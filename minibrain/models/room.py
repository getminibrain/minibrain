from dataclasses import dataclass, replace
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from minibrain.ml.planner import QLORA, REFERENCE_SEQ, Base, Machine, Settings, plan
from minibrain.models.hardware import GIB, NodeReport, needed_bytes
from minibrain.models.train_facts import TRAINER_ROLE, catalogue_base
from minibrain.registry.models import BaseModel, CatalogModel

VLLM_NOTE = (
    " SGLang and vLLM reserve most of a GPU when they start, so measured free memory on a machine that"
    " serves with them is small."
)


@dataclass(frozen=True)
class Free:
    report: NodeReport
    roles: list[str]
    free_bytes: int
    largest_bytes: int
    measured: bool


@dataclass(frozen=True)
class Size:
    label: str
    params_b: float
    weights_bytes: int
    requires: dict[str, Any]
    base: Base


@dataclass(frozen=True)
class Room:
    serve_count: int
    serve_size: str | None
    serve_bytes: int | None
    train_size: str | None
    train_strategy: str | None
    free_bytes: int
    measured: bool
    basis: str


def size_label(params_b: float) -> str:
    if params_b >= 10:
        return f"{int(params_b)}B"
    return f"{round(params_b, 1):g}B"


def catalogue_sizes(session: Session) -> list[Size]:
    found: dict[str, Size] = {}
    for entry in session.scalars(select(CatalogModel)):
        if entry.params_b <= 0 or not entry.variants:
            continue
        variant = entry.variants[0]
        if variant.weights_bytes <= 0:
            continue
        label = size_label(entry.params_b)
        kept = found.get(label)
        if kept is None or variant.weights_bytes < kept.weights_bytes:
            base = catalogue_base(entry, variant)
            found[label] = Size(label, entry.params_b, variant.weights_bytes, dict(variant.requires), base)
    return sorted(found.values(), key=lambda size: size.params_b, reverse=True)


def runs_on(size: Size, report: NodeReport) -> bool:
    accelerator = size.requires.get("accelerator")
    if accelerator and accelerator != report.accelerator:
        return False
    return not (size.requires.get("gpus") == "multi" and len(report.gpus) < 2)


def serve_count(size: Size, machines: list[Free]) -> int:
    need = needed_bytes(size.weights_bytes)
    return sum(machine.free_bytes // need for machine in machines if runs_on(size, machine.report))


def trainer(machine: Free, pool: str) -> Machine:
    found = Machine.from_report(machine.report, pool)
    if found.device == "cpu":
        return replace(found, ram_bytes=machine.free_bytes)
    return replace(found, gpu_bytes=machine.largest_bytes)


def largest_trained(sizes: list[Size], machines: list[Free], pool: str) -> tuple[Size, str] | None:
    trainers = [trainer(machine, pool) for machine in machines if TRAINER_ROLE in machine.roles]
    if not trainers:
        return None
    for size in sizes:
        if size.base.quantized:
            continue
        chosen = plan(size.base, trainers, Settings(), REFERENCE_SEQ, Settings().max_rows).chosen
        if chosen is not None:
            return size, "QLoRA" if chosen.strategy == QLORA else "LoRA"
    return None


def gigabytes(value: int) -> str:
    return f"{value / GIB:.1f} GB"


def basis_of(machines: list[Free], served: Size | None, trained: tuple[Size, str] | None) -> str:
    free = sum(machine.free_bytes for machine in machines)
    measured = sum(1 for machine in machines if machine.measured)
    if measured == len(machines):
        source = "measured free memory"
    elif measured == 0:
        source = "free memory estimated from the weights, adapters and training plans running there"
    else:
        source = f"measured free memory on {measured} machines and estimates on the rest"
    noun = "machine" if len(machines) == 1 else "machines"
    parts = [f"From the {source} of {len(machines)} online {noun} that take work: {gigabytes(free)} free."]
    if served is not None:
        need = needed_bytes(served.weights_bytes)
        parts.append(
            f"A {served.label} model needs about {gigabytes(need)} to serve; each machine counts the copies that fit."
            " The size is the largest this pool already serves that still fits, else the largest catalogue size"
            " that fits."
        )
    if trained is not None:
        parts.append(
            f"Training is planned on the largest free GPU of each worker, one {REFERENCE_SEQ}-token row at a time."
        )
    text = " ".join(parts)
    return text + VLLM_NOTE if measured else text


def served_sizes(session: Session, bases: list[str]) -> set[str]:
    found: set[str] = set()
    for key in bases:
        model = session.get(BaseModel, key)
        entry = session.get(CatalogModel, model.catalog_id if model and model.catalog_id else key)
        if entry is not None and entry.params_b > 0:
            found.add(size_label(entry.params_b))
    return found


def reference(sizes: list[Size], machines: list[Free], running: set[str]) -> Size | None:
    fitting = [size for size in sizes if serve_count(size, machines) > 0]
    return next((size for size in fitting if size.label in running), fitting[0] if fitting else None)


def pool_room(session: Session, pool: str, machines: list[Free], bases: list[str]) -> Room | None:
    if not machines:
        return None
    sizes = catalogue_sizes(session)
    served = reference(sizes, machines, served_sizes(session, bases))
    trained = largest_trained(sizes, machines, pool)
    return Room(
        serve_count=serve_count(served, machines) if served is not None else 0,
        serve_size=served.label if served is not None else None,
        serve_bytes=needed_bytes(served.weights_bytes) if served is not None else None,
        train_size=trained[0].label if trained is not None else None,
        train_strategy=trained[1] if trained is not None else None,
        free_bytes=sum(machine.free_bytes for machine in machines),
        measured=all(machine.measured for machine in machines),
        basis=basis_of(machines, served, trained),
    )
