from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from minibrain.api.access import admin
from minibrain.api.deps import SessionDep
from minibrain.auth.identity import current_actor
from minibrain.auth.join_tokens import JOIN_KEY_ENV, JoinRole, create, expired, pool_problem
from minibrain.registry.models import AuditEvent, JoinToken, now
from minibrain.registry.service import NotFoundError

router = APIRouter(prefix="/api/compute/join-tokens", dependencies=[Depends(admin)])

MAX_DAYS = 365


class JoinTokenCreate(BaseModel):
    pool: str = Field(min_length=1, max_length=63)
    role: JoinRole
    expires_in_days: int | None = Field(default=None, ge=1, le=MAX_DAYS)


class JoinTokenInfo(BaseModel):
    id: int
    pool: str
    role: str = Field(description="worker, engine or both.")
    prefix: str = Field(description="The token's first characters, to tell tokens apart.")
    created_at: datetime
    created_by: str
    expires_at: datetime | None
    expired: bool
    last_used_at: datetime | None
    last_host: str | None = Field(description="The machine that last joined with this token.")


class JoinTokenCreated(JoinTokenInfo):
    secret: str = Field(description="The token itself; shown only in this answer.")
    env: str = Field(default=JOIN_KEY_ENV, description="The environment variable workers and engines read it from.")


def info(token: JoinToken) -> JoinTokenInfo:
    return JoinTokenInfo(
        id=token.id,
        pool=token.pool,
        role=token.role,
        prefix=token.prefix,
        created_at=token.created_at,
        created_by=token.created_by,
        expires_at=token.expires_at,
        expired=expired(token),
        last_used_at=token.last_used_at,
        last_host=token.last_host,
    )


def audit(session: SessionDep, action: str, token: JoinToken) -> None:
    expires = token.expires_at.isoformat() if token.expires_at else None
    detail = {"pool": token.pool, "role": token.role, "expires_at": expires}
    session.add(AuditEvent(actor=current_actor(), action=action, target=token.prefix, detail=detail))


@router.get("", summary="List join tokens", description="Tokens not revoked, newest first.")
def list_join_tokens(session: SessionDep, pool: str | None = None) -> list[JoinTokenInfo]:
    query = select(JoinToken).where(JoinToken.revoked_at.is_(None)).order_by(JoinToken.id.desc())
    if pool is not None:
        query = query.where(JoinToken.pool == pool)
    return [info(token) for token in session.scalars(query)]


@router.post(
    "",
    status_code=201,
    summary="Create a join token",
    description="A token a worker or engine presents to join one pool. The answer is the only time it is shown.",
)
def create_join_token(body: JoinTokenCreate, session: SessionDep) -> JoinTokenCreated:
    problem = pool_problem(body.pool)
    if problem is not None:
        raise HTTPException(status_code=422, detail=problem)
    token, raw = create(session, body.pool, body.role, body.expires_in_days, current_actor())
    audit(session, "join_token.create", token)
    session.commit()
    return JoinTokenCreated(secret=raw, **info(token).model_dump())


@router.delete("/{token_id}", status_code=204, summary="Revoke a join token")
def revoke_join_token(token_id: int, session: SessionDep) -> None:
    token = session.get(JoinToken, token_id)
    if token is None or token.revoked_at is not None:
        raise NotFoundError(f"join token {token_id} not found")
    token.revoked_at = now()
    audit(session, "join_token.revoke", token)
    session.commit()
