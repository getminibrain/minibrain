import hashlib
from pathlib import Path
from typing import Any

from peft import PeftModel
from transformers import GenerationConfig, PreTrainedModel

from minibrain.artifacts import CHUNK
from minibrain.base_models import BaseModelSpec
from minibrain.ml.context import FinalError, JobSpec, emit, run_child, write_result
from minibrain.ml.devices import cap_to_grant, device_name, training_device, weights_dtype
from minibrain.ml.runtime import load_base_model, load_tokenizer

CHECKSUMS = "SHA256SUMS"
SHARD_SIZE = "5GB"


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def listed(folder: Path) -> list[dict[str, Any]]:
    files = sorted(path for path in folder.rglob("*") if path.is_file() and path.name != CHECKSUMS)
    return [
        {"path": str(path.relative_to(folder)), "size": path.stat().st_size, "sha256": file_hash(path)}
        for path in files
    ]


def write_checksums(folder: Path, files: list[dict[str, Any]]) -> None:
    (folder / CHECKSUMS).write_text("".join(f"{item['sha256']}  {item['path']}\n" for item in files))


def merged(spec: BaseModelSpec, adapter: Path, device: str) -> PreTrainedModel:
    base = load_base_model(spec, device)
    wrapped = PeftModel.from_pretrained(base, str(adapter))
    model = wrapped.merge_and_unload()
    if not isinstance(model, PreTrainedModel):
        raise FinalError(f"merging gave {type(model).__name__}, not a model")
    return model


def generation_config(spec: BaseModelSpec, model: PreTrainedModel) -> GenerationConfig | None:
    source, revision = spec.source()
    try:
        return GenerationConfig.from_pretrained(source, revision=revision or "main")
    except OSError:
        return model.generation_config


def main(spec: JobSpec) -> None:
    base = spec.base
    adapter = spec.path("adapter")
    out = spec.path("out")
    device = training_device()
    precision = str(weights_dtype(device)).removeprefix("torch.")
    emit("export.load", f"Loading {base.repo or base.key} in {precision} on {device}", progress=0.05)
    model = merged(base, adapter, device)
    emit("export.merge", "Merged the adapter into the base weights", progress=0.5)
    model.save_pretrained(str(out), safe_serialization=True, max_shard_size=SHARD_SIZE)
    load_tokenizer(base).save_pretrained(str(out))
    found = generation_config(base, model)
    if found is not None:
        found.save_pretrained(str(out))
    emit("export.save", "Saved safetensors, the tokenizer and the generation config", progress=0.8)
    files = listed(out)
    write_checksums(out, files)
    size = sum(int(item["size"]) for item in files)
    write_result(
        spec,
        {"files": files, "size": size, "device": device, "device_name": device_name(device), "precision": precision},
    )
    emit("export.done", f"Hashed {len(files)} files with SHA-256; packing for upload", progress=0.9)


if __name__ == "__main__":
    cap_to_grant()
    run_child(main)
