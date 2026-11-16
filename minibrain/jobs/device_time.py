from typing import Any

SECONDS_PER_HOUR = 3600.0
CPU = "cpu"
GPU = "gpu"


def device_kind(device: str) -> str:
    return CPU if device.split(":", 1)[0] == CPU else GPU


def device_time(summary: dict[str, Any], seconds: float) -> dict[str, Any]:
    device = str(summary.get("device") or CPU)
    devices = max(1, int(summary.get("devices") or 1))
    return {
        "kind": device_kind(device),
        "devices": devices,
        "seconds": round(seconds, 1),
        "hours": round(seconds * devices / SECONDS_PER_HOUR, 4),
    }
