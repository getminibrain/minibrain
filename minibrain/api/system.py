import os
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import ColumnElement, func, make_url, select
from sqlalchemy.orm import Session

from minibrain import provision
from minibrain.api.access import admin, viewer
from minibrain.api.deps import BackendDep, LocalNodeDep, SessionDep, SettingsDep, StoreDep
from minibrain.api.schemas import (
    DeviceInfo,
    InfrastructureInfo,
    InstallSettings,
    JobLogPurge,
    JobLogPurged,
    JobLogSettings,
    LoadedModel,
    StorageCheck,
    StorageSettings,
    StorageUpdate,
    StoreInfo,
    SystemInfo,
)
from minibrain.api.storage_usage import free_up, usage_groups
from minibrain.artifacts import ArtifactStore
from minibrain.auth.identity import current_actor
from minibrain.data.splits import EVAL_MAX, GOLDEN_MAX, MIN_ROWS, SHOTS_MAX
from minibrain.jobs.retention import log_days, purge_job_logs, save_log_days
from minibrain.models.bucket import WEIGHTS, writes_bucket
from minibrain.models.copies import BUCKET
from minibrain.models.hardware import LOCAL_POOL, NodeReport
from minibrain.models.registry import models_dir
from minibrain.object_store import CREDENTIAL_ENV, KEY, S3, StorageConfig, StorageError, load_config, read_secret
from minibrain.object_store import apply as apply_storage
from minibrain.object_store import check as check_storage
from minibrain.object_store import clean as clean_storage
from minibrain.object_store import save as save_storage
from minibrain.recipes import DEFAULT_RECIPE
from minibrain.registry.compute import pools
from minibrain.registry.files import ArtifactKind
from minibrain.registry.models import (
    Artifact,
    AuditEvent,
    BaseModel,
    BaseModelStatus,
    DatasetVersion,
    Job,
)
from minibrain.serve.backend import ServingBackend
from minibrain.settings import Settings
from minibrain.storage import disk_space

router = APIRouter(prefix="/api")

MEGABYTE = 1024 * 1024
TESTED = "storage.test"
ONLY_SAVED_ENDPOINT = "the saved secret goes only to {saved}; give the secret again to test {draft}"
NO_SAVED_BUCKET = "no S3 storage is saved yet, so give the secret to test {draft}"


def device_info() -> DeviceInfo:
    import torch

    from minibrain.ml.devices import pick_device, training_device

    accelerator, total, used = None, None, None
    if torch.cuda.is_available():
        free, capacity = torch.cuda.mem_get_info()
        accelerator, total, used = torch.cuda.get_device_name(0), capacity / MEGABYTE, (capacity - free) / MEGABYTE
    elif hasattr(torch, "xpu") and torch.xpu.is_available():
        free, capacity = torch.xpu.mem_get_info()
        accelerator, total, used = torch.xpu.get_device_name(0), capacity / MEGABYTE, (capacity - free) / MEGABYTE
    elif torch.backends.mps.is_available():
        accelerator = "Apple GPU (Metal)"
        total = torch.mps.recommended_max_memory() / MEGABYTE
        used = torch.mps.driver_allocated_memory() / MEGABYTE
    return DeviceInfo(
        inference=pick_device(),
        training=training_device(),
        accelerator=accelerator,
        memory_total_mb=total,
        memory_used_mb=used,
        cpu_count=os.cpu_count() or 1,
    )


def loaded_models(backend: ServingBackend) -> list[LoadedModel]:
    return [
        LoadedModel(base_model=item["base_model"], device=item.get("device") or "", adapters=item.get("adapters", []))
        for item in backend.status()
    ]


@router.get("/system", dependencies=[Depends(viewer)], summary="Read the version and features")
def system(request: Request, session: SessionDep, backend: BackendDep) -> SystemInfo:
    counts = session.execute(select(Job.status, func.count()).group_by(Job.status)).all()
    return SystemInfo(
        device=device_info(),
        jobs={status: count for status, count in counts},
        loaded=loaded_models(backend),
        loops=request.app.state.leader.describe(),
    )


def folder_store(name: str, path: Path, used: int | None) -> StoreInfo:
    space = disk_space(path)
    return StoreInfo(
        name=name,
        kind="folder",
        location=str(path),
        used_bytes=used,
        free_bytes=space.free if space else None,
        total_bytes=space.total if space else None,
        disk=str(space.device) if space and space.device is not None else None,
        mount=space.mount if space else None,
    )


