---
title: Docker
description: Run the minibrain image on any machine with Docker, and in production on Linux hosts with NVIDIA GPUs.
sidebar:
  order: 4
---

The minibrain image runs the whole platform in one container, with its data in a volume. Use the CPU image to try it
anywhere Docker runs, and the CUDA image in production on Linux with NVIDIA GPUs.

## Try the CPU image

```sh
docker run --name minibrain -p 127.0.0.1:8000:8000 -v minibrain-data:/data ghcr.io/getminibrain/minibrain
```

On its first start it prints a one-time setup link, `http://127.0.0.1:8000/setup?token=…`: open it to create the
admin account. Started in the background with `-d`, find it with `docker logs minibrain | grep setup`; lost, print a
new one with `docker exec minibrain minibrain admin setup-link`. Other ways to create the admin: [First
admin](first-admin.md).

The CPU image runs wherever Docker does, Docker Desktop on macOS (Apple silicon and Intel) and Windows included.
Training on CPU suits models up to about 0.5B parameters. Docker on macOS has no GPU access; a native install there
gets the Metal build of PyTorch ([Python and uv](python.md)).

## Run on NVIDIA GPUs

The host needs an NVIDIA driver that supports CUDA 13.2 (`nvidia-smi` shows CUDA Version 13.2 or higher) and the
NVIDIA Container Toolkit.

```sh
docker run -d --name minibrain --restart unless-stopped --stop-timeout 30 \
  --gpus all --shm-size 8g \
  -p 127.0.0.1:8000:8000 \
  -v minibrain-data:/data \
  -v /srv/models:/models:ro \
  ghcr.io/getminibrain/minibrain:cuda
docker logs minibrain | grep setup
```

- `--shm-size` gives PyTorch shared memory for data loading; Docker's default of 64 MB is too small.
- `--stop-timeout 30` lets minibrain finish open requests on `docker stop`. That can take about 25 seconds, and
  Docker's default kills it after 10.
- `-p 127.0.0.1:8000:8000` keeps the port on the host's loopback. Before you open it wider, read
  [Network and ports](../security/network.md).
- `/srv/models` is optional: a folder of model weights, mounted read-only (below).

## Image tags

Images are built from the release wheel for linux/amd64 and linux/arm64:

| Tag | Image |
|---|---|
| `latest`, `<version>` (`0.1.2`) | CPU: Python 3.12 slim (Debian 13) with CPU torch, about 1.7 GB |
| `cuda`, `<version>-cuda` (`0.1.2-cuda`) | NVIDIA CUDA 13.2 (Ubuntu 24.04), about 7 GB. Linux hosts with NVIDIA GPUs |

`latest` and `cuda` move with each stable release; pre-releases such as `0.2.0rc1` get only their version tags. Pin a
version in production, or its digest: `docker inspect --format '{{index .RepoDigests 0}}' <image>` after a pull. Every
image is signed and carries its SBOM: [Verify a release](verify-release.md).

## How the container runs

- It runs as user `minibrain` (uid 1000), not root. `/data` is the home folder and a volume; a bind mount there must
  be writable by uid 1000, for example `sudo chown -R 1000:1000 /srv/minibrain-data`.
- PID 1 is `tini`. The entrypoint is `minibrain` and the default command is `serve --host 0.0.0.0 --port 8000`, so
  `docker exec minibrain minibrain extensions` runs a command in the running container and
  `docker run --rm ghcr.io/getminibrain/minibrain:cuda --help` runs one in a new one.
- The image checks `GET /healthz` every 30 seconds, after a 60-second start period.

```sh
docker inspect --format '{{.State.Health.Status}}' minibrain
curl -s http://127.0.0.1:8000/healthz
```

## Environment

The image sets:

| Variable | Value | Effect |
|---|---|---|
| `MINIBRAIN_HOME` | `/data` | Everything minibrain writes |
| `HF_HOME` | `/data/huggingface` | The Hugging Face cache lives on the volume |
| `HF_HUB_DISABLE_TELEMETRY` | `1` | No Hugging Face telemetry |
| `MINIBRAIN_DUCKDB_EXTENSION_REPOSITORY` | `/opt/duckdb-extensions` | DuckDB extensions bundled in the image |

The image downloads base models from Hugging Face when you add them, like a native install. Add other settings with
`-e`, such as `-e MINIBRAIN_DATABASE_URL=postgresql+psycopg://user:password@host/db` for Postgres; the image includes
the `postgres` and `qlora` extras. Every variable: [Configuration](configuration.md). To turn off every outbound call:
[Air-gapped installs](air-gapped.md).

## Use model weights from a folder

Mount the folder read-only, as with `/srv/models:/models:ro` above. Then in **Add model**, open **Base**, choose
**Your imports** › **Server folder**, and give the path inside the container, such as `/models/Qwen3-0.6B`. minibrain
copies the files in and leaves the folder as it was ([Base models](../guides/models.md)).

## DuckDB extensions

The image carries the DuckDB extensions for S3, Postgres, Iceberg, Avro and Delta Lake sources (httpfs,
postgres_scanner, iceberg, avro and delta), so those sources work without internet access. minibrain installs each one
into `/data/duckdb/extensions` the first time a source needs it. To install them all now and list them:

```sh
docker exec minibrain minibrain extensions install
docker exec minibrain minibrain extensions
```

- delta reads Delta tables from folders on the server only: mount the table's folder into the container and add it
  under **Settings** › **Security** › **Folder sources**.
- `mysql_scanner` is left out: it links the MySQL client library (GPLv2 with the Universal FOSS Exception), whose
  licence review is not done. Build your own image with `--build-arg INCLUDE_MYSQL=true` if your own review allows it.

Licences of the extensions: [THIRD_PARTY_NOTICES.md](https://github.com/getminibrain/minibrain/blob/main/THIRD_PARTY_NOTICES.md).

## Build your own image

To change a build argument or build from a checkout:

```sh
docker build -t minibrain:cuda --build-arg COMMIT=$(git rev-parse HEAD) .
docker build -t minibrain:cpu --build-arg VARIANT=cpu .
```

| Build argument | Default | Meaning |
|---|---|---|
| `VARIANT` | `cuda` | `cuda`: NVIDIA CUDA 13.2 base (Ubuntu 24.04). `cpu`: Python 3.12 slim (Debian 13) with CPU torch |
| `TORCH_BACKEND` | `cu132` or `cpu` | The PyTorch build to install, as in `UV_TORCH_BACKEND` |
| `INCLUDE_MYSQL` | `false` | `true` adds DuckDB's `mysql_scanner` extension |
| `COMMIT` | empty | The git commit shown in **Settings** › **This install** |

The build needs network access (PyPI, the PyTorch index, the npm registry, GitHub, extensions.duckdb.org); the image
needs none. Build on the architecture you deploy, or use `docker buildx build --platform linux/amd64`. To build from a
wheel you already have, pass a folder that holds only that wheel as the `wheel` build context:

```sh
docker buildx build --build-context wheel=./release-wheel --build-arg VARIANT=cpu -t minibrain:cpu .
```

The image serves with the `transformers` engine. For SGLang, build an image `FROM` this one that installs SGLang into
its own virtual environment and sets `MINIBRAIN_SGLANG_PYTHON` to its Python; this has not been tested yet
([GPUs](gpus.md#sglang-and-vllm)).
