import os
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import lru_cache

import duckdb
import psutil

RunKey = tuple[str, str]

PREVIEW_MEMORY_SHARE = 0.25
PREVIEW_THREAD_SHARE = 0.5


class QueryCancelled(Exception):
    def __init__(self) -> None:
        super().__init__("a newer run replaced this query, or it was cancelled")


@dataclass(eq=False)
class Run:
    key: RunKey
    cancelled: bool = False
    connections: set[duckdb.DuckDBPyConnection] = field(default_factory=set)


@dataclass(frozen=True)
class PreviewCaps:
    memory: str
    threads: int


LOCK = threading.Lock()
RUNS: dict[RunKey, Run] = {}
CURRENT: ContextVar[Run | None] = ContextVar("query_run", default=None)
PREVIEWING: ContextVar[bool] = ContextVar("previewing", default=False)


@lru_cache(maxsize=1)
def preview_caps() -> PreviewCaps:
    memory = int(psutil.virtual_memory().total * PREVIEW_MEMORY_SHARE) // (1024 * 1024)
    threads = int((os.cpu_count() or 1) * PREVIEW_THREAD_SHARE)
    return PreviewCaps(memory=f"{max(memory, 256)}MB", threads=max(threads, 1))


def cap(connection: duckdb.DuckDBPyConnection) -> None:
    if not PREVIEWING.get():
        return
    caps = preview_caps()
    connection.execute(f"SET memory_limit = '{caps.memory}'")
    connection.execute(f"SET threads = {caps.threads}")


def stop(run: Run) -> None:
    with LOCK:
        run.cancelled = True
        connections = list(run.connections)
    for connection in connections:
        connection.interrupt()


def group_of(name: str) -> str:
    return name.rsplit(".", 1)[0]


def replaced(key: RunKey, owner: str, name: str) -> bool:
    return key[0] == owner and (key[1] == name or group_of(key[1]) != group_of(name))


@contextmanager
def registered(owner: str, name: str | None) -> Iterator[None]:
    if name is None:
        yield
        return
    run = Run((owner, name))
    with LOCK:
        previous = [found for key, found in RUNS.items() if replaced(key, owner, name)]
        RUNS[run.key] = run
    for found in previous:
        stop(found)
    token = CURRENT.set(run)
    try:
        yield
    finally:
        CURRENT.reset(token)
        with LOCK:
            if RUNS.get(run.key) is run:
                del RUNS[run.key]


@contextmanager
def running(owner: str, name: str | None) -> Iterator[None]:
    token = PREVIEWING.set(True)
    try:
        with registered(owner, name):
            yield
    finally:
        PREVIEWING.reset(token)


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
