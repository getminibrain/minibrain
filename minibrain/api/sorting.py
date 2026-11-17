import base64
import binascii
import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from fastapi import HTTPException
from sqlalchemy import (
    ColumnElement,
    DateTime,
    Float,
    Select,
    SQLColumnExpression,
    String,
    TypeDecorator,
    and_,
    literal,
    or_,
)
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.sql import coercions, roles
from sqlalchemy.sql.compiler import SQLCompiler
from sqlalchemy.sql.functions import FunctionElement
from sqlalchemy.types import TypeEngine

Order = Literal["asc", "desc"]
CURSOR_PATTERN = r"^[A-Za-z0-9_-]{1,2048}$"
BAD_CURSOR = "This cursor does not belong to this list and order; start again from the first page."


class SecondsBetween(FunctionElement[float]):
    type = Float()
    inherit_cache = True


@compiles(SecondsBetween)
def sqlite_seconds(element: SecondsBetween, compiler: SQLCompiler, **kw: Any) -> str:
    start, end = (compiler.process(argument, **kw) for argument in element.clauses)
    return f"ROUND((julianday({end}) - julianday({start})) * 86400.0, 3)"


@compiles(SecondsBetween, "postgresql")
def postgres_seconds(element: SecondsBetween, compiler: SQLCompiler, **kw: Any) -> str:
    start, end = (compiler.process(argument, **kw) for argument in element.clauses)
    return f"ROUND(CAST(EXTRACT(EPOCH FROM ({end} - {start})) AS NUMERIC), 3)"


class PoolOfNode(FunctionElement[str]):
    type = String()
    inherit_cache = True


@compiles(PoolOfNode)
def sqlite_pool(element: PoolOfNode, compiler: SQLCompiler, **kw: Any) -> str:
    node = compiler.process(next(iter(element.clauses)), **kw)
    return f"substr({node}, 1, instr({node}, '/') - 1)"


@compiles(PoolOfNode, "postgresql")
def postgres_pool(element: PoolOfNode, compiler: SQLCompiler, **kw: Any) -> str:
    node = compiler.process(next(iter(element.clauses)), **kw)
    return f"split_part({node}, '/', 1)"


def pool_of_node(node: SQLColumnExpression[Any]) -> PoolOfNode:
    return PoolOfNode(node)


def seconds_between(start: SQLColumnExpression[Any], end: SQLColumnExpression[Any]) -> SecondsBetween:
    return SecondsBetween(start, end)


def bad_cursor() -> HTTPException:
    return HTTPException(status_code=422, detail=BAD_CURSOR)


def type_of(column: SQLColumnExpression[Any]) -> TypeEngine[Any]:
    found = coercions.expect(roles.ExpressionElementRole, column).type
    return found.impl_instance if isinstance(found, TypeDecorator) else found


def expected_type(column: SQLColumnExpression[Any]) -> type:
    kind = type_of(column)
    if isinstance(kind, DateTime):
        return datetime
    try:
        return kind.python_type
    except NotImplementedError:
        return str


def bound(column: SQLColumnExpression[Any], value: Any) -> ColumnElement[Any]:
    return literal(value, coercions.expect(roles.ExpressionElementRole, column).type)


def plain(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime) else value


def parsed(value: Any, kind: type) -> Any:
    if kind is datetime and isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError as error:
            raise bad_cursor() from error
    if kind is float and isinstance(value, int | float) and not isinstance(value, bool):
        return float(value)
    if kind is int and isinstance(value, int) and not isinstance(value, bool):
        return value
    if kind is str and isinstance(value, str):
        return value
    raise bad_cursor()


def raw_values(cursor: str) -> list[Any]:
    try:
        values = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
    except (binascii.Error, UnicodeDecodeError, ValueError) as error:
        raise bad_cursor() from error
    if not isinstance(values, list):
        raise bad_cursor()
    return values


Anchors = tuple[datetime | None, ...]


def anchor_value(value: Any) -> datetime | None:
    return None if value is None else parsed(value, datetime)


def cursor_anchors(cursor: str | None, count: int) -> Anchors | None:
    if cursor is None:
        return None
    values = raw_values(cursor)
    if len(values) < count:
        raise bad_cursor()
    return tuple(anchor_value(value) for value in values[:count])


@dataclass(frozen=True)
class Keyset:
    columns: tuple[SQLColumnExpression[Any], ...]
    descending: bool
    anchors: Anchors = ()

    def order_by(self, reverse: bool = False) -> list[SQLColumnExpression[Any]]:
        down = self.descending != reverse
        return [column.desc() if down else column.asc() for column in self.columns]

    def beyond(self, values: Sequence[Any], reverse: bool = False) -> ColumnElement[bool]:
        down = self.descending != reverse
        pairs = list(zip(self.columns, values, strict=True))
        last_column, last_value = pairs[-1]
        last = bound(last_column, last_value)
        clause: ColumnElement[bool] = last_column < last if down else last_column > last
        for column, value in reversed(pairs[:-1]):
            edge = bound(column, value)
            past = column < edge if down else column > edge
            clause = or_(past, and_(column == edge, clause))
        return clause

    def encode(self, values: Sequence[Any]) -> str:
        text = json.dumps([plain(value) for value in [*self.anchors, *values]], separators=(",", ":"))
        return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")

    def decode(self, cursor: str) -> list[Any]:
        values = raw_values(cursor)
        pinned = len(self.anchors)
        if cursor_anchors(cursor, pinned) != self.anchors:
            raise bad_cursor()
        values = values[pinned:]
        if len(values) != len(self.columns):
            raise bad_cursor()
        return [parsed(value, expected_type(column)) for value, column in zip(values, self.columns, strict=True)]


@dataclass(frozen=True)
class KeysetPage:
    rows: list[Any]
    first: list[Any] | None
    last: list[Any] | None
    more: bool


def keyset_rows(
    session: Session,
    query: Select[*tuple[Any, ...]],
    keyset: Keyset,
    cursor: str | None,
    size: int,
    reverse: bool = False,
) -> KeysetPage:
    width = len(keyset.columns)
    if cursor is not None:
        query = query.where(keyset.beyond(keyset.decode(cursor), reverse))
    query = query.add_columns(*keyset.columns).order_by(*keyset.order_by(reverse)).limit(size + 1)
    found = list(session.execute(query))
    shown = found[:size]
    if reverse:
        shown.reverse()
    keys = [list(row[-width:]) for row in shown]
    return KeysetPage(
        rows=[row[:-width] for row in shown],
        first=keys[0] if keys else None,
        last=keys[-1] if keys else None,
        more=len(found) > size,
    )
