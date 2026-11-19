import os
import threading
import time
from collections.abc import Hashable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import lru_cache

import duckdb
import psutil

RunKey = tuple[str, str]

PREVIEW_MEMORY_SHARE = 0.25
PREVIEW_THREAD_SHARE = 0.5
PREVIEW_SLOTS = 2
PREVIEW_WAIT_SECONDS = 5.0


class QueryCancelled(Exception):
    def __init__(self) -> None:
        super().__init__("a newer run replaced this query, or it was cancelled")


class PreviewsBusy(Exception):
    def __init__(self) -> None:
        super().__init__("Previews are busy. Press Run to try again.")


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
FREED = threading.Condition(LOCK)
RUNS: dict[RunKey, Run] = {}
SLOTS: dict[Hashable, int] = {}
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
    with FREED:
        run.cancelled = True
        connections = list(run.connections)
        FREED.notify_all()
    for connection in connections:
        connection.interrupt()


def group_of(name: str) -> str:
    return name.rsplit(".", 1)[0]


def slot_of(owner: str, name: str | None) -> Hashable:
    return (owner, group_of(name)) if name is not None else object()


def free_slot(slot: Hashable) -> bool:
    return slot in SLOTS or len(SLOTS) < PREVIEW_SLOTS


@contextmanager
def held(slot: Hashable) -> Iterator[None]:
    deadline = time.monotonic() + PREVIEW_WAIT_SECONDS
    with FREED:
        while not free_slot(slot):
            if cancelled():
                raise QueryCancelled
            left = deadline - time.monotonic()
            if left <= 0:
                raise PreviewsBusy
            FREED.wait(left)
        SLOTS[slot] = SLOTS.get(slot, 0) + 1
    try:
        yield
    finally:
        with FREED:
            SLOTS[slot] -= 1
            if not SLOTS[slot]:
                del SLOTS[slot]
            FREED.notify_all()


@contextmanager
def registered(owner: str, name: str | None) -> Iterator[None]:
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


@contextmanager
def running(owner: str, name: str | None) -> Iterator[None]:
    token = PREVIEWING.set(True)
    try:
        with registered(owner, name), held(slot_of(owner, name)):
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
