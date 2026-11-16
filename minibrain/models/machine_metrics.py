import json
import logging
import os
import shutil
import subprocess
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from minibrain.registry.models import now
from minibrain.storage import disk_space

SAMPLE_SECONDS = 15.0
USAGE_SECONDS = 300.0
MAX_DISKS = 16
TOOL_TIMEOUT = 5.0
WINDOW = timedelta(hours=1)
SPACING = timedelta(seconds=10)
FRESH = timedelta(minutes=2)
MIB = 1024**2
NVIDIA_QUERY = [
    "nvidia-smi",
    "--query-gpu=index,memory.used,memory.total,utilization.gpu",
    "--format=csv,noheader,nounits",
]
ROCM_QUERY = ["rocm-smi", "--showmeminfo", "vram", "--showuse", "--json"]
UNIFIED = ("mps", "cpu")
MAX_GPUS = 64

log = logging.getLogger("minibrain.metrics")

Run = Callable[[list[str]], str | None]
Bytes = Field(default=None, ge=0)


class GpuSample(BaseModel):
    index: int = Field(ge=0)
    memory_used_bytes: int | None = Bytes
    memory_total_bytes: int | None = Bytes
    utilization: float | None = Field(default=None, ge=0, le=100, description="Busy share in percent.")


class DiskSample(BaseModel):
    path: str = Field(max_length=4096, description="The folder minibrain keeps models and artifacts in.")
    mount: str | None = Field(default=None, max_length=4096)
    total_bytes: int | None = Bytes
    free_bytes: int | None = Bytes
    minibrain_bytes: int | None = Field(default=None, ge=0, description="What minibrain keeps in that folder.")


class MachineSample(BaseModel):
    gpus: list[GpuSample] = Field(default_factory=list, max_length=MAX_GPUS)
    ram_used_bytes: int | None = Bytes
    ram_total_bytes: int | None = Bytes
    cpu_percent: float | None = Field(default=None, ge=0, le=100)
    disks: list[DiskSample] = Field(default_factory=list, max_length=MAX_DISKS)


def run_tool(command: list[str]) -> str | None:
    if shutil.which(command[0]) is None:
        return None
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=TOOL_TIMEOUT, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout if done.returncode == 0 else None


def number(text: Any) -> float | None:
    try:
        return float(str(text).strip())
    except ValueError:
        return None


def mib(value: float | None) -> int | None:
    return int(value * MIB) if value is not None and value >= 0 else None


def percent(value: float | None) -> float | None:
    return min(100.0, value) if value is not None and value >= 0 else None


def nvidia_gpus(output: str) -> list[GpuSample]:
    found: list[GpuSample] = []
    for line in output.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) != 4:
            continue
        index, used, total, busy = (number(part) for part in parts)
        found.append(
            GpuSample(
                index=int(index) if index is not None and index >= 0 else len(found),
                memory_used_bytes=mib(used),
                memory_total_bytes=mib(total),
                utilization=percent(busy),
            )
        )
    return found[:MAX_GPUS]


def card_field(card: dict[str, Any], *words: str) -> float | None:
    for name, value in card.items():
        lowered = name.lower()
        if all(word in lowered for word in words):
            return number(value)
    return None


def rocm_gpus(output: str) -> list[GpuSample]:
    try:
        cards = json.loads(output)
    except ValueError:
        return []
    found: list[GpuSample] = []
    if not isinstance(cards, dict):
        return found
    for name, card in cards.items():
        if not str(name).startswith("card") or not isinstance(card, dict):
            continue
        total = card_field(card, "vram", "total memory")
        used = card_field(card, "vram", "used")
        index = number(str(name).removeprefix("card"))
        found.append(
            GpuSample(
                index=int(index) if index is not None and index >= 0 else len(found),
                memory_used_bytes=int(used) if used is not None and used >= 0 else None,
                memory_total_bytes=int(total) if total is not None and total >= 0 else None,
                utilization=percent(card_field(card, "gpu use")),
            )
        )
    return found[:MAX_GPUS]


def gpu_samples(run: Run) -> list[GpuSample]:
    output = run(NVIDIA_QUERY)
    if output is not None:
        return nvidia_gpus(output)
    output = run(ROCM_QUERY)
    return rocm_gpus(output) if output is not None else []


def folder_bytes(folder: Path) -> int:
    total = 0
    pending = [str(folder)]
    while pending:
        try:
            entries = os.scandir(pending.pop())
        except OSError:
            continue
        with entries:
            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        pending.append(entry.path)
                    elif entry.is_file(follow_symlinks=False):
                        total += entry.stat(follow_symlinks=False).st_size
                except OSError:
                    continue
    return total


