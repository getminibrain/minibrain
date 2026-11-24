from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from minibrain.api.access import viewer
from minibrain.api.compute import served_models
from minibrain.api.deps import LocalNodeDep, MetricsDep, SessionDep, SettingsDep, StoreDep
from minibrain.api.schemas import StoreInfo
from minibrain.api.system import main_stores
from minibrain.auth.identity import current_role
from minibrain.auth.roles import Role, allows
from minibrain.ml.planner import gigabytes
from minibrain.models.handover import serving_pool
from minibrain.models.hardware import GIB, NodeReport
from minibrain.models.machine_metrics import UNIFIED as UNIFIED_MEMORY
from minibrain.models.machine_metrics import DiskSample, MetricsHistory, measured_memory
from minibrain.models.placement import weights_of
from minibrain.policy import load as load_policy
from minibrain.registry.audit_chain import head_of
from minibrain.registry.compute import DRAINING, Pool, PoolNode, live_engines, pools, replica_host
from minibrain.registry.models import (
    AuditChainBreak,
    AuditEvent,
    BaseModelStatus,
    EngineReplica,
    Job,
    JobKind,
    JobStatus,
    Model,
    now,
)
from minibrain.registry.models import BaseModel as BaseRow
from minibrain.siem import target_of, waiting
from minibrain.tasks.service import serving_base

router = APIRouter(prefix="/api")

Severity = Literal["critical", "warning", "info"]
Scope = Literal["machine", "pool", "engine", "storage", "model", "job", "system"]
Kind = Literal[
    "audit_chain_broken",
    "model_down",
    "engine_failed",
    "siem_behind",
    "disk_low",
    "version_mismatch",
    "training_failed",
    "machine_offline",
]
View = Literal["infrastructure", "model"]
Area = Literal["serving", "machines", "memory", "storage", "training", "audit"]
Tone = Literal["success", "warning", "destructive"]

SEVERITY_ORDER: dict[Severity, int] = {"critical": 0, "warning": 1, "info": 2}
KIND_ORDER: dict[Kind, int] = {
    "audit_chain_broken": 0,
    "model_down": 1,
    "engine_failed": 2,
    "siem_behind": 3,
    "disk_low": 4,
    "version_mismatch": 5,
    "training_failed": 6,
    "machine_offline": 7,
}
VIEWS: dict[View, frozenset[Scope]] = {
    "infrastructure": frozenset({"machine", "pool", "engine", "storage", "model"}),
    "model": frozenset({"model", "job", "engine"}),
}
COMPARED = ("minibrain", "torch", "transformers", "peft")
LOW_FREE_SHARE = 0.1
LOW_FREE_BYTES = 10 * GIB
STALE_AFTER = timedelta(hours=24)
FAILED_WITHIN = timedelta(hours=24)
FAILED = "failed"
READY = "ready"
AUDIT_HREF = "/settings/audit"
SIEM_HREF = "/settings/security#audit-integrity"
SIEM_LAG = timedelta(minutes=15)


class ProblemAction(BaseModel):
    kind: Literal["remove_machine"]
    label: str
    pool: str
    host: str


class Problem(BaseModel):
    id: str = Field(description="Stable while the condition lasts.")
    kind: Kind
    severity: Severity
    scope: Scope
    subject: str = Field(description="The machine, disk, model or job it is about, as a short name.")
    text: str = Field(description="One line that says what is wrong.")
    href: str = Field(description="The page that fixes it.")
    since: datetime | None = Field(description="When the condition started, when known.")
    pool: str | None = None
    machine: str | None = Field(default=None, description="The machine involved, as pool/host.")
    models: list[str] = Field(default=[], description="Keys of the models it affects.")
    actions: list[ProblemAction] = []


class AreaCheck(BaseModel):
    area: Area
    label: str
    text: str = Field(description="What the check found on main, worded for when nothing is wrong.")
    others: str | None = Field(default=None, description="The fullest of the other machines, when there are any.")
    tone: Tone = Field(default="success", description="Warning or destructive when the check is close to a limit.")
    href: str | None = Field(default=None, description="Where to look closer, for admins.")


class Checks(BaseModel):
    checked_at: datetime
    areas: list[AreaCheck] = Field(description="One line per area Health checks, in a fixed order.")
    problems: list[Problem]


def machine_href(machine: str) -> str:
    return f"/infrastructure/machines?machine={quote(machine, safe='')}"


def model_href(key: str) -> str:
    return f"/models/{quote(key, safe='')}"


def release(value: str) -> str:
    return value.split("+")[0]


