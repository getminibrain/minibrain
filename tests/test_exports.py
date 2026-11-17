import hashlib
import io
import tarfile
from typing import Any

import pytest
from sqlalchemy import select

from minibrain.auth.roles import Role
from minibrain.ml.planner import Base, Machine, merge_fits, merge_pool, merge_refusal
from minibrain.registry.models import Artifact, AuditEvent, Job, JobKind, JobStatus
from tests.conftest import Harness
from tests.test_flow import SLUG, add_version, create_with_dataset, finish

pytestmark = pytest.mark.both_stores

FAKE: dict[str, str] = {JobKind.EXPORT: "tests.fake_export"}
EXPORTS = f"/api/models/{SLUG}/versions/1/exports"
GIB = 1024**3


def ready_v1(harness: Harness) -> None:
    create_with_dataset(harness)
    add_version(harness, "lora")
    finish(harness, "train")
    finish(harness, "eval", accuracy=0.9)
    found = harness.client.get(f"/api/models/{SLUG}/versions").json()
    assert next(item for item in found if item["number"] == 1)["status"] == "ready"


def start(harness: Harness) -> dict[str, Any]:
    response = harness.client.post(EXPORTS, json={"format": "safetensors"})
    assert response.status_code == 200, response.text
    return response.json()


def run_export(harness: Harness) -> None:
    assert harness.worker(kinds=[JobKind.EXPORT], modules=FAKE).run_once()


def export_jobs(harness: Harness) -> list[Job]:
    with harness.sessions() as session:
        return list(session.scalars(select(Job).where(Job.kind == JobKind.EXPORT).order_by(Job.id)))


def actions(harness: Harness, action: str) -> list[AuditEvent]:
    with harness.sessions() as session:
        return list(session.scalars(select(AuditEvent).where(AuditEvent.action == action)))


def test_an_export_merges_packs_hashes_and_downloads(harness: Harness) -> None:
    ready_v1(harness)
    queued = start(harness)
    assert (queued["state"], queued["artifact_id"], queued["format"]) == ("queued", None, "safetensors")
    assert harness.client.get(EXPORTS).json()[0]["job_id"] == queued["job_id"]
    run_export(harness)
    [ready] = harness.client.get(EXPORTS).json()
    assert ready["state"] == "ready" and ready["filename"] == f"{SLUG}-v1-merged-safetensors.tar"
    assert {item["path"] for item in ready["files"]} == {"config.json", "model.safetensors"}
    download = harness.client.get(f"/api/artifacts/{ready['artifact_id']}")
    assert download.status_code == 200
    assert download.headers["content-disposition"] == f'attachment; filename="{ready["filename"]}"'
    assert hashlib.sha256(download.content).hexdigest() == ready["artifact_id"]
    assert len(download.content) == ready["size"]
    with tarfile.open(fileobj=io.BytesIO(download.content)) as archive:
        names = set(archive.getnames())
        sums = (archive.extractfile("SHA256SUMS") or io.BytesIO()).read().decode()
        weights = (archive.extractfile("model.safetensors") or io.BytesIO()).read()
    assert names == {"config.json", "model.safetensors", "SHA256SUMS"}
    listed = {item["path"]: item["sha256"] for item in ready["files"]}
    assert f"{listed['model.safetensors']}  model.safetensors\n" in sums
    assert hashlib.sha256(weights).hexdigest() == listed["model.safetensors"]
    [requested] = actions(harness, "version.export")
    assert (requested.target, requested.detail["job"], requested.detail["format"]) == (
        f"{SLUG}@1",
        queued["job_id"],
        "safetensors",
    )
    [downloaded] = actions(harness, "version.export_download")
    assert (downloaded.target, downloaded.detail["sha256"]) == (f"{SLUG}@1", ready["artifact_id"])


def test_a_second_request_reuses_the_running_or_finished_export(harness: Harness) -> None:
    ready_v1(harness)
    first = start(harness)
    assert start(harness)["job_id"] == first["job_id"]
    run_export(harness)
    again = start(harness)
    assert (again["state"], again["job_id"]) == ("ready", first["job_id"])
    assert len(export_jobs(harness)) == 1
    assert len(actions(harness, "version.export")) == 1


