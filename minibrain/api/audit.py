import csv
import io
import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, StringConstraints
from sqlalchemy import ColumnElement, SQLColumnExpression, String, cast, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from starlette.types import ASGIApp, Receive, Scope, Send

from minibrain.api.access import admin
from minibrain.api.audit_targets import ActorKind, AuditTarget, actor_kind, actor_names, category_of, targets_of
from minibrain.api.deps import SessionDep
from minibrain.api.model_activity import display_names
from minibrain.api.sort_labels import ACTION_LABELS, label_rank
from minibrain.api.sorting import CURSOR_PATTERN, Keyset, KeysetPage, Order, keyset_rows
from minibrain.auth.identity import current_actor
from minibrain.policy import load as load_policy
from minibrain.redaction import redact
from minibrain.registry.audit_chain import ChainReport, head_of, verify
from minibrain.registry.audit_checks import FULL, record_new
from minibrain.registry.models import PEER_ADDRESS, AuditChain, AuditChainBreak, AuditEvent, now
from minibrain.registry.service import ConflictError, NotFoundError
from minibrain.siem import target_of, waiting

router = APIRouter(prefix="/api/audit")

PAGE_SIZE = 50
PAGE_MAX = 500
EXPORT_BATCH = 1000
EXPORT_COLUMNS = ("id", "seq", "at", "actor", "actor_id", "ip", "action", "target", "detail", "prev_hash", "hash")
EXPORTED: set[str] = set(EXPORT_COLUMNS)
FORMULA_START = ("=", "+", "-", "@", "\t", "\r")
AuditSort = Literal["at", "actor", "action"]
MEDIA_TYPES = {"csv": "text/csv; charset=utf-8", "jsonl": "application/x-ndjson"}
VIEW_ACTION = "audit.view"
EXPORT_ACTION = "audit.export"
VIEW_EVERY = timedelta(hours=1)
ACKNOWLEDGE_ACTION = "audit.chain_break_acknowledged"
NOTE_MAX = 500
Note = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=NOTE_MAX)]


class PeerAddress:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        client = scope.get("client") if scope["type"] == "http" else None
        token = PEER_ADDRESS.set(client[0] if client else None)
        try:
            await self.app(scope, receive, send)
        finally:
            PEER_ADDRESS.reset(token)


class AuditInfo(BaseModel):
    id: int
    at: datetime
    actor: str
    actor_id: int | None
    ip: str | None
    action: str
    target: str
    detail: dict[str, Any]
    seq: int | None
    prev_hash: str | None
    hash: str | None
    actor_kind: ActorKind
    actor_name: str | None = None
    target_ref: AuditTarget | None = None


class AuditPage(BaseModel):
    events: list[AuditInfo]
    total: int
    start: int
    next_cursor: str | None
    prev_cursor: str | None


class AuditFacet(BaseModel):
    value: str
    count: int


class AuditFacets(BaseModel):
    categories: list[AuditFacet]
    actions: list[AuditFacet]
    actors: list[AuditFacet]


class ChainBreakInfo(BaseModel):
    seq: int
    event_id: int | None
    reason: str


class SiemInfo(BaseModel):
    target: str | None
    forwarded_seq: int
    forwarded_at: datetime | None
    error: str | None
    waiting: int


class AutomaticCheck(BaseModel):
    verified_seq: int | None
    verified_at: datetime | None
    full_checked_at: datetime | None


class ChainBreakRecord(BaseModel):
    id: int
    seq: int
    event_id: int | None
    reason: str
    found_by: Literal["hourly", "full"]
    found_at: datetime
    acknowledged_at: datetime | None
    acknowledged_by: str | None
    acknowledged_by_name: str | None
    note: str | None


class AcknowledgeBreak(BaseModel):
    note: Note


class AuditChainInfo(BaseModel):
    verified: bool
    events: int
    first_seq: int | None
    last_seq: int
    anchor_seq: int
    pending: int
    broken: ChainBreakInfo | None
    checked_at: datetime
    siem: SiemInfo
    automatic: AutomaticCheck
    breaks: list[ChainBreakRecord]


