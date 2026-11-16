from collections.abc import Iterator
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from minibrain.auth.passwords import verify_password
from minibrain.auth.roles import Role
from minibrain.auth.throttle import LOCK_AFTER
from minibrain.registry.models import LoginSession, User, now
from minibrain.settings import Settings
from tests.conftest import Harness
from tests.test_accounts import ADMIN, PASSWORD, Install, csrf, set_up, start
from tests.test_proxy import AUTH, Proxied, as_person, proxied_install
from tests.test_proxy import csrf_for as proxy_csrf

NEW_PASSWORD = "a much longer passphrase"


@pytest.fixture
def install(settings: Settings) -> Iterator[Install]:
    yield from start(settings)


@pytest.fixture
def proxied(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> Iterator[Proxied]:
    yield from proxied_install(settings, monkeypatch, AUTH)


def signed_in(install: Install, password: str = PASSWORD) -> TestClient:
    browser = install.browser()
    response = browser.post("/api/auth/login", json={"email": ADMIN, "password": password})
    assert response.status_code == 200, response.text
    return browser


def session_ids(install: Install) -> list[int]:
    with install.sessions() as session:
        return list(session.scalars(select(LoginSession.id).order_by(LoginSession.id)))


def test_your_account_shows_who_you_are(install: Install) -> None:
    admin = set_up(install)
    profile = admin.get("/api/me").json()
    assert (profile["name"], profile["email"], profile["source"], profile["role"]) == (
        "Ada Lovelace",
        ADMIN,
        "local",
        "admin",
    )
    assert (profile["provider"], profile["has_password"]) == (None, True)


def test_a_name_change_is_audited_and_shown_everywhere(install: Install) -> None:
    admin = set_up(install)
    changed = admin.patch("/api/me", json={"name": "  Ada   King "}, headers=csrf(admin))
    assert changed.status_code == 200 and changed.json()["name"] == "Ada King"
    assert admin.get("/api/auth/session").json()["person"]["name"] == "Ada King"
    [event] = [event for event in install.events("account.update")]
    assert (event.actor, event.target, event.detail["from"], event.detail["to"]) == (
        ADMIN,
        ADMIN,
        {"name": "Ada Lovelace"},
        {"name": "Ada King"},
    )
    audit = admin.get("/api/audit").json()["events"]
    assert any(item["actor_name"] == "Ada King" for item in audit)
    assert admin.patch("/api/me", json={"name": "   "}, headers=csrf(admin)).status_code == 422
    assert admin.patch("/api/me", json={"name": "Ada King"}).status_code == 403


def test_a_wrong_current_password_changes_nothing(install: Install) -> None:
    admin = set_up(install)
    body = {"current_password": "not my password", "password": NEW_PASSWORD}
    refused = admin.post("/api/me/password", json=body, headers=csrf(admin))
    assert refused.status_code == 403 and refused.json()["detail"] == "Your current password is wrong"
    assert admin.get("/api/me").status_code == 200
    with install.sessions() as session:
        user = session.scalars(select(User)).one()
        assert verify_password(PASSWORD, user.password_hash)
    assert install.events("account.password_change") == []


def test_wrong_current_passwords_count_toward_the_sign_in_lockout(install: Install) -> None:
    admin = set_up(install)
    body = {"current_password": "not my password", "password": NEW_PASSWORD}
    for _ in range(LOCK_AFTER):
        assert admin.post("/api/me/password", json=body, headers=csrf(admin)).status_code == 403
    locked = admin.post("/api/me/password", json=body | {"current_password": PASSWORD}, headers=csrf(admin))
    assert locked.status_code == 429 and "Too many wrong passwords" in locked.json()["detail"]
    refused = install.browser().post("/api/auth/login", json={"email": ADMIN, "password": PASSWORD})
    assert refused.status_code == 401 and "Too many failed sign-ins" in refused.json()["detail"]


def test_the_new_password_follows_the_password_policy(install: Install) -> None:
    admin = set_up(install)
    short = admin.post(
        "/api/me/password", json={"current_password": PASSWORD, "password": "short"}, headers=csrf(admin)
    )
    assert short.status_code == 422 and "12 characters" in short.json()["detail"]
    same = admin.post(
        "/api/me/password", json={"current_password": PASSWORD, "password": PASSWORD}, headers=csrf(admin)
    )
    assert same.status_code == 422 and "different" in same.json()["detail"]


def test_a_password_change_ends_your_other_sessions_only(install: Install) -> None:
    admin = set_up(install)
    laptop = signed_in(install)
    phone = signed_in(install)
    assert len(session_ids(install)) == 3
    body = {"current_password": PASSWORD, "password": NEW_PASSWORD}
    changed = phone.post("/api/me/password", json=body, headers=csrf(phone))
    assert changed.status_code == 200 and changed.json() == {"ended": 2}
    assert phone.get("/api/me").status_code == 200
    assert admin.get("/api/me").status_code == 401 and laptop.get("/api/me").status_code == 401
    assert len(session_ids(install)) == 1
    [event] = install.events("account.password_change")
    assert (event.actor, event.detail["sessions_ended"]) == (ADMIN, 2)
    signed_in(install, NEW_PASSWORD)


def test_sessions_list_marks_this_device_and_ends_the_others(install: Install) -> None:
    admin = set_up(install)
    laptop = signed_in(install)
    signed_in(install)
    listed = admin.get("/api/me/sessions").json()
    assert len(listed) == 3 and [row["current"] for row in listed].count(True) == 1
    mine = next(row["id"] for row in listed if row["current"])
    laptop_id = next(row["id"] for row in laptop.get("/api/me/sessions").json() if row["current"])
    assert admin.delete(f"/api/me/sessions/{mine}", headers=csrf(admin)).status_code == 422
    assert admin.delete(f"/api/me/sessions/{laptop_id}", headers=csrf(admin)).status_code == 204
    assert laptop.get("/api/me").status_code == 401
    [one] = install.events("account.session_end")
    assert one.detail["session"] == laptop_id
    ended = admin.delete("/api/me/sessions", headers=csrf(admin))
    assert ended.status_code == 200 and ended.json() == {"ended": 1}
    assert session_ids(install) == [mine]
    [many] = install.events("account.sessions_end")
    assert len(many.detail["sessions"]) == 1


def test_you_cannot_end_someone_elses_session(harness: Harness) -> None:
    viewer = harness.person(Role.VIEWER)
    other = harness.person(Role.BUILDER)
    theirs = next(row["id"] for row in other.get("/api/me/sessions").json() if row["current"])
    assert viewer.delete(f"/api/me/sessions/{theirs}").status_code == 404
    assert viewer.delete("/api/me/sessions").json() == {"ended": 0}
    assert other.get("/api/me").status_code == 200
    assert [row["id"] for row in viewer.get("/api/me/sessions").json() if row["id"] == theirs] == []


def test_viewers_and_people_without_a_role_reach_their_account(harness: Harness) -> None:
    for role in (Role.VIEWER, None):
        client = harness.person(role)
        profile = client.get("/api/me")
        assert profile.status_code == 200 and profile.json()["role"] == (role.value if role else None)
        assert client.patch("/api/me", json={"name": "Renamed"}).json()["name"] == "Renamed"
        assert len(client.get("/api/me/sessions").json()) == 1
    assert TestClient(harness.app).get("/api/me").status_code == 401


def test_single_sign_on_accounts_cannot_set_a_password(proxied: Proxied) -> None:
    client = proxied.client()
    person = as_person("bea", "bea@example.com", "ml-team")
    profile = client.get("/api/me", headers=person).json()
    assert (profile["source"], profile["provider"], profile["has_password"]) == ("proxy", "your sign-in proxy", False)
    headers = person | proxy_csrf(client, person)
    body = {"current_password": "", "password": NEW_PASSWORD}
    refused = client.post("/api/me/password", json=body, headers=headers)
    assert refused.status_code == 422 and "managed by your sign-in proxy" in refused.json()["detail"]
    assert [user.password_hash for user in proxied.users()] == [None]
    assert client.get("/api/me/sessions", headers=person).json() == []
    renamed = client.patch("/api/me", json={"name": "Bea Smith"}, headers=headers)
    assert renamed.status_code == 200 and renamed.json()["name"] == "Bea Smith"
    assert client.get("/api/auth/session", headers=person).json()["person"]["name"] == "Bea Smith"


def test_expired_sessions_are_not_counted_as_signed_in(install: Install) -> None:
    admin = set_up(install)
    signed_in(install)
    stale = signed_in(install)
    stale_id = next(row["id"] for row in stale.get("/api/me/sessions").json() if row["current"])
    with install.sessions() as session:
        row = session.get(LoginSession, stale_id)
        assert row is not None
        row.expires_at = now() - timedelta(minutes=1)
        session.commit()
    assert len(admin.get("/api/me/sessions").json()) == 2
    [person] = admin.get("/api/accounts").json()["people"]
    assert person["sessions"] == 2
    ended = admin.delete("/api/me/sessions", headers=csrf(admin))
    assert ended.json() == {"ended": 1}
    assert len(session_ids(install)) == 1
