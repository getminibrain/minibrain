from collections.abc import Iterable
from typing import Final, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from minibrain.registry.models import JobKind, PoolSetting, now

Workload = Literal["serving", "training"]
SERVING: Final = "serving"
TRAINING: Final = "training"
WORKLOADS: tuple[Workload, ...] = (SERVING, TRAINING)
ANY = frozenset(WORKLOADS)
TRAINING_KINDS = frozenset({JobKind.TRAIN, JobKind.EVAL, JobKind.JUDGE})
NOUNS = {SERVING: "serving", TRAINING: "training and scoring"}


class WorkloadError(ValueError):
    pass


def known(workloads: Iterable[str]) -> frozenset[str]:
    return frozenset(item for item in workloads if item in ANY)


def workloads_of(session: Session, pool: str) -> frozenset[str]:
    found = session.get(PoolSetting, pool)
    return known(found.workloads) if found is not None else ANY


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


def save_workloads(session: Session, pool: str, workloads: Iterable[str], actor: str) -> frozenset[str]:
    wanted = known(workloads)
    if not wanted:
        raise WorkloadError(f"Pool {pool} needs at least one use: {', '.join(WORKLOADS)}")
    found = session.get(PoolSetting, pool)
    if wanted == ANY:
        if found is not None:
            session.delete(found)
        return wanted
    row = found or PoolSetting(pool=pool, updated_by=actor)
    row.workloads = [item for item in WORKLOADS if item in wanted]
    row.updated_at = now()
    row.updated_by = actor
    session.add(row)
    return wanted


def listed(workloads: Iterable[str]) -> list[Workload]:
    found = known(workloads)
    return [item for item in WORKLOADS if item in found]
