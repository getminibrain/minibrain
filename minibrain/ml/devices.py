import os
import platform
from collections.abc import Mapping

import torch

from minibrain.models.gpus import granted_budget

TRAIN_DEVICE_ENV = "MINIBRAIN_TRAIN_DEVICE"


def kind_of(device: str) -> str:
    return device.split(":", 1)[0]


def xpu_available() -> bool:
    xpu = getattr(torch, "xpu", None)
    return bool(xpu is not None and xpu.is_available())


def pick_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if xpu_available():
        return "xpu"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def forced_training_device() -> str | None:
    return os.environ.get(TRAIN_DEVICE_ENV) or None


def training_device() -> str:
    return forced_training_device() or pick_device()


def half_dtype(device: str) -> torch.dtype | None:
    kind = kind_of(device)
    if kind == "cuda":
        return torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    if kind == "xpu":
        return torch.bfloat16 if torch.xpu.is_bf16_supported() else torch.float16
    return None


def weights_dtype(device: str) -> torch.dtype:
    return half_dtype(device) or torch.float32


def device_name(device: str) -> str:
    kind = kind_of(device)
    if kind == "cuda" and torch.cuda.is_available():
        return torch.cuda.get_device_name(torch.device(device))
    if kind == "xpu" and xpu_available():
        return torch.xpu.get_device_name(torch.device(device))
    if kind == "mps":
        return f"Apple GPU ({platform.machine()})"
    return platform.processor() or platform.machine() or "CPU"


def cap_to_grant(environ: Mapping[str, str] = os.environ) -> float | None:
    budget = granted_budget(environ)
    if budget is None or not torch.cuda.is_available():
        return None
    share = min(1.0, budget / torch.cuda.get_device_properties(0).total_memory)
    torch.cuda.set_per_process_memory_fraction(share, 0)
    return share