def differences(versions: dict[str, str], main: dict[str, str]) -> list[str]:
    return [
        f"{name} {versions[name]} (main has {main[name]})"
        for name in COMPARED
        if versions.get(name) and main.get(name) and release(versions[name]) != release(main[name])
    ]


def low_space(free: int | None, total: int | None) -> bool:
    if free is None or not total:
        return False
    return free < LOW_FREE_BYTES or free / total < LOW_FREE_SHARE


def is_main(item: PoolNode) -> bool:
    return "main" in item.roles


def remote_nodes(found: list[Pool]) -> Iterable[tuple[Pool, PoolNode]]:
    return ((pool, item) for pool in found for item in pool.nodes if not is_main(item))


def main_id(found: list[Pool]) -> str | None:
    return next((item.id for pool in found for item in pool.nodes if is_main(item)), None)


def offline(found: list[Pool], admin: bool, moment: datetime) -> list[Problem]:
    problems = []
    for pool, item in remote_nodes(found):
        if item.online or item.state == DRAINING:
            continue
        stale = item.seen_at is None or item.seen_at < moment - STALE_AFTER
        remove = ProblemAction(kind="remove_machine", label="Remove", pool=pool.name, host=item.host)
        problems.append(
            Problem(
                id=f"machine_offline:{item.id}",
                kind="machine_offline",
                severity="warning",
                scope="machine",
                subject=item.host,
                text=f"{item.host} is offline",
                href=machine_href(item.id),
                since=item.seen_at,
                pool=pool.name,
                machine=item.id,
                actions=[remove] if stale and admin else [],
            )
        )
    return problems


def mismatched(found: list[Pool], main: dict[str, str]) -> list[Problem]:
    problems = []
    for pool, item in remote_nodes(found):
        drift = differences(item.report.versions, main)
        if drift:
            problems.append(
                Problem(
                    id=f"version_mismatch:{item.id}",
                    kind="version_mismatch",
                    severity="warning",
                    scope="machine",
                    subject=item.host,
                    text=f"{item.host} runs other library versions than main: {'; '.join(drift)}",
                    href=machine_href(item.id),
                    since=None,
                    pool=pool.name,
                    machine=item.id,
                )
            )
    return problems


def failed_engines(session: Session, found: list[Pool]) -> list[Problem]:
    served = served_models(session)
    problems = []
    for pool in found:
        for replica in pool.engines:
            if replica.state != FAILED:
                continue
            host = replica_host(replica)
            models = [item.model for item in served.get((pool.name, replica.base_model), [])]
            problems.append(
                Problem(
                    id=f"engine_failed:{replica.id}",
                    kind="engine_failed",
                    severity="critical",
                    scope="engine",
                    subject=f"{replica.base_model} on {host}",
                    text=f"The engine for {replica.base_model} on {host} failed",
                    href=model_href(models[0] if models else replica.base_model),
                    since=None,
                    pool=pool.name,
                    machine=replica.node_id,
                    models=models or [replica.base_model],
                )
            )
    return problems


def disk_problem(key: str, where: str, free: int, href: str, pool: str, machine: str | None) -> Problem:
    return Problem(
        id=f"disk_low:{key}",
        kind="disk_low",
        severity="warning",
        scope="storage",
        subject=where,
        text=f"{where} has only {gigabytes(free)} free",
        href=href,
        since=None,
        pool=pool,
        machine=machine,
    )


def low_stores(stores: list[StoreInfo], found: list[Pool]) -> list[Problem]:
    seen: set[str] = set()
    problems = []
    machine = main_id(found)
    pool = found[0].name
    for store in stores:
        disk = store.disk or store.name
        if disk in seen or not low_space(store.free_bytes, store.total_bytes):
            continue
        seen.add(disk)
        where = f"Main's disk {store.mount}" if store.mount else f"Main's disk for {store.name}"
        problems.append(
            disk_problem(f"main:{disk}", where, store.free_bytes or 0, "/infrastructure/storage", pool, machine)
        )
    return problems


def machine_disks(metrics: MetricsHistory, item: PoolNode) -> list[DiskSample]:
    found = metrics.disks(item.id)
    return found[1] if found is not None else []


def low_machine_disks(found: list[Pool], metrics: MetricsHistory) -> list[Problem]:
    return [
        disk_problem(
            f"{item.id}:{disk.path}",
            f"{item.host} {disk.mount or disk.path}",
            disk.free_bytes or 0,
            machine_href(item.id),
            pool.name,
            item.id,
        )
        for pool, item in remote_nodes(found)
        for disk in machine_disks(metrics, item)
        if low_space(disk.free_bytes, disk.total_bytes)
    ]


