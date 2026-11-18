import logging
import threading
from datetime import timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session, sessionmaker

from minibrain.data.dataset_versions import cleanup
from minibrain.jobs.retention import log_days, purge_job_logs
from minibrain.leader import Leader
from minibrain.policy import load
from minibrain.registry import playground_sessions
from minibrain.registry.audit_chain import head_of, prune_cut, seal_all
from minibrain.registry.audit_checks import check_on_schedule
from minibrain.registry.compute import forget_stale
from minibrain.registry.files import store_for
from minibrain.registry.models import SYSTEM_ACTOR, AuditEvent, RequestLog, now
from minibrain.settings import Settings
from minibrain.siem import target_of

PURGE_SECONDS = 3600.0
SEAL_SECONDS = 1.0

log = logging.getLogger("minibrain")


def purge_request_logs(session: Session) -> int:
    days = int(load(session)["log_retention_days"])
    if days <= 0:
        return 0
    result = session.execute(delete(RequestLog).where(RequestLog.at < now() - timedelta(days=days)))
    session.commit()
    return int(getattr(result, "rowcount", 0) or 0)


def purge_playground_sessions(session: Session) -> int:
    return playground_sessions.purge(session, int(load(session)["log_retention_days"]))


def purge_audit_events(session: Session) -> int:
    policy = load(session)
    days = int(policy["audit_retention_days"])
    if days <= 0:
        return 0
    cutoff = now() - timedelta(days=days)
    forwarded = head_of(session).forwarded_seq if target_of(policy) is not None else None
    cut = prune_cut(session, cutoff, forwarded)
    if cut is None:
        return 0
    seq, digest = cut
    result = session.execute(delete(AuditEvent).where(AuditEvent.seq <= seq))
    deleted = int(getattr(result, "rowcount", 0) or 0)
    if deleted:
        detail = {
            "deleted": deleted,
            "older_than": cutoff.isoformat(),
            "days": days,
            "cut_seq": seq,
            "cut_hash": digest,
        }
        session.add(AuditEvent(actor=SYSTEM_ACTOR, action="audit.prune", target="audit_events", detail=detail))
    session.commit()
    return deleted


def purge_old_job_logs(session: Session, settings: Settings) -> int:
    days = log_days(session)
    if days <= 0:
        return 0
    return len(purge_job_logs(session, settings, store_for(settings), days, SYSTEM_ACTOR).jobs)


def seal_forever(sessions: sessionmaker[Session], stop: threading.Event, leader: Leader) -> None:
    while not stop.wait(SEAL_SECONDS):
        try:
            if leader.held():
                with sessions() as session:
                    seal_all(session)
        except Exception:
            log.exception("audit chain seal failed")


def purge_forever(sessions: sessionmaker[Session], settings: Settings, stop: threading.Event, leader: Leader) -> None:
    while not stop.wait(PURGE_SECONDS):
        try:
            if not leader.held():
                continue
            with sessions() as session:
                purge_request_logs(session)
                purge_playground_sessions(session)
                purge_audit_events(session)
                forget_stale(session)
                cleanup(session, settings)
                session.commit()
                purge_old_job_logs(session, settings)
        except Exception:
            log.exception("request log purge failed")
        check_audit_chain(sessions, leader)


def check_audit_chain(sessions: sessionmaker[Session], leader: Leader) -> None:
    try:
        if leader.held():
            with sessions() as session:
                check_on_schedule(session)
    except Exception:
        log.exception("audit chain check failed")
