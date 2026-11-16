from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from minibrain.api.access import admin
from minibrain.api.deps import SessionDep
from minibrain.auth.identity import current_actor
from minibrain.auth.join_tokens import JOIN_KEY_ENV, issue, pool_problem
from minibrain.registry.models import AuditEvent, JoinToken

router = APIRouter(prefix="/api/compute/join-tokens", dependencies=[Depends(admin)])


class JoinTokenIssue(BaseModel):
    pool: str = Field(min_length=1, max_length=63)


class PoolToken(BaseModel):
    pool: str
    prefix: str = Field(description="The token's first characters; the rest is shown only when it is made.")
    created_at: datetime
    created_by: str
    last_used_at: datetime | None
    last_host: str | None = Field(description="The machine that last joined with this token.")


class PoolTokenIssued(PoolToken):
    secret: str = Field(description="The token itself; shown only in this answer.")
    env: str = Field(default=JOIN_KEY_ENV, description="The environment variable workers and engines read it from.")
    replaced: str | None = Field(description="The prefix of the token this one revoked, if the pool had one.")


def info(token: JoinToken) -> PoolToken:
    return PoolToken(
        pool=token.pool,
        prefix=token.prefix,
        created_at=token.created_at,
        created_by=token.created_by,
        last_used_at=token.last_used_at,
        last_host=token.last_host,
    )


@router.get("", summary="List pool join tokens", description="Each pool's live token, by its prefix.")
def list_join_tokens(session: SessionDep) -> list[PoolToken]:
    query = select(JoinToken).where(JoinToken.revoked_at.is_(None)).order_by(JoinToken.pool)
    return [info(token) for token in session.scalars(query)]


@router.post(
    "",
    status_code=201,
    summary="Make or rotate a pool's join token",
    description=(
        "A pool has one join token. This makes it, or replaces it and revokes the old one at once: machines and "
        "engines that joined with the old token are cut off. The answer is the only time the token is shown."
    ),
)
def issue_join_token(body: JoinTokenIssue, session: SessionDep) -> PoolTokenIssued:
    problem = pool_problem(body.pool)
    if problem is not None:
        raise HTTPException(status_code=422, detail=problem)
    token, raw, old = issue(session, body.pool, current_actor())
    action = "join_token.rotate" if old is not None else "join_token.create"
    detail = {"pool": token.pool, "replaced": old.prefix if old is not None else None}
    session.add(AuditEvent(actor=current_actor(), action=action, target=token.prefix, detail=detail))
    session.commit()
    return PoolTokenIssued(secret=raw, replaced=detail["replaced"], **info(token).model_dump())