Deployed = tuple[str, str, str, str]


def deployed(session: Session) -> list[Deployed]:
    found: list[Deployed] = []
    for model in session.scalars(select(Model).where(Model.deployed.is_(True)).order_by(Model.name)):
        if model.teardown is None:
            found.append((model.slug, model.name, serving_base(model), serving_pool(model)))
    query = select(BaseRow).where(BaseRow.deployed.is_(True), BaseRow.status == BaseModelStatus.AVAILABLE)
    for base in session.scalars(query.order_by(BaseRow.name)):
        if base.teardown is None:
            found.append((base.id, base.name, base.id, serving_pool(base)))
    return found


def last_seen(session: Session, base: str, pool: str) -> datetime | None:
    query = select(func.max(EngineReplica.seen_at)).where(
        EngineReplica.base_model == base, EngineReplica.pool == pool, EngineReplica.state != FAILED
    )
    return session.scalar(query)


def down_models(session: Session) -> list[Problem]:
    running = {(replica.pool, replica.base_model) for replica in live_engines(session) if replica.state != FAILED}
    return [
        Problem(
            id=f"model_down:{key}",
            kind="model_down",
            severity="critical",
            scope="model",
            subject=name,
            text=f"{name} is live but no replica is running",
            href=model_href(key),
            since=last_seen(session, base, pool),
            pool=pool,
            models=[key],
        )
        for key, name, base, pool in deployed(session)
        if (pool, base) not in running
    ]


def retried(session: Session, job: Job) -> bool:
    later = select(Job.id).where(Job.kind == JobKind.TRAIN, Job.id > job.id)
    same = Job.model_slug == job.model_slug if job.model_slug is not None else Job.retry_of == job.id
    return session.scalar(later.where(same).limit(1)) is not None


def failed_training(session: Session, moment: datetime) -> list[Problem]:
    query = select(Job).where(
        Job.kind == JobKind.TRAIN, Job.status == JobStatus.FAILED, Job.finished_at >= moment - FAILED_WITHIN
    )
    problems = []
    for job in session.scalars(query.order_by(Job.id.desc())):
        if retried(session, job):
            continue
        name = job.model_name or job.model_slug or f"job {job.id}"
        subject = f"{name} v{job.version_number}" if job.version_number is not None else name
        problems.append(
            Problem(
                id=f"training_failed:{job.id}",
                kind="training_failed",
                severity="warning",
                scope="job",
                subject=subject,
                text=f"Training {subject} failed",
                href=f"/training/{job.id}",
                since=job.finished_at,
                models=[job.model_slug] if job.model_slug else [],
            )
        )
    return problems


def broken_chain(session: Session) -> list[Problem]:
    query = select(AuditChainBreak).where(AuditChainBreak.acknowledged_at.is_(None))
    return [
        Problem(
            id=f"audit_chain_broken:{found.id}",
            kind="audit_chain_broken",
            severity="critical",
            scope="system",
            subject="Audit log",
            text=f"Audit log integrity broken at #{found.seq}",
            href=AUDIT_HREF,
            since=found.found_at,
        )
        for found in session.scalars(query.order_by(AuditChainBreak.id.desc()))
    ]


def oldest_unforwarded(session: Session, forwarded: int) -> datetime | None:
    query = select(AuditEvent.at).where(AuditEvent.seq > forwarded).order_by(AuditEvent.seq).limit(1)
    return session.scalar(query)


def siem_text(error: str | None, backlog: int) -> str:
    if error:
        return f"Audit events are not reaching the SIEM: {error}"
    return f"{backlog:,} audit {'event has' if backlog == 1 else 'events have'} waited over 15 minutes for the SIEM"


def siem_behind(session: Session, moment: datetime) -> list[Problem]:
    target = target_of(load_policy(session))
    if target is None:
        return []
    head = head_of(session)
    oldest = oldest_unforwarded(session, head.forwarded_seq)
    lagging = oldest is not None and oldest < moment - SIEM_LAG
    if not head.forward_error and not lagging:
        return []
    return [
        Problem(
            id="siem_behind",
            kind="siem_behind",
            severity="warning",
            scope="system",
            subject=target.describe(),
            text=siem_text(head.forward_error, waiting(session, head.forwarded_seq)),
            href=SIEM_HREF,
            since=oldest if lagging else head.forwarded_at,
        )
    ]


