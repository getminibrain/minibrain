import hmac
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from minibrain.api.bases import BaseWeights, LiveBases, live
from minibrain.api.bases import base_file as file_of
from minibrain.api.bases import base_weights as weights_of
from minibrain.api.deps import MetricsDep, SessionDep, SettingsDep, StoreDep
from minibrain.artifacts import is_artifact_id
from minibrain.auth.engine_tokens import engine_caller as derived_caller
from minibrain.auth.join_tokens import ENGINE, Caller, address_of, admit, bearer, checked, refuse
from minibrain.data.feedback import Submission, record
from minibrain.gateway.config import LocalConfig
from minibrain.gateway.logs import CHAT_KIND, LogEntry, database_sink
from minibrain.models.hardware import LOCAL_POOL
from minibrain.models.health import record_load_failure, record_loaded
from minibrain.models.machine_metrics import MachineSample
from minibrain.models.placement import deployments
from minibrain.models.usage import touch
from minibrain.registry.compute import (
    EngineReport,
    GatewayReport,
    live_engines,
    node_id,
    record_engine,
    record_gateway,
)
from minibrain.registry.files import ArtifactKind
from minibrain.registry.models import Artifact, Version

MAX_WAIT_SECONDS = 30.0


NOT_SERVED = "an engine token gets only the adapters of models served in pool"
ENGINE_ONLY = "an engine token reaches only what engines need: announcing themselves, base weights and adapters"


def engine_caller(request: Request, session: SessionDep, authorization: Annotated[str, Header()] = "") -> Caller | None:
    settings = request.app.state.settings
    token = bearer(authorization)
    if token and hmac.compare_digest(token, settings.secret("gateway_token")):
        return None
    joined = checked(session, token, ENGINE, address_of(request))
    if joined is not None:
        return Caller(joined.pool, joined)
    derived = derived_caller(session, settings, token, address_of(request)) if token else None
    if derived is None:
        raise HTTPException(status_code=401, detail="invalid gateway token")
    return derived


EngineCaller = Annotated[Caller | None, Depends(engine_caller)]


def gateway_token(caller: EngineCaller) -> None:
    if caller is not None:
        raise HTTPException(status_code=403, detail=ENGINE_ONLY)


router = APIRouter(prefix="/internal/gateway", include_in_schema=False, dependencies=[Depends(engine_caller)])
GatewayOnly = [Depends(gateway_token)]


class LogBody(BaseModel):
    at: datetime
    key_id: int | None
    model_id: int | None
    model: str
    version: int | None
    status: int
    latency_ms: float
    contract: int | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    response_id: str | None = None
    input: str | None = None
    output: str | None = None
    finish_reason: str | None = None
    safety: dict[str, Any] | None = None
    kind: str = CHAT_KIND


class LogsBody(BaseModel):
    entries: list[LogBody]


class FeedbackBody(BaseModel):
    model_id: int
    origin: str
    rating: str
    response_id: str | None = None
    version: int | None = None
    key_id: int | None = None
    input: str | None = None
    output: str | None = None
    correction: str | None = None
    comment: str | None = None


class FeedbackStored(BaseModel):
    id: int


class EngineBody(BaseModel):
    id: str
    host: str
    url: str
    base_model: str
    engine: str
    state: str
    pool: str = LOCAL_POOL
    hardware: dict[str, Any] = {}
    managed: bool = False
    error: str | None = None
    code: str | None = None
    metrics: MachineSample | None = None


class GatewayBody(BaseModel):
    id: str
    host: str
    version: str
    routes: list[str] = []
    bases: list[str] = []


@router.post("/engines", status_code=204)
def register_engine(
    body: EngineBody, request: Request, session: SessionDep, caller: EngineCaller, metrics: MetricsDep
) -> None:
    if caller is not None:
        admit(session, caller, body.pool, body.host, ENGINE, address_of(request))
    record_engine(session, EngineReport(**body.model_dump(exclude={"error", "code", "metrics"})))
    if body.metrics is not None:
        metrics.record(node_id(body.pool, body.host), body.metrics)
    if body.state == "failed":
        record_load_failure(session, body.base_model, body.code, body.error, body.host)
    elif body.state == "ready":
        record_loaded(session, body.base_model)
        touch(session, body.base_model)
    session.commit()


@router.post("/gateways", status_code=204, dependencies=GatewayOnly)
def report_gateway(body: GatewayBody, session: SessionDep) -> None:
    record_gateway(session, GatewayReport(kind="standalone", **body.model_dump()))
    session.commit()


@router.get("/bases")
def bases(session: SessionDep) -> LiveBases:
    return live(session)


@router.get("/bases/{key}")
def base_weights(
    key: str, session: SessionDep, settings: SettingsDep, store: StoreDep, response: Response
) -> BaseWeights:
    return weights_of(session, settings, store, key, response)


@router.get("/bases/{key}/files/{path:path}")
def base_file(key: str, path: str, session: SessionDep, settings: SettingsDep) -> FileResponse:
    return file_of(session, settings, key, path)


@router.get("/config", dependencies=GatewayOnly)
def config(request: Request, version: str = "", wait: float = 0.0) -> Response:
    source: LocalConfig = request.app.state.gateway_config
    current = source.wait_for_change(version, max(0.0, min(wait, MAX_WAIT_SECONDS))) if version else source.current()
    if current.version == version:
        return Response(status_code=304, headers={"ETag": current.version})
    return Response(content=current.to_json(), media_type="application/json", headers={"ETag": current.version})


@router.post("/logs", status_code=204, dependencies=GatewayOnly)
def logs(body: LogsBody, request: Request) -> None:
    database_sink(request.app.state.sessions)([LogEntry(**entry.model_dump()) for entry in body.entries])


@router.post("/feedback", status_code=201, dependencies=GatewayOnly)
def feedback(body: FeedbackBody, session: SessionDep) -> FeedbackStored:
    item = record(session, Submission(**body.model_dump()))
    session.commit()
    return FeedbackStored(id=item.id)


def pool_bases(session: Session, pool: str) -> set[str]:
    placed = {key for _, key, where in deployments(session) if where == pool}
    return placed | {replica.base_model for replica in live_engines(session) if replica.pool == pool}


def served_in(session: Session, pool: str, artifact_id: str) -> bool:
    found = session.get(Artifact, artifact_id)
    if found is None or found.kind != ArtifactKind.ADAPTER:
        return False
    query = select(Version.id).where(Version.adapter_artifact_id == artifact_id)
    return session.scalar(query.where(Version.base_model.in_(pool_bases(session, pool))).limit(1)) is not None


@router.get("/artifacts/{artifact_id}")
def artifact(
    artifact_id: str, request: Request, store: StoreDep, session: SessionDep, caller: EngineCaller
) -> StreamingResponse:
    if not is_artifact_id(artifact_id):
        raise HTTPException(status_code=404, detail=f"artifact {artifact_id} not found")
    if caller is not None and not served_in(session, caller.pool, artifact_id):
        detail = {"pool": caller.pool, "reason": NOT_SERVED, "address": address_of(request)}
        refuse(session, caller.target, detail, {"artifact": artifact_id})
        raise HTTPException(status_code=403, detail=f"{NOT_SERVED} {caller.pool}")
    if not store.has(artifact_id):
        raise HTTPException(status_code=404, detail=f"artifact {artifact_id} not found")
    return StreamingResponse(store.chunks(artifact_id), media_type="application/octet-stream")
