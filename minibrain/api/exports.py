from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from minibrain.api.access import builder, viewer
from minibrain.api.deps import LocalNodeDep, SessionDep, SettingsDep, StoreDep
from minibrain.api.schemas import ExportInfo, ExportRequest, PackedFileInfo
from minibrain.artifacts import ArtifactStore
from minibrain.auth.identity import current_actor
from minibrain.jobs.queue import JobStateError, enqueue
from minibrain.ml.planner import merge_fits, merge_pool, merge_refusal
from minibrain.models.hardware import NodeReport
from minibrain.models.health import base_changed
from minibrain.models.registry import base_hash, base_readiness, require_usable
from minibrain.models.train_facts import base_facts, trainer_machines
from minibrain.registry.compute import pools
from minibrain.registry.models import (
    Artifact,
    AuditEvent,
    Job,
    JobKind,
    Model,
    Version,
    VersionExport,
    VersionKind,
    VersionStatus,
    now,
)
from minibrain.registry.service import ConflictError, get_model, get_version
from minibrain.settings import Settings
from minibrain.tasks.exports import export_of, export_params, export_state, find_export, trained_pool
from minibrain.teardown import require_idle

router = APIRouter(prefix="/api")


def export_info(session: Session, store: ArtifactStore, export: VersionExport) -> ExportInfo | None:
    state = export_state(export, store)
    if state is None:
        return None
    job = export.job
    artifact = session.get(Artifact, export.artifact_id) if state == "ready" and export.artifact_id else None
    return ExportInfo(
        format=export.format,
        state=state,
        progress=job.progress if job is not None and state in ("queued", "running") else None,
        job_id=export.job_id,
        error=job.error if job is not None and state in ("failed", "cancelled") else None,
        artifact_id=artifact.id if artifact is not None else None,
        filename=f"{artifact.name}.tar" if artifact is not None else None,
        size=artifact.size if artifact is not None else None,
        files=[PackedFileInfo.model_validate(item) for item in export.files] if artifact is not None else [],
        base_hash=export.base_hash,
        requested_by=export.requested_by,
        created_at=export.created_at,
        finished_at=export.finished_at,
    )


def exportable(session: Session, settings: Settings, model: Model, version: Version) -> str:
    target = f"{model.slug}@{version.number}"
    if version.kind != VersionKind.LORA:
        raise ConflictError(f"{target} is prompt-only; it has no weights of its own to merge")
    if version.status != VersionStatus.READY:
        raise ConflictError(f"{target} is {version.status}; export it once it is ready")
    if version.adapter_artifact_id is None:
        raise ConflictError(f"{target} has no adapter to merge")
    if base_readiness(session, version.base_model) != "ready":
        raise ConflictError(f"{version.base_model} is not on this install; the adapter has nothing to merge onto")
    require_usable(session, settings, version.base_model)
    current = base_hash(session, version.base_model)
    mismatch = base_changed(target, version.base_model, version.base_hash, current)
    if mismatch is not None:
        raise ConflictError(mismatch)
    return current or ""


def reused_export(session: Session, settings: Settings, store: ArtifactStore, job: Job) -> Job | None:
    export = export_of(session, job)
    if export is None:
        return None
    version = export.version
    try:
        current = exportable(session, settings, version.model, version)
    except ConflictError as refused:
        raise JobStateError(str(refused)) from refused
    if export.base_hash != current:
        base = version.base_model
        raise JobStateError(
            f"job {job.id} merged onto {base} files {export.base_hash[:12]}; {base} now has files {current[:12]}. "
            "Export the version again instead."
        )
    if export_state(export, store) != "ready" or export.job_id is None:
        return None
    return session.get(Job, export.job_id)


def export_pool(session: Session, settings: Settings, node: NodeReport, version: Version) -> str | None:
    base = base_facts(session, settings, version.base_model)
    fits = merge_fits(base, trainer_machines(pools(session, node)))
    refusal = merge_refusal(base, fits)
    if refusal is not None:
        raise ConflictError(refusal)
    return merge_pool(fits, trained_pool(session, version))


@router.get(
    "/models/{name}/versions/{number}/exports",
    dependencies=[Depends(viewer)],
    summary="List a version's exports",
    description="Merged exports of the version: queued, running, ready to download, or failed.",
)
def list_exports(name: str, number: int, session: SessionDep, store: StoreDep) -> list[ExportInfo]:
    version = get_version(get_model(session, name), number)
    found = [export_info(session, store, export) for export in sorted(version.exports, key=lambda item: item.id)]
    return [info for info in found if info is not None]


@router.post(
    "/models/{name}/versions/{number}/exports",
    dependencies=[Depends(builder)],
    summary="Export a version as a merged model",
    description=(
        "Merges the version's adapter into its base model's weights (bf16 on a GPU, fp32 on a CPU or Apple GPU) "
        "and packs safetensors, the tokenizer, the generation config and SHA256SUMS into one tar archive. "
        "An export already made or running for the same base files is returned instead of starting another."
    ),
)
def start_export(
    name: str,
    number: int,
    session: SessionDep,
    settings: SettingsDep,
    store: StoreDep,
    node: LocalNodeDep,
    body: ExportRequest | None = None,
) -> ExportInfo:
    asked = body or ExportRequest()
    model = get_model(session, name)
    require_idle(model.teardown, model.name)
    version = get_version(model, number)
    current = exportable(session, settings, model, version)
    export = find_export(session, version, asked.format, current)
    found = export_info(session, store, export) if export is not None else None
    if found is not None and found.state in ("queued", "running", "ready"):
        return found
    pool = export_pool(session, settings, node, version)
    actor = current_actor()
    if export is None:
        export = VersionExport(version_id=version.id, format=asked.format, base_hash=current, requested_by=actor)
        session.add(export)
        session.flush()
    params = export_params(session, settings, version, export)
    job = enqueue(session, JobKind.EXPORT, params, model.id, version.id, f"export:{export.id}", pool=pool)
    export.job_id = job.id
    export.artifact_id = None
    export.files = []
    export.requested_by = actor
    export.created_at = now()
    export.finished_at = None
    facts = {"name": model.name, "format": asked.format, "job": job.id, "base_hash": current, "pool": pool}
    session.add(AuditEvent(actor=actor, action="version.export", target=f"{model.slug}@{number}", detail=facts))
    session.commit()
    session.refresh(export)
    info = export_info(session, store, export)
    if info is None:
        raise ConflictError(f"export job {job.id} ended before it could be read")
    return info
