import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Literal

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from minibrain.models.hardware import LOCAL_POOL
from minibrain.registry.models import SYSTEM_ACTOR, AuditEvent, JoinToken, now

PREFIX = "mbj_"
SHOWN = 12
JOIN_KEY_ENV = "MINIBRAIN_JOIN_TOKEN"
LOCAL_KEY_FILE = "worker_token"
WORKER = "worker"
ENGINE = "engine"
BOTH = "both"
JoinRole = Literal["worker", "engine", "both"]
POOL_PATTERN = r"^[a-z0-9][a-z0-9._-]{0,62}$"
REFUSED = "join_token.refused"
JOINED = "join_token.joined"
LOCAL_TARGET = "local worker token"
QUIET = timedelta(minutes=10)
NOTE_EVERY = timedelta(minutes=1)
LOCAL_ONLY = (
    "the local worker token joins the local pool only; create a join token for pool {pool} under "
    "Infrastructure, Add machine, and set it in MINIBRAIN_JOIN_TOKEN"
)


def digest(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def is_join_token(raw: str) -> bool:
    return raw.startswith(PREFIX)


def pool_problem(pool: str) -> str | None:
    if pool == LOCAL_POOL:
        return "The local pool is main's own machine; it needs no join token."
    if not re.fullmatch(POOL_PATTERN, pool):
        return "A pool name is up to 63 lowercase letters, digits, dots, dashes or underscores."
    return None


def create(session: Session, pool: str, role: str, days: int | None, actor: str) -> tuple[JoinToken, str]:
    raw = PREFIX + secrets.token_urlsafe(32)
    row = JoinToken(
        pool=pool,
        role=role,
        prefix=raw[:SHOWN],
        digest=digest(raw),
        created_by=actor,
        expires_at=now() + timedelta(days=days) if days else None,
    )
    session.add(row)
    session.flush()
    return row, raw


def find(session: Session, raw: str) -> JoinToken | None:
    return session.scalar(select(JoinToken).where(JoinToken.digest == digest(raw)))


def expired(token: JoinToken) -> bool:
    return token.expires_at is not None and token.expires_at <= now()


def unusable(token: JoinToken) -> str | None:
    if token.revoked_at is not None:
        return "this join token was revoked"
    if expired(token):
        return "this join token expired"
    return None


def covers(token: JoinToken, role: str) -> bool:
    return token.role in (role, BOTH)


def note_use(session: Session, token: JoinToken, host: str, role: str) -> None:
    moment = now()
    fresh = token.last_used_at is not None and token.last_used_at > moment - NOTE_EVERY
    if fresh and token.last_host == host:
        return
    if token.last_host != host:
        detail = {"pool": token.pool, "host": host, "role": role}
        session.add(AuditEvent(actor=SYSTEM_ACTOR, action=JOINED, target=token.prefix, detail=detail))
    token.last_used_at = moment
    token.last_host = host


def refuse(session: Session, target: str, detail: dict[str, Any]) -> None:
    since = now() - QUIET
    recent = select(AuditEvent).where(AuditEvent.action == REFUSED, AuditEvent.target == target, AuditEvent.at >= since)
    if any(event.detail == detail for event in session.scalars(recent)):
        return
    session.add(AuditEvent(actor=SYSTEM_ACTOR, action=REFUSED, target=target, detail=detail))
    session.commit()


@dataclass(frozen=True)
class Caller:
    pool: str
    token: JoinToken | None = None
    name: str = LOCAL_TARGET

    @property
    def target(self) -> str:
        return self.token.prefix if self.token is not None else self.name

    @property
    def noun(self) -> str:
        return "join token" if self.token is not None else self.name


def address_of(request: Request) -> str | None:
    return request.client.host if request.client is not None else None


def bearer(authorization: str) -> str:
    scheme, _, given = authorization.partition(" ")
    return given.strip() if scheme.lower() == "bearer" else ""


def checked(session: Session, raw: str, role: str, address: str | None) -> JoinToken | None:
    token = find(session, raw) if is_join_token(raw) else None
    if token is None:
        return None
    problem = unusable(token)
    status = 401
    if problem is None and not covers(token, role):
        problem, status = f"this join token is for {token.role}s, not {role}s", 403
    if problem is not None:
        refuse(session, token.prefix, {"pool": token.pool, "reason": problem, "address": address})
        raise HTTPException(status_code=status, detail=problem)
    return token


def admit(session: Session, caller: Caller, pool: str, host: str, role: str, address: str | None) -> None:
    if pool != caller.pool:
        detail = {"pool": caller.pool, "asked": pool, "host": host, "address": address}
        refuse(session, caller.target, detail)
        if caller.token is None and caller.name == LOCAL_TARGET:
            raise HTTPException(status_code=403, detail=LOCAL_ONLY.format(pool=pool))
        raise HTTPException(status_code=403, detail=f"this {caller.noun} joins pool {caller.pool} only, not {pool}")
    if caller.token is not None:
        note_use(session, caller.token, host, role)
