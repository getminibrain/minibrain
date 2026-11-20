import threading
import time
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import cast

import anyio
import httpx
import pytest
from anyio import to_thread
from fastapi import Request
from sqlalchemy import event, select
from sqlalchemy.dialects import postgresql

from minibrain.api.jobs import events_after
from minibrain.jobs import queue as queue_module
from minibrain.jobs.policy import LEASE
from minibrain.jobs.queue import WorkerInfo, enqueue, expirable, insert_once
from minibrain.registry.models import Job, JobKind, now
from tests.conftest import Harness
from tests.test_flow import SLUG, add_version, create_with_dataset, finish


class Clock:
    def __init__(self) -> None:
        self.moment = now() + timedelta(seconds=1)

    def __call__(self) -> datetime:
        return self.moment

    def advance(self, **delta: float) -> None:
        self.moment += timedelta(**delta)


def lora_job(harness: Harness) -> Clock:
    create_with_dataset(harness)
    add_version(harness, "lora")
    clock = Clock()
    harness.queue.clock = clock
    return clock


def job(harness: Harness, job_id: int) -> dict:
    return harness.client.get(f"/api/jobs/{job_id}").json()


def version_status(harness: Harness) -> str:
    return harness.client.get(f"/api/models/{SLUG}/versions").json()[0]["status"]


def fail(harness: Harness, claim: dict, error: str = "boom", retryable: bool = True) -> int:
    body = {"token": claim["token"], "error": error, "retryable": retryable}
    return harness.internal(f"/jobs/{claim['job_id']}/fail", body).status_code


def complete(harness: Harness, claim: dict) -> int:
    body = {"token": claim["token"], "result": {"metrics": {}}, "outputs": {}}
    return harness.internal(f"/jobs/{claim['job_id']}/complete", body).status_code


def test_stale_token_is_fenced_after_the_lease_expires(harness: Harness) -> None:
    clock = lora_job(harness)
    first = harness.claim(["train"], worker_id="a")
    assert first is not None
    clock.advance(seconds=LEASE.total_seconds() + 1)
    assert harness.queue.expire() == 1
    detail = job(harness, first["job_id"])
    assert detail["status"] == "queued"
    assert detail["attempts"][0]["outcome"] == "lost"
    clock.advance(minutes=20)
    second = harness.claim(["train"], worker_id="b")
    assert second is not None and second["attempt"] == 2
    assert complete(harness, first) == 409
    assert job(harness, first["job_id"])["status"] == "running"


def test_retryable_failure_waits_then_runs_again(harness: Harness) -> None:
    clock = lora_job(harness)
    claim = harness.claim(["train"])
    assert claim is not None
    assert fail(harness, claim, "network blip") == 204
    assert job(harness, claim["job_id"])["status"] == "queued"
    assert harness.claim(["train"]) is None
    clock.advance(minutes=20)
    again = harness.claim(["train"])
    assert again is not None and again["attempt"] == 2


def test_same_error_twice_stops_retrying(harness: Harness) -> None:
    clock = lora_job(harness)
    claim = None
    for _ in range(2):
        claim = harness.claim(["train"])
        assert claim is not None
        fail(harness, claim, "CUDA out of memory")
        clock.advance(minutes=20)
    assert claim is not None
    detail = job(harness, claim["job_id"])
    assert detail["status"] == "failed"
    assert [attempt["outcome"] for attempt in detail["attempts"]] == ["failed", "failed"]
    assert version_status(harness) == "failed"


def test_final_failure_is_not_retried(harness: Harness) -> None:
    lora_job(harness)
    claim = harness.claim(["train"])
    assert claim is not None
    fail(harness, claim, "bad recipe", retryable=False)
    detail = job(harness, claim["job_id"])
    assert (detail["status"], detail["attempt"], detail["error"]) == ("failed", 1, "bad recipe")
    assert version_status(harness) == "failed"


def test_cancel_running_job_reaches_the_worker(harness: Harness) -> None:
    lora_job(harness)
    claim = harness.claim(["train"])
    assert claim is not None
    assert harness.client.post(f"/api/jobs/{claim['job_id']}/cancel").json()["cancel_requested"] is True
    beat = harness.internal(f"/jobs/{claim['job_id']}/heartbeat", {"token": claim["token"]}).json()
    assert beat["cancel"] is True
    fail(harness, claim, "cancelled", retryable=False)
    assert job(harness, claim["job_id"])["status"] == "cancelled"
    assert version_status(harness) == "failed"


def test_complete_after_cancel_still_cancels(harness: Harness) -> None:
    lora_job(harness)
    claim = harness.claim(["train"])
    assert claim is not None
    harness.client.post(f"/api/jobs/{claim['job_id']}/cancel")
    assert complete(harness, claim) == 204
    assert job(harness, claim["job_id"])["status"] == "cancelled"
    assert harness.claim(["eval"]) is None


