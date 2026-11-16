import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from minibrain.registry.models import Job, JobEvent, JobKind, JobStatus, Version

STEP = "train.step"
EVAL = "train.eval"
TRANSFER = "transfer.progress"
COUNTED = ("score.progress", "judge.progress")
DEVICE_EVENTS = ("train.start", "train.device_fallback", "score.done", "judge.done")
MAX_POINTS = 1000
PREVIOUS_POINTS = 500
RISE = 1.02
TREND_WINDOW = 10


@dataclass
class Run:
    points: list[dict[str, Any]] = field(default_factory=list)
    evals: list[dict[str, Any]] = field(default_factory=list)


def step_of(data: dict[str, Any] | None) -> int | None:
    value = (data or {}).get("step")
    return int(value) if isinstance(value, int | float) else None


def run_of(events: Sequence[tuple[str | None, dict[str, Any] | None]]) -> Run:
    run = Run()
    for name, data in events:
        step = step_of(data)
        if step is None or data is None:
            continue
        if name == STEP:
            if run.points and step <= run.points[-1]["step"]:
                run.points = [point for point in run.points if point["step"] < step]
                run.evals = [point for point in run.evals if point["step"] < step]
            run.points.append(data)
        elif name == EVAL and isinstance(data.get("eval_loss"), int | float):
            run.evals = [point for point in run.evals if point["step"] != step]
            run.evals.append({"step": step, "eval_loss": float(data["eval_loss"])})
    return run


def thinned(points: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    if len(points) <= limit:
        return points
    stride = math.ceil(len(points) / limit)
    kept = points[::stride]
    return kept if kept[-1] is points[-1] else [*kept, points[-1]]


def mean_loss(points: list[dict[str, Any]]) -> float | None:
    losses = [float(point["loss"]) for point in points if isinstance(point.get("loss"), int | float)]
    return sum(losses) / len(losses) if losses else None


def rising_from(points: list[dict[str, Any]], evals: list[dict[str, Any]]) -> int | None:
    if len(evals) < 2:
        return None
    best = min(evals, key=lambda point: point["eval_loss"])
    last = evals[-1]
    if best is last or last["eval_loss"] <= best["eval_loss"] * RISE:
        return None
    before = mean_loss([point for point in points if point["step"] <= best["step"]][-TREND_WINDOW:])
    after = mean_loss(points[-TREND_WINDOW:])
    if before is None or after is None or after >= before:
        return None
    return int(best["step"])


def named_events(session: Session, job_id: int, names: Sequence[str]) -> list[tuple[str | None, dict[str, Any] | None]]:
    query = (
        select(JobEvent.name, JobEvent.data)
        .where(JobEvent.job_id == job_id, JobEvent.name.in_(names))
        .order_by(JobEvent.id)
    )
    return [(name, data) for name, data in session.execute(query)]


def latest_data(session: Session, job_id: int, names: Sequence[str]) -> dict[str, Any] | None:
    query = (
        select(JobEvent.data)
        .where(JobEvent.job_id == job_id, JobEvent.name.in_(names))
        .order_by(JobEvent.id.desc())
        .limit(1)
    )
    return session.scalar(query)


def training_run(session: Session, job_id: int) -> Run:
    return run_of(named_events(session, job_id, (STEP, EVAL)))


def comparable_runs(session: Session, job: Job) -> dict[int, Job]:
    stepped = exists().where(JobEvent.job_id == Job.id, JobEvent.name == STEP)
    query = (
        select(Job)
        .join(Version, Job.version_id == Version.id)
        .where(
            Job.model_id == job.model_id,
            Job.kind == JobKind.TRAIN,
            Job.status == JobStatus.SUCCEEDED,
            Job.version_id.is_distinct_from(job.version_id),
            stepped,
        )
        .order_by(Job.id)
    )
    return {run.version.number: run for run in session.scalars(query) if run.version is not None}


def default_comparison(job: Job, runs: dict[int, Job], live: int | None) -> Job | None:
    if live is not None and live in runs:
        return runs[live]
    earlier = [run for run in runs.values() if run.id < job.id]
    return max(earlier, key=lambda run: run.id, default=None)


def device_of(session: Session, job_id: int) -> str | None:
    data = latest_data(session, job_id, DEVICE_EVENTS) or {}
    device = data.get("device")
    return str(device) if device else None
