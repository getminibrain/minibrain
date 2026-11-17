from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import ColumnElement, Float, SQLColumnExpression, String, and_, case, func, literal, select
from sqlalchemy.orm import aliased

from minibrain.api.job_facts import SCORED_KINDS
from minibrain.api.sorting import Keyset, Order, cursor_anchor, seconds_between
from minibrain.registry.models import (
    BaseModel,
    Dataset,
    DatasetVersion,
    Job,
    JobAttempt,
    JobKind,
    JobStatus,
    Model,
    Version,
    Worker,
    now,
)

JobSort = Literal["id", "kind", "model", "status", "pool", "started", "duration", "score", "trained_on", "gpu_hours"]
STATUS_RANK = {
    JobStatus.RUNNING: 0,
    JobStatus.QUEUED: 1,
    JobStatus.SUCCEEDED: 2,
    JobStatus.FAILED: 3,
    JobStatus.CANCELLED: 4,
}
MISSING = -1


def lowered(value: SQLColumnExpression[Any]) -> ColumnElement[str]:
    return func.lower(func.coalesce(value, ""), type_=String)


def version_value(column: SQLColumnExpression[Any]) -> SQLColumnExpression[Any]:
    return select(column).where(Version.id == Job.version_id).scalar_subquery()


def kind_parts() -> tuple[SQLColumnExpression[Any], ...]:
    number = func.coalesce(version_value(Version.number), Job.version_number, MISSING)
    return (Job.kind, number)


def model_parts() -> tuple[SQLColumnExpression[Any], ...]:
    custom = select(Model.name).where(Model.id == Job.model_id).scalar_subquery()
    base = select(BaseModel.name).where(BaseModel.id == Job.base_model_id).scalar_subquery()
    name = func.coalesce(custom, Job.model_name, base, Job.model_slug, Job.base_model_key)
    return (lowered(name),)


def status_parts() -> tuple[SQLColumnExpression[Any], ...]:
    return (case(STATUS_RANK, value=Job.status, else_=len(STATUS_RANK)),)


def pool_parts() -> tuple[SQLColumnExpression[Any], ...]:
    ran = (
        select(Worker.pool)
        .join(JobAttempt, JobAttempt.worker == Worker.id)
        .where(JobAttempt.job_id == Job.id)
        .order_by(JobAttempt.id.desc())
        .limit(1)
        .scalar_subquery()
    )
    return (lowered(func.coalesce(ran, Job.pool)),)


def started_parts() -> tuple[SQLColumnExpression[Any], ...]:
    return (func.coalesce(Job.started_at, Job.created_at),)


def duration_parts(moment: datetime) -> tuple[SQLColumnExpression[Any], ...]:
    end = func.coalesce(Job.finished_at, literal(moment, Job.finished_at.type))
    return (
        case((Job.started_at.is_(None), literal(float(MISSING), Float)), else_=seconds_between(Job.started_at, end)),
    )


def finished_with(kinds: tuple[str, ...], value: SQLColumnExpression[Any]) -> SQLColumnExpression[Any]:
    done = and_(Job.kind.in_(kinds), Job.status == JobStatus.SUCCEEDED)
    return case((done, func.coalesce(value, MISSING)), else_=MISSING)


def score_parts() -> tuple[SQLColumnExpression[Any], ...]:
    return (finished_with(SCORED_KINDS, version_value(Version.score)),)


def gpu_hours_parts() -> tuple[SQLColumnExpression[Any], ...]:
    hours = version_value(Version.device_time["hours"].as_float())
    return (finished_with((JobKind.TRAIN,), hours),)


def trained_on_parts() -> tuple[SQLColumnExpression[Any], ...]:
    trained = and_(Version.id == Job.version_id, Job.kind == JobKind.TRAIN)
    base = (
        select(func.coalesce(BaseModel.name, Version.base_model))
        .select_from(Version)
        .outerjoin(BaseModel, BaseModel.id == Version.base_model)
        .where(trained)
        .scalar_subquery()
    )
    data = (
        select(Dataset.slug)
        .select_from(Version)
        .join(DatasetVersion, DatasetVersion.id == Version.dataset_version_id)
        .join(Dataset, Dataset.id == DatasetVersion.dataset_id)
        .where(trained)
        .scalar_subquery()
    )
    parent = aliased(DatasetVersion)
    number = (
        select(func.coalesce(DatasetVersion.number, parent.number))
        .select_from(Version)
        .join(DatasetVersion, DatasetVersion.id == Version.dataset_version_id)
        .outerjoin(parent, parent.id == DatasetVersion.base_id)
        .where(trained)
        .scalar_subquery()
    )
    return (lowered(base), lowered(data), func.coalesce(number, MISSING))


PARTS: dict[str, Callable[[], tuple[SQLColumnExpression[Any], ...]]] = {
    "id": tuple,
    "kind": kind_parts,
    "model": model_parts,
    "status": status_parts,
    "pool": pool_parts,
    "started": started_parts,
    "score": score_parts,
    "trained_on": trained_on_parts,
    "gpu_hours": gpu_hours_parts,
}


def job_keyset(sort: JobSort, order: Order, cursor: str | None = None) -> Keyset:
    if sort != "duration":
        return Keyset(columns=(*PARTS[sort](), Job.id), descending=order == "desc")
    moment = cursor_anchor(cursor) or now()
    return Keyset(columns=(*duration_parts(moment), Job.id), descending=order == "desc", anchor=moment)
