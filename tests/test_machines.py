from datetime import timedelta
from typing import Any

from sqlalchemy import select

from minibrain.jobs.queue import enqueue
from minibrain.models.hardware import GIB
from minibrain.models.placement import kept_while_draining
from minibrain.models.room import size_label
from minibrain.registry.models import AuditEvent, CatalogModel, EngineReplica, Job, JobStatus, Node, Worker, now
from minibrain.worker import MachineRemovedError, MainClient
from tests.conftest import Harness
from tests.test_compute import RACK, announce, by_name
from tests.test_machine_metrics import busy_rack

RACK_WORKER = {"id": "w-rack", "host": RACK.host, "kinds": ["train"], "pool": "rack", "hardware": RACK.as_dict()}
MACHINE = "/api/compute/pools/rack/machines/gpu-01"


def join(harness: Harness, metrics: dict[str, Any] | None = None) -> None:
    body = RACK_WORKER | ({"metrics": metrics} if metrics else {})
    assert harness.internal("/register", body).status_code == 204


def claim(harness: Harness) -> Any:
    return harness.internal("/claim", {"worker": RACK_WORKER, "wait": 0})


def queue_training(harness: Harness) -> int:
    with harness.sessions() as session:
        job = enqueue(session, "train", {}, pool="rack")
        session.commit()
        return job.id


def status_of(harness: Harness, job_id: int) -> str:
    with harness.sessions() as session:
        found = session.get(Job, job_id)
        assert found is not None
        return found.status


def actions(harness: Harness) -> list[tuple[str, str]]:
    with harness.sessions() as session:
        found = session.scalars(select(AuditEvent).where(AuditEvent.action.like("machine.%")).order_by(AuditEvent.id))
        return [(event.action, event.target or "") for event in found]


def test_a_draining_machine_takes_no_new_job_until_undrained(harness: Harness) -> None:
    join(harness)
    job_id = queue_training(harness)
    assert harness.client.post(f"{MACHINE}/drain").status_code == 204
    assert by_name(harness)["rack"]["nodes"][0]["state"] == "draining"
    assert claim(harness).status_code == 204 and status_of(harness, job_id) == JobStatus.QUEUED
    assert harness.client.post(f"{MACHINE}/drain").status_code == 204
    assert harness.client.post(f"{MACHINE}/undrain").status_code == 204
    assert by_name(harness)["rack"]["nodes"][0]["state"] == "active"
    assert claim(harness).json()["job_id"] == job_id
    assert actions(harness) == [("machine.drain", "rack/gpu-01"), ("machine.undrain", "rack/gpu-01")]


def test_main_and_unknown_machines_cannot_be_drained(harness: Harness) -> None:
    host = by_name(harness)["local"]["nodes"][0]["host"]
    assert harness.client.post(f"/api/compute/pools/local/machines/{host}/drain").status_code == 409
    assert harness.client.delete(f"/api/compute/pools/local/machines/{host}").status_code == 409
    assert harness.client.post(f"{MACHINE}/drain").status_code == 404


def test_remove_refuses_while_the_machine_works_or_takes_work(harness: Harness) -> None:
    join(harness)
    refused = harness.client.delete(MACHINE)
    assert refused.status_code == 409 and "Drain it first" in refused.json()["detail"]
    queue_training(harness)
    assert harness.client.post(f"{MACHINE}/drain").status_code == 204
    with harness.sessions() as session:
        job = session.scalar(select(Job))
        assert job is not None
        job.status, job.lease_owner = JobStatus.RUNNING, "w-rack"
        session.commit()
    busy = harness.client.delete(MACHINE)
    assert busy.status_code == 409 and "still runs 1 job" in busy.json()["detail"]
    with harness.sessions() as session:
        session.query(Job).update({"status": JobStatus.SUCCEEDED})
        session.commit()
    announce(harness)
    assert "1 engine" in harness.client.delete(MACHINE).json()["detail"]


def test_removed_machines_leave_the_pool_and_are_told_to_stop(harness: Harness) -> None:
    join(harness, busy_rack())
    assert harness.client.post(f"{MACHINE}/drain").status_code == 204
    assert harness.client.delete(MACHINE).status_code == 204
    assert by_name(harness).get("rack") is None
    gone = claim(harness)
    assert gone.status_code == 410 and "removed gpu-01 from pool rack" in gone.json()["detail"]
    with harness.sessions() as session:
        assert session.scalars(select(Worker).where(Worker.host == RACK.host)).all() == []
    assert harness.client.get(f"{MACHINE}/metrics").status_code == 404
    assert actions(harness)[-1] == ("machine.remove", "rack/gpu-01")
    join(harness)
    node = by_name(harness)["rack"]["nodes"][0]
    assert (node["host"], node["state"]) == ("gpu-01", "active")


def test_an_offline_machine_can_be_removed_without_draining(harness: Harness) -> None:
    join(harness)
    with harness.sessions() as session:
        session.query(Node).update({"seen_at": now() - timedelta(minutes=10)})
        session.commit()
    assert harness.client.delete(MACHINE).status_code == 204


