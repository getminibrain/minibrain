from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response
from sqlalchemy import select, update

from minibrain import maintenance
from minibrain.auth.roles import Role
from minibrain.maintenance import purge_audit_events
from minibrain.registry.audit_chain import GENESIS, ChainReport, head_of, seal_all
from minibrain.registry.audit_checks import BROKEN_ACTION, check_chain, check_on_schedule, full_due
from minibrain.registry.models import AuditChain, AuditChainBreak, AuditEvent, now
from minibrain.siem import Forwarder
from tests.conftest import Harness
from tests.test_audit import add_events
from tests.test_audit_chain import age, run_sql
from tests.test_leader import Toggle
from tests.test_siem import Listener, configure

ADMIN = "admin@example.com"


def sealed_events(harness: Harness, count: int, **fields: Any) -> None:
    add_events(harness, count, **fields)
    with harness.sessions() as session:
        seal_all(session)


def check(harness: Harness, full: bool = False) -> ChainReport:
    with harness.sessions() as session:
        return check_chain(session, full)


def chain_head(harness: Harness) -> AuditChain:
    with harness.sessions() as session:
        return head_of(session)


def broken_events(harness: Harness) -> list[AuditEvent]:
    with harness.sessions() as session:
        return list(session.scalars(select(AuditEvent).where(AuditEvent.action == BROKEN_ACTION)))


def problems_of(client: TestClient, kind: str) -> list[dict[str, Any]]:
    response = client.get("/api/problems")
    assert response.status_code == 200, response.text
    return [problem for problem in response.json() if problem["kind"] == kind]


def verified_up_to(harness: Harness, count: int) -> None:
    sealed_events(harness, count)
    report = check(harness)
    assert report.verified
    head = chain_head(harness)
    assert head.verified_seq == head.seq


def test_the_hourly_check_walks_only_what_is_new(harness: Harness) -> None:
    verified_up_to(harness, 5)
    head = chain_head(harness)
    assert (head.full_checked_at is not None, head.verified_at is not None) == (True, True)
    sealed_events(harness, 3)
    report = check(harness)
    assert (report.verified, report.events, report.last_seq) == (True, 3, 8)
    after = chain_head(harness)
    assert (after.verified_seq, after.verified_hash, after.full_checked_at) == (8, after.hash, head.full_checked_at)
    assert check(harness).events == 0


def test_an_edit_behind_the_mark_waits_for_the_full_check(harness: Harness) -> None:
    verified_up_to(harness, 5)
    run_sql(harness, "UPDATE audit_events SET target = 'changed' WHERE seq = 3")
    assert check(harness).verified
    full = check(harness, full=True)
    assert full.broken is not None
    assert (full.broken.seq, full.broken.reason) == (3, "its contents changed after it was sealed")


def test_an_edit_after_the_mark_shows_in_the_hourly_check(harness: Harness) -> None:
    verified_up_to(harness, 3)
    sealed_events(harness, 3)
    run_sql(harness, 'UPDATE audit_events SET detail = \'{"name": "other"}\' WHERE seq = 5')
    report = check(harness)
    assert report.broken is not None and report.broken.seq == 5
    assert chain_head(harness).verified_seq == 3


@pytest.mark.parametrize(("deleted", "seq", "reason"), [(5, 5, "seq 5 is missing"), (2, 2, "seq 2 is missing")])
def test_a_deleted_middle_row_breaks_the_chain(harness: Harness, deleted: int, seq: int, reason: str) -> None:
    verified_up_to(harness, 3)
    sealed_events(harness, 4)
    run_sql(harness, "DELETE FROM audit_events WHERE seq = :seq", seq=deleted)
    hourly = check(harness)
    full = check(harness, full=True)
    assert full.broken is not None and (full.broken.seq, full.broken.reason) == (seq, reason)
    if deleted > 3:
        assert hourly.broken is not None and hourly.broken.seq == seq
    else:
        assert hourly.verified


