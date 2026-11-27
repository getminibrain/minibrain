---
title: Installer
description: Install the latest minibrain release, or its Docker image, with one command that checks the download.
sidebar:
  order: 1
---

The installer is a shell script that installs a minibrain release from GitHub Releases with uv, or pulls the Docker
image instead. Use it for the quickest native install on Linux or macOS.
`https://getminibrain.com/install.sh` serves [`install.sh`](https://github.com/getminibrain/minibrain/blob/main/install.sh)
from the `main` branch on GitHub.

## Run it

```sh
curl -LsSf https://getminibrain.com/install.sh | sh
minibrain serve
```

`minibrain serve` prints a one-time setup link: open it to create the admin account ([First admin](first-admin.md)).
The UI is then at http://127.0.0.1:8000.

If the terminal answers `minibrain: command not found`, open a new terminal or run the start command the
installer printed: it puts minibrain on the `PATH` of new terminals.

It runs on Linux (x86_64 or arm64, with glibc) and macOS on Apple silicon. Elsewhere:

- Windows: run it in WSL, or use Docker Desktop.
- Intel Macs: PyTorch has no builds for them, so use `--docker`.
- Alpine and other musl distributions: PyTorch has no builds for them, so use Docker or a glibc distribution.

## What it does

1. Installs uv with uv's own installer if it is missing. `--no-install-uv` stops with instructions instead.
2. Downloads `SHA256SUMS` and the wheel of the latest release. With [cosign](https://docs.sigstore.dev/cosign/system_config/installation/)
   installed, it first checks the signature on `SHA256SUMS`; it always checks the wheel's SHA-256.
3. Runs `uv tool install --python 3.12` on the wheel. On Linux it sets `UV_TORCH_BACKEND=auto` unless you set it:
   the CUDA build of PyTorch when an NVIDIA driver is installed, otherwise the smaller CPU build. macOS gets the Metal
   build.
4. Prints the command that starts it. If uv's tool folder (`~/.local/bin`) is not on your `PATH` yet, it runs
   `uv tool update-shell` so new terminals find `minibrain`, and prints the full path to use in this one.
   `--no-modify-path` leaves your shell startup files alone.

## Options

Flags go after `sh -s --`; environment variables go before `sh`:

```sh
curl -LsSf https://getminibrain.com/install.sh | sh -s -- --docker
curl -LsSf https://getminibrain.com/install.sh | MINIBRAIN_VERSION=0.1.2 sh
```

| Option | Does |
|---|---|
| `--version 0.1.2`, `MINIBRAIN_VERSION=0.1.2` | Installs that release instead of the latest |
| `--docker` | Pulls the Docker image instead of installing the package (below) |
| `--cpu`, `--cuda` | Chooses the image `--docker` pulls |
| `--no-install-uv` | Stops with instructions when uv is missing |
| `--no-modify-path`, `MINIBRAIN_NO_MODIFY_PATH=1` | Leaves shell startup files alone instead of putting minibrain on `PATH` |
| `MINIBRAIN_RELEASE_BASE=<url>` | Takes the files from a folder that holds one release, such as a mirror or `file:///path`, instead of GitHub |
| `MINIBRAIN_IMAGE=<repository>` | Pulls the `--docker` image from a mirror |
| `UV_TORCH_BACKEND` | Another PyTorch build ([GPUs](gpus.md)) |
| `--help` | Prints the options |

## Pull the Docker image

With `--docker`, the installer checks that Docker is running, pulls the CUDA image when `nvidia-smi` sees a GPU and
the CPU image otherwise, and checks the image's signature when cosign is installed. It then prints the `docker run`
command to start it. Docker on macOS has no GPU access, so `--cuda` stops there. Running the image:
[Docker](docker.md).

## Read it before it runs

Download the script, read it, then run it with `sh`:

```sh
curl -LsSfO https://getminibrain.com/install.sh
sh install.sh --help
sh install.sh
```

Each release also carries the `install.sh` it was made with, signed like its other files
([Verify a release](verify-release.md)):

```sh
curl -LsSf https://github.com/getminibrain/minibrain/releases/download/v0.1.2/install.sh | MINIBRAIN_VERSION=0.1.2 sh
```

## Upgrade or remove

Run the installer again to upgrade; `MINIBRAIN_VERSION` pins a release. Read the release notes and back up first:
[Upgrades](upgrades.md).

To remove minibrain, run `uv tool uninstall minibrain`. Your data stays in `~/.minibrain`
([Where data lives](data-folder.md)).
