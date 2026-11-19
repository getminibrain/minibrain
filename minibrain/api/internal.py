import hmac
import time
from collections.abc import Iterator
from datetime import datetime
from functools import partial
from typing import Annotated, Any, Literal

import anyio
import pydantic
from anyio import to_thread
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from minibrain.api.bases import BaseWeights, LiveBases, live
from minibrain.api.bases import base_file as file_of
from minibrain.api.bases import base_weights as weights_of
from minibrain.api.deps import MetricsDep, QueueDep, SessionDep, SettingsDep, StoreDep
from minibrain.api.uploads import store_body
from minibrain.artifacts import ArtifactError, Packing, is_artifact_id
from minibrain.auth.engine_tokens import engine_token
from minibrain.auth.join_requests import credential_caller
from minibrain.auth.join_tokens import LOCAL_KEY_FILE, WORKER, Caller, address_of, admit, bearer, refuse
from minibrain.connections.s3 import job_env
from minibrain.connections.spec import ConnectionProblem
from minibrain.connections.store import get_connection, resolve
from minibrain.jobs.queue import EventIn, SqlJobQueue, WorkerInfo
from minibrain.lifecycle import STOPPING
from minibrain.models.bucket import WEIGHTS, stored_files, writes_bucket
from minibrain.models.hardware import LOCAL_POOL
from minibrain.models.machine_metrics import MachineSample, MetricsHistory
from minibrain.models.placement import desired_engines
from minibrain.models.registry import check_job
from minibrain.policy import PolicyError
from minibrain.registry.compute import DRAINING, node_id, record_node
from minibrain.registry.files import register
from minibrain.registry.models import Artifact, BaseModel, Job, JobKind, JobStatus, Worker
from minibrain.registry.service import ConflictError, NotFoundError
from minibrain.settings import Settings
from minibrain.worker import LEASE_HEADER

CLAIM_POLL_SECONDS = 0.5
MAX_CLAIM_WAIT_SECONDS = 30.0


def worker_caller(request: Request, session: SessionDep, authorization: Annotated[str, Header()] = "") -> Caller:
    token = bearer(authorization)
    if token and hmac.compare_digest(token.encode(), request.app.state.settings.secret(LOCAL_KEY_FILE).encode()):
        return Caller(LOCAL_POOL)
    found = credential_caller(session, token, address_of(request))
    if found is None:
        raise HTTPException(status_code=401, detail="invalid worker token")
    return found


WorkerCaller = Annotated[Caller, Depends(worker_caller)]
NOT_LEASED = "a worker gets only what the jobs it holds need"


def strings(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)


def leased_needs(session: Session, pool: str, lease: str) -> set[str]:
    running = select(Job).where(Job.status == JobStatus.RUNNING, Job.lease_token == lease)
    job = session.scalar(running) if lease else None
    owner = session.get(Worker, job.lease_owner) if job is not None and job.lease_owner else None
    if job is None or owner is None or owner.pool != pool:
        return set()
    return set(strings(job.params))


def needed(request: Request, session: Session, caller: Caller, wanted: str) -> None:
    if not caller.remote or wanted in leased_needs(session, caller.pool, request.headers.get(LEASE_HEADER, "")):
        return
    detail = {"pool": caller.pool, "reason": NOT_LEASED, "address": address_of(request)}
    refuse(session, caller.target, detail, {"asked": wanted})
    raise HTTPException(status_code=403, detail=f"{NOT_LEASED}; none needs {wanted}")


def needed_key(request: Request, session: SessionDep, caller: WorkerCaller, key: str) -> None:
    needed(request, session, caller, key)


def needed_model(request: Request, session: SessionDep, caller: WorkerCaller, base_model_id: str) -> None:
    needed(request, session, caller, base_model_id)


ForKey = [Depends(needed_key)]
router = APIRouter(prefix="/internal/worker", include_in_schema=False, dependencies=[Depends(worker_caller)])


class WorkerBody(pydantic.BaseModel):
    id: str
    host: str
    kinds: list[str]
    gpus: int = 1
    pool: str = LOCAL_POOL
    hardware: dict[str, Any] = Field(default_factory=dict)
    metrics: MachineSample | None = None

    def info(self) -> WorkerInfo:
        return WorkerInfo(id=self.id, host=self.host, kinds=self.kinds, gpus=self.gpus, pool=self.pool)


class ClaimRequest(pydantic.BaseModel):
    worker: WorkerBody
    wait: float = 0.0


class ClaimResponse(pydantic.BaseModel):
    job_id: int
    kind: str
    attempt: int
    token: str
    params: dict[str, Any]
    lease_seconds: int
    env: dict[str, str] = Field(default_factory=dict)


class HostedEngine(pydantic.BaseModel):
    model: str


class EnginesRequest(pydantic.BaseModel):
    worker: WorkerBody


