import threading
import time
from collections.abc import Callable, Mapping
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from minibrain.ml.planner import HEADROOM
from minibrain.models.gpus import (
    GRANT_NODE,
    Grant,
    Hold,
    NoGpuError,
    choose,
    largest_usable,
    serving_bytes,
    shared,
    waiting_text,
)
from minibrain.models.hardware import FIXED_OVERHEAD, LOCAL_POOL, NodeReport, needed_bytes
from minibrain.models.placement import weights_of
from minibrain.registry.compute import node_id
from minibrain.registry.models import Job, JobKind, JobStatus

FRESH_SECONDS = 60.0
JOB_NOUNS: dict[str, str] = {
    JobKind.TRAIN: "training",
    JobKind.EVAL: "scoring",
    JobKind.JUDGE: "judging",
    JobKind.EXPORT: "export",
}
Placed = Grant | str | None


def engine_holder(key: str) -> str:
    return f"the engine for {key}"


def job_holder(job_id: int, kind: str) -> str:
    return f"{JOB_NOUNS.get(kind, kind)} job {job_id}"


def job_holds(session: Session, node: str) -> list[Hold]:
    running = session.execute(select(Job.id, Job.kind, Job.gpu).where(Job.status == JobStatus.RUNNING))
    return [
        Grant.from_dict(gpu).hold(job_holder(job_id, kind))
        for job_id, kind, gpu in running
        if isinstance(gpu, dict) and gpu.get(GRANT_NODE) == node
    ]


def planned_peak(params: Mapping[str, Any]) -> int | None:
    recipe = params.get("recipe")
    plan = recipe.get("plan") if isinstance(recipe, dict) else None
    peak = plan.get("peak_bytes") if isinstance(plan, dict) else None
    return int(peak) if isinstance(peak, int | float) and not isinstance(peak, bool) and peak > 0 else None


def job_estimate(session: Session, job: Job) -> int:
    params = job.params or {}
    peak = planned_peak(params) if job.kind == JobKind.TRAIN else None
    if peak is not None:
        return int(peak / HEADROOM)
    key = params.get("base_model") or job.base_model_key
    return needed_bytes(weights_of(session, str(key))[0]) if key else FIXED_OVERHEAD


def job_least(session: Session, job: Job, report: NodeReport) -> int:
    return min(job_estimate(session, job), largest_usable(report))


class GpuBook:
    def __init__(self, sessions: sessionmaker[Session], clock: Callable[[], float] = time.monotonic) -> None:
        self.sessions = sessions
        self.clock = clock
        self.lock = threading.RLock()
        self.local: dict[str, dict[str, Grant]] = {}
        self.reports: dict[str, dict[str, tuple[dict[str, Grant], float]]] = {}
        self.pending: dict[str, dict[str, tuple[Grant, float]]] = {}

    def fresh(self, stamped: float) -> bool:
        return self.clock() - stamped < FRESH_SECONDS

    def engine_grants(self, node: str) -> dict[str, Grant]:
        found = dict(self.local.get(node, {}))
        for grants, stamped in self.reports.get(node, {}).values():
            if self.fresh(stamped):
                found |= grants
        waiting = self.pending.get(node, {})
        return found | {
            key: grant for key, (grant, stamped) in waiting.items() if key not in found and self.fresh(stamped)
        }

    def holds(self, session: Session, node: str) -> list[Hold]:
        engines = [grant.hold(engine_holder(key)) for key, grant in sorted(self.engine_grants(node).items())]
        return engines + job_holds(session, node)

    def reported(self, node: str, worker: str, running: dict[str, Grant]) -> None:
        with self.lock:
            self.reports.setdefault(node, {})[worker] = (dict(running), self.clock())
            waiting = self.pending.get(node, {})
            self.pending[node] = {key: entry for key, entry in waiting.items() if key not in running}

    def engine_grant(self, session: Session, report: NodeReport, node: str, key: str) -> Grant | None:
        if not shared(report):
            return None
        with self.lock:
            weights = weights_of(session, key)[0]
            holds = self.holds(session, node)
            least = needed_bytes(weights)
            grant = choose(report, holds, least, serving_bytes(weights))
            if grant is None:
                raise NoGpuError(waiting_text(engine_holder(key), least, report, holds))
            return grant

    def hosted(self, session: Session, report: NodeReport, node: str, wanted: list[str]) -> dict[str, Placed]:
        found: dict[str, Placed] = {}
        with self.lock:
            running = self.engine_grants(node)
            waiting = self.pending.setdefault(node, {})
            for key in [key for key in waiting if key not in wanted or not self.fresh(waiting[key][1])]:
                waiting.pop(key)
            for key in wanted:
                if key in running:
                    found[key] = running[key]
                    continue
                try:
                    grant = self.engine_grant(session, report, node, key)
                except NoGpuError as error:
                    found[key] = str(error)
                    continue
                if grant is not None:
                    waiting[key] = (grant, self.clock())
                found[key] = grant
        return found

    def job_grant(self, session: Session, job: Job, report: NodeReport, node: str) -> Grant | str:
        with self.lock:
            holds = self.holds(session, node)
            least = job_least(session, job, report)
            grant = choose(report, holds, least)
            return grant if grant is not None else waiting_text(job_holder(job.id, job.kind), least, report, holds)


class LocalEngineGpus:
    def __init__(self, book: GpuBook, node: Callable[[], NodeReport]) -> None:
        self.book = book
        self.node = node

    def place(self) -> str:
        return node_id(LOCAL_POOL, self.node().host)

    def grant(self, key: str) -> Grant | None:
        report = self.node()
        if not shared(report):
            return None
        place = self.place()
        with self.book.lock, self.book.sessions() as session:
            grant = self.book.engine_grant(session, report, place, key)
            if grant is not None:
                self.book.local.setdefault(place, {})[key] = grant
            return grant

    def release(self, key: str) -> None:
        if not shared(self.node()):
            return
        with self.book.lock:
            self.book.local.get(self.place(), {}).pop(key, None)
