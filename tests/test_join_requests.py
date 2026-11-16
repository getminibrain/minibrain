import stat
import threading
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select

from minibrain.auth.join_requests import PER_ADDRESS
from minibrain.auth.roles import Role
from minibrain.joining import Approval, Asked, JoinRefused, approval_path, ask, save, saved, wait
from minibrain.registry.models import AuditEvent, JoinRequest, now
from tests.conftest import Harness
from tests.test_accounts import csrf
from tests.test_join_tokens import TOKENS, announce, bearer, engine_token_for, register

REQUESTS = "/api/compute/join-requests"
HOST = "gpu-a10-3"
HARDWARE = {
    "host": HOST,
    "system": "Linux",
    "arch": "x86_64",
    "cpu_count": 32,
    "ram_bytes": 256 * 1024**3,
    "accelerator": "cuda",
    "accelerator_name": "NVIDIA A10",
    "gpus": [{"name": "NVIDIA A10", "memory_bytes": 24 * 1024**3}],
    "versions": {"torch": "2.9"},
}
MAIN = "http://testserver"


def asked(harness: Harness, pool: str | None = "gpu", host: str = HOST) -> Asked:
    return ask(harness.client, host, HARDWARE | {"host": host}, pool)


def waiting(harness: Harness) -> list[dict[str, Any]]:
    response = harness.client.get(REQUESTS)
    assert response.status_code == 200, response.text
    return response.json()


def state(harness: Harness, request: Asked) -> Any:
    return harness.client.get("/internal/join/requests/self", headers=bearer(request.key))


def approve(harness: Harness, request_id: int, pool: str = "gpu") -> Any:
    return harness.client.post(f"{REQUESTS}/{request_id}/approve", json={"pool": pool})


def approved(harness: Harness, pool: str = "gpu", approve_in: str | None = None) -> Approval:
    request = asked(harness, pool)
    assert approve(harness, waiting(harness)[0]["id"], approve_in or pool).status_code == 204
    found = wait(harness.client, MAIN, request, threading.Event(), poll=0)
    assert found is not None
    return found


def actions(harness: Harness, code: str) -> list[str]:
    with harness.sessions() as session:
        found = select(AuditEvent).where(AuditEvent.target == code).order_by(AuditEvent.id)
        return [event.action for event in session.scalars(found)]


def test_an_approved_machine_joins_the_pool_the_admin_picked(harness: Harness) -> None:
    request = asked(harness)
    assert len(request.code) == 6 and request.key.startswith("mbr_")
    listed = waiting(harness)
    assert [(item["code"], item["host"], item["pool"]) for item in listed] == [(request.code, HOST, "gpu")]
    assert listed[0]["hardware"]["gpus"] == [{"name": "NVIDIA A10", "memory_bytes": 24 * 1024**3}]
    assert "versions" not in listed[0]["hardware"]
    pending = {"state": "pending", "code": request.code, "pool": None, "credential": None}
    assert state(harness, request).json() == pending
    assert register(harness, request.key, "gpu", HOST).status_code == 401
    assert approve(harness, listed[0]["id"], "rack").status_code == 204
    assert waiting(harness) == []
    found = wait(harness.client, MAIN, request, threading.Event(), poll=0)
    assert found is not None and found.pool == "rack" and found.credential.startswith("mbm_")
    again = state(harness, request)
    assert again.status_code == 410
    assert register(harness, found.credential, "rack", HOST).status_code == 204
    other_pool = register(harness, found.credential, "gpu", HOST)
    assert other_pool.status_code == 403 and "pool rack only" in other_pool.json()["detail"]
    other_host = register(harness, found.credential, "rack", "elsewhere")
    assert other_host.status_code == 403 and f"for {HOST} only" in other_host.json()["detail"]
    engine = engine_token_for(harness, found.credential, "rack", HOST)
    assert engine.startswith("engine.m") and announce(harness, engine, "rack").status_code == 204
    assert announce(harness, found.credential, "rack").status_code == 204
    assert actions(harness, request.code)[:2] == ["join_request.create", "join_request.approve"]
    with harness.sessions() as session:
        row = session.scalars(select(JoinRequest)).one()
        assert request.key not in row.digest and found.credential not in (row.credential_digest or "")


