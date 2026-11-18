from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from minibrain import provision
from minibrain.api.access import admin, viewer
from minibrain.api.deps import LocalNodeDep, MetricsDep, SessionDep
from minibrain.api.job_facts import TRAIN_START
from minibrain.auth.identity import current_actor
from minibrain.auth.join_requests import approved_machines, revoke_machine
from minibrain.jobs.metrics import latest_data
from minibrain.models.hardware import LOCAL_POOL, NodeReport, needed_bytes
from minibrain.models.machine_metrics import (
    DiskSample,
    GpuSample,
    MachineSample,
    MetricsHistory,
    gpu_percent,
    largest_free,
    measured_memory,
)
from minibrain.models.placement import pools_of, weights_of
from minibrain.models.room import Free, pool_room
from minibrain.registry.compute import ACTIVE, REMOVED, Pool, PoolNode, node_id, pools, replica_host
from minibrain.registry.machines import drain, remove, undrain
from minibrain.registry.models import (
    Artifact,
    AuditEvent,
    EngineReplica,
    Job,
    JobAttempt,
    JobKind,
    JobStatus,
    Model,
    Node,
    Version,
    Worker,
)
from minibrain.registry.models import BaseModel as BaseModel_
from minibrain.registry.pool_settings import ANY, Workload, all_workloads, listed, save_workloads, workloads_of
from minibrain.registry.prices import KEY, DevicePrices, load_prices, locked_pools, save_prices
from minibrain.tasks.service import live_version, serving_base

router = APIRouter(prefix="/api/compute")

MAX_HOURLY_PRICE = 1_000_000
RECENT_PER_NODE = 5
RECENT_SCAN = 500
Joined = Literal["main", "local", "token", "approval"]
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


class NodeMetrics(BaseModel):
    at: datetime
    gpus: list[GpuSample]
    ram_used_bytes: int | None
    ram_total_bytes: int | None
    cpu_percent: float | None
    gpu_percent: float | None = Field(description="Mean busy share of the machine's GPUs, in percent.")
    memory_used_bytes: int | None = Field(description="Measured memory in use where models run.")
    memory_total_bytes: int | None


class MetricsPoint(BaseModel):
    at: datetime
    gpu_percent: float | None
    memory_used_bytes: int | None
    memory_total_bytes: int | None
    cpu_percent: float | None


class MachineMetricsInfo(BaseModel):
    current: NodeMetrics | None
    history: list[MetricsPoint] = Field(description="Samples of the last hour, oldest first.")


class NodeDisk(DiskSample):
    reported_at: datetime


class NodeInfo(BaseModel):
    id: str
    host: str
    roles: list[str]
    online: bool
    state: Literal["active", "draining"] = Field(
        default="active", description="A draining machine finishes its work and takes no new jobs or engines."
    )
    metrics: NodeMetrics | None = Field(default=None, description="The latest measured sample, while fresh.")
    disks: list[NodeDisk] = Field(default=[], description="The disk this machine keeps models on, last reported.")
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
    joined: Joined = Field(description="How it joined: main itself, the local token, a pool token or approval.")


class ServedModel(BaseModel):
    model: str
    name: str
    version: int | None
    adapter_bytes: int | None


class DeployedModel(ServedModel):
    base_model: str = Field(description="The base its engines load.")


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


class PoolRoom(BaseModel):
    serve_count: int
    serve_size: str | None
    serve_bytes: int | None
    train_size: str | None
    train_strategy: str | None
    free_bytes: int
    measured: bool
    basis: str


class PoolInfo(BaseModel):
    name: str
    label: str
    nodes: list[NodeInfo]
    engines: list[ReplicaInfo]
    room: PoolRoom | None = Field(default=None, description="What still fits on the online machines that take work.")
    deployed: list[DeployedModel] = Field(
        default=[], description="Models deployed on this pool, whether or not an engine runs them yet."
    )
    workloads: list[Workload] = Field(
        default=["serving", "training"], description="What the pool is used for; both means any work."
    )