def test_deleting_the_newest_rows_shows_in_the_hourly_check(harness: Harness) -> None:
    verified_up_to(harness, 5)
    run_sql(harness, "DELETE FROM audit_events WHERE seq >= 4")
    hourly = check(harness)
    assert hourly.broken is not None and (hourly.broken.seq, hourly.broken.reason) == (5, "seq 5 is missing")
    full = check(harness, full=True)
    assert full.broken is not None and (full.broken.seq, full.broken.reason) == (4, "seq 4 to 5 are missing")


def test_a_rewritten_hash_at_the_mark_shows_in_the_hourly_check(harness: Harness) -> None:
    verified_up_to(harness, 4)
    run_sql(harness, "UPDATE audit_events SET hash = :genesis WHERE seq = 4", genesis=GENESIS)
    hourly = check(harness)
    assert hourly.broken is not None and hourly.broken.reason == "its hash changed after it was verified"


@pytest.mark.parametrize("verified", [2, 6])
def test_a_pruned_start_still_verifies(harness: Harness, verified: int) -> None:
    verified_up_to(harness, verified)
    sealed_events(harness, 6 - verified)
    age(harness, 400, AuditEvent.seq <= 4)
    assert harness.client.put("/api/policies/audit_retention_days", json={"value": 365}).status_code == 200
    with harness.sessions() as session:
        seal_all(session)
        assert purge_audit_events(session) == 4
        seal_all(session)
    hourly = check(harness)
    assert hourly.verified, hourly.broken
    full = check(harness, full=True)
    assert (full.verified, full.anchor_seq) == (True, 4)
    assert check(harness).verified


@pytest.fixture
def siem() -> Iterator[Listener]:
    found = Listener()
    yield found
    found.close()


def chain_breaks(harness: Harness) -> list[AuditChainBreak]:
    with harness.sessions() as session:
        return list(session.scalars(select(AuditChainBreak).order_by(AuditChainBreak.id)))


def acknowledge(client: TestClient, break_id: int, note: Any = "Restored from the SIEM copy") -> Response:
    return client.post(f"/api/audit/chain/breaks/{break_id}/acknowledge", json={"note": note})


def tampered(harness: Harness, seq: int = 5) -> None:
    verified_up_to(harness, 5)
    run_sql(harness, "UPDATE audit_events SET target = 'changed' WHERE seq = :seq", seq=seq)


def test_a_broken_chain_is_recorded_once_and_raised_until_acknowledged(harness: Harness, siem: Listener) -> None:
    configure(harness, protocol="tcp", host="127.0.0.1", port=siem.port)
    tampered(harness)
    assert problems_of(harness.client, "audit_chain_broken") == []
    check(harness, full=True)
    check(harness, full=True)
    check(harness)
    [event] = broken_events(harness)
    assert (event.actor, event.target) == ("system", "audit_events")
    assert event.detail == {
        "seq": 5,
        "event_id": 5,
        "reason": "its contents changed after it was sealed",
        "check": "full",
    }
    [found] = chain_breaks(harness)
    assert (found.seq, found.event_id, found.found_by, found.acknowledged_at) == (5, 5, "full", None)
    [problem] = problems_of(harness.client, "audit_chain_broken")
    assert (problem["severity"], problem["scope"], problem["href"]) == ("critical", "system", "/settings/audit")
    assert problem["text"] == "Audit log integrity broken at #5"
    assert problem["since"] is not None
    assert problems_of(harness.person(Role.VIEWER), "audit_chain_broken") == []
    [listed] = harness.client.get("/api/audit/chain").json()["breaks"]
    assert (listed["id"], listed["seq"], listed["reason"]) == (found.id, 5, "its contents changed after it was sealed")
    assert (listed["acknowledged_at"], listed["note"]) == (None, None)
    with harness.sessions() as session:
        seal_all(session)
    assert broken_events(harness)[0].seq is not None
    Forwarder(harness.sessions, hostname="mb-host").drain()
    assert b"audit.chain_broken" in bytes(siem.received)


