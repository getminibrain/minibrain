import re
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from minibrain.artifacts import ArtifactStore
from minibrain.jobs.output import TEXT
from minibrain.jobs.removal import referenced
from minibrain.models.machine_metrics import folder_bytes
from minibrain.registry.models import FINAL_JOB_STATUSES, Artifact, AuditEvent, Job, JobAttempt, JobEvent, now
from minibrain.registry.settings_store import read, write
from minibrain.settings import Settings

KEY = "jobs.logs"
DEFAULT_DAYS = 30
SUGGEST_DAYS = 7
TARGET = "job_logs"
JOB_FOLDER = re.compile(r"^job-(\d+)$")


def log_days(session: Session) -> int:
    stored = read(session, KEY, {}) or {}
    return int(stored.get("days", DEFAULT_DAYS))


def save_log_days(session: Session, days: int, actor: str) -> int:
    before = log_days(session)
    write(session, KEY, {"days": days})
    if before != days:
        detail = {"from": before, "to": days}
        session.add(AuditEvent(actor=actor, action="job_logs.retention", target=TARGET, detail=detail))
    session.commit()
    return days


def work_folders(settings: Settings) -> list[Path]:
    return [settings.work_dir(), settings.home / "worker" / "work"]


def job_folders(settings: Settings) -> dict[int, list[Path]]:
    found: dict[int, list[Path]] = {}
    for root in work_folders(settings):
        if not root.is_dir():
            continue
        for entry in root.iterdir():
            match = JOB_FOLDER.match(entry.name)
            if match and entry.is_dir():
                found.setdefault(int(match.group(1)), []).append(entry)
    return found


@dataclass
class OldLogs:
    jobs: set[int] = field(default_factory=set)
    attempts: list[JobAttempt] = field(default_factory=list)
    artifacts: dict[str, int] = field(default_factory=dict)
    folders: dict[Path, int] = field(default_factory=dict)

    @property
    def size(self) -> int:
        return sum(self.artifacts.values()) + sum(self.folders.values())


def finished_before(session: Session, cutoff: datetime, ids: set[int]) -> set[int]:
    if not ids:
        return set()
    query = select(Job.id).where(Job.id.in_(ids), Job.status.in_(FINAL_JOB_STATUSES), Job.finished_at < cutoff)
    return set(session.scalars(query))


def old_logs(session: Session, settings: Settings, days: int) -> OldLogs:
    cutoff = now() - timedelta(days=days)
    found = OldLogs()
    attempts = session.execute(
        select(JobAttempt, Artifact.size)
        .join(Job, Job.id == JobAttempt.job_id)
        .outerjoin(Artifact, Artifact.id == JobAttempt.log_artifact_id)
        .where(
            JobAttempt.log_artifact_id.is_not(None),
            Job.status.in_(FINAL_JOB_STATUSES),
            Job.finished_at < cutoff,
        )
    ).all()
    for attempt, size in attempts:
        found.attempts.append(attempt)
        found.jobs.add(attempt.job_id)
        found.artifacts[str(attempt.log_artifact_id)] = int(size or 0)
    folders = job_folders(settings)
    known = set(session.scalars(select(Job.id).where(Job.id.in_(folders))))
    finished = finished_before(session, cutoff, set(folders))
    for job_id, paths in folders.items():
        if job_id in finished or job_id not in known:
            found.jobs.add(job_id)
            found.folders |= {path: folder_bytes(path) for path in paths}
    return found


def purge_job_logs(session: Session, settings: Settings, store: ArtifactStore, days: int, actor: str) -> OldLogs:
    found = old_logs(session, settings, days)
    for attempt in found.attempts:
        attempt.log_artifact_id = None
    session.flush()
    events = session.execute(delete(JobEvent).where(JobEvent.job_id.in_(found.jobs), JobEvent.kind == TEXT))
    lines = int(getattr(events, "rowcount", 0) or 0)
    gone = [artifact_id for artifact_id in found.artifacts if not referenced(session, artifact_id)]
    for artifact_id in gone:
        artifact = session.get(Artifact, artifact_id)
        if artifact is not None:
            session.delete(artifact)
    if found.jobs:
        detail = {
            "days": days,
            "jobs": len(found.jobs),
            "logs": len(gone),
            "lines": lines,
            "folders": len(found.folders),
            "size_bytes": found.size,
        }
        session.add(AuditEvent(actor=actor, action="job_logs.purge", target=TARGET, detail=detail))
    session.commit()
    for artifact_id in gone:
        store.delete(artifact_id)
    for path in found.folders:
        shutil.rmtree(path, ignore_errors=True)
    return found
