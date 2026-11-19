from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from minibrain import body_limit
from minibrain.gateway import logs
from tests.conftest import Harness, fake_adapter, tickets_csv

KIB = 1024


@pytest.fixture(autouse=True)
def small_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(body_limit, "DEFAULT_LIMIT", 4 * KIB)
    monkeypatch.setattr(body_limit, "PREFIX_LIMITS", (("/v1/", 8 * KIB), ("/internal/", 8 * KIB)))


def padded(size: int) -> bytes:
    return b'{"email":"' + b"a" * size + b'","password":"x"}'


def chunks(size: int) -> Iterator[bytes]:
    yield from (b"a" * KIB for _ in range(size // KIB))


def test_oversized_bodies_are_refused_before_sign_in(harness: Harness) -> None:
    anonymous = TestClient(harness.app, raise_server_exceptions=False)
    json = {"content-type": "application/json"}
    declared = anonymous.post("/api/auth/login", content=padded(5 * KIB), headers=json)
    assert declared.status_code == 413 and "larger than" in declared.json()["detail"]
    assert anonymous.post("/api/auth/login", content=chunks(6 * KIB), headers=json).status_code == 413
    assert anonymous.post("/api/auth/login", content=padded(KIB), headers=json).status_code == 422


def test_oversized_gateway_bodies_get_an_openai_error(harness: Harness) -> None:
    anonymous = TestClient(harness.app, raise_server_exceptions=False)
    json = {"content-type": "application/json"}
    for content in (b"a" * 9 * KIB, chunks(10 * KIB)):
        refused = anonymous.post("/v1/chat/completions", content=content, headers=json)
        assert refused.status_code == 413 and refused.json()["error"]["code"] == "body_too_large"
    assert anonymous.post("/v1/chat/completions", content=b"a" * 5 * KIB, headers=json).status_code == 400


def test_source_and_artifact_uploads_stream_past_the_limit(harness: Harness) -> None:
    data = tickets_csv(400)
    assert len(data) > 8 * KIB
    files = {"file": ("tickets.csv", data, "text/csv")}
    assert harness.client.post("/api/sources", files=files).status_code == 201
    adapter = fake_adapter()
    assert len(adapter) > 8 * KIB
    assert harness.upload(adapter, "adapter", "tar", "adapter")


def test_gateway_logs_ship_in_parts_and_keep_only_what_did_not_arrive(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(logs, "SINK_BATCH", 2)
    shipped: list[list[str]] = []

    def sink(batch: list[logs.LogEntry]) -> None:
        if len(shipped) == 1:
            shipped.append([])
            raise ConnectionError("main went away")
        shipped.append([entry.model for entry in batch])

    buffer = logs.LogBuffer(sink)
    for name in "abcde":
        buffer.add(
            logs.LogEntry(
                at=datetime.now(UTC), key_id=None, model_id=None, model=name, version=None, status=200, latency_ms=1.0
            )
        )
    with pytest.raises(ConnectionError):
        buffer.flush()
    assert shipped[0] == ["a", "b"] and [entry.model for entry in buffer.entries] == ["c", "d", "e"]
