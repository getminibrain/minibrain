import hashlib
import io
import stat
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fsspec.implementations.memory import MemoryFileSystem

from minibrain import object_store
from minibrain.artifacts import INCOMING
from minibrain.encryption import keys, rekey
from minibrain.registry.files import register, store_for
from tests.conftest import Harness, stored_bytes, tickets_csv
from tests.fake_s3 import ACCESS_KEY, SECRET_KEY, FakeS3

BUCKET_KEY = "wJalrXUtnFEMI-not-a-real-key"
S3_BODY = {
    "kind": "s3",
    "endpoint": "https://minio.internal:9000",
    "bucket": "ml-artifacts",
    "prefix": "team-a",
    "region": "",
    "access_key": "AKIAEXAMPLE",
    "secret": BUCKET_KEY,
}


class BrokenFilesystem(MemoryFileSystem):
    def open(self, *_args: Any, **_kwargs: Any) -> Any:
        raise PermissionError("AccessDenied: no write access to ml-artifacts")


@pytest.fixture
def bucket(monkeypatch: pytest.MonkeyPatch) -> Iterator[MemoryFileSystem]:
    filesystem = MemoryFileSystem()
    MemoryFileSystem.store.clear()
    calls: list[tuple[str, str]] = []

    def fake(config: object_store.StorageConfig, secret: str) -> MemoryFileSystem:
        calls.append((config.endpoint, secret))
        return filesystem

    monkeypatch.setitem(object_store.FILESYSTEMS, object_store.S3, fake)
    yield filesystem
    MemoryFileSystem.store.clear()


def upload(harness: Harness) -> dict:
    response = harness.client.post("/api/sources", files={"file": ("tickets.csv", tickets_csv(), "text/csv")})
    assert response.status_code == 201, response.text
    return response.json()


def test_storage_starts_local_and_refuses_an_incomplete_bucket(harness: Harness, bucket: MemoryFileSystem) -> None:
    current = harness.client.get("/api/settings/storage").json()
    assert (current["kind"], current["secret_set"], current["prefix"]) == ("local", False, "minibrain")
    assert current["location"].endswith("artifacts")
    missing = harness.client.put("/api/settings/storage", json=S3_BODY | {"bucket": "", "secret": None})
    assert missing.status_code == 422 and "bucket, secret key" in missing.json()["detail"]
    bad = harness.client.put("/api/settings/storage", json=S3_BODY | {"endpoint": "minio.internal"})
    assert bad.status_code == 422 and "https://" in bad.json()["detail"]


def test_connection_check_writes_reads_and_removes_a_probe(
    harness: Harness, bucket: MemoryFileSystem, monkeypatch: pytest.MonkeyPatch
) -> None:
    checked = harness.client.post("/api/settings/storage/test", json=S3_BODY).json()
    assert checked["ok"] is True and "ml-artifacts" in checked["message"]
    assert bucket.find("ml-artifacts") == []
    monkeypatch.setitem(object_store.FILESYSTEMS, object_store.S3, lambda config, secret: BrokenFilesystem())
    failed = harness.client.post("/api/settings/storage/test", json=S3_BODY).json()
    assert failed["ok"] is False and "AccessDenied" in failed["message"]
    refused = harness.client.put("/api/settings/storage", json=S3_BODY)
    assert refused.status_code == 422
    assert harness.client.get("/api/settings/storage").json()["secret_set"] is False


def storage_tests(harness: Harness) -> list[dict[str, Any]]:
    events = harness.client.get("/api/audit", params={"action": "storage.test"}).json()["events"]
    return [event["detail"] for event in events if event["action"] == "storage.test"]