def test_a_passing_full_check_never_clears_a_break(harness: Harness) -> None:
    tampered(harness)
    check(harness, full=True)
    run_sql(harness, "UPDATE audit_events SET target = 'mb_0004' WHERE seq = 5")
    assert check(harness, full=True).verified
    [found] = chain_breaks(harness)
    assert found.acknowledged_at is None
    assert len(problems_of(harness.client, "audit_chain_broken")) == 1
    info = harness.client.get("/api/audit/chain").json()
    assert (info["verified"], len(info["breaks"])) == (True, 1)
    assert info["automatic"]["verified_seq"] == chain_head(harness).seq


def test_a_break_at_a_new_spot_is_recorded_and_raised_on_its_own(harness: Harness) -> None:
    tampered(harness)
    check(harness, full=True)
    assert acknowledge(harness.client, chain_breaks(harness)[0].id).status_code == 200
    assert problems_of(harness.client, "audit_chain_broken") == []
    check(harness, full=True)
    assert len(chain_breaks(harness)) == 1
    run_sql(harness, "UPDATE audit_events SET target = 'changed' WHERE seq = 2")
    check(harness, full=True)
    first, second = chain_breaks(harness)
    assert (first.seq, second.seq, second.acknowledged_at) == (5, 2, None)
    assert [event.detail["seq"] for event in broken_events(harness)] == [5, 2]
    [problem] = problems_of(harness.client, "audit_chain_broken")
    assert problem["id"] == f"audit_chain_broken:{second.id}"
    assert [row["seq"] for row in harness.client.get("/api/audit/chain").json()["breaks"]] == [2, 5]


def test_acknowledging_a_break_needs_an_admin_and_a_note(harness: Harness) -> None:
    tampered(harness)
    check(harness, full=True)
    [found] = chain_breaks(harness)
    assert acknowledge(harness.person(Role.BUILDER), found.id).status_code == 403
    for note in ("", "   ", "x" * 501, None):
        assert acknowledge(harness.client, found.id, note).status_code == 422, note
    assert acknowledge(harness.client, 999).status_code == 404
    assert len(problems_of(harness.client, "audit_chain_broken")) == 1
    response = acknowledge(harness.client, found.id, "  Restored from the SIEM copy  ")
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["acknowledged_by"], body["note"]) == (ADMIN, "Restored from the SIEM copy")
    assert body["acknowledged_at"] is not None
    assert problems_of(harness.client, "audit_chain_broken") == []
    assert acknowledge(harness.client, found.id, "Again").status_code == 409
    [event] = audit_events(harness, "audit.chain_break_acknowledged")
    assert (event.actor, event.target) == (ADMIN, "audit_events")
    assert event.detail == {
        "break_id": found.id,
        "seq": 5,
        "reason": "its contents changed after it was sealed",
        "note": "Restored from the SIEM copy",
        "sign_in": "local",
    }
    [listed] = harness.client.get("/api/audit/chain").json()["breaks"]
    assert (listed["acknowledged_by"], listed["note"]) == (ADMIN, "Restored from the SIEM copy")
    check(harness, full=True)
    assert len(chain_breaks(harness)) == 1
    assert len(broken_events(harness)) == 1


def test_the_full_walk_runs_at_night_and_never_waits_more_than_a_day_and_a_half() -> None:
    night = datetime(2026, 11, 18, 3, 20).astimezone()
    day = night.replace(hour=14)
    assert full_due(None, day)
    assert full_due(night - timedelta(hours=13), night)
    assert not full_due(night - timedelta(hours=6), night)
    assert not full_due(day - timedelta(hours=20), day)
    assert full_due(day.astimezone(UTC) - timedelta(hours=37), day)


def test_the_schedule_runs_a_full_walk_first_then_hourly_checks(harness: Harness) -> None:
    sealed_events(harness, 2)
    with harness.sessions() as session:
        first = check_on_schedule(session)
        assert (first.events, head_of(session).full_checked_at is not None) == (2, True)
    sealed_events(harness, 1)
    with harness.sessions() as session:
        assert check_on_schedule(session).events == 1


def test_only_the_leader_checks_the_chain(harness: Harness) -> None:
    sealed_events(harness, 2)
    maintenance.check_audit_chain(harness.sessions, Toggle(False))
    assert chain_head(harness).verified_seq is None
    maintenance.check_audit_chain(harness.sessions, Toggle(True))
    assert chain_head(harness).verified_seq == 2


