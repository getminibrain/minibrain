import math
import os
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from typing import Any

from minibrain.ml.planner import gigabytes
from minibrain.models.hardware import GIB, NodeReport, needed_bytes

SHARED_KINDS = frozenset({"cuda"})
USABLE_SHARE = 0.9
KV_FLOOR = 2 * GIB
KV_SHARE = 0.25
VISIBLE_DEVICES = "CUDA_VISIBLE_DEVICES"
FRACTION_ENV = "MINIBRAIN_GPU_FRACTION"
CEILING_ENV = "MINIBRAIN_GPU_CEILING"
BUDGET_ENV = "MINIBRAIN_GPU_BYTES"
GRANT_NODE = "node"


class NoGpuError(RuntimeError):
    pass


@dataclass(frozen=True)
class Hold:
    holder: str
    device: int
    bytes: int


@dataclass(frozen=True)
class Grant:
    device: int
    bytes: int
    total_bytes: int
    beside_bytes: int = 0

    @property
    def fraction(self) -> float:
        return share_of(self.bytes, self.total_bytes)

    @property
    def ceiling(self) -> float:
        return share_of(self.beside_bytes + self.bytes, self.total_bytes)

    def hold(self, holder: str) -> Hold:
        return Hold(holder, self.device, self.bytes)

    def visible(self, environ: Mapping[str, str]) -> dict[str, str]:
        return {VISIBLE_DEVICES: visible_device(self.device, environ)}

    def engine_env(self, environ: Mapping[str, str]) -> dict[str, str]:
        shares = {FRACTION_ENV: f"{self.fraction:.2f}", CEILING_ENV: f"{self.ceiling:.2f}"}
        return self.visible(environ) | shares

    def job_env(self, environ: Mapping[str, str]) -> dict[str, str]:
        return self.visible(environ) | {BUDGET_ENV: str(self.bytes)}

    def as_dict(self) -> dict[str, int]:
        return asdict(self)

    @staticmethod
    def from_dict(data: Mapping[str, Any]) -> "Grant":
        return Grant(
            int(data["device"]), int(data["bytes"]), int(data["total_bytes"]), int(data.get("beside_bytes") or 0)
        )


def share_of(amount: int, total: int) -> float:
    return min(0.99, max(0.01, math.floor(amount * 100 / total) / 100)) if total > 0 else 0.01


def visible_device(index: int, environ: Mapping[str, str]) -> str:
    given = [part.strip() for part in environ.get(VISIBLE_DEVICES, "").split(",") if part.strip()]
    return given[index] if index < len(given) else str(index)


def shared(report: NodeReport) -> bool:
    return report.accelerator in SHARED_KINDS and bool(report.gpus)


def serving_bytes(weights: int) -> int:
    return needed_bytes(weights) + max(KV_FLOOR, int(weights * KV_SHARE))


def usable(total: int) -> int:
    return int(total * USABLE_SHARE)


def largest_usable(report: NodeReport) -> int:
    return max((usable(gpu.memory_bytes) for gpu in report.gpus), default=0)


def taken_bytes(report: NodeReport, holds: list[Hold]) -> list[int]:
    taken = [0] * len(report.gpus)
    for hold in holds:
        if 0 <= hold.device < len(taken):
            taken[hold.device] += hold.bytes
    return taken


def room_bytes(report: NodeReport, holds: list[Hold]) -> list[int]:
    taken = taken_bytes(report, holds)
    return [usable(gpu.memory_bytes) - taken[index] for index, gpu in enumerate(report.gpus)]


def device_for(taken: list[int], room: list[int], least: int) -> int | None:
    fitting = [index for index, free in enumerate(room) if free >= least]
    if not fitting:
        return None
    idle = [index for index in fitting if taken[index] == 0]
    return idle[0] if idle else max(fitting, key=lambda index: (room[index], -index))


def choose(report: NodeReport, holds: list[Hold], least: int) -> Grant | None:
    taken = taken_bytes(report, holds)
    room = room_bytes(report, holds)
    device = device_for(taken, room, least)
    if device is None:
        return None
    total = report.gpus[device].memory_bytes
    return Grant(device, total if taken[device] == 0 else room[device], total, taken[device])


def engine_amount(total: int, taken: int, room: int, serving: int, reserve: int, spare: bool) -> int:
    if taken > 0:
        return min(serving, room)
    whole = usable(total)
    return whole if spare or whole - reserve < serving else whole - reserve


def choose_engine(report: NodeReport, holds: list[Hold], least: int, serving: int, reserve: int) -> Grant | None:
    taken = taken_bytes(report, holds)
    room = room_bytes(report, holds)
    device = device_for(taken, room, least)
    if device is None:
        return None
    spare = any(amount == 0 for index, amount in enumerate(taken) if index != device)
    total = report.gpus[device].memory_bytes
    amount = engine_amount(total, taken[device], room[device], serving, reserve, spare)
    return Grant(device, amount, total, taken[device])


def holders_of(device: int, holds: list[Hold]) -> str:
    found = [f"{hold.holder} holds {gigabytes(hold.bytes)}" for hold in holds if hold.device == device]
    return f" ({', '.join(found)})" if found else ""


def waiting_text(what: str, least: int, report: NodeReport, holds: list[Hold]) -> str:
    room = room_bytes(report, holds)
    states = [
        f"GPU {index} has {gigabytes(max(0, free))} free{holders_of(index, holds)}" for index, free in enumerate(room)
    ]
    return f"Waiting for a GPU on {report.host} with {gigabytes(least)} free for {what}: {'; '.join(states)}."


def granted_budget(environ: Mapping[str, str] = os.environ) -> int | None:
    found = environ.get(BUDGET_ENV)
    return int(found) if found and found.isdigit() else None


def memory_flags(flag: str, env_name: str, environ: Mapping[str, str] = os.environ) -> list[str]:
    found = environ.get(env_name)
    return [flag, found] if found else []


def ran_granted(environ: Mapping[str, str] = os.environ) -> bool:
    return FRACTION_ENV in environ
