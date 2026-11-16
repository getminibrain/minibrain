from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from minibrain.registry.compute import ACTIVE, DRAINING, NODE_FRESH, REMOVED, live_engines
from minibrain.registry.models import EngineReplica, Job, JobStatus, Node, Worker, now
from minibrain.registry.service import ConflictError


@dataclass(frozen=True)
class Busy:
    jobs: int
    engines: int

    @property
    def idle(self) -> bool:
        return self.jobs == 0 and self.engines == 0

    def text(self) -> str:
        parts = [
            f"{count} {noun}{'' if count == 1 else 's'}"
            for count, noun in ((self.jobs, "job"), (self.engines, "engine"))
            if count
        ]
        return " and ".join(parts)


def busy(session: Session, node: Node) -> Busy:
    running = select(func.count()).select_from(Job).join(Worker, Worker.id == Job.lease_owner)
    jobs = session.scalar(
        running.where(Job.status == JobStatus.RUNNING, Worker.pool == node.pool, Worker.host == node.host)
    )
    engines = [replica for replica in live_engines(session) if replica.node_id == node.id]
    return Busy(int(jobs or 0), len(engines))


def online(node: Node) -> bool:
    return node.seen_at >= now() - NODE_FRESH


def drain(node: Node) -> bool:
    if node.state == DRAINING:
        return False
    node.state = DRAINING
    return True


def undrain(node: Node) -> bool:
    if node.state != DRAINING:
        return False
    node.state = ACTIVE
    return True


def remove(session: Session, node: Node) -> Busy:
    found = busy(session, node)
    if not found.idle:
        raise ConflictError(
            f"{node.host} still runs {found.text()}. Drain it and wait until they finish, then remove it."
        )
    if node.state != DRAINING and online(node):
        raise ConflictError(f"{node.host} is online and taking work. Drain it first, then remove it.")
    node.state = REMOVED
    session.execute(delete(Worker).where(Worker.pool == node.pool, Worker.host == node.host))
    session.execute(delete(EngineReplica).where(EngineReplica.node_id == node.id))
    return found
