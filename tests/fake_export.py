import hashlib
import json
import os
import sys
from pathlib import Path

from minibrain.ml.context import emit

if __name__ == "__main__":
    spec = json.loads(Path(sys.argv[1]).read_text())
    emit("export.load", "loading", progress=0.1)
    if os.environ.get("FAKE_EXPORT_FAIL"):
        emit("job.error", "out of memory while merging", "error", retryable=False)
        sys.exit(2)
    if not (Path(spec["adapter"]) / "adapter_config.json").is_file():
        sys.exit(3)
    out = Path(spec["out"])
    out.mkdir(parents=True)
    (out / "config.json").write_text('{"model_type": "qwen3"}')
    (out / "model.safetensors").write_bytes(b"weights of " + spec["slug"].encode())
    files = [
        {"path": path.name, "size": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        for path in sorted(out.iterdir())
    ]
    (out / "SHA256SUMS").write_text("".join(f"{item['sha256']}  {item['path']}\n" for item in files))
    Path(spec["result"]).write_text(json.dumps({"files": files, "size": sum(item["size"] for item in files)}))
