from collections.abc import Callable
from datetime import datetime, timedelta
from itertools import pairwise
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from minibrain.jobs.queue import enqueue
from minibrain.registry.models import (
    ApiKey,
    Artifact,
    AuditEvent,
    BaseModel,
    BaseModelStatus,
    Dataset,
    DatasetVersion,
    JobKind,
    JobStatus,
    Model,
    RequestLog,
    Version,
    VersionKind,
    VersionStatus,
    now,
)
from tests.conftest import Harness, blank_dataset

STATUS_RANK = {"running": 0, "queued": 1, "succeeded": 2, "failed": 3, "cancelled": 4}
JOB_SORTS = ["id", "kind", "model", "status", "pool", "started", "duration", "score", "trained_on", "gpu_hours"]
REQUEST_SORTS = ["at", "model", "kind", "key", "status", "latency", "tokens"]
AUDIT_SORTS = ["at", "actor", "action"]


def when(text: str | None) -> datetime | None:
    return datetime.fromisoformat(text) if text else None


def seconds(job: dict[str, Any]) -> float:
    started, finished = when(job["started_at"]), when(job["finished_at"])
    if started is None:
        return -1.0
    return ((finished or datetime.now(started.tzinfo)) - started).total_seconds()


def trained_on(job: dict[str, Any]) -> tuple[str, str, int]:
    on = job["trained_on"] or {}
    base = (on.get("base_model_name") or on.get("base_model") or "").lower()
    number = on.get("dataset_version")
    return (base, (on.get("dataset") or "").lower(), -1 if number is None else number)


def owner(job: dict[str, Any]) -> str:
    return (job["model_name"] or job["base_model_name"] or job["model"] or job["base_model"] or "").lower()


JOB_KEYS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "id": lambda job: (),
    "kind": lambda job: (job["kind"], -1 if job["version"] is None else job["version"]),
    "model": lambda job: (owner(job),),
    "status": lambda job: (STATUS_RANK[job["status"]],),
    "pool": lambda job: ((job["pool"] or "").lower(),),
    "started": lambda job: (when(job["started_at"]) or when(job["created_at"]),),
    "duration": lambda job: (round(seconds(job), 3),),
    "score": lambda job: (-1 if job["score"] is None else job["score"],),
    "trained_on": trained_on,
    "gpu_hours": lambda job: (-1 if job["device_time"] is None else job["device_time"]["hours"],),
}


def as_tuple(value: Any) -> tuple[Any, ...]:
    return value if isinstance(value, tuple) else (value,)


def walk(harness: Harness, path: str, params: dict[str, Any], cursor_name: str = "cursor") -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor = None
    while True:
        query = params | ({cursor_name: cursor} if cursor else {})
        response = harness.client.get(path, params=query)
        assert response.status_code == 200, response.text
        body = response.json()
        items += body.get("items", body.get("events", []))
        cursor = body["next_cursor"]
        if cursor is None:
            return items


def assert_ordered(items: list[dict[str, Any]], key: Callable[[dict[str, Any]], Any], descending: bool) -> None:
    ids = [item["id"] for item in items]
    assert len(ids) == len(set(ids))
    full = [(*as_tuple(key(item)), item["id"]) for item in items]
    assert full == sorted(full, reverse=descending)


def new_model(harness: Harness, name: str) -> int:
    slug = harness.client.post(
        "/api/models",
        json={"dataset": blank_dataset(harness.client), "preset": "classify", "labels": ["a", "b"], "name": name},
    ).json()["slug"]
    with harness.sessions() as session:
        return session.scalars(select(Model.id).where(Model.slug == slug)).one()


def scored_version(
    model_id: int, number: int, score: float | None, hours: float | None, data: int | None, base: str = "qwen-test"
) -> Version:
    metrics = None if score is None else {"eval": {"scores": [{"metric": "label_accuracy", "value": score}]}}
    device = None if hours is None else {"kind": "gpu", "devices": 1, "seconds": hours * 3600, "hours": hours}
    return Version(
        model_id=model_id,
        number=number,
        kind=VersionKind.LORA,
        status=VersionStatus.READY,
        base_model=base,
        graders=[{"name": "label_accuracy"}],
        metrics=metrics,
        device_time=device,
        dataset_version_id=data,
    )


