from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, Field, StringConstraints

from minibrain.api.access import admin
from minibrain.api.deps import SessionDep
from minibrain.auth.identity import current_actor
from minibrain.auth.join_requests import approve, collect, deny, open_request, waiting
from minibrain.auth.join_tokens import address_of, bearer
from minibrain.registry.models import JoinRequest

router = APIRouter(prefix="/api/compute/join-requests", dependencies=[Depends(admin)])
machines = APIRouter(prefix="/internal/join", include_in_schema=False)

Short = Annotated[str, StringConstraints(max_length=200)]
MAX_GPUS = 64


class JoinGpu(BaseModel):
    name: Short
    memory_bytes: int = Field(ge=0)


class JoinHardware(BaseModel):
    system: Short = ""
    arch: Short = ""
    cpu_count: int = Field(default=0, ge=0)
    ram_bytes: int | None = Field(default=None, ge=0)
    accelerator: Short = "cpu"
    accelerator_name: Short = ""
    gpus: list[JoinGpu] = Field(default_factory=list, max_length=MAX_GPUS)


class JoinRequestBody(BaseModel):
    host: Annotated[str, StringConstraints(min_length=1, max_length=253)]
    pool: Annotated[str, StringConstraints(min_length=1, max_length=63)] | None = None
    hardware: JoinHardware = Field(default_factory=JoinHardware)


class JoinRequestOpened(BaseModel):
    code: str
    expires_at: datetime


class JoinRequestAnswer(BaseModel):
    state: str
    code: str
    pool: str | None = None
    credential: str | None = None


class JoinRequestInfo(BaseModel):
    id: int
    code: str = Field(description="The short code the machine printed, to tell requests apart.")
    host: str
    hardware: JoinHardware
    pool: str | None = Field(description="The pool the machine asked for, if any.")
    address: str | None
    created_at: datetime
    expires_at: datetime


class JoinApproval(BaseModel):
    pool: str = Field(min_length=1, max_length=63)


def hardware_of(stored: dict[str, Any]) -> JoinHardware:
    return JoinHardware.model_validate(stored)


def info(row: JoinRequest) -> JoinRequestInfo:
    return JoinRequestInfo(
        id=row.id,
        code=row.code,
        host=row.host,
        hardware=hardware_of(row.hardware),
        pool=row.asked_pool,
        address=row.address,
        created_at=row.created_at,
        expires_at=row.expires_at,
    )


@router.get("", summary="List machines waiting for approval", description="Requests not yet decided or expired.")
def list_join_requests(session: SessionDep) -> list[JoinRequestInfo]:
    return [info(row) for row in waiting(session)]


@router.post(
    "/{request_id}/approve",
    status_code=204,
    summary="Approve a machine",
    description="The machine joins this pool with a credential bound to it; removing the machine revokes it.",
)
def approve_join_request(request_id: int, body: JoinApproval, session: SessionDep) -> None:
    approve(session, request_id, body.pool, current_actor())
    session.commit()


@router.post("/{request_id}/deny", status_code=204, summary="Deny a machine")
def deny_join_request(request_id: int, session: SessionDep) -> None:
    deny(session, request_id, current_actor())
    session.commit()


@machines.post("/requests", status_code=201)
def open_join_request(
    body: JoinRequestBody, request: Request, session: SessionDep, authorization: Annotated[str, Header()] = ""
) -> JoinRequestOpened:
    hardware = body.hardware.model_dump()
    row = open_request(session, bearer(authorization), body.host, hardware, body.pool, address_of(request))
    session.commit()
    return JoinRequestOpened(code=row.code, expires_at=row.expires_at)


@machines.get("/requests/self")
def join_request_state(session: SessionDep, authorization: Annotated[str, Header()] = "") -> JoinRequestAnswer:
    answer = collect(session, bearer(authorization))
    session.commit()
    return JoinRequestAnswer(**answer.__dict__)