def database_store(settings: Settings) -> StoreInfo:
    url = make_url(settings.database_url)
    if url.get_backend_name() != "sqlite":
        location = f"{url.host or 'localhost'}:{url.port or 5432}/{url.database or ''}"
        return StoreInfo(
            name="Database", kind="postgres", location=location, used_bytes=None, free_bytes=None, total_bytes=None
        )
    path = Path(url.database or "")
    files = [path, path.with_name(f"{path.name}-wal")]
    used = sum(item.stat().st_size for item in files if item.is_file())
    return folder_store("Database", path, used).model_copy(update={"kind": "sqlite"})


Setup = Literal["one_machine", "remote_gpus", "distributed"]


def setup_of(session: Session, node: NodeReport, database: StoreInfo) -> Setup:
    if database.kind == "postgres":
        return "distributed"
    found = pools(session, node)
    remote = any(pool.name != LOCAL_POOL and pool.nodes for pool in found) or any(
        item.host != node.host for pool in found for item in pool.nodes
    )
    return "remote_gpus" if remote else "one_machine"


def artifact_store(name: str, settings: Settings, store: ArtifactStore, used: int) -> StoreInfo:
    if store.writes_remote and store.remote is not None:
        return StoreInfo(
            name=name, kind="s3", location=store.remote.describe(), used_bytes=used, free_bytes=None, total_bytes=None
        )
    return folder_store(name, settings.artifacts_dir(), used)


def secret_reference(found: provision.Provided) -> str | None:
    ref = provision.storage_secret_ref(found)
    if ref is None:
        return None
    kind, where = ref
    return f"the environment variable {where}" if kind == "env" else f"the file {where}"


def model_store(session: Session, settings: Settings, store: ArtifactStore) -> StoreInfo:
    if not writes_bucket(store) or store.remote is None:
        used = session.scalar(select(func.sum(BaseModel.size_bytes)).where(*on_main()))
        return folder_store("Model files", models_dir(settings), int(used or 0))
    used = session.scalar(select(func.sum(BaseModel.size_bytes)).where(*available(), BaseModel.store == BUCKET))
    location = store.remote.describe()
    return StoreInfo(
        name="Model files", kind="s3", location=location, used_bytes=int(used or 0), free_bytes=None, total_bytes=None
    )


def available() -> tuple[ColumnElement[bool], ...]:
    return (BaseModel.status == BaseModelStatus.AVAILABLE,)


def on_main() -> tuple[ColumnElement[bool], ...]:
    return (*available(), BaseModel.store != BUCKET)


def storage_settings(session: Session, settings: Settings, store: ArtifactStore) -> StorageSettings:
    config = load_config(session)
    found = provision.provided("storage")
    return StorageSettings(
        kind="s3" if config.kind == S3 else "local",
        endpoint=config.endpoint,
        bucket=config.bucket,
        prefix=config.prefix,
        region=config.region,
        access_key=config.access_key,
        secret_set=bool(read_secret(settings)),
        secret_from_environment=bool(os.environ.get(CREDENTIAL_ENV, "").strip()),
        secret_reference=secret_reference(found),
        locked=found.locked_by(),
        location=store.remote.describe() if store.writes_remote and store.remote else str(settings.artifacts_dir()),
    )


def storage_update(body: StorageUpdate) -> StorageConfig:
    return StorageConfig(
        kind=body.kind,
        endpoint=body.endpoint,
        bucket=body.bucket,
        prefix=body.prefix,
        region=body.region,
        access_key=body.access_key,
    )


@router.get("/settings/storage", dependencies=[Depends(admin)], summary="Read storage settings")
def read_storage(session: SessionDep, settings: SettingsDep, store: StoreDep) -> StorageSettings:
    return storage_settings(session, settings, store)


@router.put("/settings/storage", dependencies=[Depends(admin)], summary="Change storage settings")
def update_storage(body: StorageUpdate, session: SessionDep, settings: SettingsDep, store: StoreDep) -> StorageSettings:
    try:
        save_storage(session, settings, storage_update(body), body.secret, current_actor())
    except StorageError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    session.commit()
    apply_storage(store, session, settings)
    return storage_settings(session, settings, store)


def storage_target(config: StorageConfig) -> str:
    return f"{config.endpoint} ({config.region})" if config.region else config.endpoint


