from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from minibrain.api.job_facts import number
from minibrain.api.schemas import DeviceTime, ScoreReference, TrainedOn
from minibrain.data.dataset_versions import version_number
from minibrain.jobs.metrics import STEP
from minibrain.registry.models import BaseModel, Job, JobEvent, JobKind, JobStatus, Model, Version, VersionStatus
from minibrain.tasks.service import held_out_score


@dataclass
class Peers:
    live: Version | None = None
    zero: Version | None = None


def base_names(session: Session, keys: set[str]) -> dict[str, str]:
    if not keys:
        return {}
    rows = session.execute(select(BaseModel.id, BaseModel.name).where(BaseModel.id.in_(keys)))
    return {key: name for key, name in rows}


def peers_of(session: Session, model_ids: set[int]) -> dict[int, Peers]:
    if not model_ids:
        return {}
    live = and_(Model.deployed, Version.number == Model.current_version)
    query = (
        select(Version, live)
        .join(Model, Version.model_id == Model.id)
        .where(Version.model_id.in_(model_ids), or_(Version.number == 0, live))
    )
    found: dict[int, Peers] = {}
    for version, is_live in session.execute(query):
        peers = found.setdefault(version.model_id, Peers())
        if is_live:
            peers.live = version
        if version.number == 0:
            peers.zero = version
    return found


def etas(session: Session, jobs: Sequence[Job]) -> dict[int, float]:
    running = [job.id for job in jobs if job.kind == JobKind.TRAIN and job.status == JobStatus.RUNNING]
    if not running:
        return {}
    latest = (
        select(func.max(JobEvent.id))
        .where(JobEvent.job_id.in_(running), JobEvent.name == STEP)
        .group_by(JobEvent.job_id)
    )
    rows = session.execute(select(JobEvent.job_id, JobEvent.data).where(JobEvent.id.in_(latest)))
    found = {job_id: number(data or {}, "eta_seconds") for job_id, data in rows}
    return {job_id: eta for job_id, eta in found.items() if eta is not None and eta > 0}


def trained_on(job: Job, names: dict[str, str]) -> TrainedOn | None:
    version = job.version
    if job.kind != JobKind.TRAIN or version is None:
        return None
    data = version.dataset_version
    return TrainedOn(
        base_model=version.base_model,
        base_model_name=names.get(version.base_model),
        dataset=data.dataset.slug if data is not None and data.dataset is not None else None,
        dataset_version=version_number(data) if data is not None else None,
    )


def reference(version: Version, peer: Version | None, live: bool) -> ScoreReference | None:
    if peer is None or peer.id == version.id or peer.status != VersionStatus.READY:
        return None
    score = held_out_score(peer)
    return None if score is None else ScoreReference(version=peer.number, score=score, live=live)


def compared_with(job: Job, score: float | None, peers: dict[int, Peers]) -> ScoreReference | None:
    version = job.version
    if score is None or version is None:
        return None
    found = peers.get(version.model_id, Peers())
    return reference(version, found.live, True) or reference(version, found.zero, False)


def device_time(job: Job) -> DeviceTime | None:
    version = job.version
    if job.kind != JobKind.TRAIN or job.status != JobStatus.SUCCEEDED or version is None or not version.device_time:
        return None
    return DeviceTime.model_validate(version.device_time)


def list_extras(session: Session, jobs: Sequence[Job], scores: dict[int, float | None]) -> dict[int, dict[str, Any]]:
    versions = [job.version for job in jobs if job.version is not None]
    names = base_names(session, {version.base_model for version in versions})
    peers = peers_of(session, {version.model_id for version in versions})
    left = etas(session, jobs)
    return {
        job.id: {
            "trained_on": trained_on(job, names),
            "compared_with": compared_with(job, scores.get(job.id), peers),
            "device_time": device_time(job),
            "eta_seconds": left.get(job.id),
        }
        for job in jobs
    }
