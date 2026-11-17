from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from minibrain.artifacts import ArtifactStore
from minibrain.jobs.specs import base_spec
from minibrain.registry.files import MissingArtifactError, ref
from minibrain.registry.models import (
    ACTIVE_JOB_STATUSES,
    Artifact,
    Job,
    JobAttempt,
    JobKind,
    JobStatus,
    Version,
    VersionExport,
    now,
)
from minibrain.settings import Settings

ExportState = Literal["queued", "running", "ready", "failed", "cancelled"]
EXPORTED = "export"


def export_name(version: Version, format_name: str) -> str:
    return f"{version.model.slug}-v{version.number}-merged-{format_name}"


def find_export(session: Session, version: Version, format_name: str, base_hash: str) -> VersionExport | None:
    query = select(VersionExport).where(
        VersionExport.version_id == version.id,
        VersionExport.format == format_name,
        VersionExport.base_hash == base_hash,
    )
    return session.scalar(query)


def export_state(export: VersionExport, store: ArtifactStore) -> ExportState | None:
    if export.artifact_id is not None and store.has(export.artifact_id):
        return "ready"
    job = export.job
    if job is None or job.status == JobStatus.SUCCEEDED:
        return None
    if job.status in ACTIVE_JOB_STATUSES:
        return "running" if job.status == JobStatus.RUNNING else "queued"
    return "cancelled" if job.status == JobStatus.CANCELLED else "failed"


def export_params(session: Session, settings: Settings, version: Version, export: VersionExport) -> dict[str, Any]:
    adapter = ref(session, version.adapter_artifact_id)
    if adapter is None:
        raise MissingArtifactError(f"{version.model.slug}@{version.number} has no adapter to merge")
    return {
        "slug": version.model.slug,
        "number": version.number,
        "base_model": version.base_model,
        "base_spec": base_spec(session, settings, version),
        "adapter": adapter,
        "format": export.format,
        "name": export_name(version, export.format),
        "export": export.id,
    }


def trained_pool(session: Session, version: Version) -> str | None:
    query = (
        select(JobAttempt.node_id)
        .join(Job, Job.id == JobAttempt.job_id)
        .where(Job.version_id == version.id, Job.kind == JobKind.TRAIN, Job.status == JobStatus.SUCCEEDED)
        .order_by(JobAttempt.id.desc())
        .limit(1)
    )
    node = session.scalar(query)
    return node.split("/", 1)[0] if node else None


def drop_artifact(session: Session, store: ArtifactStore, artifact_id: str) -> None:
    session.flush()
    if session.scalar(select(VersionExport.id).where(VersionExport.artifact_id == artifact_id).limit(1)) is not None:
        return
    found = session.get(Artifact, artifact_id)
    if found is not None:
        session.delete(found)
    store.delete(artifact_id)


def export_of(session: Session, job: Job) -> VersionExport | None:
    found = job.params.get("export")
    return session.get(VersionExport, int(found)) if isinstance(found, int) else None


def retried(session: Session, job: Job) -> None:
    export = export_of(session, job)
    if export is not None:
        export.job_id = job.id


def exported(session: Session, store: ArtifactStore, job: Job) -> None:
    artifact = job.outputs.get(EXPORTED)
    if artifact is None:
        raise MissingArtifactError(f"export job {job.id} returned no archive")
    export = export_of(session, job)
    if export is None:
        drop_artifact(session, store, artifact)
        return
    export.job_id = job.id
    export.artifact_id = artifact
    export.files = list((job.result or {}).get("files") or [])
    export.finished_at = now()


def export_artifacts(versions: list[Version]) -> set[str]:
    return {export.artifact_id for version in versions for export in version.exports if export.artifact_id}
