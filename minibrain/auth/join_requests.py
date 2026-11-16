import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from minibrain.auth.join_tokens import Caller, checked, digest, pool_problem, refuse
from minibrain.registry.models import SYSTEM_ACTOR, AuditEvent, JoinRequest, now
from minibrain.registry.service import ConflictError, NotFoundError

REQUEST_PREFIX = "mbr_"
MACHINE_PREFIX = "mbm_"
KEY_LENGTH = 40
CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
CODE_LENGTH = 6
LIFETIME = timedelta(hours=1)
KEPT_FOR = timedelta(days=1)
PER_ADDRESS = 5
PENDING_LIMIT = 50
PENDING = "pending"
APPROVED = "approved"
DENIED = "denied"
EXPIRED = "expired"
REVOKED = "revoked"
REFUSED = "join_request.refused"
REQUESTS = "join requests"
REVOKED_TEXT = "an admin removed this machine, so its approval no longer holds; run minibrain worker to ask again"


@dataclass(frozen=True)
class Answer:
    state: str
    code: str
    pool: str | None = None
    credential: str | None = None


def expired(row: JoinRequest, moment: datetime | None = None) -> bool:
    return row.state == PENDING and row.expires_at <= (moment or now())


def state_of(row: JoinRequest) -> str:
    if expired(row):
        return EXPIRED
    if row.state == APPROVED and row.revoked_at is not None:
        return REVOKED
    return row.state


def by_key(session: Session, raw: str) -> JoinRequest | None:
    if not raw.startswith(REQUEST_PREFIX):
        return None
    return session.scalar(select(JoinRequest).where(JoinRequest.digest == digest(raw)))


def new_code(session: Session) -> str:
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        taken = select(JoinRequest.id).where(JoinRequest.code == code, JoinRequest.state == PENDING)
        if session.scalar(taken) is None:
            return code


def waiting(session: Session) -> list[JoinRequest]:
    query = select(JoinRequest).where(JoinRequest.state == PENDING, JoinRequest.expires_at > now())
    return list(session.scalars(query.order_by(JoinRequest.id)))


def tidy(session: Session, host: str, address: str | None) -> None:
    session.execute(delete(JoinRequest).where(JoinRequest.state == PENDING, JoinRequest.expires_at < now() - KEPT_FOR))
    superseded = delete(JoinRequest).where(
        JoinRequest.state == PENDING, JoinRequest.host == host, JoinRequest.address == address
    )
    session.execute(superseded)


def crowded(session: Session, address: str | None) -> str | None:
    found = waiting(session)
    if len(found) >= PENDING_LIMIT:
        return f"{PENDING_LIMIT} machines already wait for approval"
    if sum(1 for row in found if row.address == address) >= PER_ADDRESS:
        return f"{PER_ADDRESS} machines from this address already wait for approval"
    return None


def open_request(
    session: Session, raw: str, host: str, hardware: dict[str, Any], pool: str | None, address: str | None
) -> JoinRequest:
    if not raw.startswith(REQUEST_PREFIX) or len(raw) < KEY_LENGTH:
        raise HTTPException(status_code=401, detail="a join request needs its own random request key")
    found = by_key(session, raw)
    if found is not None:
        return found
    problem = pool_problem(pool) if pool is not None else None
    if problem is not None:
        raise HTTPException(status_code=422, detail=problem)
    tidy(session, host, address)
    busy = crowded(session, address)
    if busy is not None:
        refuse(session, REQUESTS, {"reason": busy, "address": address}, {"host": host}, action=REFUSED)
        raise HTTPException(status_code=429, detail=f"{busy}; try again later")
    row = JoinRequest(
        code=new_code(session),
        digest=digest(raw),
        host=host,
        hardware=hardware,
        asked_pool=pool,
        address=address,
        expires_at=now() + LIFETIME,
    )
    session.add(row)
    detail = {"host": host, "pool": pool, "address": address}
    session.add(AuditEvent(actor=SYSTEM_ACTOR, action="join_request.create", target=row.code, detail=detail))
    session.flush()
    return row


def collect(session: Session, raw: str) -> Answer:
    row = by_key(session, raw)
    if row is None:
        raise HTTPException(status_code=404, detail="main has no such join request; run minibrain worker to ask again")
    state = state_of(row)
    if state != APPROVED:
        return Answer(state, row.code)
    if row.collected_at is not None:
        raise HTTPException(status_code=410, detail="this machine already holds its approval")
    credential = MACHINE_PREFIX + secrets.token_urlsafe(32)
    row.credential_digest = digest(credential)
    row.collected_at = now()
    return Answer(APPROVED, row.code, row.pool, credential)


def pending_row(session: Session, request_id: int) -> JoinRequest:
    row = session.get(JoinRequest, request_id)
    if row is None or row.state != PENDING:
        raise NotFoundError(f"join request {request_id} not found")
    if expired(row):
        raise ConflictError(f"the join request from {row.host} expired; run minibrain worker there to ask again")
    return row


def decided(session: Session, row: JoinRequest, action: str, actor: str) -> None:
    row.decided_by = actor
    row.decided_at = now()
    detail = {"host": row.host, "pool": row.pool, "asked": row.asked_pool, "address": row.address}
    session.add(AuditEvent(actor=actor, action=action, target=row.code, detail=detail))


def revoke_machine(session: Session, pool: str, host: str, actor: str) -> None:
    live = select(JoinRequest).where(
        JoinRequest.state == APPROVED,
        JoinRequest.revoked_at.is_(None),
        JoinRequest.pool == pool,
        JoinRequest.host == host,
    )
    for row in session.scalars(live):
        row.revoked_at = now()
        detail = {"host": host, "pool": pool}
        session.add(AuditEvent(actor=actor, action="join_request.revoke", target=row.code, detail=detail))


def approve(session: Session, request_id: int, pool: str, actor: str) -> JoinRequest:
    problem = pool_problem(pool)
    if problem is not None:
        raise HTTPException(status_code=422, detail=problem)
    row = pending_row(session, request_id)
    revoke_machine(session, pool, row.host, actor)
    row.state = APPROVED
    row.pool = pool
    decided(session, row, "join_request.approve", actor)
    return row


def deny(session: Session, request_id: int, actor: str) -> JoinRequest:
    row = pending_row(session, request_id)
    row.state = DENIED
    decided(session, row, "join_request.deny", actor)
    return row


def lapse(row: JoinRequest) -> str | None:
    return "was revoked" if row.state != APPROVED or row.revoked_at is not None else None


def approved_machine(session: Session, raw: str, address: str | None) -> JoinRequest | None:
    if not raw.startswith(MACHINE_PREFIX):
        return None
    row = session.scalar(select(JoinRequest).where(JoinRequest.credential_digest == digest(raw)))
    if row is None:
        return None
    if lapse(row) is not None:
        refuse(session, row.code, {"pool": row.pool, "reason": REVOKED_TEXT, "address": address})
        raise HTTPException(status_code=401, detail=REVOKED_TEXT)
    return row


def credential_caller(session: Session, raw: str, address: str | None) -> Caller | None:
    token = checked(session, raw, address)
    if token is not None:
        return Caller(token.pool, token)
    machine = approved_machine(session, raw, address)
    if machine is not None and machine.pool is not None:
        return Caller(machine.pool, machine=machine)
    return None