def saved_secret_for(session: Session, settings: Settings, draft: StorageConfig) -> str:
    saved = clean_storage(load_config(session))
    if saved.kind != S3:
        raise StorageError(NO_SAVED_BUCKET.format(draft=storage_target(draft)))
    if (draft.endpoint, draft.region) != (saved.endpoint, saved.region):
        raise StorageError(ONLY_SAVED_ENDPOINT.format(saved=storage_target(saved), draft=storage_target(draft)))
    return read_secret(settings)


def storage_check(session: Session, settings: Settings, config: StorageConfig, secret: str) -> StorageCheck:
    try:
        cleaned = clean_storage(config)
        if not secret and cleaned.endpoint:
            secret = saved_secret_for(session, settings, cleaned)
        check_storage(cleaned, secret)
    except StorageError as error:
        return StorageCheck(ok=False, message=str(error))
    return StorageCheck(ok=True, message=f"Wrote, read back and removed a test object in {cleaned.bucket}.")


@router.post(
    "/settings/storage/test",
    dependencies=[Depends(admin)],
    summary="Test storage settings",
    description="Writes, reads back and removes a test object. Without a secret it uses the saved one, and only when "
    "the endpoint and region are the saved ones. Every test is audited.",
)
def test_storage(body: StorageUpdate, session: SessionDep, settings: SettingsDep) -> StorageCheck:
    config = storage_update(body)
    secret = (body.secret or "").strip()
    check = storage_check(session, settings, config, secret)
    session.rollback()
    detail = {
        "endpoint": config.endpoint.strip(),
        "bucket": config.bucket.strip(),
        "region": config.region.strip(),
        "saved_secret": not secret,
        "ok": check.ok,
    }
    session.add(AuditEvent(actor=current_actor(), action=TESTED, target=KEY, detail=detail))
    session.commit()
    return check


def dataset_version_bytes(session: Session) -> int:
    stored = {
        artifact: size for artifact, size in session.execute(select(DatasetVersion.artifact_id, DatasetVersion.size))
    }
    return sum(stored.values())


def main_stores(session: Session, settings: Settings, store: ArtifactStore) -> list[StoreInfo]:
    kept = (ArtifactKind.DATASET_VERSION, WEIGHTS)
    artifacts = session.scalar(select(func.sum(Artifact.size)).where(Artifact.kind.not_in(kept)))
    return [
        database_store(settings),
        model_store(session, settings, store),
        artifact_store("Dataset versions", settings, store, dataset_version_bytes(session)),
        artifact_store("Uploads, adapters and results", settings, store, int(artifacts or 0)),
    ]


@router.get("/system/infrastructure", dependencies=[Depends(viewer)], summary="List servers, devices and engines")
def infrastructure(
    session: SessionDep, settings: SettingsDep, node: LocalNodeDep, store: StoreDep
) -> InfrastructureInfo:
    stores = main_stores(session, settings, store)
    return InfrastructureInfo(
        setup=setup_of(session, node, stores[0]),
        host=node.host,
        home=str(settings.home),
        web=str(settings.web_dist),
        stores=stores,
        usage=usage_groups(session, settings, stores[0]),
        free_up=free_up(session, settings),
        job_log_days=log_days(session),
    )


@router.get("/settings/job-logs", dependencies=[Depends(viewer)], summary="Read how long job logs are kept")
def read_job_logs(session: SessionDep) -> JobLogSettings:
    return JobLogSettings(days=log_days(session))


@router.put("/settings/job-logs", dependencies=[Depends(admin)], summary="Change how long job logs are kept")
def update_job_logs(body: JobLogSettings, session: SessionDep) -> JobLogSettings:
    return JobLogSettings(days=save_log_days(session, body.days, current_actor()))


@router.post(
    "/system/job-logs/purge",
    dependencies=[Depends(admin)],
    summary="Delete old job logs",
    description="Removes the logs and checkpoints of jobs that finished more than the given days ago. "
    "Queued and running jobs keep theirs.",
)
def purge_old_job_logs(body: JobLogPurge, session: SessionDep, settings: SettingsDep, store: StoreDep) -> JobLogPurged:
    found = purge_job_logs(session, settings, store, body.older_than_days, current_actor())
    return JobLogPurged(jobs=len(found.jobs), size_bytes=found.size)


@router.get("/settings", dependencies=[Depends(viewer)], summary="Read install settings")
def install_settings() -> InstallSettings:
    return InstallSettings(
        recipe=DEFAULT_RECIPE,
        splits={"golden": GOLDEN_MAX, "eval": EVAL_MAX, "shots": SHOTS_MAX, "min_rows": MIN_ROWS},
    )