@dataclass(frozen=True)
class AuditFilter:
    categories: list[str]
    actions: list[str]
    actors: list[str]
    targets: list[str]
    since: datetime | None
    until: datetime | None
    search: str

    def conditions(self) -> list[ColumnElement[bool]]:
        found: list[ColumnElement[bool]] = []
        if self.categories:
            found.append(or_(*(AuditEvent.action.startswith(f"{name}.", autoescape=True) for name in self.categories)))
        if self.targets:
            found.append(or_(*(about(target) for target in self.targets)))
        if self.actions:
            found.append(AuditEvent.action.in_(self.actions))
        if self.actors:
            found.append(AuditEvent.actor.in_(self.actors))
        if self.since is not None:
            found.append(AuditEvent.at >= self.since)
        if self.until is not None:
            found.append(AuditEvent.at < self.until)
        words = self.search.strip().lower()
        if words:
            columns = (AuditEvent.actor, AuditEvent.action, AuditEvent.target, AuditEvent.ip)
            fields = [*columns, cast(AuditEvent.detail, String)]
            found.append(or_(*(func.lower(field).contains(words, autoescape=True) for field in fields)))
        return found


def about(target: str) -> ColumnElement[bool]:
    return or_(
        AuditEvent.target == target,
        AuditEvent.target.startswith(f"{target}@", autoescape=True),
        AuditEvent.target.startswith(f"{target}/", autoescape=True),
    )


def audit_filter(
    category: Annotated[list[str] | None, Query()] = None,
    action: Annotated[list[str] | None, Query()] = None,
    actor: Annotated[list[str] | None, Query()] = None,
    target: Annotated[list[str] | None, Query()] = None,
    since: datetime | None = None,
    until: datetime | None = None,
    q: str = "",
) -> AuditFilter:
    return AuditFilter(
        categories=category or [],
        actions=action or [],
        actors=actor or [],
        targets=target or [],
        since=since,
        until=until,
        search=q,
    )


def filters_of(found: AuditFilter) -> dict[str, Any]:
    values = {
        "category": found.categories,
        "action": found.actions,
        "actor": found.actors,
        "target": found.targets,
        "since": found.since.isoformat() if found.since else None,
        "until": found.until.isoformat() if found.until else None,
        "q": found.search.strip(),
    }
    return {name: value for name, value in values.items() if value}


def viewed_lately(session: Session, actor: str) -> bool:
    query = select(AuditEvent.id).where(
        AuditEvent.action == VIEW_ACTION, AuditEvent.actor == actor, AuditEvent.at >= now() - VIEW_EVERY
    )
    return session.scalar(query.limit(1)) is not None


def record_view(session: Session) -> None:
    actor = current_actor()
    if viewed_lately(session, actor):
        return
    session.add(AuditEvent(actor=actor, action=VIEW_ACTION, target="audit_events", detail={}))
    session.commit()


FilterDep = Annotated[AuditFilter, Depends(audit_filter)]


def event_info(
    event: AuditEvent, names: dict[int, str] | None = None, targets: dict[int, AuditTarget] | None = None
) -> AuditInfo:
    return AuditInfo(
        id=event.id,
        at=event.at,
        actor=event.actor,
        actor_id=event.actor_id,
        ip=event.ip,
        action=event.action,
        target=event.target,
        detail=redact(dict(event.detail)),
        seq=event.seq,
        prev_hash=event.prev_hash,
        hash=event.hash,
        actor_kind=actor_kind(event.actor),
        actor_name=(names or {}).get(event.id),
        target_ref=(targets or {}).get(event.id),
    )


def described(session: Session, events: list[AuditEvent]) -> list[AuditInfo]:
    names = actor_names(session, events)
    targets = targets_of(session, events)
    return [event_info(event, names, targets) for event in events]


def matching(session: Session, conditions: list[ColumnElement[bool]]) -> int:
    return int(session.scalar(select(func.count(AuditEvent.id)).where(*conditions)) or 0)


def lowered(value: SQLColumnExpression[str]) -> SQLColumnExpression[str]:
    return func.lower(value, type_=String)


PARTS: dict[str, Callable[[], tuple[SQLColumnExpression[Any], ...]]] = {
    "at": tuple,
    "actor": lambda: (lowered(AuditEvent.actor),),
    "action": lambda: (label_rank(AuditEvent.action, ACTION_LABELS), AuditEvent.action),
}


def audit_keyset(sort: AuditSort, order: Order) -> Keyset:
    return Keyset(columns=(*PARTS[sort](), AuditEvent.id), descending=order == "desc")


