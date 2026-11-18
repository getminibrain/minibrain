import threading
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field

import duckdb

RunKey = tuple[str, str]


class QueryCancelled(Exception):
    def __init__(self) -> None:
        super().__init__("a newer run replaced this query, or it was cancelled")


@dataclass(eq=False)
class Run:
    key: RunKey
    cancelled: bool = False
    connections: set[duckdb.DuckDBPyConnection] = field(default_factory=set)


LOCK = threading.Lock()
RUNS: dict[RunKey, Run] = {}
CURRENT: ContextVar[Run | None] = ContextVar("query_run", default=None)


def stop(run: Run) -> None:
    with LOCK:
        run.cancelled = True
        connections = list(run.connections)
    for connection in connections:
        connection.interrupt()


@contextmanager
def running(owner: str, name: str | None) -> Iterator[None]:
    if name is None:
        yield
        return
    run = Run((owner, name))
    with LOCK:
        previous = RUNS.get(run.key)
        RUNS[run.key] = run
    if previous is not None:
        stop(previous)
    token = CURRENT.set(run)
    try:
        yield
    finally:
        CURRENT.reset(token)
        with LOCK:
            if RUNS.get(run.key) is run:
                del RUNS[run.key]


def cancel(owner: str, name: str) -> bool:
    with LOCK:
        found = RUNS.get((owner, name))
    if found is not None:
        stop(found)
    return found is not None


def cancelled() -> bool:
    run = CURRENT.get()
    return run is not None and run.cancelled


@contextmanager
def watched(connection: duckdb.DuckDBPyConnection) -> Iterator[None]:
    run = CURRENT.get()
    if run is None:
        yield
        return
    with LOCK:
        if run.cancelled:
            raise QueryCancelled
        run.connections.add(connection)
    try:
        yield
    finally:
        with LOCK:
            run.connections.discard(connection)
