from datetime import timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select

from minibrain.auth.roles import Role
from minibrain.maintenance import purge_old_job_logs
from minibrain.registry import settings_store
from minibrain.registry.models import (
    Artifact,
    AuditEvent,
    BaseModel,
    BaseModelStatus,
    Dataset,
    DatasetVersion,
    Job,
    JobAttempt,
    JobEvent,
    JobKind,
    JobStatus,
    Model,
    Source,
    Version,
    now,
)
from tests.conftest import Harness


def add_base(harness: Harness, key: str, size: int, deployed: bool = False) -> None:
    with harness.sessions() as session:
        session.add(
            BaseModel(
                id=key,
                source="download",
                name=key,
                status=BaseModelStatus.AVAILABLE,
                size_bytes=size,
                deployed=deployed,
            )
        )
        session.commit()


def add_model(harness: Harness, slug: str, base: str, adapters: list[int]) -> None:
    with harness.sessions() as session:
        model = Model(slug=slug, name=slug.title(), preset="classify", base_model=base)
        session.add(model)
        session.flush()
        for number, size in enumerate(adapters, start=1):
            artifact = f"{slug}-adapter-{number}"
            session.add(Artifact(id=artifact, kind="adapter", packing="tar", name="adapter", size=size))
            session.add(
                Version(
                    model_id=model.id,
                    number=number,
                    kind="sft",
                    status="ready",
                    base_model=base,
                    adapter_artifact_id=artifact,
                )
            )
        session.commit()


def add_dataset(harness: Harness, slug: str, sizes: list[int], trained: int | None = None) -> None:
    with harness.sessions() as session:
        dataset = Dataset(slug=slug, name=slug.title())
        session.add(dataset)
        session.flush()
        for number, size in enumerate(sizes, start=1):
            artifact = f"{slug}-rows-{number}"
            session.add(Artifact(id=artifact, kind="dataset_version", packing="parquet", name="rows", size=size))
            version = DatasetVersion(
                dataset_id=dataset.id,
                number=number,
                hash=f"{slug}-{number}",
                artifact_id=artifact,
                counts={},
                labels=[],
                size=size,
            )
            session.add(version)
            session.flush()
            if number == trained:
                model = session.scalars(select(Model)).first()
                assert model is not None
                session.add(
                    Version(
                        model_id=model.id,
                        number=99,
                        kind="sft",
                        status="ready",
                        base_model=model.base_model,
                        dataset_version_id=version.id,
                    )
                )
        session.commit()


def log_id(job_id: int) -> str:
    return f"{job_id:064x}"


def finished_job(harness: Harness, days_ago: float, log_size: int, status: str = JobStatus.SUCCEEDED) -> int:
    with harness.sessions() as session:
        job = Job(
            kind=JobKind.TRAIN,
            status=status,
            model_name="Triage",
            finished_at=now() - timedelta(days=days_ago) if status != JobStatus.RUNNING else None,
        )
        session.add(job)
        session.flush()
        artifact = log_id(job.id)
        session.add(Artifact(id=artifact, kind="log", packing="file", name="log.txt", size=log_size))
        session.add(JobAttempt(job_id=job.id, number=1, worker="w", log_artifact_id=artifact))
        session.add(JobEvent(job_id=job.id, attempt=1, kind="log", message="loss 0.1"))
        session.add(JobEvent(job_id=job.id, attempt=1, kind="event", message="trained", name="done"))
        session.commit()
        return job.id


def checkpoint(harness: Harness, job_id: int, size: int) -> Path:
    folder = harness.settings.home / "worker" / "work" / f"job-{job_id}"
    (folder / "checkpoints").mkdir(parents=True)
    (folder / "checkpoints" / "state.bin").write_bytes(b"x" * size)
    return folder


def infrastructure(harness: Harness) -> dict[str, Any]:
    return harness.client.get("/api/system/infrastructure").json()