def dataset_versions(session: Session) -> list[int | None]:
    found: list[int | None] = [None]
    for slug in ("zoo", "Apples"):
        dataset = Dataset(slug=slug.lower(), name=slug)
        session.add(dataset)
        session.flush()
        for number in (1, 2):
            artifact = f"{slug}-{number}"
            session.add(Artifact(id=artifact, kind="dataset_version", packing="parquet", name="rows", size=1))
            version = DatasetVersion(
                dataset_id=dataset.id, number=number, hash=artifact, artifact_id=artifact, counts={}, labels=[]
            )
            session.add(version)
            session.flush()
            found.append(version.id)
    return found


def seed_jobs(harness: Harness) -> list[int]:
    alpha = new_model(harness, "Alpha")
    beta = new_model(harness, "beta")
    moment = now()
    statuses = [JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.QUEUED, JobStatus.CANCELLED, JobStatus.SUCCEEDED]
    kinds = [JobKind.TRAIN, JobKind.EVAL, JobKind.DOWNLOAD]
    pools = ["gpu-a", None, "Local", "gpu-a"]
    bases = ["qwen-test", "llama-x", "Mistral"]
    with harness.sessions() as session:
        session.add(BaseModel(id="llama-x", source="download", name="Zephyr", status=BaseModelStatus.AVAILABLE))
        data = dataset_versions(session)
        ids: list[int] = []
        for index in range(31):
            owner = (alpha, beta, None)[index % 3]
            job = enqueue(session, kinds[(index // 2) % 3], {"n": index}, model_id=owner)
            job.status = statuses[index % 5] if index % 7 else JobStatus.SUCCEEDED
            job.pool = pools[index % 4]
            job.created_at = moment - timedelta(minutes=index)
            if job.status != JobStatus.QUEUED:
                started = moment - timedelta(minutes=index, seconds=30)
                job.started_at = started
                job.finished_at = started + timedelta(seconds=(index * 7) % 5 * 10)
            if owner is not None and job.kind in (JobKind.TRAIN, JobKind.EVAL):
                score = None if index % 4 == 0 else round((index % 6) / 10, 2)
                hours = None if index % 5 == 0 else (index % 3) * 0.5
                chosen = data[index % len(data)]
                version = scored_version(owner, 100 + index, score, hours, chosen, bases[index % 3])
                session.add(version)
                session.flush()
                job.version_id = version.id
                job.model_slug = "alpha" if owner == alpha else "beta"
            ids.append(job.id)
        session.commit()
        return ids


@pytest.mark.parametrize("descending", [True, False])
def test_every_job_sort_pages_in_order_without_gaps_or_duplicates(harness: Harness, descending: bool) -> None:
    ids = seed_jobs(harness)
    order = "desc" if descending else "asc"
    for sort in JOB_SORTS:
        items = walk(harness, "/api/jobs", {"sort": sort, "order": order, "limit": 4})
        assert sorted(item["id"] for item in items) == sorted(ids), sort
        assert_ordered(items, JOB_KEYS[sort], descending)


def test_job_list_defaults_to_newest_first(harness: Harness) -> None:
    ids = seed_jobs(harness)
    assert [item["id"] for item in walk(harness, "/api/jobs", {"limit": 5})] == sorted(ids, reverse=True)


def test_job_sort_keeps_filters(harness: Harness) -> None:
    seed_jobs(harness)
    items = walk(harness, "/api/jobs", {"sort": "score", "order": "desc", "kind": "train", "limit": 2})
    assert items and all(item["kind"] == "train" for item in items)
    assert_ordered(items, JOB_KEYS["score"], descending=True)


def test_version_score_follows_metrics_and_graders(harness: Harness) -> None:
    model = new_model(harness, "Gamma")
    with harness.sessions() as session:
        version = scored_version(model, 50, 0.4, None, None)
        session.add(version)
        session.commit()
        assert version.score == 0.4
        version.metrics = {"eval": {"scores": [{"metric": "label_accuracy", "value": 0.9}]}}
        session.commit()
        assert version.score == 0.9
        version.graders = []
        session.commit()
        assert version.score is None


@pytest.mark.parametrize(
    ("path", "cursor"),
    [("/api/jobs", "cursor"), ("/api/requests", "cursor"), ("/api/audit", "next")],
)
def test_unknown_sort_keys_and_foreign_cursors_are_rejected(harness: Harness, path: str, cursor: str) -> None:
    assert harness.client.get(path, params={"sort": "secret"}).status_code == 422
    assert harness.client.get(path, params={"order": "sideways"}).status_code == 422
    assert harness.client.get(path, params={cursor: "WyJ4Il0"}).status_code == 422
    assert harness.client.get(path, params={cursor: "!!"}).status_code == 422


def seed_requests(harness: Harness) -> list[int]:
    model = new_model(harness, "Requests model")
    moment = now()
    with harness.sessions() as session:
        keys = [ApiKey(name=name, prefix=f"mb_{name}", digest=f"{name}-digest") for name in ("zeta", "Alpha")]
        session.add_all(keys)
        session.flush()
        logs = [
            RequestLog(
                at=moment - timedelta(seconds=index),
                model_id=model if index % 3 else None,
                model="requests-model" if index % 3 else f"base-{index % 2}",
                model_slug="requests-model" if index % 3 else None,
                status=(200, 404, 503, 200)[index % 4],
                latency_ms=float((index * 37) % 11),
                prompt_tokens=(index * 5) % 7,
                completion_tokens=index % 3,
                key_id=keys[index % 2].id if index % 5 else None,
                kind="completion" if index % 4 == 1 else "chat",
            )
            for index in range(19)
        ]
        session.add_all(logs)
        session.commit()
        return [log.id for log in logs]


REQUEST_KEYS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "at": lambda row: (),
    "model": lambda row: (row["model_name"].lower(),),
    "kind": lambda row: (row["kind"],),
    "key": lambda row: ((row["key_name"] or "").lower(),),
    "status": lambda row: (row["status"],),
    "latency": lambda row: (row["latency_ms"],),
    "tokens": lambda row: (row["prompt_tokens"] + row["completion_tokens"],),
}


@pytest.mark.parametrize("descending", [True, False])
def test_every_request_sort_pages_in_order_without_gaps_or_duplicates(harness: Harness, descending: bool) -> None:
    ids = seed_requests(harness)
    order = "desc" if descending else "asc"
    for sort in REQUEST_SORTS:
        items = walk(harness, "/api/requests", {"sort": sort, "order": order, "limit": 4})
        assert sorted(item["id"] for item in items) == sorted(ids), sort
        assert_ordered(items, REQUEST_KEYS[sort], descending)


def seed_audit(harness: Harness) -> list[int]:
    actors = ["bob@example.com", "Alice@example.com", "system"]
    actions = ["key.create", "model.create", "job.cancel", "key.delete"]
    with harness.sessions() as session:
        events = [
            AuditEvent(actor=actors[index % 3], action=actions[index % 4], target=f"t{index}", detail={})
            for index in range(17)
        ]
        session.add_all(events)
        session.commit()
        return [event.id for event in events]


AUDIT_KEYS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "at": lambda event: (),
    "actor": lambda event: (event["actor"].lower(),),
    "action": lambda event: (event["action"],),
}


@pytest.mark.parametrize("descending", [True, False])
def test_every_audit_sort_pages_both_ways(harness: Harness, descending: bool) -> None:
    seed_audit(harness)
    order = "desc" if descending else "asc"
    for sort in AUDIT_SORTS:
        params = {"sort": sort, "order": order, "limit": 4}
        forward = walk(harness, "/api/audit", params, cursor_name="next")
        everything = [event for event in forward if event["target"].startswith("t")]
        assert len(everything) == 17, sort
        assert_ordered(forward, AUDIT_KEYS[sort], descending)
        pages: list[dict[str, Any]] = [harness.client.get("/api/audit", params=params).json()]
        while pages[-1]["next_cursor"]:
            pages.append(harness.client.get("/api/audit", params=params | {"next": pages[-1]["next_cursor"]}).json())
        assert [page["start"] for page in pages] == [index * 4 for index in range(len(pages))]
        for earlier, later in pairwise(pages):
            back = harness.client.get("/api/audit", params=params | {"prev": later["prev_cursor"]}).json()
            assert back["events"] == earlier["events"] and back["start"] == earlier["start"]


@pytest.mark.parametrize("descending", [True, False])
def test_duration_pages_hold_running_jobs_still_while_the_clock_moves(
    harness: Harness, monkeypatch: pytest.MonkeyPatch, descending: bool
) -> None:
    start = now()
    with harness.sessions() as session:
        for index in range(12):
            job = enqueue(session, JobKind.DOWNLOAD, {"n": index})
            job.status = JobStatus.RUNNING if index % 2 else JobStatus.SUCCEEDED
            began = start - timedelta(minutes=10 * index)
            job.started_at = began
            job.finished_at = None if index % 2 else began + timedelta(minutes=5 * index)
        session.commit()
    ticks = iter(start + timedelta(hours=hour) for hour in range(100))
    monkeypatch.setattr("minibrain.api.job_sorting.now", lambda: next(ticks))
    items = walk(harness, "/api/jobs", {"sort": "duration", "order": "desc" if descending else "asc", "limit": 3})
    assert len(items) == 12
    assert len({item["id"] for item in items}) == 12
