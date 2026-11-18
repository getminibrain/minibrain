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
from minibrain.models.machine_metrics import DiskSample, MetricsHistory
from minibrain.policy import load as load_policy
from minibrain.registry.audit_chain import head_of
from minibrain.registry.compute import DRAINING, Pool, PoolNode, live_engines, pools, replica_host
from minibrain.registry.models import AuditEvent, BaseModelStatus, EngineReplica, Job, JobKind, JobStatus, Model, now
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
    head = head_of(session)
    if head.broken_seq is None:
        return []
    return [
        Problem(
            id=f"audit_chain_broken:{head.broken_seq}",
            kind="audit_chain_broken",
            severity="critical",
            scope="system",
            subject="Audit log",
            text=f"Audit log integrity broken at #{head.broken_seq}",
            href=AUDIT_HREF,
            since=head.broken_at,
        )
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