def groups(info: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {group["kind"]: group for group in info["usage"]}


def test_usage_groups_space_by_base_model_adapter_dataset_upload_job_and_database(harness: Harness) -> None:
    add_base(harness, "qwen3-0.6b", 5000)
    add_base(harness, "spare-1b", 3000)
    add_model(harness, "triage", "qwen3-0.6b", [40, 60])
    add_model(harness, "intent", "qwen3-0.6b", [10])
    add_dataset(harness, "tickets", [300, 200])
    with harness.sessions() as session:
        session.add(Artifact(id="upload-1", kind="source", packing="raw", name="tickets.csv", size=900))
        session.add(
            Source(name="tickets.csv", filename="tickets.csv", table_name="tickets_csv", artifact_id="upload-1")
        )
        session.commit()
    job_id = finished_job(harness, 1, 40)
    checkpoint(harness, job_id, 500)
    found = groups(infrastructure(harness))
    bases = found["bases"]
    assert [item["key"] for item in bases["items"]] == ["qwen3-0.6b", "spare-1b"] and bases["size_bytes"] == 8000
    assert [ref["key"] for ref in bases["items"][0]["used_by"]] == ["intent", "triage"]
    adapters = {item["key"]: (item["size_bytes"], item["count"]) for item in found["adapters"]["items"]}
    assert adapters == {"triage": (100, 2), "intent": (10, 1)} and found["adapters"]["size_bytes"] == 110
    assert (found["datasets"]["items"][0]["size_bytes"], found["datasets"]["items"][0]["count"]) == (500, 2)
    assert found["uploads"]["items"][0]["name"] == "tickets.csv" and found["uploads"]["size_bytes"] == 900
    assert found["jobs"]["items"] == [
        found["jobs"]["items"][0] | {"key": str(job_id), "name": "Triage", "size_bytes": 540}
    ]
    assert found["database"]["count"] == 1 and found["database"]["size_bytes"] > 0


def test_free_up_suggests_only_what_nothing_uses(harness: Harness) -> None:
    for key in ("qwen3-0.6b", "spare-1b", "judge-1b", "served-1b"):
        add_base(harness, key, 1000, deployed=key == "served-1b")
    add_model(harness, "triage", "qwen3-0.6b", [10])
    with harness.sessions() as session:
        model = session.scalars(select(Model).where(Model.slug == "triage")).one()
        model.judge_model = "judge-1b"
        settings_store.write(session, "judge", {"model": "install-judge"})
        session.commit()
    add_dataset(harness, "tickets", [300, 200, 100, 50], trained=2)
    with harness.sessions() as session:
        session.add(Artifact(id="spare-csv", kind="source", packing="raw", name="old.csv", size=70))
        session.add(Source(name="old.csv", filename="old.csv", table_name="old_csv", artifact_id="spare-csv"))
        session.commit()
    finished_job(harness, 10, 40)
    finished_job(harness, 1, 40)
    found = {(item["kind"], item["key"]): item for item in infrastructure(harness)["free_up"]}
    assert set(found) == {("base", "spare-1b"), ("dataset", "tickets"), ("source", "1"), ("job_logs", "job_logs")}
    assert (found["dataset", "tickets"]["count"], found["dataset", "tickets"]["size_bytes"]) == (2, 400)
    assert (found["job_logs", "job_logs"]["count"], found["job_logs", "job_logs"]["days"]) == (1, 7)


def test_job_log_retention_defaults_to_30_days_and_changes_are_audited(harness: Harness) -> None:
    assert harness.client.get("/api/settings/job-logs").json() == {"days": 30}
    builder = harness.person(Role.BUILDER)
    assert builder.put("/api/settings/job-logs", json={"days": 7}).status_code == 403
    assert harness.client.put("/api/settings/job-logs", json={"days": 7}).json() == {"days": 7}
    assert infrastructure(harness)["job_log_days"] == 7
    with harness.sessions() as session:
        event = session.scalars(select(AuditEvent).where(AuditEvent.action == "job_logs.retention")).one()
        assert event.detail | {"from": 30, "to": 7} == event.detail


def test_retention_removes_old_logs_and_checkpoints_of_finished_jobs_only(harness: Harness) -> None:
    old = finished_job(harness, 40, 40, JobStatus.FAILED)
    recent = finished_job(harness, 2, 40)
    running = finished_job(harness, 0, 40, JobStatus.RUNNING)
    folders = {job_id: checkpoint(harness, job_id, 100) for job_id in (old, recent, running)}
    orphan = checkpoint(harness, 9999, 100)
    with harness.sessions() as session:
        assert purge_old_job_logs(session, harness.settings) == 2
    with harness.sessions() as session:
        logs = {attempt.job_id: attempt.log_artifact_id for attempt in session.scalars(select(JobAttempt))}
        assert logs == {old: None, recent: log_id(recent), running: log_id(running)}
        assert session.get(Artifact, log_id(old)) is None
        kinds = {(event.job_id, event.kind) for event in session.scalars(select(JobEvent))}
        assert (old, "log") not in kinds and (old, "event") in kinds and (recent, "log") in kinds
        event = session.scalars(select(AuditEvent).where(AuditEvent.action == "job_logs.purge")).one()
        assert event.actor == "system" and event.detail["jobs"] == 2 and event.detail["folders"] == 2
    assert not folders[old].exists() and not orphan.exists()
    assert folders[recent].exists() and folders[running].exists()


def test_forever_keeps_every_log(harness: Harness) -> None:
    finished_job(harness, 400, 40)
    harness.client.put("/api/settings/job-logs", json={"days": 0})
    with harness.sessions() as session:
        assert purge_old_job_logs(session, harness.settings) == 0


def test_an_admin_deletes_old_job_logs_from_the_storage_page(harness: Harness) -> None:
    old = finished_job(harness, 10, 40)
    finished_job(harness, 1, 40)
    builder = harness.person(Role.BUILDER)
    assert builder.post("/api/system/job-logs/purge", json={"older_than_days": 7}).status_code == 403
    answer = harness.client.post("/api/system/job-logs/purge", json={"older_than_days": 7}).json()
    assert answer == {"jobs": 1, "size_bytes": 40}
    with harness.sessions() as session:
        assert session.get(Artifact, log_id(old)) is None
        event = session.scalars(select(AuditEvent).where(AuditEvent.action == "job_logs.purge")).one()
        assert event.actor != "system" and event.detail["days"] == 7
    assert [item["kind"] for item in infrastructure(harness)["free_up"]] == []