def test_duplicate_complete_is_rejected_and_harmless(harness: Harness) -> None:
    lora_job(harness)
    claim = harness.claim(["train"])
    assert claim is not None
    adapter = harness.upload(b"not really a tar", "adapter", "tar", "adapter")
    body = {"token": claim["token"], "result": {"summary": {}}, "outputs": {"adapter": adapter}}
    assert harness.internal(f"/jobs/{claim['job_id']}/complete", body).status_code == 204
    assert harness.internal(f"/jobs/{claim['job_id']}/complete", body).status_code == 409
    evals = harness.client.get(f"/api/jobs?model={SLUG}&kind=eval").json()["items"]
    assert len(evals) == 1


def test_unknown_output_artifacts_are_refused(harness: Harness) -> None:
    lora_job(harness)
    claim = harness.claim(["train"])
    assert claim is not None
    body = {"token": claim["token"], "result": {}, "outputs": {"adapter": "0" * 64}}
    assert harness.internal(f"/jobs/{claim['job_id']}/complete", body).status_code == 422
    assert job(harness, claim["job_id"])["status"] == "running"


def test_concurrent_claims_take_each_job_once(harness: Harness) -> None:
    with harness.sessions() as session:
        for index in range(20):
            enqueue(session, JobKind.VERIFY, {"n": index})
        session.commit()
    claimed: list[int] = []
    lock = threading.Lock()

    def take(worker_id: str) -> None:
        worker = WorkerInfo(id=worker_id, host="h", kinds=[JobKind.VERIFY], gpus=0)
        while (claim := harness.queue.claim(worker)) is not None:
            with lock:
                claimed.append(claim.job_id)

    threads = [threading.Thread(target=take, args=(f"w{index}",)) for index in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(claimed) == sorted(set(claimed))
    assert len(claimed) == 20


def test_gpu_slots_limit_heavy_jobs_only(harness: Harness) -> None:
    lora_job(harness)
    with harness.sessions() as session:
        enqueue(session, JobKind.VERIFY, {})
        session.commit()
    assert harness.claim(["train", "verify"], worker_id="w") is not None
    second = harness.claim(["train", "verify"], worker_id="w")
    assert second is not None and second["kind"] == "verify"


def test_idempotency_key_dedupes_active_jobs(harness: Harness) -> None:
    with harness.sessions() as session:
        first = enqueue(session, JobKind.VERIFY, {}, idempotency_key="k")
        second = enqueue(session, JobKind.VERIFY, {}, idempotency_key="k")
        session.commit()
        assert first.id == second.id


def test_retry_creates_a_linked_job(harness: Harness) -> None:
    lora_job(harness)
    claim = harness.claim(["train"])
    assert claim is not None
    fail(harness, claim, "bad", retryable=False)
    again = harness.client.post(f"/api/jobs/{claim['job_id']}/retry").json()
    assert (again["status"], again["retry_of"]) == ("queued", claim["job_id"])
    assert version_status(harness) == "training"
    assert harness.client.post(f"/api/jobs/{again['id']}/retry").status_code == 409


def test_time_limit_fails_without_retry(harness: Harness) -> None:
    clock = lora_job(harness)
    claim = harness.claim(["train"])
    assert claim is not None
    for _ in range(25):
        clock.advance(hours=1)
        harness.internal(f"/jobs/{claim['job_id']}/heartbeat", {"token": claim["token"]})
    harness.queue.expire()
    detail = job(harness, claim["job_id"])
    assert (detail["status"], detail["error"]) == ("failed", "ran past its time limit")


def test_time_limit_counts_from_the_current_attempt(harness: Harness) -> None:
    clock = lora_job(harness)
    first = harness.claim(["train"])
    assert first is not None
    for _ in range(20):
        clock.advance(hours=1)
        harness.internal(f"/jobs/{first['job_id']}/heartbeat", {"token": first["token"]})
    assert fail(harness, first, "network blip") == 204
    clock.advance(minutes=20)
    second = harness.claim(["train"])
    assert second is not None and second["attempt"] == 2
    for _ in range(10):
        clock.advance(hours=1)
        harness.internal(f"/jobs/{second['job_id']}/heartbeat", {"token": second["token"]})
    assert harness.queue.expire() == 0
    assert job(harness, second["job_id"])["status"] == "running"
    for _ in range(15):
        clock.advance(hours=1)
        harness.internal(f"/jobs/{second['job_id']}/heartbeat", {"token": second["token"]})
    harness.queue.expire()
    detail = job(harness, second["job_id"])
    assert (detail["status"], detail["error"]) == ("failed", "ran past its time limit")


def test_lease_expiry_locks_the_rows_it_reads() -> None:
    sql = str(expirable().compile(dialect=postgresql.dialect()))
    assert sql.endswith("FOR UPDATE SKIP LOCKED")


def test_restart_grace_keeps_running_jobs(harness: Harness) -> None:
    clock = lora_job(harness)
    claim = harness.claim(["train"])
    assert claim is not None
    clock.advance(seconds=LEASE.total_seconds() + 30)
    harness.queue.grace()
    assert harness.queue.expire() == 0
    assert job(harness, claim["job_id"])["status"] == "running"


def test_events_stream_until_the_job_ends(harness: Harness) -> None:
    lora_job(harness)
    claim = harness.claim(["train"])
    assert claim is not None
    events = [
        {"kind": "log", "message": "step 1"},
        {"kind": "event", "name": "train.step", "message": "Step 1 of 4", "data": {"progress": 0.25}},
    ]
    harness.internal(f"/jobs/{claim['job_id']}/events", {"token": claim["token"], "events": events})
    assert job(harness, claim["job_id"])["progress"] == 0.25
    fail(harness, claim, "stop", retryable=False)
    stream = harness.client.get(f"/api/jobs/{claim['job_id']}/events").text
    assert "step 1" in stream and stream.rstrip().endswith(f'data: {{"job": {claim["job_id"]}}}')


def test_the_event_stream_reads_the_job_status_before_its_events(harness: Harness) -> None:
    lora_job(harness)
    claim = harness.claim(["train"])
    assert claim is not None
    engine = harness.sessions.kw["bind"]
    tables: list[str] = []

    def note(*args: object) -> None:
        statement = str(args[2])
        tables.extend(table for table in ("FROM job_events", "FROM jobs") if table in statement)

    event.listen(engine, "before_cursor_execute", note)
    try:
        events_after(cast(Request, SimpleNamespace(app=harness.app)), claim["job_id"], 0)
    finally:
        event.remove(engine, "before_cursor_execute", note)
    assert tables == ["FROM jobs", "FROM job_events"]


def test_job_rows_outlive_the_model(harness: Harness) -> None:
    lora_job(harness)
    claim = harness.claim(["train"])
    assert claim is not None
    fail(harness, claim, "x", retryable=False)
    assert harness.client.delete(f"/api/models/{SLUG}").status_code == 202
    harness.settle()
    with harness.sessions() as session:
        kept = session.get(Job, claim["job_id"])
        assert kept is not None and kept.model_id is None and kept.model_slug == SLUG


def test_jobs_filter_by_several_kinds(harness: Harness) -> None:
    lora_job(harness)
    claim = harness.claim(["train"])
    assert claim is not None
    adapter = harness.upload(b"not really a tar", "adapter", "tar", "adapter")
    body = {"token": claim["token"], "result": {"summary": {}}, "outputs": {"adapter": adapter}}
    assert harness.internal(f"/jobs/{claim['job_id']}/complete", body).status_code == 204
    kinds = [item["kind"] for item in harness.client.get("/api/jobs?kind=train&kind=eval").json()["items"]]
    assert kinds == ["eval", "train"]
    everything = {item["kind"] for item in harness.client.get("/api/jobs").json()["items"]}
    assert everything == {"train", "eval"}
    assert [item["kind"] for item in harness.client.get("/api/jobs?kind=train").json()["items"]] == ["train"]


def test_a_job_is_retried_once_so_two_runs_never_build_one_version(harness: Harness) -> None:
    lora_job(harness)
    claim = harness.claim(["train"])
    assert claim is not None
    fail(harness, claim, "bad", retryable=False)
    again = harness.client.post(f"/api/jobs/{claim['job_id']}/retry").json()
    second = harness.client.post(f"/api/jobs/{claim['job_id']}/retry")
    assert second.status_code == 409 and f"job {again['id']}" in second.text
    bulk = harness.client.post("/api/jobs/retry", json={"ids": [claim["job_id"]]}).json()
    assert bulk[0]["done"] is False
    queued = harness.client.get("/api/jobs?status=queued&kind=train").json()["items"]
    assert [item["id"] for item in queued] == [again["id"]]
    finish(harness, "train")
    finish(harness, "eval", accuracy=0.9)
    assert version_status(harness) == "ready"
    assert harness.client.post(f"/api/jobs/{claim['job_id']}/retry").status_code == 409
    assert version_status(harness) == "ready"


def test_expiry_fails_a_running_job_without_its_attempt_and_keeps_expiring_the_rest(harness: Harness) -> None:
    clock = lora_job(harness)
    broken = harness.claim(["train"], worker_id="a")
    assert broken is not None
    with harness.sessions() as session:
        stray = session.get(Job, broken["job_id"])
        assert stray is not None
        other = enqueue(session, JobKind.TRAIN, {}, model_id=stray.model_id, version_id=stray.version_id)
        stray.attempts.clear()
        session.commit()
        other_id = other.id
    lost = harness.claim(["train"], worker_id="b")
    assert lost is not None and lost["job_id"] == other_id
    clock.advance(seconds=LEASE.total_seconds() + 1)
    assert harness.queue.expire() == 2
    failed = job(harness, broken["job_id"])
    assert (failed["status"], failed["error"]) == ("failed", "its run has no attempt 1 on record")
    assert job(harness, other_id)["attempts"][0]["outcome"] == "lost"


def test_job_lists_name_the_pool_a_job_ran_in(harness: Harness) -> None:
    lora_job(harness)
    queued = harness.client.get("/api/jobs").json()["items"][0]
    assert queued["status"] == "queued"
    claim = harness.claim(["train"], worker_id="w-rack", pool="rack")
    assert claim is not None
    listed = harness.client.get("/api/jobs").json()["items"][0]
    assert (listed["id"], listed["pool"]) == (claim["job_id"], "rack")
    assert job(harness, claim["job_id"])["pool"] == "rack"


def test_a_cancel_that_loses_the_race_to_a_claim_asks_the_running_job_to_stop(harness: Harness) -> None:
    lora_job(harness)
    with harness.sessions() as session:
        found = session.scalar(select(Job).where(Job.kind == JobKind.TRAIN))
        assert found is not None and found.status == "queued"
        claim = harness.claim(["train"])
        assert claim is not None
        harness.queue.cancel(session, found)
        session.commit()
        assert (found.status, found.cancel_requested, found.lease_token) == ("running", True, claim["token"])
    beat = harness.internal(f"/jobs/{claim['job_id']}/heartbeat", {"token": claim["token"]})
    assert beat.status_code == 200 and beat.json()["cancel"] is True
    assert fail(harness, claim, "cancelled", retryable=False) == 204
    assert job(harness, claim["job_id"])["status"] == "cancelled"


def test_a_retry_racing_another_retry_gets_the_same_job(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    lora_job(harness)
    claim = harness.claim(["train"])
    assert claim is not None
    fail(harness, claim, "bad", retryable=False)
    monkeypatch.setattr(queue_module, "refuse_rerun", lambda session, job: None)
    with harness.sessions() as one, harness.sessions() as two:
        first = harness.queue.retry(one, one.get_one(Job, claim["job_id"]))
        one.commit()
        second = harness.queue.retry(two, two.get_one(Job, claim["job_id"]))
        two.commit()
        assert first.id == second.id
        trains = two.scalars(select(Job.id).where(Job.kind == JobKind.TRAIN, Job.status == "queued")).all()
        assert trains == [first.id]


def test_an_idempotent_insert_that_meets_an_active_key_inserts_nothing(harness: Harness) -> None:
    with harness.sessions() as session:
        first = enqueue(session, JobKind.VERIFY, {}, idempotency_key="k")
        session.commit()
        assert insert_once(session, {"kind": JobKind.VERIFY, "params": {}, "idempotency_key": "k"}) is None
        session.rollback()
        assert session.scalars(select(Job.id).where(Job.idempotency_key == "k")).all() == [first.id]


LONG_POLLS = 8
THREADS = 4


async def api_time_while_polling(harness: Harness) -> tuple[int, float]:
    to_thread.current_default_thread_limiter().total_tokens = THREADS
    worker_headers = {"Authorization": f"Bearer {harness.token}"}
    transport = httpx.ASGITransport(app=harness.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        client.cookies.update(dict(harness.client.cookies.items()))
        version = (await client.get("/internal/gateway/config", headers=harness.gateway_headers)).headers["ETag"]
        config_poll = {"version": version, "wait": 3}

        async def poll(index: int) -> None:
            if index % 2:
                await client.get("/internal/gateway/config", params=config_poll, headers=harness.gateway_headers)
                return
            worker = {"id": f"w{index}", "host": f"h{index}", "kinds": ["train"], "gpus": 1, "pool": "local"}
            await client.post("/internal/worker/claim", json={"worker": worker, "wait": 3}, headers=worker_headers)

        measured: list[tuple[int, float]] = []
        async with anyio.create_task_group() as group:
            for index in range(LONG_POLLS):
                group.start_soon(poll, index)
            await anyio.sleep(0.5)
            started = time.monotonic()
            response = await client.get("/api/jobs")
            measured.append((response.status_code, time.monotonic() - started))
    return measured[0]


@pytest.mark.serial
def test_long_polls_leave_threads_for_other_requests(harness: Harness) -> None:
    status, took = anyio.run(api_time_while_polling, harness)
    assert status == 200
    assert took < 1.0
