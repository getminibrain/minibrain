from collections import defaultdict
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from minibrain.api.schemas import FreeUpItem, StoreInfo, UsageGroup, UsageItem, UsageKind, UsageRef
from minibrain.data.dataset_versions import latest_ids
from minibrain.jobs.retention import SUGGEST_DAYS, job_folders, old_logs
from minibrain.models.machine_metrics import folder_bytes
from minibrain.models.safety import install_safety
from minibrain.registry.models import (
    Artifact,
    BaseModel,
    BaseModelStatus,
    Dataset,
    DatasetVersion,
    Job,
    JobAttempt,
    Model,
    Source,
    Version,
    VersionExport,
)
from minibrain.settings import Settings
from minibrain.tasks.judges import install_judge

SHOWN = 8


def group(kind: UsageKind, items: Iterable[UsageItem]) -> UsageGroup:
    found = sorted((item for item in items if item.size_bytes > 0), key=lambda item: item.size_bytes, reverse=True)
    return UsageGroup(
        kind=kind, size_bytes=sum(item.size_bytes for item in found), count=len(found), items=found[:SHOWN]
    )


def checking_bases(session: Session) -> set[str]:
    found = {install_judge(session), install_safety(session).model}
    found |= set(session.scalars(select(Model.judge_model)))
    for safety in session.scalars(select(Model.safety)):
        if isinstance(safety, dict) and safety.get("model"):
            found.add(str(safety["model"]))
    return {key for key in found if key}


def base_users(session: Session) -> dict[str, dict[str, UsageRef]]:
    users: dict[str, dict[str, UsageRef]] = defaultdict(dict)
    for slug, name, base in session.execute(select(Model.slug, Model.name, Model.base_model)):
        users[base][slug] = UsageRef(key=slug, name=name)
    built = select(Model.slug, Model.name, Version.base_model).join(Version, Version.model_id == Model.id)
    for slug, name, base in session.execute(built):
        users[base][slug] = UsageRef(key=slug, name=name)
    return users


def stored_bases(session: Session) -> list[BaseModel]:
    found = select(BaseModel).where(BaseModel.status == BaseModelStatus.AVAILABLE, BaseModel.size_bytes > 0)
    return list(session.scalars(found))


def base_items(session: Session) -> list[UsageItem]:
    users = base_users(session)
    checks = checking_bases(session)
    return [
        UsageItem(
            key=base.id,
            name=base.name,
            size_bytes=base.size_bytes,
            used_by=sorted(users.get(base.id, {}).values(), key=lambda ref: ref.name.lower()),
            checks=base.id in checks,
            deployed=base.deployed,
        )
        for base in stored_bases(session)
    ]


def adapter_items(session: Session) -> list[UsageItem]:
    found = session.execute(
        select(Model.slug, Model.name, Version.adapter_artifact_id, Artifact.size)
        .join(Version, Version.model_id == Model.id)
        .join(Artifact, Artifact.id == Version.adapter_artifact_id)
    )
    sizes: dict[str, dict[str, int]] = defaultdict(dict)
    versions: dict[str, int] = defaultdict(int)
    exports: dict[str, int] = defaultdict(int)
    names: dict[str, str] = {}
    for slug, name, artifact, size in found:
        sizes[slug][str(artifact)] = int(size or 0)
        versions[slug] += 1
        names[slug] = name
    merged = session.execute(
        select(Model.slug, Model.name, VersionExport.artifact_id, Artifact.size)
        .join(Version, Version.model_id == Model.id)
        .join(VersionExport, VersionExport.version_id == Version.id)
        .join(Artifact, Artifact.id == VersionExport.artifact_id)
    )
    for slug, name, artifact, size in merged:
        sizes[slug][str(artifact)] = int(size or 0)
        exports[slug] += 1
        names[slug] = name
    return [
        UsageItem(
            key=slug,
            name=names[slug],
            size_bytes=sum(sizes[slug].values()),
            count=versions[slug],
            exports=exports[slug],
        )
        for slug in sizes
    ]


def dataset_items(session: Session) -> list[UsageItem]:
    sizes: dict[int, dict[str, int]] = defaultdict(dict)
    versions: dict[int, int] = defaultdict(int)
    for version in session.scalars(select(DatasetVersion).where(DatasetVersion.dataset_id.is_not(None))):
        sizes[version.dataset_id or 0][version.artifact_id] = version.size
        versions[version.dataset_id or 0] += 1
    named = session.scalars(select(Dataset).where(Dataset.id.in_(sizes)))
    return [
        UsageItem(
            key=dataset.slug,
            name=dataset.name,
            size_bytes=sum(sizes[dataset.id].values()),
            count=versions[dataset.id],
        )
        for dataset in named
    ]


