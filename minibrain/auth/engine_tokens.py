import hashlib
import hmac

from fastapi import HTTPException
from sqlalchemy.orm import Session

from minibrain.auth import join_requests, join_tokens
from minibrain.auth.join_tokens import Caller, refuse
from minibrain.registry.models import JoinRequest, JoinToken
from minibrain.settings import Settings

PREFIX = "engine."
KEY_FILE = "engine_token"
NAME = "engine token"
FROM_POOL = "t"
FROM_APPROVAL = "m"
SOURCES = {FROM_POOL: "join token", FROM_APPROVAL: "approval"}


def signature(settings: Settings, source: str, pool: str) -> str:
    claim = f"{source}/{pool}".encode()
    return hmac.new(settings.secret(KEY_FILE).encode(), claim, hashlib.sha256).hexdigest()


def source_of(caller: Caller) -> str | None:
    if caller.token is not None:
        return f"{FROM_POOL}{caller.token.id}"
    return f"{FROM_APPROVAL}{caller.machine.id}" if caller.machine is not None else None


def engine_token(settings: Settings, caller: Caller) -> str | None:
    source = source_of(caller)
    if source is None:
        return None
    return f"{PREFIX}{source}.{caller.pool}.{signature(settings, source, caller.pool)}"


def signed_claim(settings: Settings, token: str) -> tuple[str, int, str] | None:
    if not token.startswith(PREFIX):
        return None
    head, _, given = token.removeprefix(PREFIX).rpartition(".")
    source, _, pool = head.partition(".")
    kind, number = source[:1], source[1:]
    if kind not in SOURCES or not (number.isascii() and number.isdigit()) or not pool:
        return None
    if not hmac.compare_digest(given, signature(settings, source, pool)):
        return None
    return kind, int(number), pool


def behind(session: Session, kind: str, number: int, pool: str) -> tuple[str, str | None]:
    if kind == FROM_POOL:
        join = session.get(JoinToken, number)
        if join is None or join.pool != pool:
            return f"{NAME} {kind}{number}", "is gone"
        return join.prefix, join_tokens.lapse(join)
    machine = session.get(JoinRequest, number)
    if machine is None or machine.pool != pool:
        return f"{NAME} {kind}{number}", "is gone"
    return machine.code, join_requests.lapse(machine)


def engine_caller(session: Session, settings: Settings, token: str, address: str | None) -> Caller | None:
    claim = signed_claim(settings, token)
    if claim is None:
        return None
    kind, number, pool = claim
    target, state = behind(session, kind, number, pool)
    if state is not None:
        problem = f"the {SOURCES[kind]} behind this engine token {state}"
        refuse(session, target, {"pool": pool, "reason": problem, "address": address})
        raise HTTPException(status_code=401, detail=problem)
    return Caller(pool, name=NAME, issuer=target)