class PoolSettingsInfo(BaseModel):
    pool: str
    workloads: list[Workload] = Field(description="What the pool is used for; both means any work.")


class PoolSettingsUpdate(BaseModel):
    workloads: list[Workload] = Field(min_length=1, description="Serving, training (with scoring), or both.")


def planned_peak(session: Session, job: Job) -> int | None:
    started = latest_data(session, job.id, (TRAIN_START,)) or {}
    recipe = started.get("recipe")
    plan = recipe.get("plan") if isinstance(recipe, dict) else None
    peak = plan.get("peak_bytes") if isinstance(plan, dict) else None
    return int(peak) if isinstance(peak, int | float) and not isinstance(peak, bool) else None


def machine_of_attempt(attempt: JobAttempt | None, worker: Worker) -> str:
    return attempt.node_id if attempt is not None and attempt.node_id else node_id(worker.pool, worker.host)


def running_jobs(session: Session) -> dict[str, list[NodeJob]]:
    found: dict[str, list[NodeJob]] = {}
    query = (
        select(Job, Worker, JobAttempt)
        .join(Worker, Worker.id == Job.lease_owner)
        .outerjoin(JobAttempt, (JobAttempt.job_id == Job.id) & (JobAttempt.number == Job.attempt))
        .where(Job.status == JobStatus.RUNNING)
    )
    for job, worker, attempt in session.execute(query.order_by(Job.id)):
        found.setdefault(machine_of_attempt(attempt, worker), []).append(
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
        listed = found.setdefault(machine_of_attempt(attempt, worker), [])
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


def node_metrics(sample: MachineSample, at: datetime, accelerator: str) -> NodeMetrics:
    memory = measured_memory(sample, accelerator)
    return NodeMetrics(
        at=at,
        gpus=sample.gpus,
        ram_used_bytes=sample.ram_used_bytes,
        ram_total_bytes=sample.ram_total_bytes,
        cpu_percent=sample.cpu_percent,
        gpu_percent=gpu_percent(sample),
        memory_used_bytes=memory[0] if memory else None,
        memory_total_bytes=memory[1] if memory else None,
    )


def estimated_use(engines: list[ReplicaInfo], jobs: list[NodeJob]) -> int:
    weights = sum(needed_bytes(engine.weights_bytes or 0) for engine in engines if engine.state != "failed")
    adapters = sum(served.adapter_bytes or 0 for engine in engines for served in engine.serves)
    return weights + adapters + sum(job.memory_bytes or 0 for job in jobs)


def measured_free(item: PoolNode, sample: MachineSample) -> Free | None:
    report = item.report
    memory = measured_memory(sample, report.accelerator)
    if memory is None:
        return None
    free = max(0, memory[1] - memory[0])
    largest = largest_free(sample, report.accelerator) or 0
    if report.usable_bytes and report.accelerator == "mps":
        free, largest = min(free, report.usable_bytes), min(largest, report.usable_bytes)
    return Free(report, item.roles, free, largest, True)


def free_of(
    item: PoolNode, sample: MachineSample | None, engines: list[ReplicaInfo], jobs: list[NodeJob]
) -> Free | None:
    found = measured_free(item, sample) if sample is not None else None
    if found is not None:
        return found
    usable = item.report.usable_bytes
    if not usable:
        return None
    free = max(0, usable - estimated_use(engines, jobs))
    biggest = max((gpu.memory_bytes for gpu in item.report.gpus), default=usable)
    return Free(item.report, item.roles, free, min(biggest, free), False)


Sampled = tuple[MachineSample, datetime]


def node_disks(metrics: MetricsHistory, item: PoolNode) -> list[NodeDisk]:
    found = metrics.disks(item.id)
    if found is None:
        return []
    at, disks = found
    return [NodeDisk(reported_at=at, **disk.model_dump()) for disk in disks]


def joined_by(item: PoolNode, pool: str, approved: set[tuple[str, str]]) -> Joined:
    if "main" in item.roles:
        return "main"
    if pool == LOCAL_POOL:
        return "local"
    return "approval" if (pool, item.host) in approved else "token"


def node_info(
    item: PoolNode,
    jobs: list[NodeJob],
    recent: list[RecentJob],
    sample: Sampled | None,
    disks: list[NodeDisk],
    joined: Joined,
) -> NodeInfo:
    fields = {key: value for key, value in item.report.as_dict().items() if key != "host"}
    fields |= {
        "id": item.id,
        "host": item.host,
        "roles": item.roles,
        "online": item.online,
        "state": "draining" if item.state != ACTIVE else "active",
        "metrics": node_metrics(sample[0], sample[1], item.report.accelerator) if sample else None,
        "seen_at": item.seen_at,
        "jobs": jobs,
        "recent": recent,
        "disks": disks,
        "joined": joined,
    }
    return NodeInfo.model_validate(fields)


def latest_sample(metrics: MetricsHistory, item: PoolNode) -> Sampled | None:
    point = metrics.latest(item.id) if item.online else None
    return (point.sample, point.at) if point is not None else None


def deployed_on(pool: str, served: dict[tuple[str, str], list[ServedModel]]) -> list[DeployedModel]:
    return [
        DeployedModel(base_model=base, **item.model_dump())
        for (name, base), items in served.items()
        if name == pool
        for item in items
    ]


def pool_info(
    session: Session,
    pool: Pool,
    jobs: dict[str, list[NodeJob]],
    recent: dict[str, list[RecentJob]],
    served: dict[tuple[str, str], list[ServedModel]],
    metrics: MetricsHistory,
    approved: set[tuple[str, str]],
    workloads: frozenset[str],
) -> PoolInfo:
    engines = [replica_info(session, replica, served) for replica in pool.engines]
    nodes: list[NodeInfo] = []
    machines: list[Free] = []
    for item in pool.nodes:
        sample = latest_sample(metrics, item)
        disks = node_disks(metrics, item)
        joined = joined_by(item, pool.name, approved)
        nodes.append(node_info(item, jobs.get(item.id, []), recent.get(item.id, []), sample, disks, joined))
        here = [engine for engine in engines if engine.host == item.host]
        free = free_of(item, sample[0] if sample else None, here, jobs.get(item.id, []))
        if item.online and item.state == ACTIVE and free is not None:
            machines.append(free)
    room = pool_room(session, pool.name, machines, sorted({engine.base_model for engine in engines}))
    return PoolInfo(
        name=pool.name,
        label=pool.label,
        nodes=nodes,
        engines=engines,
        room=PoolRoom.model_validate(room.__dict__) if room is not None else None,
        deployed=deployed_on(pool.name, served),
        workloads=listed(workloads),
    )


@router.get("/pools", dependencies=[Depends(viewer)], summary="List compute pools")
def list_pools(session: SessionDep, node: LocalNodeDep, metrics: MetricsDep) -> list[PoolInfo]:
    jobs = running_jobs(session)
    recent = recent_jobs(session)
    served = served_models(session)
    approved = approved_machines(session)
    uses = all_workloads(session)
    return [
        pool_info(session, pool, jobs, recent, served, metrics, approved, uses.get(pool.name, ANY))
        for pool in pools(session, node)
    ]


SETTINGS = "/pools/{pool}/settings"


@router.get(SETTINGS, dependencies=[Depends(admin)], summary="Read a pool's settings")
def read_pool_settings(pool: PoolName, session: SessionDep) -> PoolSettingsInfo:
    return PoolSettingsInfo(pool=pool, workloads=listed(workloads_of(session, pool)))


@router.put(SETTINGS, dependencies=[Depends(admin)], summary="Change what a pool is used for")
def update_pool_settings(pool: PoolName, body: PoolSettingsUpdate, session: SessionDep) -> PoolSettingsInfo:
    actor = current_actor()
    before = workloads_of(session, pool)
    after = save_workloads(session, pool, body.workloads, actor)
    if after != before:
        detail = {"pool": pool, "from": listed(before), "to": listed(after)}
        session.add(AuditEvent(actor=actor, action="pool.workloads", target=pool, detail=detail))
    session.commit()
    return PoolSettingsInfo(pool=pool, workloads=listed(after))


def machine_of(session: Session, local: str, pool: str, host: str) -> Node:
    if pool == LOCAL_POOL and host == local:
        raise HTTPException(status_code=409, detail=f"{host} is main: it runs minibrain itself and stays in its pool")
    found = session.get(Node, node_id(pool, host))
    if found is None or found.state == REMOVED:
        raise HTTPException(status_code=404, detail=f"No machine {host} in pool {pool}")
    return found


def audit_machine(session: Session, action: str, machine: Node) -> None:
    detail = {"pool": machine.pool, "host": machine.host}
    session.add(AuditEvent(actor=current_actor(), action=action, target=machine.id, detail=detail))


def accelerator_of(session: Session, local: NodeReport, pool: str, host: str) -> str:
    if pool == LOCAL_POOL and host == local.host:
        return local.accelerator
    found = session.get(Node, node_id(pool, host))
    if found is None or found.state == REMOVED:
        raise HTTPException(status_code=404, detail=f"No machine {host} in pool {pool}")
    return str(found.hardware.get("accelerator") or "cpu")


MACHINE = "/pools/{pool}/machines/{host}"


def metrics_point(found: NodeMetrics) -> MetricsPoint:
    return MetricsPoint(
        at=found.at,
        gpu_percent=found.gpu_percent,
        memory_used_bytes=found.memory_used_bytes,
        memory_total_bytes=found.memory_total_bytes,
        cpu_percent=found.cpu_percent,
    )


@router.get(f"{MACHINE}/metrics", dependencies=[Depends(viewer)], summary="Read a machine's live metrics")
def machine_metrics(
    pool: str, host: str, session: SessionDep, node: LocalNodeDep, metrics: MetricsDep
) -> MachineMetricsInfo:
    accelerator = accelerator_of(session, node, pool, host)
    key = node_id(pool, host)
    latest = metrics.latest(key)
    return MachineMetricsInfo(
        current=node_metrics(latest.sample, latest.at, accelerator) if latest else None,
        history=[metrics_point(node_metrics(point.sample, point.at, accelerator)) for point in metrics.history(key)],
    )


@router.post(f"{MACHINE}/drain", status_code=204, dependencies=[Depends(admin)], summary="Drain a machine")
def drain_machine(pool: str, host: str, session: SessionDep, node: LocalNodeDep) -> Response:
    machine = machine_of(session, node.host, pool, host)
    if drain(machine):
        audit_machine(session, "machine.drain", machine)
    session.commit()
    return Response(status_code=204)


@router.post(f"{MACHINE}/undrain", status_code=204, dependencies=[Depends(admin)], summary="Undrain a machine")
def undrain_machine(pool: str, host: str, session: SessionDep, node: LocalNodeDep) -> Response:
    machine = machine_of(session, node.host, pool, host)
    if undrain(machine):
        audit_machine(session, "machine.undrain", machine)
    session.commit()
    return Response(status_code=204)


@router.delete(MACHINE, status_code=204, dependencies=[Depends(admin)], summary="Remove a machine from its pool")
def remove_machine(pool: str, host: str, session: SessionDep, node: LocalNodeDep, metrics: MetricsDep) -> Response:
    machine = machine_of(session, node.host, pool, host)
    remove(session, machine)
    audit_machine(session, "machine.remove", machine)
    revoke_machine(session, machine.pool, machine.host, current_actor())
    session.commit()
    metrics.forget(machine.id)
    return Response(status_code=204)


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
