from datetime import timedelta
from typing import Any

from sqlalchemy import select

from minibrain.auth.roles import Role
from minibrain.registry.models import AuditEvent, JoinToken, now
from tests.conftest import Harness
from tests.test_accounts import csrf
from tests.test_teardown import BASE

TOKENS = "/api/compute/join-tokens"


def worker(pool: str, host: str = "gpu-a10-3") -> dict[str, Any]:
    return {"id": f"w-{host}", "host": host, "kinds": ["train"], "pool": pool}


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def register(harness: Harness, token: str, pool: str, host: str = "gpu-a10-3") -> Any:
    return harness.client.post("/internal/worker/register", json=worker(pool, host), headers=bearer(token))


def announce(harness: Harness, token: str, pool: str) -> Any:
    body = {"id": "e1", "host": "gpu-a10-4", "url": "http://gpu-a10-4:8200", "base_model": BASE}
    body |= {"engine": "sglang", "state": "loading", "pool": pool}
    return harness.client.post("/internal/gateway/engines", json=body, headers=bearer(token))


def create(harness: Harness, pool: str = "gpu", role: str = "worker", days: int | None = None) -> dict[str, Any]:
    response = harness.client.post(TOKENS, json={"pool": pool, "role": role, "expires_in_days": days})
    assert response.status_code == 201, response.text
    return response.json()


def actions(harness: Harness, prefix: str) -> list[str]:
    with harness.sessions() as session:
        found = select(AuditEvent).where(AuditEvent.target == prefix).order_by(AuditEvent.id)
        return [event.action for event in session.scalars(found)]


def test_a_join_token_admits_its_own_pool_only(harness: Harness) -> None:
    created = create(harness)
    token = created["secret"]
    assert token.startswith("mbj_") and created["env"] == "MINIBRAIN_JOIN_TOKEN"
    assert register(harness, token, "gpu").status_code == 204
    refused = register(harness, token, "rack")
    assert refused.status_code == 403 and "pool gpu only" in refused.json()["detail"]
    claim = {"worker": worker("rack"), "wait": 0}
    assert harness.client.post("/internal/worker/claim", json=claim, headers=bearer(token)).status_code == 403
    engines = {"worker": worker("local")}
    assert harness.client.post("/internal/worker/engines", json=engines, headers=bearer(token)).status_code == 403
    refused_twice = ["join_token.refused", "join_token.refused"]
    assert actions(harness, created["prefix"]) == ["join_token.create", "join_token.joined", *refused_twice]
    listed = harness.client.get(TOKENS).json()
    assert [(item["pool"], item["last_host"]) for item in listed] == [("gpu", "gpu-a10-3")]


def test_the_local_worker_token_joins_the_local_pool_only(harness: Harness) -> None:
    assert register(harness, harness.token, "local").status_code == 204
    refused = register(harness, harness.token, "gpu")
    assert refused.status_code == 403 and "MINIBRAIN_JOIN_TOKEN" in refused.json()["detail"]
    assert actions(harness, "local worker token") == ["join_token.refused"]


def test_refusals_are_audited_once_while_a_machine_retries(harness: Harness) -> None:
    token = create(harness)
    for _ in range(3):
        assert register(harness, token["secret"], "rack").status_code == 403
    assert actions(harness, token["prefix"]).count("join_token.refused") == 1


def test_the_secret_is_shown_once_and_stored_as_a_digest(harness: Harness) -> None:
    created = create(harness)
    listed = harness.client.get(TOKENS).text
    assert created["secret"] not in listed and created["prefix"] in listed
    with harness.sessions() as session:
        row = session.scalars(select(JoinToken)).one()
        assert created["secret"] not in (row.digest, row.prefix) and len(row.digest) == 64


def test_revoked_and_expired_tokens_are_refused(harness: Harness) -> None:
    revoked = create(harness)
    assert harness.client.delete(f"{TOKENS}/{revoked['id']}").status_code == 204
    assert harness.client.delete(f"{TOKENS}/{revoked['id']}").status_code == 404
    gone = register(harness, revoked["secret"], "gpu")
    assert gone.status_code == 401 and "revoked" in gone.json()["detail"]
    assert harness.client.get(TOKENS).json() == []
    lapsing = create(harness, days=1)
    with harness.sessions() as session:
        row = session.get(JoinToken, lapsing["id"])
        assert row is not None
        row.expires_at = now() - timedelta(minutes=1)
        session.commit()
    lapsed = register(harness, lapsing["secret"], "gpu")
    assert lapsed.status_code == 401 and "expired" in lapsed.json()["detail"]
    assert harness.client.get(TOKENS).json()[0]["expired"] is True
    assert actions(harness, revoked["prefix"]) == ["join_token.create", "join_token.revoke", "join_token.refused"]
    assert actions(harness, lapsing["prefix"]) == ["join_token.create", "join_token.refused"]
    assert register(harness, "mbj_unknown", "gpu").status_code == 401


def test_roles_limit_what_a_token_reaches(harness: Harness) -> None:
    engine = create(harness, role="engine")["secret"]
    assert announce(harness, engine, "gpu").status_code == 204
    elsewhere = announce(harness, engine, "rack")
    assert elsewhere.status_code == 403 and "pool gpu only" in elsewhere.json()["detail"]
    assert harness.client.get("/internal/gateway/config", headers=bearer(engine)).status_code == 403
    not_worker = register(harness, engine, "gpu")
    assert not_worker.status_code == 403 and "for engines" in not_worker.json()["detail"]
    worker_only = create(harness, role="worker")["secret"]
    assert announce(harness, worker_only, "gpu").status_code == 403
    both = create(harness, role="both")["secret"]
    assert register(harness, both, "gpu").status_code == 204 and announce(harness, both, "gpu").status_code == 204


def test_pool_names_are_checked(harness: Harness) -> None:
    for pool in ("local", "GPU", "has space", "-lead"):
        response = harness.client.post(TOKENS, json={"pool": pool, "role": "worker"})
        assert response.status_code == 422, pool
    assert harness.client.post(TOKENS, json={"pool": "gpu", "role": "admin"}).status_code == 422
    assert harness.client.post(TOKENS, json={"pool": "gpu", "role": "worker", "expires_in_days": 0}).status_code == 422


def test_only_admins_manage_join_tokens(harness: Harness) -> None:
    builder = harness.person(Role.BUILDER)
    assert builder.get(TOKENS).status_code == 403
    assert builder.post(TOKENS, json={"pool": "gpu", "role": "worker"}, headers=csrf(builder)).status_code == 403
