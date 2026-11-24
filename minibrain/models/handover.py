import logging
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from minibrain.models import deployments
from minibrain.models.deployments import moving, owner_row, served_name, stop_moving
from minibrain.models.hardware import LOCAL_POOL
from minibrain.models.placement import assigned, engine_hosts, key_of
from minibrain.registry.compute import live_engines
from minibrain.registry.models import SYSTEM_ACTOR, AuditEvent, BaseModel, Deployment, now

MOVE_WAIT = timedelta(minutes=5)
READY = "ready"
FAILED = "failed"

log = logging.getLogger("minibrain.handover")


@dataclass(frozen=True)
class Progress:
    done: bool = False
    failure: str | None = None


def needed(session: Session, key: str, pool: str, replicas: int) -> int:
    if pool == LOCAL_POOL:
        return 1
    return max(1, len(assigned(session, pool, key, replicas)))


def failure_of(session: Session, key: str, pool: str) -> str:
    base = session.get(BaseModel, key)
    message = (base.health_detail or {}).get("message") if base is not None and base.health else None
    return f"its engine in pool {pool} failed to start{f': {message}' if message else ''}"


def progress(session: Session, key: str, pool: str, replicas: int, since: datetime) -> Progress:
    found = [replica for replica in live_engines(session) if replica.base_model == key and replica.pool == pool]
    if sum(replica.state == READY for replica in found) >= needed(session, key, pool, replicas):
        return Progress(done=True)
    if any(replica.state == FAILED and replica.seen_at >= since for replica in found):
        return Progress(failure=failure_of(session, key, pool))
    waited = now() - since
    if pool != LOCAL_POOL and not engine_hosts(session, pool) and waited > MOVE_WAIT:
        minutes = int(MOVE_WAIT.total_seconds() // 60)
        return Progress(failure=f"no machine in pool {pool} came online within {minutes} minutes")
    return Progress()


def record(session: Session, found: Deployment, detail: dict[str, object]) -> None:
    owner = owner_row(found)
    facts = {"name": owner.name, "from_pool": found.moving_from, "pool": found.pool} | detail
    session.add(AuditEvent(actor=SYSTEM_ACTOR, action="model.move", target=served_name(owner), detail=facts))


def finish(session: Session, found: Deployment) -> None:
    log.info("%s now serves from pool %s; pool %s stops", owner_row(found).name, found.pool, found.moving_from)
    record(session, found, {"outcome": "moved"})
    stop_moving(found)


def roll_back(session: Session, found: Deployment, failure: str) -> None:
    target, back = found.pool, found.moving_from or LOCAL_POOL
    log.warning("moving %s to pool %s failed: %s; it stays on %s", owner_row(found).name, target, failure, back)
    record(session, found, {"outcome": "rolled_back", "error": failure})
    deployments.roll_back(found, failure)


def advance(session: Session, found: Deployment) -> bool:
    if found.moving_since is None:
        stop_moving(found)
        return True
    step = progress(session, key_of(found), found.pool, found.replicas, found.moving_since)
    if step.done:
        finish(session, found)
    elif step.failure is not None:
        roll_back(session, found, step.failure)
    return step.done or step.failure is not None


def advance_moves(session: Session) -> bool:
    changed = [found for found in moving(session) if advance(session, found)]
    if changed:
        session.commit()
    return bool(changed)
