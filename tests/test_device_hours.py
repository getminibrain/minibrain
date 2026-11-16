import pytest

from minibrain.jobs.device_time import device_time
from tests.conftest import Harness
from tests.test_flow import SLUG
from tests.test_worker import FAKE, queued_training, train_job

pytestmark = pytest.mark.both_stores


def trained(harness: Harness) -> tuple[dict, dict]:
    queued_training(harness)
    assert harness.worker(kinds=["train"], modules=FAKE).run_once()
    version = harness.client.get(f"/api/models/{SLUG}/versions").json()[0]
    return train_job(harness), version


def test_a_gpu_run_records_wall_time_times_its_accelerators(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAKE_JOB_DEVICE", "cuda")
    monkeypatch.setenv("FAKE_JOB_DEVICES", "2")
    monkeypatch.setenv("FAKE_JOB_SECONDS", "0.4")
    job, version = trained(harness)
    recorded = job["result"]["device_time"]
    assert (recorded["kind"], recorded["devices"]) == ("gpu", 2)
    assert recorded["seconds"] >= 0.4
    assert recorded["hours"] == pytest.approx(recorded["seconds"] * 2 / 3600, abs=1e-4)
    assert version["device_time"] == recorded


def test_a_cpu_run_reports_cpu_hours(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAKE_JOB_DEVICE", "cpu")
    job, version = trained(harness)
    assert (version["device_time"]["kind"], version["device_time"]["devices"]) == ("cpu", 1)
    assert job["result"]["device_time"] == version["device_time"]


def test_a_version_without_a_training_run_has_no_device_time(harness: Harness) -> None:
    queued_training(harness)
    versions = harness.client.get(f"/api/models/{SLUG}/versions").json()
    assert [item["device_time"] for item in versions] == [None, None]


@pytest.mark.parametrize(
    ("summary", "kind", "devices"),
    [
        ({"device": "mps"}, "gpu", 1),
        ({"device": "cuda:1", "devices": 4}, "gpu", 4),
        ({"device": "xpu", "devices": 0}, "gpu", 1),
        ({}, "cpu", 1),
    ],
)
def test_device_time_counts_accelerators(summary: dict, kind: str, devices: int) -> None:
    found = device_time(summary, 1800.0)
    assert (found["kind"], found["devices"], found["seconds"]) == (kind, devices, 1800.0)
    assert found["hours"] == 0.5 * devices
