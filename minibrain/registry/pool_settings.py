from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from minibrain.registry.models import Job, JobKind, JobStatus, PoolSetting, now
from minibrain.registry.service import ConflictError

Workload = Literal["serving", "training"]
SERVING: Final = "serving"
TRAINING: Final = "training"
WORKLOADS: tuple[Workload, ...] = (SERVING, TRAINING)
ANY = frozenset(WORKLOADS)
TRAINING_KINDS = frozenset({JobKind.TRAIN, JobKind.EVAL, JobKind.JUDGE})
NOUNS = {SERVING: "serving", TRAINING: "training and scoring"}
DESCRIPTION_LIMIT: Final = 120
NAMED_JOBS: Final = 5


class WorkloadError(ValueError):
    pass


@dataclass(frozen=True)
class PoolSettings:
    workloads: frozenset[str] = ANY
    description: str | None = None


def clean_description(text: str) -> str:
    cleaned = " ".join(text.split())
    if len(cleaned) > DESCRIPTION_LIMIT:
        raise ValueError(f"Keep the description to {DESCRIPTION_LIMIT} characters; it has {len(cleaned)}")
    return cleaned


def known(workloads: Iterable[str]) -> frozenset[str]:
    return frozenset(item for item in workloads if item in ANY)


def workloads_of(session: Session, pool: str) -> frozenset[str]:
    found = session.get(PoolSetting, pool)
    return known(found.workloads) if found is not None else ANY


def settings_of(session: Session, pool: str) -> PoolSettings:
    found = session.get(PoolSetting, pool)
    return PoolSettings(known(found.workloads), found.description) if found is not None else PoolSettings()


def all_descriptions(session: Session) -> dict[str, str]:
    found = session.scalars(select(PoolSetting).where(PoolSetting.description.is_not(None)))
    return {row.pool: row.description for row in found if row.description}


def all_workloads(session: Session) -> dict[str, frozenset[str]]:
    return {row.pool: known(row.workloads) for row in session.scalars(select(PoolSetting))}


def allows(session: Session, pool: str, workload: str) -> bool:
    return workload in workloads_of(session, pool)


def closed_pools(session: Session, workload: str) -> set[str]:
    return {pool for pool, workloads in all_workloads(session).items() if workload not in workloads}


def used_for(workloads: Iterable[str]) -> str:
    found = known(workloads)
    if found == ANY:
        return "any work"
    return " and ".join(NOUNS[item] for item in WORKLOADS if item in found) + " only"


def refusal(pool: str, workload: str, workloads: Iterable[str]) -> str:
    return (
        f"Pool {pool} is used for {used_for(workloads)}, not {NOUNS[workload]}. "
        f"Pick another pool, or an admin changes what {pool} is used for on the Infrastructure page."
    )


def require(session: Session, pool: str, workload: str) -> None:
    workloads = workloads_of(session, pool)
    if workload not in workloads:
        raise WorkloadError(refusal(pool, workload, workloads))


def workload_of_job(kind: str) -> str | None:
    return TRAINING if kind in TRAINING_KINDS else None


def held_jobs(session: Session, pool: str) -> list[Job]:
    query = select(Job).where(Job.pool == pool, Job.status == JobStatus.QUEUED, Job.kind.in_(TRAINING_KINDS))
    return list(session.scalars(query.order_by(Job.id)))


def job_names(jobs: list[Job]) -> str:
    named = ", ".join(f"#{job.id}" for job in jobs[:NAMED_JOBS])
    return named + (f" and {len(jobs) - NAMED_JOBS} more" if len(jobs) > NAMED_JOBS else "")


def refuse_stranding(session: Session, pool: str, workloads: frozenset[str]) -> None:
    waiting = [] if TRAINING in workloads else held_jobs(session, pool)
    if waiting:
        noun = "job" if len(waiting) == 1 else "jobs"
        raise ConflictError(
            f"Pool {pool} has queued training or scoring {noun} that only it can run ({job_names(waiting)}). "
            f"Cancel them on the Jobs page, or let them start, before {pool} stops taking training."
        )


def save_settings(session: Session, pool: str, wanted: PoolSettings, actor: str) -> PoolSettings:
    workloads = known(wanted.workloads)
    if not workloads:
        raise WorkloadError(f"Pool {pool} needs at least one use: {', '.join(WORKLOADS)}")
    refuse_stranding(session, pool, workloads)
    description = wanted.description or None
    found = session.get(PoolSetting, pool)
    if workloads == ANY and description is None:
        if found is not None:
            session.delete(found)
        return PoolSettings()
    row = found or PoolSetting(pool=pool, updated_by=actor)
    row.workloads = [item for item in WORKLOADS if item in workloads]
    row.description = description
    row.updated_at = now()
    row.updated_by = actor
    session.add(row)
    return PoolSettings(workloads, description)


def listed(workloads: Iterable[str]) -> list[Workload]:
    found = known(workloads)
    return [item for item in WORKLOADS if item in found]
