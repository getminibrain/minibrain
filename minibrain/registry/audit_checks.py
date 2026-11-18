import time
from collections.abc import Iterable, Iterator
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import update
from sqlalchemy.orm import Session

from minibrain.registry.audit_chain import HEAD, ChainBreak, ChainReport, Sealed, head_of, verify, verify_after
from minibrain.registry.models import SYSTEM_ACTOR, AuditChain, AuditEvent, now

BROKEN_ACTION = "audit.chain_broken"
FULL_HOUR = 3
FULL_AFTER = timedelta(hours=12)
FULL_LATEST = timedelta(hours=36)
PACE_ROWS = 1000
PACE_SECONDS = 0.01


def paced(rows: Iterable[Sealed]) -> Iterator[Sealed]:
    for index, row in enumerate(rows, 1):
        yield row
        if index % PACE_ROWS == 0:
            time.sleep(PACE_SECONDS)


def full_due(last: datetime | None, moment: datetime) -> bool:
    if last is None:
        return True
    since = moment - last
    return since >= FULL_LATEST or (since >= FULL_AFTER and moment.astimezone().hour == FULL_HOUR)


def recorded(head: AuditChain, broken: ChainBreak, full: bool) -> bool:
    if (head.broken_seq, head.broken_reason) == (broken.seq, broken.reason):
        return True
    return not full and head.broken_seq is not None


def record_break(session: Session, broken: ChainBreak, full: bool) -> None:
    detail = {
        "seq": broken.seq,
        "event_id": broken.event_id,
        "reason": broken.reason,
        "check": "full" if full else "hourly",
    }
    session.add(AuditEvent(actor=SYSTEM_ACTOR, action=BROKEN_ACTION, target="audit_events", detail=detail))


def settle(session: Session, report: ChainReport, full: bool) -> None:
    session.commit()
    moment = now()
    head = head_of(session)
    values: dict[str, Any] = {"full_checked_at": moment} if full else {}
    broken = report.broken
    if broken is None:
        values |= {"verified_seq": report.last_seq, "verified_hash": report.last_hash, "verified_at": moment}
        if full:
            values |= {"broken_seq": None, "broken_reason": None, "broken_at": None}
    elif not recorded(head, broken, full):
        values |= {"broken_seq": broken.seq, "broken_reason": broken.reason, "broken_at": moment}
        record_break(session, broken, full)
    if values:
        session.execute(update(AuditChain).where(AuditChain.id == HEAD).values(**values))
    session.commit()


def check_chain(session: Session, full: bool) -> ChainReport:
    head = head_of(session)
    if full or head.verified_seq is None or head.verified_hash is None:
        report, full = verify(session, paced), True
    else:
        report = verify_after(session, head.verified_seq, head.verified_hash)
    settle(session, report, full)
    return report


def check_on_schedule(session: Session, moment: datetime | None = None) -> ChainReport:
    return check_chain(session, full_due(head_of(session).full_checked_at, moment or now()))
