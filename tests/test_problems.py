from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest

from minibrain.api import system
from minibrain.auth.roles import Role
from minibrain.models.hardware import GIB
from minibrain.registry.models import Job, JobKind, JobStatus, JoinRequest, Model, Node, now
from minibrain.storage import Space
from tests.conftest import Harness
from tests.test_compute import RACK, announce, by_name

PROBLEMS = "/api/problems"


def roomy(free: int) -> Any:
    def space(_path: Path) -> Space:
        return Space(free=free, total=1000 * GIB, device=1, mount="/data")

    return space


@pytest.fixture(autouse=True)
def plenty_of_disk(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(system, "disk_space", roomy(500 * GIB))


def join(harness: Harness, host: str = RACK.host, **hardware: Any) -> None:
    body = {"id": f"w-{host}", "host": host, "kinds": ["train"], "pool": "rack", "hardware": RACK.as_dict() | hardware}
    assert harness.internal("/register", body).status_code == 204


def report_disk(harness: Harness, free: int) -> None:
    disk = {"path": "/srv/minibrain", "mount": "/srv", "total_bytes": 1000 * GIB, "free_bytes": free}
    body = {"id": "w-gpu-01", "host": RACK.host, "kinds": ["train"], "pool": "rack", "hardware": RACK.as_dict()}
    assert harness.internal("/register", body | {"metrics": {"disks": [disk]}}).status_code == 204


def last_seen(harness: Harness, host: str, ago: timedelta) -> None:
    with harness.sessions() as session:
        node = session.get(Node, f"rack/{host}")
        assert node is not None
        node.seen_at = now() - ago
        session.commit()


def deploy(harness: Harness, slug: str = "triage", pool: str = "rack") -> None:
    with harness.sessions() as session:
        model = Model(slug=slug, name="Ticket Triage", preset="classify", base_model="qwen3-0.6b", deployed=True)
        model.pool = pool
        session.add(model)
        session.commit()


def failed_training(harness: Harness, ago: timedelta, slug: str = "triage") -> int:
    with harness.sessions() as session:
        job = Job(
            kind=JobKind.TRAIN,
            status=JobStatus.FAILED,
            model_slug=slug,
            model_name="Ticket Triage",
            version_number=2,
            finished_at=now() - ago,
        )
        session.add(job)
        session.commit()
        return job.id


def problems(client: Any, **params: str) -> list[dict[str, Any]]:
    response = client.get(PROBLEMS, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def kinds(found: list[dict[str, Any]]) -> list[str]:
    return [problem["kind"] for problem in found]


def test_a_fresh_install_has_nothing_to_look_at(harness: Harness) -> None:
    assert problems(harness.client) == []


def test_an_offline_machine_is_a_warning_and_after_a_day_can_be_removed(harness: Harness) -> None:
    join(harness)
    last_seen(harness, RACK.host, timedelta(minutes=10))
    [found] = problems(harness.client)
    assert (found["id"], found["kind"], found["severity"], found["scope"]) == (
        "machine_offline:rack/gpu-01",
        "machine_offline",
        "warning",
        "machine",
    )
    assert found["text"] == "gpu-01 is offline" and found["pool"] == "rack" and found["actions"] == []
    assert found["href"] == "/infrastructure/machines?machine=rack%2Fgpu-01" and found["since"]
    last_seen(harness, RACK.host, timedelta(days=2))
    [stale] = problems(harness.client)
    assert stale["actions"] == [{"kind": "remove_machine", "label": "Remove", "pool": "rack", "host": "gpu-01"}]
    assert harness.client.post("/api/compute/pools/rack/machines/gpu-01/drain").status_code == 204
    assert problems(harness.client) == []


def test_viewers_see_problems_but_never_admin_actions(harness: Harness) -> None:
    join(harness)
    last_seen(harness, RACK.host, timedelta(days=2))
    [found] = problems(harness.person(Role.VIEWER))
    assert found["kind"] == "machine_offline" and found["actions"] == []
    assert harness.person(None).get(PROBLEMS).status_code == 403


def test_library_versions_that_differ_from_main_are_flagged(harness: Harness) -> None:
    main = by_name(harness)["local"]["nodes"][0]["versions"]["minibrain"]
    join(harness, versions={"minibrain": f"{main}+local"})
    assert problems(harness.client) == []
    join(harness, versions={"minibrain": "0.0.1"})
    [found] = problems(harness.client)
    assert found["kind"] == "version_mismatch" and found["machine"] == "rack/gpu-01"
    assert f"minibrain 0.0.1 (main has {main})" in found["text"]


def test_a_failed_engine_is_critical_and_names_the_models_it_serves(harness: Harness) -> None:
    join(harness)
    deploy(harness)
    announce(harness, state="failed")
    found = problems(harness.client)
    assert kinds(found) == ["model_down", "engine_failed"]
    engine = found[1]
    assert engine["severity"] == "critical" and engine["models"] == ["triage"]
    assert engine["text"] == "The engine for qwen3-0.6b on gpu-01 failed" and engine["href"] == "/models/triage"


def test_a_live_model_without_a_running_replica_is_critical(harness: Harness) -> None:
    join(harness)
    deploy(harness)
    [found] = problems(harness.client)
    assert (found["kind"], found["severity"], found["models"], found["pool"]) == (
        "model_down",
        "critical",
        ["triage"],
        "rack",
    )
    assert found["text"] == "Ticket Triage is live but no replica is running"
    announce(harness, state="loading")
    assert problems(harness.client) == []


def test_low_disk_on_main_counts_each_disk_once(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(system, "disk_space", roomy(4 * GIB))
    [found] = problems(harness.client)
    assert (found["kind"], found["scope"], found["href"]) == ("disk_low", "storage", "/infrastructure/storage")
    assert found["text"] == "Main's disk /data has only 4.0 GB free"


def test_low_disk_on_a_machine_points_at_the_machine(harness: Harness) -> None:
    report_disk(harness, 500 * GIB)
    assert problems(harness.client) == []
    report_disk(harness, 2 * GIB)
    [found] = problems(harness.client)
    assert found["kind"] == "disk_low" and found["machine"] == "rack/gpu-01"
    assert found["text"] == "gpu-01 /srv has only 2.0 GB free"


def test_training_that_failed_today_and_was_not_retried_is_a_warning(harness: Harness) -> None:
    failed_training(harness, timedelta(days=2))
    assert problems(harness.client) == []
    job_id = failed_training(harness, timedelta(hours=1))
    [found] = problems(harness.client)
    assert (found["kind"], found["scope"], found["href"]) == ("training_failed", "job", f"/training/{job_id}")
    assert found["text"] == "Training Ticket Triage v2 failed" and found["models"] == ["triage"]
    with harness.sessions() as session:
        session.add(Job(kind=JobKind.TRAIN, status=JobStatus.QUEUED, model_slug="triage"))
        session.commit()
    assert problems(harness.client) == []


def test_live_models_come_first_then_disk_versions_and_offline_machines(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    join(harness, host="gpu-02")
    last_seen(harness, "gpu-02", timedelta(minutes=10))
    join(harness, versions={"minibrain": "0.0.1"})
    deploy(harness)
    failed_training(harness, timedelta(hours=1))
    monkeypatch.setattr(system, "disk_space", roomy(GIB))
    assert kinds(problems(harness.client)) == [
        "model_down",
        "disk_low",
        "version_mismatch",
        "training_failed",
        "machine_offline",
    ]


def test_scopes_narrow_to_infrastructure_or_one_model(harness: Harness) -> None:
    join(harness, host="gpu-02")
    last_seen(harness, "gpu-02", timedelta(minutes=10))
    deploy(harness)
    failed_training(harness, timedelta(hours=1))
    assert kinds(problems(harness.client, scope="infrastructure")) == ["model_down", "machine_offline"]
    assert kinds(problems(harness.client, scope="model")) == ["model_down", "training_failed"]
    assert kinds(problems(harness.client, model="triage")) == ["model_down", "training_failed"]
    assert problems(harness.client, model="other") == []


def test_machines_say_how_they_joined(harness: Harness) -> None:
    join(harness)
    rack = by_name(harness)
    assert rack["local"]["nodes"][0]["joined"] == "main" and rack["rack"]["nodes"][0]["joined"] == "token"
    with harness.sessions() as session:
        session.add(
            JoinRequest(
                code="ABC234",
                digest="d",
                host=RACK.host,
                state="approved",
                pool="rack",
                expires_at=now() + timedelta(hours=1),
            )
        )
        session.commit()
    assert by_name(harness)["rack"]["nodes"][0]["joined"] == "approval"
