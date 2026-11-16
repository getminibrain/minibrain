import hashlib
import hmac

from fastapi import HTTPException
from sqlalchemy.orm import Session

from minibrain.auth.join_tokens import Caller, lapse, refuse
from minibrain.registry.models import JoinToken
from minibrain.settings import Settings

PREFIX = "engine."
KEY_FILE = "engine_token"
NAME = "engine token"


def signature(settings: Settings, token_id: int, pool: str) -> str:
    claim = f"{token_id}/{pool}".encode()
    return hmac.new(settings.secret(KEY_FILE).encode(), claim, hashlib.sha256).hexdigest()


def engine_token(settings: Settings, join: JoinToken) -> str:
    return f"{PREFIX}{join.id}.{join.pool}.{signature(settings, join.id, join.pool)}"


def signed_claim(settings: Settings, token: str) -> tuple[int, str] | None:
    if not token.startswith(PREFIX):
        return None
    head, _, given = token.removeprefix(PREFIX).rpartition(".")
    number, _, pool = head.partition(".")
    if not (number.isascii() and number.isdigit()) or not pool:
        return None
    if not hmac.compare_digest(given, signature(settings, int(number), pool)):
        return None
    return int(number), pool


def engine_caller(session: Session, settings: Settings, token: str, address: str | None) -> Caller | None:
    claim = signed_claim(settings, token)
    if claim is None:
        return None
    token_id, pool = claim
    join = session.get(JoinToken, token_id)
    state = "is gone" if join is None or join.pool != pool else lapse(join)
    target = join.prefix if join is not None else f"{NAME} {token_id}"
    if state is not None:
        problem = f"the join token behind this engine token {state}"
        refuse(session, target, {"pool": pool, "reason": problem, "address": address})
        raise HTTPException(status_code=401, detail=problem)
    return Caller(pool, name=NAME, issuer=target)
