from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from minibrain import provision
from minibrain.api.access import admin, viewer
from minibrain.api.deps import LocalNodeDep, SessionDep
from minibrain.api.job_facts import TRAIN_START
from minibrain.auth.identity import current_actor
from minibrain.jobs.metrics import latest_data
from minibrain.models.placement import pools_of, weights_of
from minibrain.registry.compute import Pool, node_id, pools, replica_host
from minibrain.registry.models import (
    Artifact,
    AuditEvent,
    EngineReplica,
    Job,
    JobAttempt,
    JobKind,
    JobStatus,
    Model,
    Version,
    Worker,
)
from minibrain.registry.models import BaseModel as BaseModel_
from minibrain.registry.prices import KEY, DevicePrices, load_prices, locked_pools, save_prices
from minibrain.tasks.service import live_version, serving_base

router = APIRouter(prefix="/api/compute")

MAX_HOURLY_PRICE = 1_000_000
RECENT_PER_NODE = 5
RECENT_SCAN = 500
PoolName = Annotated[str, StringConstraints(min_length=1, max_length=200)]
HourlyPrice = Annotated[float, Field(ge=0, le=MAX_HOURLY_PRICE)]


class GpuInfo(BaseModel):
    name: str
    memory_bytes: int


class NodeJob(BaseModel):
    id: int
    kind: str
    model: str | None
    model_name: str | None
    version: int | None
    progress: float
    memory_bytes: int | None = Field(default=None, description="The training plan's peak memory, once planned.")


class RecentJob(BaseModel):
    id: int
    kind: str
    model: str | None
    model_name: str | None
    version: int | None
    outcome: str = Field(description="How this machine's attempt ended: succeeded, failed, lost or cancelled.")
    finished_at: datetime


class NodeInfo(BaseModel):
    id: str
    host: str
    roles: list[str]
    online: bool
    seen_at: datetime | None
    system: str
    arch: str
    cpu_count: int
    ram_bytes: int | None
    accelerator: str
    accelerator_name: str
    usable_bytes: int | None
    gpus: list[GpuInfo]
    engines: list[str]
    versions: dict[str, str] = {}
    jobs: list[NodeJob]
    recent: list[RecentJob] = Field(default=[], description="The last jobs this machine finished, newest first.")


class ServedModel(BaseModel):
    model: str
    name: str
    version: int | None
    adapter_bytes: int | None


class ReplicaInfo(BaseModel):
    id: str
    base_model: str
    engine: str
    url: str
    state: str
    host: str
    seen_at: datetime
    weights_bytes: int | None = Field(description="Size of the base model's weight files.")
    serves: list[ServedModel]


class PoolInfo(BaseModel):
    name: str
    label: str
    nodes: list[NodeInfo]
    engines: list[ReplicaInfo]


def planned_peak(session: Session, job: Job) -> int | None:
    started = latest_data(session, job.id, (TRAIN_START,)) or {}
    recipe = started.get("recipe")
    plan = recipe.get("plan") if isinstance(recipe, dict) else None
    peak = plan.get("peak_bytes") if isinstance(plan, dict) else None
    return int(peak) if isinstance(peak, int | float) and not isinstance(peak, bool) else None


def running_jobs(session: Session) -> dict[str, list[NodeJob]]:
    found: dict[str, list[NodeJob]] = {}
    query = select(Job, Worker).join(Worker, Worker.id == Job.lease_owner).where(Job.status == JobStatus.RUNNING)
    for job, worker in session.execute(query.order_by(Job.id)):
        found.setdefault(node_id(worker.pool, worker.host), []).append(
            NodeJob(
                id=job.id,
                kind=job.kind,
                model=job.model_slug,
                model_name=job.model_name,
                version=job.version_number,
                progress=job.progress,
                memory_bytes=planned_peak(session, job) if job.kind == JobKind.TRAIN else None,
            )
        )
    return found


def recent_jobs(session: Session) -> dict[str, list[RecentJob]]:
    found: dict[str, list[RecentJob]] = {}
    query = (
        select(JobAttempt, Job, Worker)
        .join(Job, Job.id == JobAttempt.job_id)
        .join(Worker, Worker.id == JobAttempt.worker)
        .where(JobAttempt.finished_at.is_not(None))
        .order_by(JobAttempt.finished_at.desc(), JobAttempt.id.desc())
        .limit(RECENT_SCAN)
    )
    for attempt, job, worker in session.execute(query):
        listed = found.setdefault(node_id(worker.pool, worker.host), [])
        if len(listed) < RECENT_PER_NODE and attempt.finished_at is not None:
            listed.append(
                RecentJob(
                    id=job.id,
                    kind=job.kind,
                    model=job.model_slug,
                    model_name=job.model_name,
                    version=job.version_number,
                    outcome=attempt.outcome,
                    finished_at=attempt.finished_at,
                )
            )
    return found


