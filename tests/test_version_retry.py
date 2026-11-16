from typing import Any

from sqlalchemy import delete

from minibrain.registry.models import Job, JobKind
from tests.conftest import Harness
from tests.test_flow import SLUG, add_version, create_with_dataset, finish


def fail(harness: Harness, kind: str) -> int:
    claim = harness.claim([kind])
    assert claim is not None
    body = {"token": claim["token"], "error": "out of memory", "retryable": False}
    assert harness.internal(f"/jobs/{claim['job_id']}/fail", body).status_code == 204
    return claim["job_id"]


def version(harness: Harness, number: int) -> dict[str, Any]:
    found = harness.client.get(f"/api/models/{SLUG}/versions").json()
    return next(item for item in found if item["number"] == number)


def retry(harness: Harness, number: int) -> Any:
    return harness.client.post(f"/api/models/{SLUG}/versions/{number}/retry")


def training_v1(harness: Harness) -> None:
    create_with_dataset(harness)
    add_version(harness, "lora")


def test_a_version_whose_training_failed_trains_again(harness: Harness) -> None:
    training_v1(harness)
    failed = fail(harness, JobKind.TRAIN)
    assert version(harness, 1)["status"] == "failed"
    again = retry(harness, 1)
    assert again.status_code == 201, again.text
    assert (again.json()["kind"], again.json()["retry_of"]) == ("train", failed)
    assert version(harness, 1)["status"] == "training"
    assert retry(harness, 1).status_code == 409


def test_a_trained_version_whose_scoring_failed_only_scores_again(harness: Harness) -> None:
    training_v1(harness)
    finish(harness, JobKind.TRAIN)
    failed = fail(harness, JobKind.EVAL)
    add_version(harness, "lora")
    assert version(harness, 1)["status"] == "failed"
    again = retry(harness, 1)
    assert again.status_code == 201, again.text
    assert (again.json()["kind"], again.json()["retry_of"]) == ("eval", failed)
    assert version(harness, 1)["status"] == "evaluating"


def test_a_failed_version_whose_scoring_job_was_deleted_is_scored_afresh(harness: Harness) -> None:
    training_v1(harness)
    finish(harness, JobKind.TRAIN)
    failed = fail(harness, JobKind.EVAL)
    with harness.sessions() as session:
        session.execute(delete(Job).where(Job.id == failed))
        session.commit()
    again = retry(harness, 1)
    assert again.status_code == 201, again.text
    assert (again.json()["kind"], again.json()["retry_of"]) == ("eval", None)
    assert version(harness, 1)["status"] == "evaluating"
    finish(harness, JobKind.EVAL)
    assert version(harness, 1)["status"] == "ready"


def test_only_failed_versions_can_be_retried(harness: Harness) -> None:
    training_v1(harness)
    assert retry(harness, 1).status_code == 409


def test_scoring_a_failed_version_afresh_is_in_its_activity(harness: Harness) -> None:
    training_v1(harness)
    finish(harness, JobKind.TRAIN)
    failed = fail(harness, JobKind.EVAL)
    with harness.sessions() as session:
        session.execute(delete(Job).where(Job.id == failed))
        session.commit()
    assert retry(harness, 1).status_code == 201
    texts = [event["text"] for event in harness.client.get(f"/api/models/{SLUG}/activity").json()["events"]]
    assert "started scoring v1 again" in texts
