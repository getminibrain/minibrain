import time
from collections.abc import Iterable, Iterator
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from minibrain.registry.audit_chain import HEAD, ChainBreak, ChainReport, Sealed, head_of, verify, verify_after
from minibrain.registry.models import SYSTEM_ACTOR, AuditChain, AuditChainBreak, AuditEvent, now

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


def known(session: Session, broken: ChainBreak) -> bool:
    query = select(AuditChainBreak.id).where(AuditChainBreak.seq == broken.seq, AuditChainBreak.reason == broken.reason)
    return session.scalar(query.limit(1)) is not None


def record_break(session: Session, broken: ChainBreak, full: bool) -> None:
    found_by = "full" if full else "hourly"
    detail = {"seq": broken.seq, "event_id": broken.event_id, "reason": broken.reason, "check": found_by}
    session.add(AuditChainBreak(seq=broken.seq, event_id=broken.event_id, reason=broken.reason, found_by=found_by))
    session.add(AuditEvent(actor=SYSTEM_ACTOR, action=BROKEN_ACTION, target="audit_events", detail=detail))


def settle(session: Session, report: ChainReport, full: bool) -> None:
    session.commit()
    moment = now()
    values: dict[str, Any] = {"full_checked_at": moment} if full else {}
    broken = report.broken
    if broken is None:
        values |= {"verified_seq": report.last_seq, "verified_hash": report.last_hash, "verified_at": moment}
    elif not known(session, broken):
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