def upload_items(session: Session) -> list[UsageItem]:
    found = session.execute(
        select(Source.id, Source.name, Artifact.size).join(Artifact, Artifact.id == Source.artifact_id)
    )
    return [UsageItem(key=str(source), name=name, size_bytes=int(size or 0)) for source, name, size in found]


def job_name(job: Job) -> str:
    return job.model_name or job.base_model_key or job.kind


def job_items(session: Session, settings: Settings) -> list[UsageItem]:
    sizes: dict[int, int] = defaultdict(int)
    logs = session.execute(
        select(JobAttempt.job_id, Artifact.size).join(Artifact, Artifact.id == JobAttempt.log_artifact_id)
    )
    for job_id, size in logs:
        sizes[job_id] += int(size or 0)
    for job_id, paths in job_folders(settings).items():
        sizes[job_id] += sum(folder_bytes(path) for path in paths)
    jobs = {job.id: job for job in session.scalars(select(Job).where(Job.id.in_(sizes)))}
    return [
        UsageItem(
            key=str(job_id),
            name=job_name(jobs[job_id]) if job_id in jobs else "Deleted job",
            size_bytes=size,
            finished_at=jobs[job_id].finished_at if job_id in jobs else None,
        )
        for job_id, size in sizes.items()
    ]


def database_items(database: StoreInfo) -> list[UsageItem]:
    if database.used_bytes is None:
        return []
    return [UsageItem(key="database", name=database.location.rsplit("/", 1)[-1], size_bytes=database.used_bytes)]


def usage_groups(session: Session, settings: Settings, database: StoreInfo) -> list[UsageGroup]:
    return [
        group("bases", base_items(session)),
        group("adapters", adapter_items(session)),
        group("datasets", dataset_items(session)),
        group("uploads", upload_items(session)),
        group("jobs", job_items(session, settings)),
        group("database", database_items(database)),
    ]


def unused_bases(session: Session) -> list[FreeUpItem]:
    needed = set(session.scalars(select(Model.base_model))) | set(session.scalars(select(Version.base_model)))
    needed |= checking_bases(session)
    return [
        FreeUpItem(kind="base", key=base.id, name=base.name, size_bytes=base.size_bytes)
        for base in stored_bases(session)
        if base.id not in needed and not base.deployed
    ]


def used_dataset_versions(session: Session, versions: list[DatasetVersion]) -> set[int]:
    used = {found for found in session.scalars(select(Version.dataset_version_id)) if found is not None}
    return used | {version.base_id for version in versions if version.id in used and version.base_id is not None}


def unused_dataset_versions(session: Session) -> list[FreeUpItem]:
    versions = list(session.scalars(select(DatasetVersion).where(DatasetVersion.dataset_id.is_not(None))))
    kept_ids = used_dataset_versions(session, versions) | latest_ids(session)
    kept = {version.artifact_id for version in versions if version.id in kept_ids}
    spare: dict[int, list[DatasetVersion]] = defaultdict(list)
    for version in versions:
        if version.id not in kept_ids:
            spare[version.dataset_id or 0].append(version)
    named = {dataset.id: dataset for dataset in session.scalars(select(Dataset).where(Dataset.id.in_(spare)))}
    found = []
    for dataset_id, items in spare.items():
        sizes = {version.artifact_id: version.size for version in items if version.artifact_id not in kept}
        dataset = named[dataset_id]
        found.append(
            FreeUpItem(
                kind="dataset", key=dataset.slug, name=dataset.name, size_bytes=sum(sizes.values()), count=len(items)
            )
        )
    return found


def unused_sources(session: Session) -> list[FreeUpItem]:
    found = session.execute(
        select(Source, Artifact.size).join(Artifact, Artifact.id == Source.artifact_id).where(~Source.datasets.any())
    )
    return [
        FreeUpItem(kind="source", key=str(source.id), name=source.name, size_bytes=int(size or 0))
        for source, size in found
    ]


def old_job_logs(session: Session, settings: Settings) -> list[FreeUpItem]:
    found = old_logs(session, settings, SUGGEST_DAYS)
    if not found.jobs:
        return []
    return [
        FreeUpItem(
            kind="job_logs",
            key="job_logs",
            name="Job logs and checkpoints",
            size_bytes=found.size,
            count=len(found.jobs),
            days=SUGGEST_DAYS,
        )
    ]


def free_up(session: Session, settings: Settings) -> list[FreeUpItem]:
    found = (
        unused_bases(session)
        + unused_dataset_versions(session)
        + unused_sources(session)
        + old_job_logs(session, settings)
    )
    return sorted((item for item in found if item.size_bytes > 0), key=lambda item: item.size_bytes, reverse=True)