def test_a_storage_test_sends_the_saved_secret_only_to_the_saved_endpoint(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    MemoryFileSystem.store.clear()
    sent: list[tuple[str, str]] = []

    def fake(config: object_store.StorageConfig, secret: str) -> MemoryFileSystem:
        sent.append((config.endpoint, secret))
        return MemoryFileSystem()

    monkeypatch.setitem(object_store.FILESYSTEMS, object_store.S3, fake)
    unsaved = harness.client.post("/api/settings/storage/test", json=S3_BODY | {"secret": None}).json()
    assert unsaved["ok"] is False and "no S3 storage is saved yet" in unsaved["message"]
    assert harness.client.put("/api/settings/storage", json=S3_BODY).status_code == 200
    sent.clear()
    kept = harness.client.post("/api/settings/storage/test", json=S3_BODY | {"secret": None, "bucket": "other"})
    assert kept.json()["ok"] is True
    assert sent == [("https://minio.internal:9000", BUCKET_KEY)]
    sent.clear()
    for moved in ({"endpoint": "https://collector.example.com"}, {"region": "eu-west-1"}):
        refused = harness.client.post("/api/settings/storage/test", json=S3_BODY | {"secret": ""} | moved).json()
        assert refused["ok"] is False and "give the secret again" in refused["message"]
    assert sent == []
    retyped = S3_BODY | {"endpoint": "https://collector.example.com", "secret": "typed-again"}
    assert harness.client.post("/api/settings/storage/test", json=retyped).json()["ok"] is True
    assert sent == [("https://collector.example.com", "typed-again")]
    audited = storage_tests(harness)
    assert [(event["endpoint"], event["saved_secret"], event["ok"]) for event in reversed(audited)] == [
        ("https://minio.internal:9000", True, False),
        ("https://minio.internal:9000", True, True),
        ("https://collector.example.com", True, False),
        ("https://minio.internal:9000", True, False),
        ("https://collector.example.com", False, True),
    ]
    assert all(BUCKET_KEY not in str(event) and "typed-again" not in str(event) for event in audited)


def test_artifacts_go_to_the_bucket_and_the_secret_never_comes_back(harness: Harness, bucket: MemoryFileSystem) -> None:
    before = upload(harness)
    saved = harness.client.put("/api/settings/storage", json=S3_BODY)
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert (body["kind"], body["secret_set"], body["access_key"]) == ("s3", True, "AKIAEXAMPLE")
    assert body["location"] == "s3://ml-artifacts/team-a/artifacts at https://minio.internal:9000"
    assert BUCKET_KEY not in saved.text
    assert BUCKET_KEY not in harness.client.get("/api/settings/storage").text
    assert BUCKET_KEY not in harness.client.get("/api/audit").text
    secret_file = object_store.secret_path(harness.settings)
    assert secret_file.read_text() == BUCKET_KEY
    assert stat.S_IMODE(secret_file.stat().st_mode) == 0o600
    other = harness.client.post("/api/sources", files={"file": ("more.csv", tickets_csv(120), "text/csv")}).json()
    store = store_for(harness.settings)
    artifact_id = other_artifact(harness, other)
    assert any(name.endswith(f"/{artifact_id[:2]}/{artifact_id}") for name in bucket.find("ml-artifacts/team-a"))
    assert not store.local(artifact_id)
    assert harness.client.get(f"/api/sources/{other['id']}").json()["rows"] == 120
    assert harness.client.get(f"/api/sources/{before['id']}").json()["rows"] == 200
    harness.client.post("/api/datasets", json={"name": "More", "source_id": other["id"]})
    dataset_version = harness.client.post("/api/datasets/more/versions").json()
    assert store.remote is not None and store.remote.has(dataset_version["hash"])
    headers = {"Authorization": f"Bearer {harness.token}"}
    pulled = harness.client.get(f"/internal/worker/artifacts/{dataset_version['hash']}", headers=headers)
    assert pulled.status_code == 200 and pulled.content[:4] == b"PAR1"
    stores = {item["name"]: item for item in harness.client.get("/api/system/infrastructure").json()["stores"]}
    assert stores["Dataset versions"]["kind"] == "s3" and stores["Dataset versions"]["free_bytes"] is None


def test_switching_back_to_local_keeps_bucket_artifacts_readable(harness: Harness, bucket: MemoryFileSystem) -> None:
    harness.client.put("/api/settings/storage", json=S3_BODY)
    remote = upload(harness)
    local = harness.client.put("/api/settings/storage", json=S3_BODY | {"kind": "local", "secret": None})
    assert local.json()["kind"] == "local" and local.json()["secret_set"] is True
    later = harness.client.post("/api/sources", files={"file": ("later.csv", tickets_csv(30), "text/csv")}).json()
    store = store_for(harness.settings)
    assert store.local(other_artifact(harness, later))
    assert harness.client.get(f"/api/sources/{remote['id']}").json()["rows"] == 200


def other_artifact(harness: Harness, source: dict) -> str:
    from minibrain.registry.models import Source

    with harness.sessions() as session:
        found = session.get(Source, source["id"])
        assert found is not None and found.artifact_id is not None
        return found.artifact_id


@pytest.mark.both_stores
def test_writes_stage_outside_the_store_and_never_replace_an_object(harness: Harness) -> None:
    store = store_for(harness.settings)
    first = store.put_stream(io.BytesIO(b"same rows"))
    sealed = stored_bytes(store, first.id)
    again = store.put_stream(io.BytesIO(b"same rows"))
    assert again.id == first.id and stored_bytes(store, first.id) == sealed
    assert not any((store.root / INCOMING).iterdir())
    root_files = [path for path in store.root.iterdir() if path.is_file()]
    assert root_files == []


@pytest.mark.both_stores
def test_key_retirement_waits_for_a_registered_artifact_the_store_has_lost(harness: Harness) -> None:
    store = store_for(harness.settings)
    kept = store.put_stream(io.BytesIO(b"kept rows")).id
    lost = hashlib.sha256(b"lost rows").hexdigest()
    with harness.sessions() as session:
        register(session, kept, "source", "file", "kept.csv", 9)
        register(session, lost, "source", "file", "lost.csv", 9)
        session.commit()
        service = keys.keys_for(harness.settings)
        rekey.rotate_key(session, service, "tester")
        session.commit()
        tally = rekey.run_pass(session, store, service, rekey.Plan(rewrap=True))
        assert (tally.rewrapped, tally.damaged) == (1, 1) and lost in tally.problems[0]
        assert rekey.retire_unused(session, service, tally, timedelta(0), "tester") == []


def test_the_bucket_keeps_the_first_object_written_under_an_id(moto: FakeS3, tmp_path: Path) -> None:
    moto.bucket("first-write-wins")
    config = object_store.StorageConfig(
        kind="s3", endpoint=moto.endpoint, bucket="first-write-wins", access_key=ACCESS_KEY
    )
    blobs = object_store.bucket_for(config, SECRET_KEY)
    assert blobs is not None
    artifact_id = hashlib.sha256(b"rows").hexdigest()
    first, second = tmp_path / "first", tmp_path / "second"
    first.write_bytes(b"first sealed copy")
    second.write_bytes(b"second sealed copy")
    blobs.upload(first, artifact_id)
    blobs.upload(second, artifact_id)
    with blobs.open(artifact_id) as stream:
        assert stream.read() == b"first sealed copy"
    blobs.replace(second, artifact_id)
    with blobs.open(artifact_id) as stream:
        assert stream.read() == b"second sealed copy"
    assert "X-Amz-Algorithm=AWS4-HMAC-SHA256" in blobs.fs.sign(blobs.key(artifact_id), expiration=60)
