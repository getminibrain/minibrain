import resource
import sys
from dataclasses import dataclass
from typing import Any

import torch
from transformers import AutoModelForCausalLM, BitsAndBytesConfig, PreTrainedModel

from minibrain.base_models import BaseModelSpec
from minibrain.ml.context import FinalError, JobSpec
from minibrain.ml.devices import device_name, half_dtype, kind_of
from minibrain.ml.examples import Encoded, longest, truncated
from minibrain.ml.planner import (
    PINNED,
    QLORA,
    Base,
    Machine,
    Plan,
    Settings,
    plan_machine,
    seq_len_for,
    settings_of,
)
from minibrain.ml.runtime import load_base_model
from minibrain.models.gpus import granted_budget
from minibrain.models.hardware import ram_bytes
from minibrain.versions import installed_versions

PLAN_BASE = "plan_base"


def device_memory(device: str) -> int | None:
    found = whole_device_memory(device)
    budget = granted_budget()
    return found if found is None or budget is None else min(found, budget)


def whole_device_memory(device: str) -> int | None:
    kind = kind_of(device)
    if kind == "cuda" and torch.cuda.is_available():
        return int(torch.cuda.get_device_properties(torch.device(device)).total_memory)
    if kind == "xpu" and hasattr(torch, "xpu") and torch.xpu.is_available():
        return int(torch.xpu.get_device_properties(torch.device(device)).total_memory)
    if kind == "mps" and hasattr(torch.mps, "recommended_max_memory"):
        return int(torch.mps.recommended_max_memory())
    return None


def machine_kind(device: str) -> str:
    kind = kind_of(device)
    if kind == "cuda" and getattr(torch.version, "hip", None):
        return "rocm"
    return kind


def machine_here(device: str) -> Machine:
    return Machine(
        device_name(device), machine_kind(device), device_memory(device), ram_bytes(), frozenset(installed_versions())
    )


def base_of(spec: JobSpec) -> Base:
    found = spec.raw.get(PLAN_BASE)
    if found:
        return Base.from_dict(found)
    return Base.of(spec.base.key, None, None, None, None)


def fit_here(base: Base, machine: Machine, recipe: dict[str, Any], encoded: list[Encoded]) -> tuple[Plan, bool]:
    tokens = longest(encoded)
    rows = len(encoded)
    stored = settings_of(recipe, PINNED if recipe.get("strategy") else ())
    first = plan_machine(base, machine, stored, seq_len_for(base, stored, tokens), rows)
    if first.chosen is not None:
        return first, False
    loose = settings_of(recipe, ())
    return plan_machine(base, machine, loose, seq_len_for(base, loose, tokens), rows), True


def fitted_recipe(spec: JobSpec, recipe: dict[str, Any], encoded: list[Encoded], device: str) -> dict[str, Any]:
    machine = machine_here(device)
    found, replanned = fit_here(base_of(spec), machine, recipe, encoded)
    if found.chosen is None:
        raise FinalError(found.refusal or f"{spec.base.key} does not fit for training on {machine.place}")
    planned = found.recipe()
    planned["overrides"] = list(recipe.get("overrides") or [])
    return (
        recipe
        | planned
        | {
            "longest_tokens": longest(encoded),
            "truncated": truncated(encoded, found.seq_len),
            "replanned": replanned,
        }
    )


def compute_dtype(device: str) -> torch.dtype:
    return half_dtype(device) or torch.bfloat16


def quantization_config(recipe: dict[str, Any], device: str) -> BitsAndBytesConfig | None:
    if recipe.get("strategy") != QLORA:
        return None
    return BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=compute_dtype(device),
    )


def load_training_model(spec: BaseModelSpec, device: str, recipe: dict[str, Any]) -> PreTrainedModel:
    quantized = quantization_config(recipe, device)
    if quantized is None:
        return load_base_model(spec, device)
    source, revision = spec.source()
    return AutoModelForCausalLM.from_pretrained(
        source, revision=revision, quantization_config=quantized, dtype=compute_dtype(device), device_map=device
    )


@dataclass(frozen=True)
class TrainerSettings:
    epochs: float
    micro_batch: int
    grad_accum: int
    learning_rate: float
    warmup: float
    scheduler: str
    weight_decay: float
    max_length: int
    checkpointing: bool
    optimizer: str


@dataclass(frozen=True)
class LoraSettings:
    rank: int
    alpha: int
    dropout: float


def trainer_settings(recipe: dict[str, Any]) -> TrainerSettings:
    return TrainerSettings(
        epochs=float(recipe["epochs"]),
        micro_batch=int(recipe["micro_batch"]),
        grad_accum=int(recipe["grad_accum"]),
        learning_rate=float(recipe["learning_rate"]),
        warmup=float(recipe.get("warmup", Settings.warmup)),
        scheduler=str(recipe.get("scheduler", Settings.scheduler)),
        weight_decay=float(recipe.get("weight_decay", Settings.weight_decay)),
        max_length=int(recipe["seq_len"]),
        checkpointing=bool(recipe.get("checkpointing")),
        optimizer=str(recipe.get("optimizer") or "adamw_torch"),
    )


def lora_settings(recipe: dict[str, Any]) -> LoraSettings:
    return LoraSettings(
        rank=int(recipe["rank"]), alpha=int(recipe["alpha"]), dropout=float(recipe.get("dropout", Settings.dropout))
    )


def peak_memory(device: str) -> int | None:
    kind = kind_of(device)
    if kind == "cuda" and torch.cuda.is_available():
        return int(torch.cuda.max_memory_reserved(torch.device(device)))
    if kind == "xpu" and hasattr(torch, "xpu") and torch.xpu.is_available():
        return int(torch.xpu.max_memory_reserved(torch.device(device)))
    if kind == "mps":
        return int(torch.mps.driver_allocated_memory())
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(usage if sys.platform == "darwin" else usage * 1024)