def test_a_removed_worker_stops_asking_for_work(harness: Harness) -> None:
    join(harness)
    harness.client.post(f"{MACHINE}/drain")
    harness.client.delete(MACHINE)
    config = harness.worker_config()
    config.host, config.pool, config.token = RACK.host, "rack", harness.join_token("rack")
    client = MainClient(config, http=harness.client)
    try:
        client.claim(0)
    except MachineRemovedError as error:
        assert "Restart minibrain worker" in str(error)
    else:
        raise AssertionError("a removed machine was given work")


def replica(session: Any, replica_id: str, host: str, state: str = "ready") -> None:
    session.add(
        EngineReplica(
            id=replica_id,
            node_id=f"rack/{host}",
            pool="rack",
            base_model="qwen3-0.6b",
            engine="sglang",
            url=f"http://{host}:9000",
            state=state,
            seen_at=now(),
        )
    )


def test_a_draining_machine_keeps_its_engine_until_another_is_ready(harness: Harness) -> None:
    placements = {"qwen3-0.6b": {"rack": 1}, "other": {"rack": 1}}
    with harness.sessions() as session:
        replica(session, "e-old", "gpu-01")
        session.commit()
        assert kept_while_draining(session, placements, "rack", "gpu-01") == ["qwen3-0.6b"]
        replica(session, "e-new", "gpu-02", "loading")
        session.commit()
        assert kept_while_draining(session, placements, "rack", "gpu-01") == ["qwen3-0.6b"]
        session.query(EngineReplica).filter_by(id="e-new").update({"state": "ready"})
        session.commit()
        assert kept_while_draining(session, placements, "rack", "gpu-01") == []


def test_two_draining_machines_keep_their_engines_until_an_active_one_is_ready(harness: Harness) -> None:
    placements = {"qwen3-0.6b": {"rack": 2}}
    with harness.sessions() as session:
        for host in ("gpu-01", "gpu-02"):
            node = Node(id=f"rack/{host}", pool="rack", host=host, roles=["worker"], hardware={}, state="draining")
            session.add(node)
            replica(session, f"e-{host}", host)
        session.commit()
        assert kept_while_draining(session, placements, "rack", "gpu-01") == ["qwen3-0.6b"]
        assert kept_while_draining(session, placements, "rack", "gpu-02") == ["qwen3-0.6b"]
        replica(session, "e-gpu-03", "gpu-03")
        session.commit()
        assert kept_while_draining(session, placements, "rack", "gpu-01") == []


def test_room_counts_models_from_measured_free_memory(harness: Harness) -> None:
    join(harness, busy_rack())
    room = by_name(harness)["rack"]["room"]
    assert room["measured"] and room["free_bytes"] == 160 * GIB
    assert room["serve_count"] >= 1 and room["serve_size"] and room["serve_bytes"] <= 160 * GIB
    assert room["train_size"] and room["train_strategy"] in {"LoRA", "QLoRA"}
    assert "measured free memory" in room["basis"]


def test_room_falls_back_to_estimates_and_prefers_the_size_already_served(harness: Harness) -> None:
    join(harness)
    announce(harness)
    room = by_name(harness)["rack"]["room"]
    with harness.sessions() as session:
        entry = session.get(CatalogModel, "qwen3-0.6b")
        assert entry is not None
        served = size_label(entry.params_b)
    assert not room["measured"] and room["free_bytes"] < 320 * GIB
    assert room["serve_size"] == served and room["serve_count"] > 10
    assert "estimated" in room["basis"]


def test_a_draining_or_offline_machine_leaves_no_room(harness: Harness) -> None:
    join(harness, busy_rack())
    harness.client.post(f"{MACHINE}/drain")
    assert by_name(harness)["rack"]["room"] is None


def test_room_sizes_read_like_model_names() -> None:
    assert [size_label(value) for value in (0.75, 7.62, 8.03, 14.77, 70.55)] == ["0.8B", "7.6B", "8B", "14B", "70B"]


def test_workers_report_their_disk_and_it_stays_after_they_go_offline(harness: Harness) -> None:
    disk = {"path": "/srv/minibrain", "mount": "/srv", "total_bytes": 100 * GIB, "free_bytes": 5 * GIB}
    join(harness, busy_rack() | {"disks": [disk | {"minibrain_bytes": 60 * GIB}]})
    node = by_name(harness)["rack"]["nodes"][0]
    assert node["disks"][0]["mount"] == "/srv" and node["disks"][0]["minibrain_bytes"] == 60 * GIB
    with harness.sessions() as session:
        session.query(Node).update({"seen_at": now() - timedelta(minutes=10)})
        session.commit()
    offline = by_name(harness)["rack"]["nodes"][0]
    assert not offline["online"] and offline["metrics"] is None
    assert offline["disks"][0]["free_bytes"] == 5 * GIB and offline["disks"][0]["reported_at"]
