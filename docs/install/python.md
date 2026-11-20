---
title: Python and uv
description: Install minibrain from PyPI or a release wheel with uv, uvx or pip, and start it.
sidebar:
  order: 2
---

minibrain is the `minibrain` package on [PyPI](https://pypi.org/project/minibrain/), for Python 3.12 or 3.13, with the
web UI inside. Running it needs no Node. The commands below use Python 3.12, which the Docker image runs too.

## Try it with uvx

```sh
uvx --python 3.12 minibrain serve
```

Nothing is installed: uvx keeps the environment in its cache, so later starts are fast. On the first start it prints a
one-time setup link and opens it in the browser; create the admin account there ([First admin](first-admin.md)).
Later, open http://127.0.0.1:8000 and sign in.

## Install with uv

```sh
uv tool install --python 3.12 minibrain
minibrain serve
```

This keeps a `minibrain` command on your `PATH`. Upgrade it with `uv tool upgrade minibrain`.

## Install with pip

Use a virtual environment. On Linux and macOS:

```sh
python3.12 -m venv ~/.venvs/minibrain
. ~/.venvs/minibrain/bin/activate
pip install minibrain
minibrain serve
```

On Windows, in PowerShell:

```powershell
py -3.12 -m venv $HOME\.venvs\minibrain
& $HOME\.venvs\minibrain\Scripts\Activate.ps1
pip install minibrain
minibrain serve
```

Native Windows has not been tested yet and gets the CPU build of PyTorch. WSL and Docker Desktop are the other routes.

## Choose the PyTorch build

A plain install takes PyTorch from PyPI: on Linux that is the CUDA build, about 3 GB, which also runs on CPU. For AMD,
Intel, CPU-only or a specific CUDA version, set `UV_TORCH_BACKEND` or install torch first: [GPUs](gpus.md).

## Add extras

| Extra | Adds |
|---|---|
| `postgres` | psycopg, to keep metadata in Postgres with `MINIBRAIN_DATABASE_URL` ([Configuration](configuration.md)) |
| `mlx` | The MLX engine (`mlx-lm`), Apple silicon only |
| `llamacpp` | The llama.cpp engine, for GGUF models |
| `qlora` | bitsandbytes, for QLoRA and 8-bit optimisers on CUDA, ROCm and Intel GPUs (Linux and Windows) |

```sh
uvx --python 3.12 --from 'minibrain[postgres]' minibrain serve
uv tool install --python 3.12 'minibrain[postgres,llamacpp]'
pip install 'minibrain[postgres]'
```

## Install the DuckDB extensions

Postgres, S3, Iceberg and Delta Lake sources read through DuckDB extensions, which the wheel leaves out: one set is
tens of MB per platform and DuckDB release. minibrain never downloads them while it runs, so install the default set
once, from extensions.duckdb.org, before you add such a source:

```sh
minibrain extensions install
minibrain extensions
```

The network policy must allow extensions.duckdb.org. On a server without internet access:
[Air-gapped installs](air-gapped.md#carry-the-duckdb-extensions). The Docker image already has them.

## Install a release wheel

Each [GitHub Release](https://github.com/getminibrain/minibrain/releases) carries the wheel, with the web UI inside,
and an sdist. Take the wheel's URL from the release page and use one of these:

```sh
WHEEL=https://github.com/getminibrain/minibrain/releases/download/v0.1.2/minibrain-0.1.2-py3-none-any.whl
uv tool install --python 3.12 "$WHEEL"
pipx install --python python3.12 "$WHEEL"
pip install "$WHEEL"
uvx --python 3.12 --from "$WHEEL" minibrain serve
```

With extras, name the package before the URL: `"minibrain[postgres] @ $WHEEL"` (uv and pip). To check the download
against the release's checksums first, then install the local file the same way:

```sh
curl -fsSLO "$WHEEL"
curl -fsSLO https://github.com/getminibrain/minibrain/releases/download/v0.1.2/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
```

On macOS, use `shasum -a 256 --check --ignore-missing SHA256SUMS`. To check that the release itself came from
minibrain's release workflow: [Verify a release](verify-release.md).

## Start options

`minibrain serve` runs everything on one machine: the UI, the API, the `/v1` gateway, a job worker and the engines.

| Flag | Does |
|---|---|
| `--host`, `--port` | The address to listen on, `127.0.0.1` and `8000` by default |
| `--no-browser` | Does not open the setup link in a browser on the first start |

It keeps its data in `~/.minibrain`, or the folder `MINIBRAIN_HOME` names ([Where data lives](data-folder.md)).
Before you listen on another address than loopback, read [Network and ports](../security/network.md).