class EnginesResponse(pydantic.BaseModel):
    engines: list[HostedEngine]
    engine_token: str | None


class TokenBody(pydantic.BaseModel):
    token: str


class HeartbeatResponse(pydantic.BaseModel):
    cancel: bool
    lease_expires_at: str


class EventBody(pydantic.BaseModel):
    kind: Literal["event", "log"]
    message: str = ""
    data: dict[str, Any] | None = None
    level: Literal["debug", "info", "warning", "error"] = "info"
    name: str | None = None
    at: datetime | None = None


class EventsBody(TokenBody):
    events: list[EventBody] = Field(default_factory=list)


class CompleteBody(TokenBody):
    result: dict[str, Any] = Field(default_factory=dict)
    outputs: dict[str, str] = Field(default_factory=dict)
    log: str | None = None


class FailBody(TokenBody):
    error: str
    retryable: bool = True
    log: str | None = None
    code: str | None = None


class StoredArtifact(pydantic.BaseModel):
    id: str
    size: int


def require_artifacts(session: SessionDep, ids: list[str | None]) -> None:
    missing = [artifact for artifact in ids if artifact is not None and session.get(Artifact, artifact) is None]
    if missing:
        raise HTTPException(status_code=422, detail=f"unknown artifacts: {', '.join(missing)}")


def policy_refusal(session: SessionDep, job_id: int) -> str | None:
    session.expire_all()
    job = session.get(Job, job_id)
    if job is None:
        return None
    try:
        check_job(session, job)
    except (PolicyError, ConflictError) as error:
        return str(error)
    return None


def job_secrets(session: SessionDep, settings: Settings, job_id: int) -> dict[str, str]:
    job = session.get(Job, job_id)
    connection_id = job.params.get("connection_id") if job is not None else None
    if job is None or job.kind not in (JobKind.IMPORT, JobKind.REPAIR) or connection_id is None:
        return {}
    return job_env(resolve(session, settings, get_connection(session, int(connection_id))))


def report_worker(session: SessionDep, metrics: MetricsDep, body: WorkerBody, rejoin: bool = False) -> str:
    node = record_node(session, body.pool, body.host, "worker", body.hardware, rejoin)
    state = node.state
    session.commit()
    if body.metrics is not None:
        metrics.record(node_id(body.pool, body.host), body.metrics)
    return state


def admitted(session: SessionDep, request: Request, caller: Caller, body: WorkerBody) -> None:
    admit(session, caller, body.pool, body.host, WORKER, address_of(request))


@router.post("/register", status_code=204)
def register_worker(
    body: WorkerBody,
    request: Request,
    caller: WorkerCaller,
    queue: QueueDep,
    session: SessionDep,
    metrics: MetricsDep,
) -> None:
    admitted(session, request, caller, body)
    report_worker(session, metrics, body, rejoin=True)
    queue.register(body.info())


def checked_in(
    session: Session, request: Request, caller: Caller, queue: SqlJobQueue, metrics: MetricsHistory, worker: WorkerBody
) -> str:
    admitted(session, request, caller, worker)
    state = report_worker(session, metrics, worker)
    queue.register(worker.info())
    return state


def claim_once(session: Session, queue: SqlJobQueue, settings: Settings, worker: WorkerInfo) -> ClaimResponse | None:
    while (claimed := queue.claim(worker)) is not None:
        refusal = policy_refusal(session, claimed.job_id)
        if refusal is None:
            try:
                env = job_secrets(session, settings, claimed.job_id)
            except (ConnectionProblem, PolicyError, NotFoundError) as error:
                refusal = str(error)
            else:
                return ClaimResponse(**claimed.__dict__, env=env)
        queue.fail(claimed.job_id, claimed.token, refusal, False, None)
    return None


async def idle_until(deadline: float) -> None:
    while not STOPPING.is_set() and (left := deadline - time.monotonic()) > 0:
        await anyio.sleep(min(CLAIM_POLL_SECONDS, left))


@router.post("/claim", response_model=None)
async def claim(
    body: ClaimRequest,
    request: Request,
    caller: WorkerCaller,
    queue: QueueDep,
    session: SessionDep,
    settings: SettingsDep,
    metrics: MetricsDep,
) -> ClaimResponse | Response:
    deadline = time.monotonic() + max(0.0, min(body.wait, MAX_CLAIM_WAIT_SECONDS))
    state = await to_thread.run_sync(partial(checked_in, session, request, caller, queue, metrics, body.worker))
    if state == DRAINING:
        await idle_until(deadline)
        return Response(status_code=204)
    worker = body.worker.info()
    while True:
        found = await to_thread.run_sync(partial(claim_once, session, queue, settings, worker))
        if found is not None:
            return found
        if STOPPING.is_set() or time.monotonic() >= deadline:
            return Response(status_code=204)
        await anyio.sleep(CLAIM_POLL_SECONDS)