def page_rows(
    session: Session,
    conditions: list[ColumnElement[bool]],
    keyset: Keyset,
    after: str | None,
    back: str | None,
    size: int,
) -> KeysetPage:
    query = select(AuditEvent).where(*conditions)
    if back is not None:
        found = keyset_rows(session, query, keyset, back, size, reverse=True)
        if len(found.rows) == size:
            return found
    return keyset_rows(session, query, keyset, after if back is None else None, size)


@router.get("", dependencies=[Depends(admin)], summary="List audit events")
def list_events(
    session: SessionDep,
    found: FilterDep,
    after: Annotated[str | None, Query(alias="next", pattern=CURSOR_PATTERN)] = None,
    back: Annotated[str | None, Query(alias="prev", pattern=CURSOR_PATTERN)] = None,
    limit: int = PAGE_SIZE,
    sort: AuditSort = "at",
    order: Order = "desc",
) -> AuditPage:
    conditions = found.conditions()
    keyset = audit_keyset(sort, order)
    page = page_rows(session, conditions, keyset, after, back, max(1, min(limit, PAGE_MAX)))
    total = matching(session, conditions)
    if page.first is None or page.last is None:
        record_view(session)
        return AuditPage(events=[], total=total, start=0, next_cursor=None, prev_cursor=None)
    start = matching(session, [*conditions, keyset.beyond(page.first, reverse=True)])
    rest = total - start - len(page.rows)
    listed = AuditPage(
        events=described(session, [row[0] for row in page.rows]),
        total=total,
        start=start,
        next_cursor=keyset.encode(page.last) if rest > 0 else None,
        prev_cursor=keyset.encode(page.first) if start > 0 else None,
    )
    record_view(session)
    return listed


@router.get("/facets", dependencies=[Depends(admin)], summary="Count audit events by filter")
def facets(session: SessionDep) -> AuditFacets:
    def counted(column: Any) -> list[AuditFacet]:
        rows = session.execute(select(column, func.count()).group_by(column).order_by(column)).all()
        return [AuditFacet(value=value, count=count) for value, count in rows]

    actions = counted(AuditEvent.action)
    categories: dict[str, int] = {}
    for item in actions:
        name = category_of(item.value)
        categories[name] = categories.get(name, 0) + item.count
    return AuditFacets(
        categories=[AuditFacet(value=name, count=total) for name, total in sorted(categories.items())],
        actions=actions,
        actors=counted(AuditEvent.actor),
    )


def safe_cell(value: Any) -> str:
    text = "" if value is None else str(value)
    return f"'{text}" if text.startswith(FORMULA_START) else text


def exported(event: AuditEvent) -> dict[str, Any]:
    return event_info(event).model_dump(mode="json", include=EXPORTED)


def csv_lines(rows: Iterator[AuditEvent]) -> Iterator[str]:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(EXPORT_COLUMNS)
    for event in rows:
        record = exported(event)
        record["detail"] = json.dumps(record["detail"], sort_keys=True)
        writer.writerow([safe_cell(record[column]) for column in EXPORT_COLUMNS])
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate()
    yield buffer.getvalue()


def jsonl_lines(rows: Iterator[AuditEvent]) -> Iterator[str]:
    for event in rows:
        yield json.dumps(exported(event), sort_keys=True) + "\n"


def export_stream(
    sessions: sessionmaker[Session], conditions: list[ColumnElement[bool]], kind: Literal["csv", "jsonl"]
) -> Iterator[str]:
    with sessions() as session:
        query = select(AuditEvent).where(*conditions).order_by(AuditEvent.id.desc())
        rows = iter(session.scalars(query.execution_options(yield_per=EXPORT_BATCH)))
        yield from (csv_lines(rows) if kind == "csv" else jsonl_lines(rows))


