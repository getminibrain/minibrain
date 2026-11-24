import time
from pathlib import Path
from typing import Any

from minibrain.data.splits import read_split
from minibrain.ml.context import JobSpec, emit, run_child, write_result
from minibrain.models.transfer import Target
from minibrain.registry.models import VersionKind

ACCURACY = {VersionKind.PROMPT: 0.6, VersionKind.LORA: 0.9}
TRAIN_STEPS = 4
STEP_SECONDS = 0.2
SPLITS = ("golden", "eval")
TIMING = {"latency": {"p50_ms": 180.0, "p95_ms": 240.0}, "device": "cpu", "decoding": "constrained"}
PROMPT_TOKENS = {VersionKind.PROMPT: 240, VersionKind.LORA: 44}


def placeholder(path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as stream:
        if path.suffix == ".json" and size >= 2:
            stream.write(b"{}" + b" " * (size - 2))
        else:
            stream.truncate(size)


def download(spec: JobSpec) -> None:
    target = Target.of(spec)
    files: list[dict[str, Any]] = spec.raw["files"]
    for index, entry in enumerate(files, start=1):
        placeholder(target.out / str(entry["path"]), int(entry["size"]))
        emit("download.file", f"Wrote {entry['path']}", progress=index / len(files))
    revision = spec.raw["revision"]
    target.finish({"repo": spec.raw["repo"], "revision": revision, "files": files})
    size = sum(int(entry["size"]) for entry in files)
    write_result(spec, {"files": files, "size_bytes": size, "revision": revision})


def train(spec: JobSpec) -> None:
    for step in range(1, TRAIN_STEPS + 1):
        time.sleep(STEP_SECONDS)
        loss = round(2.0 / step, 4)
        emit("train.step", f"step {step}", progress=step / TRAIN_STEPS, step=step, steps=TRAIN_STEPS, loss=loss)
    out = spec.path("adapter_out")
    out.mkdir(parents=True, exist_ok=True)
    (out / "adapter_config.json").write_text('{"r": 16}')
    summary = {"device": "cpu", "devices": 1, "train_seconds": TRAIN_STEPS * STEP_SECONDS, "train_loss": 0.5}
    write_result(spec, {"summary": summary})
    emit("train.done", "Trained", progress=1.0)


def answers_at(rows: list[Any], labels: list[str], accuracy: float) -> list[str]:
    right = round(len(rows) * accuracy)
    wrong = (next((label for label in labels if label != row.expected), "") for row in rows)
    return [row.expected if index < right else miss for index, (row, miss) in enumerate(zip(rows, wrong, strict=True))]


def evaluate(spec: JobSpec) -> None:
    kind = VersionKind(spec.raw["version_kind"])
    splits = {name: read_split(spec.path("dataset_version"), name) for name in SPLITS}
    labels = sorted({row.expected for rows in splits.values() for row in rows})
    accuracy = ACCURACY.get(kind, ACCURACY[VersionKind.PROMPT])
    answers = {name: answers_at(rows, labels, accuracy) for name, rows in splits.items()}
    metrics = TIMING | {"prompt_tokens": PROMPT_TOKENS.get(kind, PROMPT_TOKENS[VersionKind.PROMPT])}
    write_result(spec, {"metrics": metrics, "answers": answers})
    emit("score.done", f"Answered {sum(len(rows) for rows in splits.values())} rows", progress=1.0)


def main(spec: JobSpec) -> None:
    if "adapter_out" in spec.raw:
        train(spec)
    elif "version_kind" in spec.raw:
        evaluate(spec)
    else:
        download(spec)


if __name__ == "__main__":
    run_child(main)