def test_a_failing_or_lagging_siem_raises_a_warning_until_it_catches_up(harness: Harness) -> None:
    sealed_events(harness, 2)
    age(harness, 1, AuditEvent.seq <= 2)
    assert problems_of(harness.client, "siem_behind") == []
    configure(harness, protocol="tcp", host="127.0.0.1", port=6514)
    with harness.sessions() as session:
        seal_all(session)
    [lagging] = problems_of(harness.client, "siem_behind")
    assert (lagging["severity"], lagging["scope"], lagging["subject"]) == ("warning", "system", "tcp://127.0.0.1:6514")
    assert lagging["text"].endswith("audit events have waited over 15 minutes for the SIEM")
    assert lagging["href"] == "/settings/security#audit-integrity"
    with harness.sessions() as session:
        head = head_of(session).seq
        values = {"forwarded_seq": head, "forwarded_at": now()}
        session.execute(update(AuditChain).values(**values))
        session.commit()
    assert problems_of(harness.client, "siem_behind") == []
    sealed_events(harness, 1)
    assert problems_of(harness.client, "siem_behind") == []
    with harness.sessions() as session:
        session.execute(update(AuditChain).values(forward_error="Connection refused"))
        session.commit()
    [failing] = problems_of(harness.client, "siem_behind")
    assert failing["text"] == "Audit events are not reaching the SIEM: Connection refused"
    assert problems_of(harness.person(Role.VIEWER), "siem_behind") == []
    with harness.sessions() as session:
        session.execute(update(AuditChain).values(forward_error=None))
        session.commit()
    assert problems_of(harness.client, "siem_behind") == []


def audit_events(harness: Harness, action: str) -> list[AuditEvent]:
    with harness.sessions() as session:
        query = select(AuditEvent).where(AuditEvent.action == action).order_by(AuditEvent.id)
        return list(session.scalars(query))


def test_every_export_is_recorded_with_its_filters_and_format(harness: Harness) -> None:
    add_events(harness, 2)
    params = {"format": "jsonl", "action": "key.create", "q": "mb_", "since": "2026-01-01T00:00:00+00:00"}
    assert harness.client.get("/api/audit/export", params=params).status_code == 200
    assert harness.client.get("/api/audit/export").status_code == 200
    first, second = audit_events(harness, "audit.export")
    assert (first.actor, first.target) == (ADMIN, "audit_events")
    assert first.detail == {
        "format": "jsonl",
        "filters": {"action": ["key.create"], "q": "mb_", "since": "2026-01-01T00:00:00+00:00"},
        "sign_in": "local",
    }
    assert second.detail == {"format": "csv", "filters": {}, "sign_in": "local"}


def test_views_are_recorded_once_an_hour_per_admin(harness: Harness) -> None:
    add_events(harness, 2)
    harness.client.get("/api/audit/chain")
    assert audit_events(harness, "audit.view") == []
    assert harness.client.get("/api/audit").status_code == 200
    harness.client.get("/api/audit", params={"limit": 1})
    harness.client.get("/api/audit/1")
    [view] = audit_events(harness, "audit.view")
    assert (view.actor, view.target) == (ADMIN, "audit_events")
    other = harness.person(Role.ADMIN, "second@example.com")
    other.get("/api/audit/1")
    assert [event.actor for event in audit_events(harness, "audit.view")] == [ADMIN, "second@example.com"]
    with harness.sessions() as session:
        session.execute(
            update(AuditEvent).where(AuditEvent.action == "audit.view").values(at=now() - timedelta(minutes=61))
        )
        session.commit()
    harness.client.get("/api/audit")
    assert len(audit_events(harness, "audit.view")) == 3


def test_watching_the_chain_is_never_recorded(harness: Harness) -> None:
    for _ in range(3):
        assert harness.client.get("/api/audit/chain").status_code == 200
    with harness.sessions() as session:
        assert session.scalars(select(AuditEvent.action).where(AuditEvent.action.startswith("audit."))).all() == []
