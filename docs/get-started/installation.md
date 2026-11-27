---
title: Installation
description: The fastest ways to get minibrain running, and where to find the details for each.
sidebar:
  order: 3
---

minibrain is one Python package for Python 3.12 or 3.13, with the web UI built in. Pick one of the ways below; each
starts the whole platform on one machine at http://127.0.0.1:8000.

## Installer

On Linux (x86_64 or arm64) and macOS (Apple silicon), one command installs the latest release with uv and checks the
download:

```sh
curl -LsSf https://raw.githubusercontent.com/getminibrain/minibrain/main/install.sh | sh
minibrain serve
```

If the terminal answers `minibrain: command not found`, open a new terminal or run the start command the
installer printed: it puts minibrain on the `PATH` of new terminals.

Options, pinned versions and the Docker mode: [Installer](../install/installer.md).

## uv

Run it straight from PyPI without installing anything, or install a `minibrain` command that stays:

```sh
uvx --python 3.12 minibrain serve
```

```sh
uv tool install --python 3.12 minibrain
minibrain serve
```

Extras and release wheels: [Python and uv](../install/python.md).

## pip

In a virtual environment:

```sh
python3.12 -m venv ~/.venvs/minibrain
. ~/.venvs/minibrain/bin/activate
pip install minibrain
minibrain serve
```

On Linux, a plain install takes the CUDA build of PyTorch, about 3 GB. To pick another build for AMD, Intel or no GPU:
[GPUs](../install/gpus.md).

## Docker

The CPU image runs wherever Docker does, Docker Desktop on macOS and Windows included:

```sh
docker run --name minibrain -p 127.0.0.1:8000:8000 -v minibrain-data:/data ghcr.io/getminibrain/minibrain
```

On a Linux host with NVIDIA GPUs, the NVIDIA driver and the NVIDIA Container Toolkit, run the CUDA image:

```sh
docker run -d --name minibrain --gpus all --shm-size 8g -p 127.0.0.1:8000:8000 -v minibrain-data:/data ghcr.io/getminibrain/minibrain:cuda
```

Production flags, image tags and the compose file: [Docker](../install/docker.md) and
[Docker Compose](../install/compose.md).

## Create the admin

On its first start, minibrain prints a one-time setup link:

```text
  minibrain has no admin account yet. Create it with this one-time setup link:

    http://127.0.0.1:8000/setup?token=…
```

Open it, enter an email and a password of at least 12 characters, and click **Create admin account**. In Docker, the
link is in the container log: `docker logs minibrain | grep setup`. Lost it, or deploying without a terminal:
[First admin](../install/first-admin.md).

## Next step

Build a model on your own data and call it from Python: [Your first model](first-model.md).