def adapter_bytes(session: Session, version: Version | None) -> int | None:
    if version is None or version.adapter_artifact_id is None:
        return None
    artifact = session.get(Artifact, version.adapter_artifact_id)
    return artifact.size if artifact is not None else None


def served_models(session: Session) -> dict[tuple[str, str], list[ServedModel]]:
    found: dict[tuple[str, str], list[ServedModel]] = {}
    for model in session.scalars(select(Model).where(Model.deployed.is_(True)).order_by(Model.name)):
        live = live_version(model)
        served = ServedModel(
            model=model.slug,
            name=model.name,
            version=live.number if live is not None else None,
            adapter_bytes=adapter_bytes(session, live),
        )
        for pool in pools_of(model):
            found.setdefault((pool, serving_base(model)), []).append(served)
    for base in session.scalars(select(BaseModel_).where(BaseModel_.deployed.is_(True)).order_by(BaseModel_.name)):
        served = ServedModel(model=base.id, name=base.name, version=None, adapter_bytes=None)
        for pool in pools_of(base):
            found.setdefault((pool, base.id), []).append(served)
    return found


def replica_info(
    session: Session, replica: EngineReplica, served: dict[tuple[str, str], list[ServedModel]]
) -> ReplicaInfo:
    weights = weights_of(session, replica.base_model)[0]
    return ReplicaInfo(
        id=replica.id,
        base_model=replica.base_model,
        engine=replica.engine,
        url=replica.url,
        state=replica.state,
        host=replica_host(replica),
        seen_at=replica.seen_at,
        weights_bytes=weights or None,
        serves=served.get((replica.pool, replica.base_model), []),
    )


@router.get("/pools", dependencies=[Depends(viewer)], summary="List compute pools")
def list_pools(session: SessionDep, node: LocalNodeDep) -> list[PoolInfo]:
    found: list[PoolInfo] = []
    jobs = running_jobs(session)
    recent = recent_jobs(session)
    served = served_models(session)
    for pool in pools(session, node):
        nodes = [
            NodeInfo(
                id=item.id,
                host=item.host,
                roles=item.roles,
                online=item.online,
                seen_at=item.seen_at,
                jobs=jobs.get(item.id, []),
                recent=recent.get(item.id, []),
                **{key: value for key, value in item.report.as_dict().items() if key != "host"},
            )
            for item in pool.nodes
        ]
        engines = [replica_info(session, replica, served) for replica in pool.engines]
        found.append(PoolInfo(name=pool.name, label=pool.label, nodes=nodes, engines=engines))
    return found


class PoolPrice(BaseModel):
    pool: str
    label: str
    accelerators: list[str]
    hourly_price: float | None
    locked: str | None = None


class DevicePricesInfo(BaseModel):
    currency: str
    currency_locked: str | None = None
    pools: list[PoolPrice]


class DevicePricesUpdate(BaseModel):
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    hourly: dict[PoolName, HourlyPrice] | None = None


def accelerators(pool: Pool) -> list[str]:
    names = [node.report.accelerator_name for node in pool.nodes if node.report.accelerator_name]
    return list(dict.fromkeys(names))


def prices_info(found: list[Pool], prices: DevicePrices) -> DevicePricesInfo:
    provided = provision.provided("compute")
    fixed = locked_pools(provided)

    def lock(name: str) -> str | None:
        return provided.source("prices") if name in fixed else None

    listed = [
        PoolPrice(
            pool=pool.name,
            label=pool.label,
            accelerators=accelerators(pool),
            hourly_price=prices.hourly_for(pool.name),
            locked=lock(pool.name),
        )
        for pool in found
    ]
    known = {pool.name for pool in found}
    gone = [
        PoolPrice(pool=name, label=name, accelerators=[], hourly_price=price, locked=lock(name))
        for name, price in sorted(prices.hourly.items())
        if name not in known
    ]
    return DevicePricesInfo(currency=prices.currency, currency_locked=provided.source("currency"), pools=listed + gone)


@router.get("/prices", dependencies=[Depends(viewer)], summary="Read device prices")
def read_prices(session: SessionDep, node: LocalNodeDep) -> DevicePricesInfo:
    return prices_info(pools(session, node), load_prices(session))


@router.put("/prices", dependencies=[Depends(admin)], summary="Change device prices")
def update_prices(body: DevicePricesUpdate, session: SessionDep, node: LocalNodeDep) -> DevicePricesInfo:
    before = load_prices(session)
    saved = save_prices(session, body.currency, body.hourly)
    if saved != before:
        detail = {"from": before.as_dict(), "to": saved.as_dict()}
        session.add(AuditEvent(actor=current_actor(), action="settings.prices", target=KEY, detail=detail))
    session.commit()
    return prices_info(pools(session, node), saved)
