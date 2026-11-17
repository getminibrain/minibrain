import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from minibrain.models.hardware import LOCAL_POOL
from minibrain.registry.models import SYSTEM_ACTOR, AuditEvent, JoinRequest, JoinToken, now

PREFIX = "mbj_"
SHOWN = 12
JOIN_KEY_ENV = "MINIBRAIN_JOIN_TOKEN"
LOCAL_KEY_FILE = "worker_token"
WORKER = "worker"
ENGINE = "engine"
POOL_PATTERN = r"^[a-z0-9][a-z0-9._-]{0,62}$"
REFUSED = "join_token.refused"
JOINED = "join_token.joined"
LOCAL_TARGET = "local worker token"
QUIET = timedelta(minutes=10)
NOTE_EVERY = timedelta(minutes=1)
LOCAL_ONLY = (
    "the local worker token joins the local pool only; run minibrain worker without it to ask an admin to approve "
    "this machine for pool {pool}, or set the pool's join token in MINIBRAIN_JOIN_TOKEN"
)


def digest(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def is_join_token(raw: str) -> bool:
    return raw.startswith(PREFIX)


def pool_problem(pool: str) -> str | None:
    if pool == LOCAL_POOL:
        return "The local pool is main's own machine; no other machine joins it."
    if not re.fullmatch(POOL_PATTERN, pool):
        return "A pool name is up to 63 lowercase letters, digits, dots, dashes or underscores."
    return None


def live_token(session: Session, pool: str) -> JoinToken | None:
    return session.scalar(select(JoinToken).where(JoinToken.pool == pool, JoinToken.revoked_at.is_(None)))


def issue(session: Session, pool: str, actor: str) -> tuple[JoinToken, str, JoinToken | None]:
    old = live_token(session, pool)
    if old is not None:
        old.revoked_at = now()
        session.flush()
    raw = PREFIX + secrets.token_urlsafe(32)
    row = JoinToken(pool=pool, prefix=raw[:SHOWN], digest=digest(raw), created_by=actor)
    session.add(row)
    session.flush()
    return row, raw, old


def find(session: Session, raw: str) -> JoinToken | None:
    return session.scalar(select(JoinToken).where(JoinToken.digest == digest(raw)))


def lapse(token: JoinToken) -> str | None:
    return "was revoked" if token.revoked_at is not None else None


def joined_before(session: Session, token: JoinToken, host: str) -> bool:
    seen = select(AuditEvent.detail).where(AuditEvent.action == JOINED, AuditEvent.target == token.prefix)
    return any(detail.get("host") == host for detail in session.scalars(seen))


def note_use(session: Session, token: JoinToken, host: str, role: str) -> None:
    moment = now()
    fresh = token.last_used_at is not None and token.last_used_at > moment - NOTE_EVERY
    if fresh and token.last_host == host:
        return
    if token.last_host != host and not joined_before(session, token, host):
        detail = {"pool": token.pool, "host": host, "role": role}
        session.add(AuditEvent(actor=SYSTEM_ACTOR, action=JOINED, target=token.prefix, detail=detail))
    token.last_used_at = moment
    token.last_host = host


def note_machine(machine: JoinRequest) -> None:
    moment = now()
    if machine.last_used_at is None or machine.last_used_at <= moment - NOTE_EVERY:
        machine.last_used_at = moment


def same(found: dict[str, Any], detail: dict[str, Any]) -> bool:
    return all(found.get(key) == value for key, value in detail.items())


def refuse(
    session: Session,
    target: str,
    detail: dict[str, Any],
    extra: dict[str, Any] | None = None,
    action: str = REFUSED,
) -> None:
    since = now() - QUIET
    recent = select(AuditEvent).where(AuditEvent.action == action, AuditEvent.target == target, AuditEvent.at >= since)
    if any(same(event.detail, detail) for event in session.scalars(recent)):
        return
    session.add(AuditEvent(actor=SYSTEM_ACTOR, action=action, target=target, detail=detail | (extra or {})))
    session.commit()


@dataclass(frozen=True)
class Caller:
    pool: str
    token: JoinToken | None = None
    machine: JoinRequest | None = None
    name: str = LOCAL_TARGET
    issuer: str | None = None

    @property
    def remote(self) -> bool:
        return self.token is not None or self.machine is not None

    @property
    def target(self) -> str:
        if self.token is not None:
            return self.token.prefix
        if self.machine is not None:
            return self.machine.code
        return self.issuer or self.name

    @property
    def noun(self) -> str:
        if self.token is not None:
            return "join token"
        return "approval" if self.machine is not None else self.name


def address_of(request: Request) -> str | None:
    return request.client.host if request.client is not None else None


def bearer(authorization: str) -> str:
    scheme, _, given = authorization.partition(" ")
    return given.strip() if scheme.lower() == "bearer" else ""


def checked(session: Session, raw: str, address: str | None) -> JoinToken | None:
    token = find(session, raw) if is_join_token(raw) else None
    if token is None:
        return None
    state = lapse(token)
    if state is not None:
        problem = f"this join token {state}"
        refuse(session, token.prefix, {"pool": token.pool, "reason": problem, "address": address})
        raise HTTPException(status_code=401, detail=problem)
    return token


def admit(session: Session, caller: Caller, pool: str, host: str, role: str, address: str | None) -> None:
    if pool != caller.pool:
        detail = {"pool": caller.pool, "asked": pool, "host": host, "address": address}
        refuse(session, caller.target, detail)
        if not caller.remote and caller.name == LOCAL_TARGET:
            raise HTTPException(status_code=403, detail=LOCAL_ONLY.format(pool=pool))
        raise HTTPException(status_code=403, detail=f"this {caller.noun} joins pool {caller.pool} only, not {pool}")
    machine = caller.machine
    if machine is not None and role == WORKER and host != machine.host:
        detail = {"pool": caller.pool, "host": host, "approved": machine.host, "address": address}
        refuse(session, caller.target, detail)
        raise HTTPException(status_code=403, detail=f"this approval is for {machine.host} only, not {host}")
    if caller.token is not None:
        note_use(session, caller.token, host, role)
    if machine is not None:
        note_machine(machine)