class Sampler:
    def __init__(
        self, home: Path | None = None, run: Run = run_tool, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.home = home
        self.run = run
        self.clock = clock
        self.lock = threading.Lock()
        self.cached: MachineSample | None = None
        self.taken = float("-inf")
        self.primed = False
        self.usage: int | None = None
        self.counted = float("-inf")

    def disks(self, moment: float) -> list[DiskSample]:
        if self.home is None:
            return []
        space = disk_space(self.home)
        if space is None:
            return []
        if moment - self.counted >= USAGE_SECONDS:
            self.usage = folder_bytes(self.home) if self.home.exists() else 0
            self.counted = moment
        return [
            DiskSample(
                path=str(self.home),
                mount=space.mount,
                total_bytes=space.total,
                free_bytes=space.free,
                minibrain_bytes=self.usage,
            )
        ]

    def host(self) -> dict[str, Any]:
        try:
            import psutil
        except ImportError:
            return {}
        memory = psutil.virtual_memory()
        busy = psutil.cpu_percent(interval=None)
        primed, self.primed = self.primed, True
        return {
            "ram_total_bytes": int(memory.total),
            "ram_used_bytes": int(memory.total - memory.available),
            "cpu_percent": percent(float(busy)) if primed else None,
        }

    def sample(self) -> MachineSample:
        with self.lock:
            moment = self.clock()
            if self.cached is not None and moment - self.taken < SAMPLE_SECONDS:
                return self.cached
            self.cached = MachineSample(gpus=gpu_samples(self.run), disks=self.disks(moment), **self.host())
            self.taken = moment
            return self.cached

    def body(self) -> dict[str, Any]:
        return self.sample().model_dump()


def measured_memory(sample: MachineSample, accelerator: str) -> tuple[int, int] | None:
    gpus = [gpu for gpu in sample.gpus if gpu.memory_used_bytes is not None and gpu.memory_total_bytes]
    if gpus and len(gpus) == len(sample.gpus):
        used = sum(gpu.memory_used_bytes or 0 for gpu in gpus)
        return used, sum(gpu.memory_total_bytes or 0 for gpu in gpus)
    if accelerator in UNIFIED and sample.ram_used_bytes is not None and sample.ram_total_bytes:
        return sample.ram_used_bytes, sample.ram_total_bytes
    return None


def largest_free(sample: MachineSample, accelerator: str) -> int | None:
    gpus = [gpu for gpu in sample.gpus if gpu.memory_used_bytes is not None and gpu.memory_total_bytes]
    if gpus and len(gpus) == len(sample.gpus):
        return max(max(0, (gpu.memory_total_bytes or 0) - (gpu.memory_used_bytes or 0)) for gpu in gpus)
    found = measured_memory(sample, accelerator)
    return max(0, found[1] - found[0]) if found is not None else None


def gpu_percent(sample: MachineSample) -> float | None:
    values = [gpu.utilization for gpu in sample.gpus if gpu.utilization is not None]
    return sum(values) / len(values) if values else None


@dataclass(frozen=True)
class Point:
    at: datetime
    sample: MachineSample


class MetricsHistory:
    def __init__(self, window: timedelta = WINDOW, spacing: timedelta = SPACING) -> None:
        self.window = window
        self.spacing = spacing
        self.lock = threading.Lock()
        self.points: dict[str, deque[Point]] = {}
        self.disk_reports: dict[str, tuple[datetime, list[DiskSample]]] = {}

    def record(self, node: str, sample: MachineSample, at: datetime | None = None) -> bool:
        moment = at or now()
        with self.lock:
            if sample.disks:
                self.disk_reports[node] = (moment, sample.disks)
            found = self.points.setdefault(node, deque())
            if found and moment - found[-1].at < self.spacing:
                return False
            found.append(Point(moment, sample))
            self.prune(moment)
            return True

    def prune(self, moment: datetime) -> None:
        for node in list(self.points):
            found = self.points[node]
            while found and found[0].at < moment - self.window:
                found.popleft()
            if not found:
                del self.points[node]

    def history(self, node: str, at: datetime | None = None) -> list[Point]:
        moment = at or now()
        with self.lock:
            return [point for point in self.points.get(node, ()) if point.at >= moment - self.window]

    def latest(self, node: str, at: datetime | None = None) -> Point | None:
        moment = at or now()
        with self.lock:
            found = self.points.get(node)
            point = found[-1] if found else None
        return point if point is not None and point.at >= moment - FRESH else None

    def disks(self, node: str) -> tuple[datetime, list[DiskSample]] | None:
        with self.lock:
            return self.disk_reports.get(node)

    def forget(self, node: str) -> None:
        with self.lock:
            self.points.pop(node, None)
            self.disk_reports.pop(node, None)


def sample_forever(history: MetricsHistory, node: str, sampler: Sampler, stop: threading.Event) -> None:
    while True:
        try:
            history.record(node, sampler.sample())
        except Exception:
            log.warning("could not sample this machine's memory and load")
        if stop.wait(SAMPLE_SECONDS):
            return
