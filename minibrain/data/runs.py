import os
import shutil
import tempfile
import threading
import time
from collections.abc import Hashable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import duckdb
import psutil

from minibrain.data.extensions import home

RunKey = tuple[str, str]

PREVIEW_MEMORY_SHARE = 0.25
PREVIEW_THREAD_SHARE = 0.5
PREVIEW_SLOTS = 2
RUNS_PER_PAGE = 3
PREVIEW_RUNS = PREVIEW_SLOTS * RUNS_PER_PAGE
MIN_RUN_MEMORY_MIB = 256
PREVIEW_SPILL_SHARE = 1.0
PREVIEW_WAIT_SECONDS = 5.0
MIB = 1024 * 1024


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
    memory_mib: int
    threads: int
    spill_mib: int

    @property
    def memory(self) -> str:
        return f"{self.memory_mib}MiB"

    @property
    def spill(self) -> str:
        return f"{self.spill_mib}MiB"


LOCK = threading.Lock()
FREED = threading.Condition(LOCK)
RUNS: dict[RunKey, Run] = {}
SLOTS: dict[Hashable, int] = {}
CURRENT: ContextVar[Run | None] = ContextVar("query_run", default=None)
PREVIEWING: ContextVar[bool] = ContextVar("previewing", default=False)


def caps_for(memory_bytes: int, cores: int) -> PreviewCaps:
    memory = max(int(memory_bytes * PREVIEW_MEMORY_SHARE) // PREVIEW_RUNS // MIB, MIN_RUN_MEMORY_MIB)
    spill = max(int(memory_bytes * PREVIEW_SPILL_SHARE) // PREVIEW_RUNS // MIB, memory)
    threads = max(int(cores * PREVIEW_THREAD_SHARE) // PREVIEW_SLOTS, 1)
    return PreviewCaps(memory_mib=memory, threads=threads, spill_mib=spill)


@lru_cache(maxsize=1)
def preview_caps() -> PreviewCaps:
    return caps_for(psutil.virtual_memory().total, os.cpu_count() or 1)


def previewing() -> bool:
    return PREVIEWING.get()


def spill_root(preview: bool = True) -> Path:
    return home() / "tmp" / ("previews" if preview else "queries")


def clear_spills() -> None:
    for root in (spill_root(), spill_root(preview=False)):
        if not root.is_dir():
            continue
        for found in root.iterdir():
            owner = found.name.split("-", 1)[0]
            if not (owner.isdigit() and psutil.pid_exists(int(owner))):
                shutil.rmtree(found, ignore_errors=True)


@contextmanager
def spill_space() -> Iterator[Path | None]:
    root = spill_root(PREVIEWING.get())
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    space = Path(tempfile.mkdtemp(prefix=f"{os.getpid()}-", dir=root))
    try:
        yield space
    finally:
        shutil.rmtree(space, ignore_errors=True)


def spill_into(connection: duckdb.DuckDBPyConnection, spill: Path) -> None:
    directory = str(spill).replace("'", "''")
    connection.execute(f"SET temp_directory = '{directory}'")


def cap(connection: duckdb.DuckDBPyConnection, spill: Path | None) -> None:
    if not PREVIEWING.get():
        if spill is not None:
            spill_into(connection, spill)
        return
    caps = preview_caps()
    connection.execute(f"SET memory_limit = '{caps.memory}'")
    connection.execute(f"SET threads = {caps.threads}")
    if spill is None:
        connection.execute("SET temp_directory = ''")
        return
    spill_into(connection, spill)
    connection.execute(f"SET max_temp_directory_size = '{caps.spill}'")


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
    if slot in SLOTS:
        return SLOTS[slot] < RUNS_PER_PAGE
    return len(SLOTS) < PREVIEW_SLOTS


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
