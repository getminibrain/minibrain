from typing import Any

from sqlalchemy import event, select

from minibrain.registry.models import BaseModel, BaseModelStatus, Job, JobKind, Model, Version, VersionStatus
from minibrain.tasks.service import version_metric
from tests.conftest import Harness
from tests.test_flow import SLUG, add_version, deploy, finish
from tests.test_job_facts import complete, training_job
from tests.test_job_paging import page

GPU_TIME = {"kind": "gpu", "devices": 2, "seconds": 720.0, "hours": 0.4}


def metric_of(harness: Harness) -> str:
    with harness.sessions() as session:
        version = session.scalars(select(Version).join(Model).where(Model.slug == SLUG)).first()
        assert version is not None
        metric = version_metric(version)
        assert metric is not None
        return metric


def set_version(harness: Harness, number: int, **fields: Any) -> None:
    with harness.sessions() as session:
        version = session.scalar(select(Version).join(Model).where(Model.slug == SLUG, Version.number == number))
        assert version is not None
        for key, value in fields.items():
            setattr(version, key, value)
        session.commit()


def score(harness: Harness, number: int, value: float) -> None:
    found = {"grader": "label", "version": 1, "metric": metric_of(harness), "value": value}
    metrics = {"eval": {"examples": 20, "scores": [found]}}
    set_version(harness, number, metrics=metrics, status=VersionStatus.READY)


def listed(harness: Harness, job_id: int) -> dict[str, Any]:
    return next(item for item in page(harness, "kind=train")["items"] if item["id"] == job_id)


def trained(harness: Harness) -> int:
    claim = training_job(harness)
    complete(harness, claim)
    return claim["job_id"]


def test_a_finished_run_names_its_base_and_dataset_version(harness: Harness) -> None:
    job_id = trained(harness)
    base = harness.client.get(f"/api/models/{SLUG}/versions").json()[0]["base_model"]
    assert listed(harness, job_id)["trained_on"]["base_model_name"] is None
    with harness.sessions() as session:
        session.add(BaseModel(id=base, source="download", name="Qwen3 0.6B", status=BaseModelStatus.AVAILABLE))
        session.commit()
    found = listed(harness, job_id)["trained_on"]
    assert (found["base_model"], found["base_model_name"]) == (base, "Qwen3 0.6B")
    assert (found["dataset"], found["dataset_version"]) == (SLUG, 1)


def test_the_score_is_compared_with_v0_when_nothing_is_live(harness: Harness) -> None:
    job_id = trained(harness)
    score(harness, 1, 0.91)
    assert listed(harness, job_id)["compared_with"] is None
    score(harness, 0, 0.87)
    found = listed(harness, job_id)
    assert found["score"] == 0.91
    assert found["compared_with"] == {"version": 0, "score": 0.87, "live": False}


def test_the_score_is_compared_with_the_live_version_first(harness: Harness) -> None:
    add = training_job(harness)
    complete(harness, add)
    score(harness, 0, 0.5)
    score(harness, 1, 0.8)
    deploy(harness, 1)
    add_version(harness, "lora")
    second = finish(harness, "train")
    score(harness, 2, 0.84)
    assert listed(harness, second)["compared_with"] == {"version": 1, "score": 0.8, "live": True}
    assert listed(harness, add["job_id"])["compared_with"] == {"version": 0, "score": 0.5, "live": False}


def test_device_time_shows_once_the_run_succeeded(harness: Harness) -> None:
    claim = training_job(harness)
    set_version(harness, 1, device_time=GPU_TIME)
    assert listed(harness, claim["job_id"])["device_time"] is None
    complete(harness, claim)
    set_version(harness, 1, device_time=GPU_TIME)
    assert listed(harness, claim["job_id"])["device_time"] == GPU_TIME


def post_step(harness: Harness, claim: dict[str, Any], step: int, eta: float) -> None:
    data = {"step": step, "steps": 10, "loss": 1.0, "eta_seconds": eta}
    item = {"kind": "event", "name": "train.step", "level": "info", "message": "", "data": data}
    body = {"token": claim["token"], "events": [item]}
    assert harness.internal(f"/jobs/{claim['job_id']}/events", body).status_code == 204


def test_a_running_run_reports_the_time_left_from_its_latest_step(harness: Harness) -> None:
    claim = training_job(harness)
    assert listed(harness, claim["job_id"])["eta_seconds"] is None
    post_step(harness, claim, 1, 300.0)
    post_step(harness, claim, 2, 240.0)
    assert listed(harness, claim["job_id"])["eta_seconds"] == 240.0
    complete(harness, claim)
    assert listed(harness, claim["job_id"])["eta_seconds"] is None


def queries_for(harness: Harness) -> int:
    engine = harness.sessions.kw["bind"]
    seen: list[object] = []

    def record(*args: object) -> None:
        seen.append(args[2])

    event.listen(engine, "before_cursor_execute", record)
    try:
        page(harness, "kind=train")
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return len(seen)


def test_listing_more_runs_takes_no_more_queries(harness: Harness) -> None:
    trained(harness)
    one = queries_for(harness)
    with harness.sessions() as session:
        job = session.scalars(select(Job).where(Job.kind == JobKind.TRAIN)).one()
        for _ in range(5):
            session.add(
                Job(
                    kind=JobKind.TRAIN,
                    model_id=job.model_id,
                    version_id=job.version_id,
                    status="succeeded",
                    model_slug=job.model_slug,
                )
            )
        session.commit()
    assert queries_for(harness) == one