def audit_problems(session: Session, moment: datetime) -> list[Problem]:
    return broken_chain(session) + siem_behind(session, moment)


def order_key(problem: Problem) -> tuple[int, int, str]:
    return SEVERITY_ORDER[problem.severity], KIND_ORDER[problem.kind], problem.subject


def collect(
    session: Session, local: NodeReport, metrics: MetricsHistory, stores: list[StoreInfo], admin: bool
) -> list[Problem]:
    moment = now()
    found = pools(session, local)
    problems = (
        down_models(session)
        + failed_engines(session, found)
        + low_stores(stores, found)
        + low_machine_disks(found, metrics)
        + mismatched(found, local.versions)
        + failed_training(session, moment)
        + offline(found, admin, moment)
        + (audit_problems(session, moment) if admin else [])
    )
    return sorted(problems, key=order_key)


def counted(count: int, one: str, many: str) -> str:
    return f"{count:,} {one if count == 1 else many}"


def serving_text(session: Session) -> str:
    live = deployed(session)
    if not live:
        return "No live models"
    served = {(pool, base) for _, _, base, pool in live}
    states = [
        replica.state
        for replica in live_engines(session)
        if replica.state != FAILED and (replica.pool, replica.base_model) in served
    ]
    running = states.count(READY)
    starting = len(states) - running
    models = counted(len(live), "live model", "live models")
    replicas = counted(len(states), "replica", "replicas")
    if running and starting:
        return f"{models}, {replicas}: {running:,} running, {starting:,} starting"
    return f"{models}, {replicas} {'starting' if starting else 'running'}"


def machines_text(found: list[Pool], main: dict[str, str]) -> str:
    online = sum(1 for pool in found for item in pool.nodes if item.online or is_main(item))
    release_part = f", minibrain {release(main['minibrain'])}" if main.get("minibrain") else ""
    return f"{counted(online, 'machine', 'machines')} online{release_part}"


Usage = tuple[str, int, int]


def share_used(usage: Usage) -> float:
    return (usage[2] - usage[1]) / usage[2]


def fullest_other(found: list[Usage]) -> str | None:
    if not found:
        return None
    host, _, _ = fullest = max(found, key=share_used)
    others = counted(len(found), "other machine", "other machines")
    return f"{others}, fullest {host} at {round(100 * share_used(fullest))}%"


MEMORY_WARNING = 0.9
MEMORY_CRITICAL = 0.95


def memory_of(item: PoolNode, metrics: MetricsHistory) -> Usage | None:
    point = metrics.latest(item.id)
    if point is None:
        return None
    sample = point.sample
    ram = (sample.ram_used_bytes, sample.ram_total_bytes)
    used, total = measured_memory(sample, item.report.accelerator) or ram
    if used is None or not total:
        return None
    return item.host, max(0, total - used), total


def holders_text(session: Session, found: list[Pool], item: PoolNode) -> str:
    bases = [
        replica.base_model
        for pool in found
        for replica in pool.engines
        if replica.node_id == item.id and replica.state != FAILED
    ]
    if not bases:
        return "no models loaded"
    held = gigabytes(sum(weights_of(session, base)[0] for base in bases))
    if len(bases) > 1:
        return f"{len(bases)} models hold {held}"
    base = session.get(BaseRow, bases[0])
    return f"{base.name if base is not None else bases[0]} holds {held}"


def memory_tone(item: PoolNode, usage: Usage) -> Tone:
    if item.report.accelerator not in UNIFIED_MEMORY:
        return "success"
    if share_used(usage) >= MEMORY_CRITICAL:
        return "destructive"
    return "warning" if share_used(usage) >= MEMORY_WARNING else "success"


def memory_check(session: Session, found: list[Pool], metrics: MetricsHistory, admin: bool) -> AreaCheck:
    main = next((item for pool in found for item in pool.nodes if is_main(item)), None)
    usage = memory_of(main, metrics) if main is not None else None
    others = [found_usage for _, item in remote_nodes(found) if (found_usage := memory_of(item, metrics)) is not None]
    if main is None or usage is None:
        return AreaCheck(
            area="memory", label="Memory", text="Not measured on this machine yet", others=fullest_other(others)
        )
    return AreaCheck(
        area="memory",
        label="Memory",
        text=f"{round(100 * share_used(usage))}% used · {holders_text(session, found, main)}",
        others=fullest_other(others),
        tone=memory_tone(main, usage),
        href=machine_href(main.id) if admin else None,
    )


