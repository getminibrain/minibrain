from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from minibrain.api.access import IdentityDep, signed_in
from minibrain.api.deps import SessionDep
from minibrain.auth.accounts import (
    LOCAL,
    OIDC,
    PROXY,
    AccountError,
    WrongPassword,
    change_password,
    clean_name,
    end_other_sessions,
    get_user,
    lifetimes,
    person_for,
    person_of,
)
from minibrain.auth.config import AuthConfig
from minibrain.auth.gate import Identity
from minibrain.auth.passwords import PasswordError
from minibrain.auth.roles import Role
from minibrain.auth.throttle import TooManyAttempts
from minibrain.registry.models import AuditEvent, LoginSession, User, now, peer_address
from minibrain.registry.service import NotFoundError

router = APIRouter(prefix="/api/me")

PROXY_PROVIDER = "your sign-in proxy"
NO_SESSION = "No such session on your account"
THIS_SESSION = "This is the session you are using; sign out instead"


class Profile(BaseModel):
    id: int
    name: str
    email: str | None
    source: str
    role: Role | None
    role_locked: bool
    provider: str | None
    has_password: bool
    created_at: datetime
    last_sign_in_at: datetime | None


class NameChange(BaseModel):
    name: str = Field(max_length=1000)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=1024)
    password: str


class SignInSession(BaseModel):
    id: int
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    ip: str | None
    user_agent: str | None
    current: bool


class SessionsEnded(BaseModel):
    ended: int


def auth_config(request: Request) -> AuthConfig:
    return request.app.state.auth


AuthDep = Annotated[AuthConfig, Depends(auth_config)]


def own_account(session: Session, found: Identity) -> User:
    if found.person is None:
        raise NotFoundError("No one is signed in")
    return get_user(session, found.person.id)


def current_session_id(session: Session, found: Identity) -> int | None:
    kind, _, digest = (found.csrf_subject or "").partition(":")
    if kind != "session":
        return None
    return session.scalar(select(LoginSession.id).where(LoginSession.token_hash == digest))


def provider_of(config: AuthConfig, user: User) -> str | None:
    if user.source == OIDC:
        return config.oidc.label if config.oidc else "single sign-on"
    if user.source == PROXY:
        return PROXY_PROVIDER
    return None


def profile_of(session: Session, config: AuthConfig, user: User) -> Profile:
    person = person_for(session, user, config)
    return Profile(
        id=user.id,
        name=user.name,
        email=user.email,
        source=user.source,
        role=person.role,
        role_locked=person.role_locked,
        provider=provider_of(config, user),
        has_password=user.source == LOCAL and user.password_hash is not None,
        created_at=user.created_at,
        last_sign_in_at=user.last_sign_in_at,
    )


def audit_self(session: Session, user: User, action: str, detail: dict[str, Any]) -> None:
    actor = person_of(user).actor
    session.add(AuditEvent(actor=actor, actor_id=user.id, action=action, target=actor, detail=detail))


def live(session: Session, row: LoginSession) -> bool:
    moment = now()
    limits = lifetimes(session)
    ends = min(row.expires_at, row.created_at + limits.absolute)
    idle = limits.idle is not None and moment - row.last_seen_at > limits.idle
    return ends > moment and not idle


@router.get("", dependencies=[Depends(signed_in)], summary="Read your own account")
def read_profile(session: SessionDep, found: IdentityDep, config: AuthDep) -> Profile:
    return profile_of(session, config, own_account(session, found))


@router.patch("", dependencies=[Depends(signed_in)], summary="Change your name")
def change_name(body: NameChange, session: SessionDep, found: IdentityDep, config: AuthDep) -> Profile:
    user = own_account(session, found)
    name = clean_name(body.name, "")
    if not name:
        raise AccountError("Enter a name")
    if name != user.name:
        before = user.name
        user.name = name
        user.updated_at = now()
        audit_self(session, user, "account.update", {"name": user.name, "from": {"name": before}, "to": {"name": name}})
    session.commit()
    return profile_of(session, config, user)


@router.post("/password", dependencies=[Depends(signed_in)], summary="Change your password")
def new_password(body: PasswordChange, session: SessionDep, found: IdentityDep, config: AuthDep) -> SessionsEnded:
    user = own_account(session, found)
    if user.source != LOCAL:
        provider = provider_of(config, user) or "your identity provider"
        raise AccountError(f"Your password is managed by {provider}")
    try:
        ended = change_password(
            session, user, body.current_password, body.password, peer_address(), current_session_id(session, found)
        )
    except (WrongPassword, TooManyAttempts, PasswordError):
        session.commit()
        raise
    audit_self(session, user, "account.password_change", {"sessions_ended": len(ended)})
    session.commit()
    return SessionsEnded(ended=len(ended))


@router.get("/sessions", dependencies=[Depends(signed_in)], summary="List your sign-in sessions")
def my_sessions(session: SessionDep, found: IdentityDep) -> list[SignInSession]:
    user = own_account(session, found)
    current = current_session_id(session, found)
    query = select(LoginSession).where(LoginSession.user_id == user.id).order_by(LoginSession.last_seen_at.desc())
    return [
        SignInSession(
            id=row.id,
            created_at=row.created_at,
            last_seen_at=row.last_seen_at,
            expires_at=row.expires_at,
            ip=row.ip,
            user_agent=row.user_agent,
            current=row.id == current,
        )
        for row in session.scalars(query)
        if row.id == current or live(session, row)
    ]


@router.delete("/sessions/{session_id}", status_code=204, dependencies=[Depends(signed_in)], summary="End one session")
def end_one_session(session_id: int, session: SessionDep, found: IdentityDep) -> None:
    user = own_account(session, found)
    row = session.get(LoginSession, session_id)
    if row is None or row.user_id != user.id:
        raise NotFoundError(NO_SESSION)
    if row.id == current_session_id(session, found):
        raise AccountError(THIS_SESSION)
    detail = {"session": row.id, "session_ip": row.ip}
    session.delete(row)
    audit_self(session, user, "account.session_end", detail)
    session.commit()


@router.delete("/sessions", dependencies=[Depends(signed_in)], summary="End your other sessions")
def end_other(session: SessionDep, found: IdentityDep) -> SessionsEnded:
    user = own_account(session, found)
    ended = end_other_sessions(session, user, current_session_id(session, found))
    if ended:
        audit_self(session, user, "account.sessions_end", {"sessions": ended})
    session.commit()
    return SessionsEnded(ended=len(ended))
