from dataclasses import replace
from typing import Any, ClassVar

import pytest
from sqlalchemy import select

from minibrain.base_models import QWEN3_0_6B
from minibrain.ml import strategies
from minibrain.models.gpu_book import GpuBook, LocalEngineGpus
from minibrain.models.gpus import (
    BUDGET_ENV,
    CEILING_ENV,
    FRACTION_ENV,
    VISIBLE_DEVICES,
    Grant,
    Hold,
    NoGpuError,
    choose,
)
from minibrain.models.hardware import GIB, Gpu, NodeReport
from minibrain.registry.models import Job
from minibrain.serve import engines as engines_module
from minibrain.serve import sglang_backend, vllm_backend
from minibrain.serve.backend import EngineUnavailableError
from minibrain.serve.engines import EngineManager
from minibrain.worker import MainClient, job_env
from tests.conftest import Harness
from tests.test_compute import RACK
from tests.test_deploy_pools import deploy, host, join
from tests.test_flow import SLUG, add_version, create_with_dataset

TWO_GPUS = replace(RACK, gpus=[Gpu("NVIDIA H100 80GB HBM3", 80 * GIB)] * 2, usable_bytes=160 * GIB)
SMALL_GPU = replace(RACK, host="gpu-small", gpus=[Gpu("NVIDIA T4", 3 * GIB)], usable_bytes=3 * GIB)
MAC = replace(RACK, host="mac", system="darwin", arch="arm64", accelerator="mps", gpus=[Gpu("Apple GPU", 12 * GIB)])
OTHER = replace(QWEN3_0_6B, key="qwen3-other")


class Recorded:
    started: ClassVar[list["Recorded"]] = []

    def __init__(self, name: str, command: list[str], env: dict[str, str]) -> None:
        self.name, self.command, self.env = name, command, env
        self.down = False

    def start(self) -> None:
        Recorded.started.append(self)

    def shutdown(self) -> None:
        self.down = True


@pytest.fixture
def recorded(monkeypatch: pytest.MonkeyPatch) -> list[Recorded]:
    Recorded.started = []
    monkeypatch.setattr(engines_module, "Supervisor", Recorded)
    return Recorded.started


def manager_on(harness: Harness, node: NodeReport) -> tuple[EngineManager, GpuBook]:
    book = GpuBook(harness.sessions)
    return EngineManager(harness.settings, "http://main", gpus=LocalEngineGpus(book, lambda: node)), book


def test_whole_gpus_go_first_and_a_share_only_where_the_base_fits() -> None:
    first = choose(TWO_GPUS, [], 10 * GIB, 20 * GIB)
    assert first is not None and (first.device, first.bytes, first.beside_bytes) == (0, 20 * GIB, 0)
    second = choose(TWO_GPUS, [first.hold("a")], 10 * GIB, 20 * GIB)
    assert second is not None and second.device == 1
    third = choose(TWO_GPUS, [first.hold("a"), Hold("b", 1, 30 * GIB)], 10 * GIB, 20 * GIB)
    assert third is not None and (third.device, third.beside_bytes) == (0, 20 * GIB)
    assert third.fraction == 0.25 and third.ceiling == 0.5
    job = choose(TWO_GPUS, [first.hold("a")], 30 * GIB)
    assert job is not None and (job.device, job.bytes) == (1, 80 * GIB)
    assert choose(TWO_GPUS, [Hold("a", 0, 70 * GIB), Hold("b", 1, 70 * GIB)], 10 * GIB) is None


def test_two_engines_on_a_two_gpu_machine_get_different_devices(harness: Harness, recorded: list[Recorded]) -> None:
    manager, book = manager_on(harness, TWO_GPUS)
    manager.start(QWEN3_0_6B)
    manager.start(OTHER)
    devices = [found.env[VISIBLE_DEVICES] for found in recorded]
    assert devices == ["0", "1"]
    for found in recorded:
        assert float(found.env[FRACTION_ENV]) > 0 and found.env[CEILING_ENV] == found.env[FRACTION_ENV]
    machine = f"local/{TWO_GPUS.host}"
    assert sorted(book.engine_grants(machine)) == sorted([QWEN3_0_6B.key, OTHER.key])
    manager.stop_one(QWEN3_0_6B.key)
    assert recorded[0].down and list(book.engine_grants(machine)) == [OTHER.key]


def test_an_engine_with_no_gpu_left_waits_and_says_why(harness: Harness, recorded: list[Recorded]) -> None:
    manager, _ = manager_on(harness, SMALL_GPU)
    manager.start(QWEN3_0_6B)
    with pytest.raises(
        EngineUnavailableError, match=f"Waiting for a GPU on gpu-small .* for the engine for {OTHER.key}"
    ):
        manager.ensure_one(OTHER)
    manager.ensure({OTHER.key: OTHER}, {})
    assert OTHER.key not in manager.engines and "GPU 0 has" in manager.waits[OTHER.key]
    assert len(recorded) == 1


def test_apple_and_cpu_machines_start_engines_as_before(harness: Harness, recorded: list[Recorded]) -> None:
    manager, book = manager_on(harness, MAC)
    manager.start(QWEN3_0_6B)
    manager.start(OTHER)
    assert all(VISIBLE_DEVICES not in found.env and FRACTION_ENV not in found.env for found in recorded)
    assert book.local == {}