@router.get(
    "/export",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/csv": {}}}},
    dependencies=[Depends(admin)],
    summary="Export the audit log",
)
def export(
    request: Request, session: SessionDep, found: FilterDep, format: Literal["csv", "jsonl"] = "csv"
) -> StreamingResponse:
    detail = {"format": format, "filters": filters_of(found)}
    session.add(AuditEvent(actor=current_actor(), action=EXPORT_ACTION, target="audit_events", detail=detail))
    session.commit()
    name = f"minibrain-audit-{now().strftime('%Y%m%d-%H%M%S')}.{format}"
    return StreamingResponse(
        export_stream(request.app.state.sessions, found.conditions(), format),
        media_type=MEDIA_TYPES[format],
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


def automatic_of(head: AuditChain) -> AutomaticCheck:
    return AutomaticCheck(
        verified_seq=head.verified_seq,
        verified_at=head.verified_at,
        full_checked_at=head.full_checked_at,
    )


def break_records(session: Session, found: list[AuditChainBreak]) -> list[ChainBreakRecord]:
    names = display_names(session, {row.acknowledged_by for row in found if row.acknowledged_by})
    return [
        ChainBreakRecord(
            id=row.id,
            seq=row.seq,
            event_id=row.event_id,
            reason=row.reason,
            found_by="full" if row.found_by == "full" else "hourly",
            found_at=row.found_at,
            acknowledged_at=row.acknowledged_at,
            acknowledged_by=row.acknowledged_by,
            acknowledged_by_name=names.get(row.acknowledged_by) if row.acknowledged_by else None,
            note=row.note,
        )
        for row in found
    ]


def break_history(session: Session) -> list[ChainBreakRecord]:
    query = select(AuditChainBreak).order_by(AuditChainBreak.found_at.desc(), AuditChainBreak.id.desc())
    return break_records(session, list(session.scalars(query)))


def chain_info(
    report: ChainReport, siem: SiemInfo, automatic: AutomaticCheck, breaks: list[ChainBreakRecord]
) -> AuditChainInfo:
    broken = report.broken
    return AuditChainInfo(
        verified=report.verified,
        events=report.events,
        first_seq=report.first_seq,
        last_seq=report.last_seq,
        anchor_seq=report.anchor_seq,
        pending=report.pending,
        broken=ChainBreakInfo(seq=broken.seq, event_id=broken.event_id, reason=broken.reason) if broken else None,
        checked_at=now(),
        siem=siem,
        automatic=automatic,
        breaks=breaks,
    )


def siem_info(session: Session) -> SiemInfo:
    target = target_of(load_policy(session))
    head = head_of(session)
    return SiemInfo(
        target=target.describe() if target else None,
        forwarded_seq=head.forwarded_seq,
        forwarded_at=head.forwarded_at,
        error=head.forward_error,
        waiting=waiting(session, head.forwarded_seq),
    )


@router.get("/chain", dependencies=[Depends(admin)], summary="Check the audit hash chain")
def chain(session: SessionDep) -> AuditChainInfo:
    report = verify(session)
    remember_breaks(session, report)
    return chain_info(report, siem_info(session), automatic_of(head_of(session)), break_history(session))


def remember_breaks(session: Session, report: ChainReport) -> None:
    if not report.breaks:
        return
    try:
        if record_new(session, report, FULL):
            session.commit()
    except IntegrityError:
        session.rollback()


@router.post(
    "/chain/breaks/{break_id}/acknowledge", dependencies=[Depends(admin)], summary="Acknowledge an audit chain break"
)
def acknowledge(break_id: int, body: AcknowledgeBreak, session: SessionDep) -> ChainBreakRecord:
    found = session.get(AuditChainBreak, break_id)
    if found is None:
        raise NotFoundError(f"No audit chain break {break_id}")
    actor, moment = current_actor(), now()
    unacknowledged = (AuditChainBreak.id == break_id, AuditChainBreak.acknowledged_at.is_(None))
    values = {"acknowledged_at": moment, "acknowledged_by": actor, "note": body.note}
    result = session.execute(update(AuditChainBreak).where(*unacknowledged).values(**values))
    if not getattr(result, "rowcount", 0):
        session.rollback()
        raise ConflictError(f"The break at seq {found.seq} is already acknowledged")
    detail = {"break_id": found.id, "seq": found.seq, "reason": found.reason, "note": body.note}
    session.add(AuditEvent(actor=actor, action=ACKNOWLEDGE_ACTION, target="audit_events", detail=detail))
    session.commit()
    session.refresh(found)
    return break_records(session, [found])[0]


@router.get("/{event_id}", dependencies=[Depends(admin)], summary="Read an audit event")
def event(event_id: int, session: SessionDep) -> AuditInfo:
    found = session.get(AuditEvent, event_id)
    if found is None:
        raise NotFoundError(f"No audit event {event_id}")
    info = described(session, [found])[0]
    record_view(session)
    return info
