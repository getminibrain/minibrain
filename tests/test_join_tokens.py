from typing import Any

from sqlalchemy import select

from minibrain.auth.roles import Role
from minibrain.registry.models import AuditEvent, JoinToken
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


def issue(harness: Harness, pool: str = "gpu") -> dict[str, Any]:
    response = harness.client.post(TOKENS, json={"pool": pool})
    assert response.status_code == 201, response.text
    return response.json()


def actions(harness: Harness, prefix: str) -> list[str]:
    with harness.sessions() as session:
        found = select(AuditEvent).where(AuditEvent.target == prefix).order_by(AuditEvent.id)
        return [event.action for event in session.scalars(found)]


def engine_token_for(harness: Harness, token: str, pool: str, host: str | None = None) -> str:
    body = {"worker": worker(pool, host or f"host-{pool}")}
    response = harness.client.post("/internal/worker/engines", json=body, headers=bearer(token))
    assert response.status_code == 200, response.text
    return response.json()["engine_token"]


def test_a_pool_token_admits_its_own_pool_only(harness: Harness) -> None:
    created = issue(harness)
    token = created["secret"]
    assert token.startswith("mbj_") and created["env"] == "MINIBRAIN_JOIN_TOKEN" and created["replaced"] is None
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


def test_one_token_serves_workers_and_engines(harness: Harness) -> None:
    token = issue(harness)["secret"]
    assert register(harness, token, "gpu").status_code == 204
    assert announce(harness, token, "gpu").status_code == 204
    elsewhere = announce(harness, token, "rack")
    assert elsewhere.status_code == 403 and "pool gpu only" in elsewhere.json()["detail"]
    assert harness.client.get("/internal/gateway/config", headers=bearer(token)).status_code == 403


def test_a_pool_has_one_token_and_rotating_cuts_off_the_old_one(harness: Harness) -> None:
    first = issue(harness)
    rack = issue(harness, "rack")
    engine = engine_token_for(harness, first["secret"], "gpu")
    assert announce(harness, engine, "gpu").status_code == 204
    second = issue(harness)
    assert second["replaced"] == first["prefix"] and second["secret"] != first["secret"]
    listed = harness.client.get(TOKENS).json()
    assert [(item["pool"], item["prefix"]) for item in listed] == [("gpu", second["prefix"]), ("rack", rack["prefix"])]
    gone = register(harness, first["secret"], "gpu")
    assert gone.status_code == 401 and "revoked" in gone.json()["detail"]
    for _ in range(3):
        refused = announce(harness, engine, "gpu")
        assert refused.status_code == 401 and "join token behind this engine token was revoked" in refused.text
    assert harness.client.get("/internal/gateway/bases", headers=bearer(engine)).status_code == 401
    assert actions(harness, first["prefix"]).count("join_token.refused") == 2
    assert register(harness, second["secret"], "gpu").status_code == 204
    assert register(harness, rack["secret"], "rack").status_code == 204
    assert actions(harness, second["prefix"])[0] == "join_token.rotate"
    with harness.sessions() as session:
        live = session.scalars(select(JoinToken).where(JoinToken.revoked_at.is_(None))).all()
        assert sorted(row.pool for row in live) == ["gpu", "rack"]


def test_the_local_worker_token_joins_the_local_pool_only(harness: Harness) -> None:
    assert register(harness, harness.token, "local").status_code == 204
    refused = register(harness, harness.token, "gpu")
    assert refused.status_code == 403 and "MINIBRAIN_JOIN_TOKEN" in refused.json()["detail"]
    assert actions(harness, "local worker token") == ["join_token.refused"]
    local_body = {"worker": worker("local")}
    local = harness.client.post("/internal/worker/engines", json=local_body, headers=bearer(harness.token))
    assert local.status_code == 200 and local.json()["engine_token"] is None


def test_refusals_are_audited_once_while_a_machine_retries(harness: Harness) -> None:
    token = issue(harness)
    for _ in range(3):
        assert register(harness, token["secret"], "rack").status_code == 403
    assert actions(harness, token["prefix"]).count("join_token.refused") == 1


def test_the_secret_is_shown_once_and_stored_as_a_digest(harness: Harness) -> None:
    created = issue(harness)
    listed = harness.client.get(TOKENS).text
    assert created["secret"] not in listed and created["prefix"] in listed
    with harness.sessions() as session:
        row = session.scalars(select(JoinToken)).one()
        assert created["secret"] not in (row.digest, row.prefix) and len(row.digest) == 64
    assert register(harness, "mbj_unknown", "gpu").status_code == 401


def test_pool_names_are_checked(harness: Harness) -> None:
    for pool in ("local", "GPU", "has space", "-lead"):
        assert harness.client.post(TOKENS, json={"pool": pool}).status_code == 422, pool


def test_only_admins_manage_join_tokens(harness: Harness) -> None:
    builder = harness.person(Role.BUILDER)
    assert builder.get(TOKENS).status_code == 403
    assert builder.post(TOKENS, json={"pool": "gpu"}, headers=csrf(builder)).status_code == 403