def test_engine_commands_carry_the_memory_fraction(monkeypatch: pytest.MonkeyPatch) -> None:
    assert "--mem-fraction-static" not in sglang_backend.launch_command(QWEN3_0_6B, 9000)
    monkeypatch.setenv(FRACTION_ENV, "0.25")
    monkeypatch.setenv(CEILING_ENV, "0.60")
    sglang = sglang_backend.launch_command(QWEN3_0_6B, 9000)
    assert sglang[sglang.index("--mem-fraction-static") + 1] == "0.60"
    vllm = vllm_backend.launch_command(QWEN3_0_6B, 9000)
    assert vllm[vllm.index("--gpu-memory-utilization") + 1] == "0.25"


def test_granted_devices_follow_the_devices_the_machine_was_given(monkeypatch: pytest.MonkeyPatch) -> None:
    grant = Grant(1, 40 * GIB, 80 * GIB)
    assert grant.job_env({}) == {VISIBLE_DEVICES: "1", BUDGET_ENV: str(40 * GIB)}
    assert grant.engine_env({VISIBLE_DEVICES: "2,3"})[VISIBLE_DEVICES] == "3"
    claim = {"env": {"AWS_REGION": "x"}, "gpu": grant.as_dict()}
    monkeypatch.delenv(VISIBLE_DEVICES, raising=False)
    assert job_env(claim) == {"AWS_REGION": "x", VISIBLE_DEVICES: "1", BUDGET_ENV: str(40 * GIB)}
    assert job_env({"env": {}}) == {}


def test_training_plans_within_the_memory_it_was_given(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(strategies, "whole_device_memory", lambda _device: 80 * GIB)
    monkeypatch.delenv(BUDGET_ENV, raising=False)
    assert strategies.device_memory("cuda") == 80 * GIB
    monkeypatch.setenv(BUDGET_ENV, str(30 * GIB))
    assert strategies.device_memory("cuda") == 30 * GIB


class Stub:
    def shutdown(self) -> None:
        return None


def train_job(harness: Harness) -> Job:
    with harness.sessions() as session:
        found = session.scalar(select(Job).where(Job.kind == "train"))
        assert found is not None
        return found


def claim_on(harness: Harness, node: NodeReport, pool: str = "local") -> dict[str, Any] | None:
    worker = {"id": f"w-{node.host}", "host": node.host, "kinds": ["train"], "gpus": 1, "pool": pool}
    response = harness.internal("/claim", {"worker": worker | {"hardware": node.as_dict()}, "wait": 0})
    return None if response.status_code == 204 else response.json()


def test_training_waits_while_a_live_engine_holds_the_only_gpu(harness: Harness) -> None:
    create_with_dataset(harness)
    add_version(harness, "lora")
    job_id = train_job(harness).id
    engine = LocalEngineGpus(harness.app.state.gpus, lambda: SMALL_GPU)
    assert engine.grant(QWEN3_0_6B.key) is not None
    assert claim_on(harness, SMALL_GPU) is None
    waiting = harness.client.get(f"/api/jobs/{job_id}").json()["waiting"]
    assert waiting.startswith("Waiting for a GPU on gpu-small with ") and f"for training job {job_id}" in waiting
    assert f"GPU 0 has 0.0 GB free (the engine for {QWEN3_0_6B.key} holds" in waiting
    engine.release(QWEN3_0_6B.key)
    claim = claim_on(harness, SMALL_GPU)
    assert claim is not None and claim["job_id"] == job_id
    assert claim["gpu"] == {"device": 0, "bytes": 3 * GIB, "total_bytes": 3 * GIB, "beside_bytes": 0}
    shown = harness.client.get(f"/api/jobs/{job_id}").json()
    assert shown["waiting"] is None and shown["status"] == "running"
    with pytest.raises(NoGpuError, match=f"training job {job_id} holds 3.0 GB"):
        engine.grant(QWEN3_0_6B.key)


def test_jobs_on_apple_or_cpu_machines_get_no_gpu(harness: Harness) -> None:
    create_with_dataset(harness)
    add_version(harness, "lora")
    claim = claim_on(harness, MAC)
    assert claim is not None and claim["gpu"] is None and VISIBLE_DEVICES not in job_env(claim)


def test_a_joined_machine_reports_its_engine_gpus_and_jobs_wait_for_them(harness: Harness) -> None:
    body = join(harness, "rack", SMALL_GPU)
    create_with_dataset(harness)
    engine_host, started = host(harness, body)
    launched: list[dict[str, str]] = []

    def launch(key: str, _token: str, env: dict[str, str]) -> Stub:
        launched.append(env)
        started.append(key)
        return Stub()

    engine_host.launch = launch
    assert deploy(harness, "rack").status_code == 200
    engine_host.reconcile()
    assert started == [QWEN3_0_6B.key] and launched[0][VISIBLE_DEVICES] == "0" and FRACTION_ENV in launched[0]
    assert engine_host.config.engine_gpus[QWEN3_0_6B.key]["device"] == 0
    response = harness.client.post(
        f"/api/models/{SLUG}/versions", json={"kind": "lora", "max_rows": 100, "pool": "rack"}
    )
    assert response.status_code == 201, response.text
    assert MainClient(engine_host.config, http=harness.client).claim(0) is None
    waiting = train_job(harness).waiting
    assert waiting is not None and f"the engine for {QWEN3_0_6B.key} holds" in waiting
    engine_host.stop_all()
    claim = MainClient(engine_host.config, http=harness.client).claim(0)
    assert claim is not None and claim["gpu"]["device"] == 0
