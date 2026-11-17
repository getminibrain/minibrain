from datetime import timedelta
from pathlib import Path
from typing import Any

from minibrain.models.hardware import GIB
from minibrain.models.machine_metrics import (
    NVIDIA_QUERY,
    ROCM_QUERY,
    GpuSample,
    MachineSample,
    MetricsHistory,
    Sampler,
    measured_memory,
    nvidia_gpus,
    rocm_gpus,
)
from minibrain.registry.models import now
from tests.conftest import Harness
from tests.test_compute import RACK, announce, by_name

SMI = "0, 30000, 81559, 87\n1, [N/A], 81559, [N/A]\n"
MIB = 1024**2


def busy_rack(used: int = 40 * GIB, total: int = 80 * GIB) -> dict[str, Any]:
    gpus = [
        {"index": index, "memory_used_bytes": used, "memory_total_bytes": total, "utilization": 50.0 + index}
        for index in range(4)
    ]
    return {
        "gpus": gpus,
        "ram_used_bytes": 100 * GIB,
        "ram_total_bytes": 512 * GIB,
        "cpu_percent": 12.5,
    }


def report_rack(harness: Harness, metrics: dict[str, Any] | None) -> None:
    worker = {"id": "w-rack", "host": RACK.host, "kinds": ["train"], "pool": "rack", "hardware": RACK.as_dict()}
    assert harness.internal("/register", worker | {"metrics": metrics}).status_code == 204


def test_nvidia_smi_lines_become_samples_and_unknowns_stay_empty() -> None:
    first, second = nvidia_gpus(SMI)
    assert first == GpuSample(index=0, memory_used_bytes=30000 * MIB, memory_total_bytes=81559 * MIB, utilization=87)
    assert (second.memory_used_bytes, second.utilization, second.memory_total_bytes) == (None, None, 81559 * MIB)
    assert nvidia_gpus("garbage\n") == []


def test_rocm_smi_json_becomes_samples() -> None:
    output = (
        '{"card0": {"VRAM Total Memory (B)": "68702699520", "VRAM Total Used Memory (B)": "1024", "GPU use (%)": "3"}}'
    )
    assert rocm_gpus(output) == [
        GpuSample(index=0, memory_used_bytes=1024, memory_total_bytes=68702699520, utilization=3)
    ]
    assert rocm_gpus("not json") == []


def test_the_sampler_asks_nvidia_first_caches_and_reports_its_disk(tmp_path: Path) -> None:
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "weights.bin").write_bytes(b"x" * 4096)
    asked: list[list[str]] = []
    clock = [0.0]

    def run(command: list[str]) -> str | None:
        asked.append(command)
        return SMI if command == NVIDIA_QUERY else None

    sampler = Sampler(tmp_path, run=run, clock=lambda: clock[0])
    sample = sampler.sample()
    assert [gpu.index for gpu in sample.gpus] == [0, 1] and asked == [NVIDIA_QUERY]
    assert sample.ram_total_bytes and sample.cpu_percent is None
    disk = sample.disks[0]
    assert disk.path == str(tmp_path) and disk.minibrain_bytes == 4096 and disk.total_bytes and disk.free_bytes
    clock[0] = 5.0
    assert sampler.sample() is sample and len(asked) == 1
    clock[0] = 20.0
    assert sampler.sample() is not sample and sampler.sample().cpu_percent is not None


def test_the_sampler_reports_model_copies_and_downloads_as_cache(tmp_path: Path) -> None:
    for parts, size in (
        (("worker", "models", "qwen", "weights.bin"), 1000),
        (("worker", "cache", "a1", "rows.parquet"), 200),
        (("engines", "qwen", "weights", "w.bin"), 30),
        (("worker", "work", "job-4", "checkpoint.bin"), 7),
    ):
        path = tmp_path.joinpath(*parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x" * size)
    disk = Sampler(tmp_path, run=lambda command: None).sample().disks[0]
    assert disk.cache_bytes == 1230 and disk.minibrain_bytes == 1237


def test_machines_without_a_gpu_tool_report_no_gpus_rather_than_guesses() -> None:
    sample = Sampler(run=lambda command: None).sample()
    assert sample.gpus == [] and sample.disks == []
    assert measured_memory(sample, "cuda") is None
    assert measured_memory(sample, "mps") == (sample.ram_used_bytes, sample.ram_total_bytes)
    assert ROCM_QUERY[0] == "rocm-smi"


def test_history_keeps_one_hour_at_the_heartbeat_spacing() -> None:
    history = MetricsHistory(window=timedelta(hours=1), spacing=timedelta(seconds=10))
    start = now() - timedelta(minutes=90)
    sample = MachineSample(cpu_percent=1.0)
    assert history.record("rack/gpu-01", sample, start)
    assert not history.record("rack/gpu-01", sample, start + timedelta(seconds=5))
    for minute in range(1, 91):
        history.record("rack/gpu-01", sample, start + timedelta(minutes=minute))
    kept = history.history("rack/gpu-01")
    assert len(kept) == 60 and kept[0].at >= now() - timedelta(hours=1)
    history.record("rack/gpu-02", sample, start)
    history.record("rack/gpu-01", sample, now() + timedelta(seconds=20))
    assert history.history("rack/gpu-02") == [] and "rack/gpu-02" not in history.points
    assert history.latest("rack/gpu-01") is not None
    history.forget("rack/gpu-01")
    assert history.latest("rack/gpu-01") is None


def test_workers_report_measured_memory_with_each_heartbeat(harness: Harness) -> None:
    report_rack(harness, busy_rack())
    node = by_name(harness)["rack"]["nodes"][0]
    metrics = node["metrics"]
    assert (metrics["memory_used_bytes"], metrics["memory_total_bytes"]) == (160 * GIB, 320 * GIB)
    assert metrics["gpu_percent"] == 51.5 and metrics["cpu_percent"] == 12.5
    assert metrics["ram_used_bytes"] == 100 * GIB
    found = harness.client.get("/api/compute/pools/rack/machines/gpu-01/metrics").json()
    assert found["current"]["memory_used_bytes"] == 160 * GIB
    assert [point["gpu_percent"] for point in found["history"]] == [51.5]


def test_engines_report_metrics_too_and_unreported_values_stay_null(harness: Harness) -> None:
    announce(harness, metrics={"gpus": [{"index": 0}], "ram_used_bytes": None})
    node = by_name(harness)["rack"]["nodes"][0]
    assert node["metrics"]["memory_used_bytes"] is None and node["metrics"]["gpu_percent"] is None


def test_a_machine_that_never_reported_has_no_metrics(harness: Harness) -> None:
    report_rack(harness, None)
    assert by_name(harness)["rack"]["nodes"][0]["metrics"] is None
    found = harness.client.get("/api/compute/pools/rack/machines/gpu-01/metrics").json()
    assert found == {"current": None, "history": []}
    assert harness.client.get("/api/compute/pools/rack/machines/nowhere/metrics").status_code == 404


def test_out_of_range_samples_are_refused(harness: Harness) -> None:
    worker = {"id": "w-rack", "host": RACK.host, "kinds": ["train"], "pool": "rack", "hardware": RACK.as_dict()}
    bad = {"gpus": [{"index": 0, "utilization": 400}]}
    assert harness.internal("/register", worker | {"metrics": bad}).status_code == 422