def test_a_denied_machine_gets_nothing(harness: Harness) -> None:
    request = asked(harness)
    request_id = waiting(harness)[0]["id"]
    assert harness.client.post(f"{REQUESTS}/{request_id}/deny").status_code == 204
    assert harness.client.post(f"{REQUESTS}/{request_id}/deny").status_code == 404
    assert approve(harness, request_id).status_code == 404
    with pytest.raises(JoinRefused, match="denied"):
        wait(harness.client, MAIN, request, threading.Event(), poll=0)
    assert waiting(harness) == []
    assert actions(harness, request.code) == ["join_request.create", "join_request.deny"]


def test_requests_expire_after_an_hour(harness: Harness) -> None:
    request = asked(harness)
    request_id = waiting(harness)[0]["id"]
    with harness.sessions() as session:
        row = session.get(JoinRequest, request_id)
        assert row is not None
        row.expires_at = now() - timedelta(minutes=1)
        session.commit()
    assert waiting(harness) == []
    assert approve(harness, request_id).status_code == 409
    with pytest.raises(JoinRefused, match="within an hour"):
        wait(harness.client, MAIN, request, threading.Event(), poll=0)


def test_removing_an_approved_machine_revokes_it(harness: Harness) -> None:
    found = approved(harness)
    engine = engine_token_for(harness, found.credential, "gpu", HOST)
    assert register(harness, found.credential, "gpu", HOST).status_code == 204
    issue = harness.client.post(TOKENS, json={"pool": "gpu"})
    assert issue.status_code == 201 and register(harness, found.credential, "gpu", HOST).status_code == 204
    machine = f"/api/compute/pools/gpu/machines/{HOST}"
    assert harness.client.post(f"{machine}/drain").status_code == 204
    assert harness.client.delete(machine).status_code == 204
    refused = register(harness, found.credential, "gpu", HOST)
    assert refused.status_code == 401 and "removed this machine" in refused.json()["detail"]
    gone = announce(harness, engine, "gpu")
    assert gone.status_code == 401 and "approval behind this engine token was revoked" in gone.text


def test_requests_are_rate_limited_by_address_and_superseded_by_host(harness: Harness) -> None:
    first = asked(harness, host="box-0")
    asked(harness, host="box-0")
    assert [item["host"] for item in waiting(harness)] == ["box-0"]
    with pytest.raises(JoinRefused, match="no such join request"):
        wait(harness.client, MAIN, first, threading.Event(), poll=0)
    for number in range(1, PER_ADDRESS):
        asked(harness, host=f"box-{number}")
    for _ in range(3):
        with pytest.raises(JoinRefused, match="already wait for approval"):
            asked(harness, host="one-too-many")
    assert actions(harness, "join requests") == ["join_request.refused"]


def test_join_requests_check_their_input(harness: Harness) -> None:
    short = harness.client.post("/internal/join/requests", json={"host": HOST}, headers=bearer("mbr_short"))
    assert short.status_code == 401
    with pytest.raises(JoinRefused, match="local pool"):
        asked(harness, "local")
    assert harness.client.get("/internal/join/requests/self", headers=bearer("mbr_" + "x" * 43)).status_code == 404
    builder = harness.person(Role.BUILDER)
    assert builder.get(REQUESTS).status_code == 403
    assert builder.post(f"{REQUESTS}/1/approve", json={"pool": "gpu"}, headers=csrf(builder)).status_code == 403


def test_the_approval_is_kept_for_the_next_start(tmp_path: Path) -> None:
    held = Approval("http://main:8000/", "gpu", "mbm_secret")
    save(tmp_path, held)
    assert stat.S_IMODE(approval_path(tmp_path).stat().st_mode) == 0o600
    assert saved(tmp_path, "http://main:8000") == held
    assert saved(tmp_path, "http://other:8000") is None