@router.post("/engines")
def hosted_engines(
    body: EnginesRequest,
    request: Request,
    caller: WorkerCaller,
    queue: QueueDep,
    session: SessionDep,
    settings: SettingsDep,
    metrics: MetricsDep,
) -> EnginesResponse:
    worker = body.worker
    admitted(session, request, caller, worker)
    report_worker(session, metrics, worker)
    queue.register(worker.info())
    config = request.app.state.gateway_config.current()
    placements = {key: found for key, found in config.placements.items() if key not in config.problems}
    wanted = desired_engines(session, placements, worker.pool, worker.host, worker.id)
    engines = [HostedEngine(model=key) for key in wanted]
    return EnginesResponse(engines=engines, engine_token=engine_token(settings, caller))


@router.post("/jobs/{job_id}/heartbeat")
def heartbeat(job_id: int, body: TokenBody, queue: QueueDep) -> HeartbeatResponse:
    beat = queue.heartbeat(job_id, body.token)
    return HeartbeatResponse(cancel=beat.cancel, lease_expires_at=beat.lease_expires_at.isoformat())


@router.post("/jobs/{job_id}/events", status_code=204)
def events(job_id: int, body: EventsBody, queue: QueueDep) -> None:
    queue.record(
        job_id,
        body.token,
        [EventIn(e.kind, e.message, e.data, e.level, e.name, e.at) for e in body.events],
    )


@router.post("/jobs/{job_id}/complete", status_code=204)
def complete(job_id: int, body: CompleteBody, queue: QueueDep, session: SessionDep) -> None:
    require_artifacts(session, [*body.outputs.values(), body.log])
    queue.complete(job_id, body.token, body.result, body.outputs, body.log)


@router.post("/jobs/{job_id}/fail", status_code=204)
def fail(job_id: int, body: FailBody, queue: QueueDep, session: SessionDep) -> None:
    require_artifacts(session, [body.log])
    queue.fail(job_id, body.token, body.error, body.retryable, body.log, body.code)


@router.put("/artifacts/{artifact_id}")
async def upload_artifact(
    artifact_id: str,
    request: Request,
    session: SessionDep,
    store: StoreDep,
    x_artifact_kind: Annotated[str, Header()],
    x_artifact_packing: Annotated[str, Header()],
    x_artifact_name: Annotated[str, Header()],
    x_artifact_replace: Annotated[str, Header()] = "",
) -> StoredArtifact:
    if x_artifact_packing not in (Packing.FILE, Packing.TAR) or not is_artifact_id(artifact_id):
        raise HTTPException(status_code=422, detail="bad artifact id or packing")
    if x_artifact_kind == WEIGHTS and not writes_bucket(store):
        raise HTTPException(status_code=422, detail="Storage is no longer a bucket; start the transfer again")
    try:
        stored = await store_body(store, request, artifact_id, replace=x_artifact_replace == "1")
    except ArtifactError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    register(session, stored.id, x_artifact_kind, x_artifact_packing, x_artifact_name, stored.size)
    session.commit()
    return StoredArtifact(id=stored.id, size=stored.size)


@router.get("/artifacts/{artifact_id}")
def download_artifact(
    artifact_id: str, request: Request, session: SessionDep, caller: WorkerCaller, store: StoreDep
) -> StreamingResponse:
    if not is_artifact_id(artifact_id):
        raise HTTPException(status_code=404, detail=f"artifact {artifact_id} not found")
    needed(request, session, caller, artifact_id)
    if not store.has(artifact_id):
        raise HTTPException(status_code=404, detail=f"artifact {artifact_id} not found")
    return StreamingResponse(store.chunks(artifact_id), media_type="application/octet-stream")


class StoredFiles(pydantic.BaseModel):
    files: list[dict[str, Any]]


@router.get("/bases/{base_model_id}/stored", dependencies=[Depends(needed_model)])
def stored(base_model_id: str, session: SessionDep, store: StoreDep) -> StoredFiles:
    model = session.get(BaseModel, base_model_id)
    if model is None:
        raise HTTPException(status_code=404, detail=f"model {base_model_id} not found")
    return StoredFiles(files=stored_files(session, store, model))


@router.get("/bases")
def bases(session: SessionDep) -> LiveBases:
    return live(session)


@router.get("/bases/{key}", dependencies=ForKey)
def base_weights(
    key: str, session: SessionDep, settings: SettingsDep, store: StoreDep, response: Response
) -> BaseWeights:
    return weights_of(session, settings, store, key, response)


@router.get("/bases/{key}/files/{path:path}", dependencies=ForKey)
def base_file(key: str, path: str, session: SessionDep, settings: SettingsDep) -> FileResponse:
    return file_of(session, settings, key, path)