def test_a_failed_export_shows_why_and_can_start_again(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    ready_v1(harness)
    start(harness)
    monkeypatch.setenv("FAKE_EXPORT_FAIL", "1")
    run_export(harness)
    [failed] = harness.client.get(EXPORTS).json()
    assert (failed["state"], failed["error"]) == ("failed", "out of memory while merging")
    monkeypatch.delenv("FAKE_EXPORT_FAIL")
    again = start(harness)
    assert again["state"] == "queued" and again["job_id"] != failed["job_id"]
    run_export(harness)
    assert [item["state"] for item in harness.client.get(EXPORTS).json()] == ["ready"]


def test_retrying_a_failed_export_job_still_lands_on_the_version(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    ready_v1(harness)
    first = start(harness)
    monkeypatch.setenv("FAKE_EXPORT_FAIL", "1")
    run_export(harness)
    monkeypatch.delenv("FAKE_EXPORT_FAIL")
    retried = harness.client.post(f"/api/jobs/{first['job_id']}/retry")
    assert retried.status_code == 201, retried.text
    run_export(harness)
    [ready] = harness.client.get(EXPORTS).json()
    assert (ready["state"], ready["job_id"]) == ("ready", retried.json()["id"])


def failed_then_ready(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> tuple[int, int]:
    ready_v1(harness)
    first = start(harness)
    monkeypatch.setenv("FAKE_EXPORT_FAIL", "1")
    run_export(harness)
    monkeypatch.delenv("FAKE_EXPORT_FAIL")
    again = start(harness)
    run_export(harness)
    return first["job_id"], again["job_id"]


def test_retrying_an_old_failed_export_reuses_the_newer_ready_one(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    old, newer = failed_then_ready(harness, monkeypatch)
    [ready] = harness.client.get(EXPORTS).json()
    retried = harness.client.post(f"/api/jobs/{old}/retry")
    assert retried.status_code == 201 and retried.json()["id"] == newer
    [bulk] = harness.client.post("/api/jobs/retry", json={"ids": [old]}).json()
    assert bulk["done"] and bulk["retry"]["id"] == newer
    assert [job.id for job in export_jobs(harness)] == [old, newer]
    assert harness.client.get(EXPORTS).json() == [ready]
    with harness.sessions() as session:
        assert list(session.scalars(select(Artifact.id).where(Artifact.kind == "export"))) == [ready["artifact_id"]]


def test_retrying_an_export_refuses_once_the_base_files_changed(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    ready_v1(harness)
    first = start(harness)
    monkeypatch.setenv("FAKE_EXPORT_FAIL", "1")
    run_export(harness)
    monkeypatch.delenv("FAKE_EXPORT_FAIL")
    monkeypatch.setattr("minibrain.api.exports.base_hash", lambda session, key: "f" * 64)
    refused = harness.client.post(f"/api/jobs/{first['job_id']}/retry")
    assert refused.status_code == 409
    assert "now has files ffffffffffff" in refused.json()["detail"]
    assert [job.id for job in export_jobs(harness)] == [first["job_id"]]


def test_deleting_the_version_deletes_its_export(harness: Harness) -> None:
    ready_v1(harness)
    start(harness)
    run_export(harness)
    artifact = harness.client.get(EXPORTS).json()[0]["artifact_id"]
    assert harness.app.state.store.has(artifact)
    assert harness.client.delete(f"/api/models/{SLUG}/versions/1").status_code == 204
    assert not harness.app.state.store.has(artifact)
    with harness.sessions() as session:
        assert session.get(Artifact, artifact) is None


def test_deleting_the_model_deletes_its_exports(harness: Harness) -> None:
    ready_v1(harness)
    start(harness)
    run_export(harness)
    artifact = harness.client.get(EXPORTS).json()[0]["artifact_id"]
    assert harness.client.delete(f"/api/models/{SLUG}").status_code in (200, 202, 204)
    harness.settle()
    assert not harness.app.state.store.has(artifact)


def test_an_export_does_not_become_the_versions_job(harness: Harness) -> None:
    ready_v1(harness)
    start(harness)
    versions = harness.client.get(f"/api/models/{SLUG}/versions").json()
    v1 = next(item for item in versions if item["number"] == 1)
    assert v1["status"] == "ready" and v1["job"]["kind"] == "eval"


def test_only_a_ready_trained_version_exports(harness: Harness) -> None:
    create_with_dataset(harness)
    add_version(harness, "lora")
    training = harness.client.post(EXPORTS)
    assert training.status_code == 409 and "ready" in training.json()["detail"]
    baseline = harness.client.post(f"/api/models/{SLUG}/versions/0/exports")
    assert baseline.status_code == 409 and "prompt-only" in baseline.json()["detail"]


def test_viewers_see_exports_and_builders_start_them(harness: Harness) -> None:
    ready_v1(harness)
    viewer = harness.person(Role.VIEWER)
    assert viewer.post(EXPORTS).status_code == 403
    assert viewer.get(EXPORTS).status_code == 200
    builder = harness.person(Role.BUILDER)
    assert builder.post(EXPORTS).status_code == 200
    started = export_jobs(harness)
    assert [job.status for job in started] == [JobStatus.QUEUED]


def test_the_aibom_lists_the_export_with_its_sha256(harness: Harness) -> None:
    ready_v1(harness)
    start(harness)
    run_export(harness)
    artifact = harness.client.get(EXPORTS).json()[0]["artifact_id"]
    bom = harness.client.get(f"/api/models/{SLUG}/versions/1/aibom.json").json()
    [component] = [item for item in bom["components"] if item["bom-ref"] == f"export:{artifact}"]
    assert component["hashes"] == [{"alg": "SHA-256", "content": artifact}]
    assert component["name"] == f"{SLUG}-v1-merged-safetensors"
    [dependency] = [item for item in bom["dependencies"] if item["ref"] == f"export:{artifact}"]
    assert len(dependency["dependsOn"]) == 2


def test_storage_counts_exports_with_the_models_adapters(harness: Harness) -> None:
    ready_v1(harness)
    start(harness)
    run_export(harness)
    size = harness.client.get(EXPORTS).json()[0]["size"]
    usage = {group["kind"]: group for group in harness.client.get("/api/system/infrastructure").json()["usage"]}
    [item] = usage["adapters"]["items"]
    assert (item["key"], item["count"], item["exports"]) == (SLUG, 1, 1)
    assert item["size_bytes"] > size


def machine(name: str, kind: str, memory: int, pool: str) -> Machine:
    return Machine(name, kind, memory if kind != "cpu" else None, memory, frozenset(), pool)


def test_a_merge_must_fit_the_base_in_bf16_on_a_gpu_and_fp32_elsewhere() -> None:
    base = Base.of("Qwen3 8B", 8.0, None, None, None)
    small = machine("RTX 4060", "cuda", 8 * GIB, "desk")
    laptop = machine("M3", "mps", 36 * GIB, "mac")
    big = machine("H100", "cuda", 80 * GIB, "gpu")
    fits = merge_fits(base, [small, laptop])
    assert [fit.precision for fit in fits] == ["bf16", "fp32"]
    assert [fit.fits for fit in fits] == [False, False]
    refusal = merge_refusal(base, fits)
    assert refusal is not None and "M3 in pool mac" in refusal and "fp32" in refusal
    with_big = merge_fits(base, [small, laptop, big])
    assert merge_refusal(base, with_big) is None
    assert merge_pool(with_big, "desk") == "gpu"
    assert merge_pool(merge_fits(base, [big, machine("H200", "cuda", 141 * GIB, "train")]), "gpu") == "gpu"
    unknown = Machine("worker", "cuda", None, None, frozenset(), "far")
    assert merge_refusal(base, merge_fits(base, [small, unknown])) is None
    assert merge_refusal(base, []) is None