def main_disks(stores: list[StoreInfo]) -> dict[str, Usage]:
    disks: dict[str, Usage] = {}
    for store in stores:
        if store.free_bytes is not None and store.total_bytes:
            disks.setdefault(store.disk or store.name, ("main", store.free_bytes, store.total_bytes))
    return disks


def other_disks(found: list[Pool], metrics: MetricsHistory) -> list[Usage]:
    fullest: dict[str, Usage] = {}
    for _, item in remote_nodes(found):
        for disk in machine_disks(metrics, item):
            if disk.free_bytes is None or not disk.total_bytes:
                continue
            usage = (item.host, disk.free_bytes, disk.total_bytes)
            if item.id not in fullest or share_used(usage) > share_used(fullest[item.id]):
                fullest[item.id] = usage
    return list(fullest.values())


def ours_on(stores: list[StoreInfo], disk: str) -> int:
    return sum(store.used_bytes or 0 for store in stores if (store.disk or store.name) == disk)


def storage_check(stores: list[StoreInfo], found: list[Pool], metrics: MetricsHistory, admin: bool) -> AreaCheck:
    others = fullest_other(other_disks(found, metrics))
    disks = main_disks(stores)
    if not disks:
        return AreaCheck(
            area="storage", label="Storage", text="No local disk to measure on this machine", others=others
        )
    disk, (_, free, total) = max(disks.items(), key=lambda entry: share_used(entry[1]))
    used = round(100 * share_used(("main", free, total)))
    text = f"{used}% used · {gigabytes(free)} free · minibrain {gigabytes(ours_on(stores, disk))}"
    href = "/infrastructure/storage" if admin else None
    return AreaCheck(area="storage", label="Storage", text=text, others=others, href=href)


def training_text(session: Session, moment: datetime) -> str:
    train = Job.kind == JobKind.TRAIN
    running = session.scalar(select(func.count()).select_from(Job).where(train, Job.status == JobStatus.RUNNING)) or 0
    recent = Job.finished_at >= moment - FAILED_WITHIN
    finished = (
        session.scalar(select(func.count()).select_from(Job).where(train, Job.status == JobStatus.SUCCEEDED, recent))
        or 0
    )
    parts = ([f"{running:,} running"] if running else []) + ([f"{finished:,} finished in 24 h"] if finished else [])
    return ", ".join(parts) if parts else "No runs in the last 24 h"


def audit_text(session: Session) -> str:
    siem = target_of(load_policy(session))
    return "Chain intact, SIEM up to date" if siem is not None else "Chain intact"


def area_checks(
    session: Session, local: NodeReport, metrics: MetricsHistory, stores: list[StoreInfo], admin: bool
) -> list[AreaCheck]:
    moment = now()
    found = pools(session, local)
    areas = [
        AreaCheck(area="serving", label="Serving", text=serving_text(session)),
        AreaCheck(area="machines", label="Machines", text=machines_text(found, local.versions)),
        memory_check(session, found, metrics, admin),
        storage_check(stores, found, metrics, admin),
        AreaCheck(area="training", label="Training", text=training_text(session, moment)),
    ]
    if admin:
        areas.append(AreaCheck(area="audit", label="Audit log", text=audit_text(session)))
    return areas


def narrowed(problems: list[Problem], view: View | None, model: str | None) -> list[Problem]:
    scopes = VIEWS[view] if view is not None else None
    return [
        problem
        for problem in problems
        if (scopes is None or problem.scope in scopes) and (model is None or model in problem.models)
    ]


@router.get("/problems", dependencies=[Depends(viewer)], summary="List what needs attention")
def list_problems(
    session: SessionDep,
    settings: SettingsDep,
    store: StoreDep,
    node: LocalNodeDep,
    metrics: MetricsDep,
    scope: View | None = None,
    model: str | None = None,
) -> list[Problem]:
    stores = main_stores(session, settings, store)
    admin = allows(current_role(), Role.ADMIN)
    return narrowed(collect(session, node, metrics, stores, admin), scope, model)


@router.get(
    "/problems/checks",
    dependencies=[Depends(viewer)],
    summary="Run the health checks",
    description="One line per area with what its check found, and the problems it found.",
)
def health_checks(
    session: SessionDep, settings: SettingsDep, store: StoreDep, node: LocalNodeDep, metrics: MetricsDep
) -> Checks:
    stores = main_stores(session, settings, store)
    admin = allows(current_role(), Role.ADMIN)
    return Checks(
        checked_at=now(),
        areas=area_checks(session, node, metrics, stores, admin),
        problems=collect(session, node, metrics, stores, admin),
    )
