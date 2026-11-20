---
title: Docker Compose
description: Run minibrain on an NVIDIA host with the compose file from the repository, and set it up with a .env file.
sidebar:
  order: 5
---

The repository's `compose.yaml` runs minibrain as one service on a Linux host with NVIDIA GPUs, from the CUDA image.
Use it when you manage the host with Docker Compose rather than a `docker run` command.

## Start it

Download the file into an empty folder, then start it:

```sh
curl -LsSfO https://raw.githubusercontent.com/getminibrain/minibrain/main/compose.yaml
docker compose up -d
docker compose logs minibrain | grep setup
```

Open the setup link from the log to create the admin account ([First admin](first-admin.md)). The UI is at
http://127.0.0.1:8000.

The host needs the same as the CUDA image: an NVIDIA driver that supports CUDA 13.2 and the NVIDIA Container Toolkit
([Docker](docker.md#run-on-nvidia-gpus)).

## What the file sets

| Setting | Value |
|---|---|
| Image | `ghcr.io/getminibrain/minibrain:cuda`, or `MINIBRAIN_IMAGE` |
| GPUs | All NVIDIA GPUs reserved for the service |
| Port | `127.0.0.1:8000`, loopback only |
| Data | The `minibrain-data` volume at `/data` |
| Model weights | `./models`, or `MINIBRAIN_MODELS_DIR`, mounted read-only at `/models` |
| Shared memory | 8 GB, for PyTorch data loading |
| Restart | `unless-stopped`, with 30 seconds to finish open requests on stop |

## Set options in .env

Put overrides in a `.env` file next to `compose.yaml`:

```sh title=".env"
MINIBRAIN_IMAGE=ghcr.io/getminibrain/minibrain:0.1.2-cuda
MINIBRAIN_MODELS_DIR=/srv/models
MINIBRAIN_DATABASE_URL=postgresql+psycopg://minibrain:password@db.internal/minibrain
```

| Variable | For |
|---|---|
| `MINIBRAIN_IMAGE` | The image, such as `ghcr.io/getminibrain/minibrain:0.1.2-cuda` to pin a release |
| `MINIBRAIN_MODELS_DIR` | The host folder mounted at `/models` |
| `MINIBRAIN_DATABASE_URL` | Metadata in Postgres instead of SQLite on the volume |
| `MINIBRAIN_OFFLINE`, `HF_HUB_OFFLINE` | `1` for an air-gapped install; both default to `0`, so models download as usual ([Air-gapped installs](air-gapped.md)) |

The file passes only these variables into the container. For any other setting from
[Configuration](configuration.md), add it under `environment:` in `compose.yaml`.

## Use model weights from a folder

Put each model's folder under `./models` (or `MINIBRAIN_MODELS_DIR`). In **Add model**, open **Base**, choose
**Your imports** › **Server folder**, and give the path inside the container, such as `/models/Qwen3-0.6B`.

## Create the admin from a secret

For a deploy without a terminal, create the admin from a password file instead of the setup link. Add this to
`compose.yaml`, with the password in `admin_password.txt` next to it:

```yaml
services:
  minibrain:
    environment:
      MINIBRAIN_ADMIN_EMAIL: admin@example.com
      MINIBRAIN_ADMIN_PASSWORD_FILE: /run/secrets/minibrain_admin_password
    secrets:
      - minibrain_admin_password

secrets:
  minibrain_admin_password:
    file: ./admin_password.txt
```

Both are read on the first start only ([First admin](first-admin.md#create-the-admin-from-the-environment)).

## Run commands

```sh
docker compose exec minibrain minibrain admin setup-link
docker compose exec minibrain minibrain extensions
```

## Build locally

The file keeps a `build:` section for building from a checkout of the repository. `docker compose up -d --build`
builds the image and tags it as `MINIBRAIN_IMAGE`, so set `MINIBRAIN_IMAGE=minibrain:cuda` with it to keep a local
build apart from the release image. Build arguments: [Docker](docker.md#build-your-own-image).

## Upgrade

```sh
docker compose pull && docker compose up -d
```

With a release pinned in `.env`, set `MINIBRAIN_IMAGE` to the new tag first. Back up before you upgrade:
[Upgrades](upgrades.md).
