---
title: Add machines
description: Join other machines to minibrain as workers in a compute pool, so training and deployed models run on their GPUs.
sidebar:
  order: 8
---

Other machines join minibrain as workers in a compute pool. Training, scoring and deployed models then run on their
GPUs (or CPUs) instead of on main. A worker is the same minibrain package as main and only needs to reach main over
HTTP.

## Pools

A pool is a named group of machines. Every machine belongs to exactly one, picked when it joins, because the pool
decides what runs there and who may join:

| The pool sets | Where |
|---|---|
| Where a deployment's replicas run, one per online machine where the model fits | Deploy dialog, **Pool** and **Replicas** |
| Which workers claim a model's training and scoring jobs | Train page, **Pool** |
| Whether it takes any work, serving only or training only | Pool row's **…** menu › **Pool settings** › **Used for** |
| The price of an hour of its GPU time | **Settings › General › Compute prices**, or `compute.prices` in `minibrain.yaml` |
| Whether a catalogue model fits, judged on its best machine | Discover |
| Who may join: one join token per pool | Pool row's **…** menu |

`local` is main's own machine and takes no other. Pool names are up to 63 lowercase letters, digits, dots, dashes or
underscores. Put machines that should be placed and priced alike in one pool, such as one per GPU type or rack.
Placing models on pools: [Deployments](../guides/deployments.md).

## Add a machine

Install minibrain on the machine first, the same release as main. The [installer](installer.md) takes the version and,
on Linux with an NVIDIA driver, installs the CUDA build of torch:

```sh
curl -LsSf https://raw.githubusercontent.com/getminibrain/minibrain/main/install.sh | MINIBRAIN_VERSION=<version> sh
```

Then, as an admin:

1. Open **Infrastructure › Machines** and click **Add machine**.
2. Under **Pool**, pick a pool, or **A new pool** and type its name. Click **Continue**.
3. Copy the command under **Run this on the machine**. For a pool without a join token, the dialog makes one and shows
   it this once:

   ```sh
   MINIBRAIN_JOIN_TOKEN=mbj_… minibrain worker --main https://minibrain.corp --pool gpu-a10
   ```

   For a pool that already has a token, the command comes without it and the dialog shows the token's first
   characters: set `MINIBRAIN_JOIN_TOKEN` to the token you kept, or click **Rotate** for a new one.
4. Run the command on the machine. The dialog shows "gpu-01 joined pool gpu-a10". Click **Done**.

`--main` is the address your browser uses for minibrain. If that is `127.0.0.1`, replace it with an address the machine
reaches. Keep the worker running with systemd, a container restart policy or your scheduler.

## Join by approval

The same command without `MINIBRAIN_JOIN_TOKEN` asks an admin to let the machine in. **Copy join command** in the pool
row's **…** menu copies it. The worker prints a code and waits:

```text
This machine asked main to join pool gpu-a10. Code K7QM2P: waiting for approval in Infrastructure, Machines (the request lasts an hour).
```

The request appears under **Infrastructure › Machines › Waiting for approval** with the machine's name, hardware, code
and the pool it asked for (Any without `--pool`). Approve it only if it shows the same code: click **Approve**, pick
the pool and click **Approve**, or click **Deny**. An open **Add machine** dialog offers **Approve into gpu-a10** too.

The worker prints "Approved: this machine joins pool gpu-a10." and keeps its credential in `worker/approval.json`
under `MINIBRAIN_HOME`. Later starts with the same `--main` reuse it and ignore `--pool`: the pool is the
one the admin picked.

## Join tokens

Each pool has one join token. **Make join token** or **Rotate join token** in the pool row's **…** menu makes a new one
and shows it once, with the command to run.

Rotating replaces the token at once: workers that joined with the old one stop with `this join token was revoked`, and
their engines are cut off. Machines that joined by approval stay. Restart each token-joined machine with the new
command.

## What runs on the machine

`minibrain worker` is the only process to start. It:

- registers the machine's hardware: GPUs, memory, CPU, RAM, installed engines and library versions;
- claims training, scoring and export jobs for its pool, and pulls what each job needs from main, or from the bucket
  when Storage is S3;
- every 10 seconds asks main which models to serve, and starts or stops one `minibrain engine` per deployed model;
- keeps working copies in `worker/` and `engines/` under `MINIBRAIN_HOME` (`~/.minibrain`), pruned as main drops
  models.

Downloads and imports of base models stay with main's own worker.

| Option | Does |
|---|---|
| `--main URL` | main's address (`--api-url` also works); default `http://127.0.0.1:8000` |
| `--pool NAME` | The pool to join; required with a join token |
| `--advertise ADDRESS` | The address gateways reach this machine's engines at; default the machine's name, or the address it reaches main from when the name resolves to loopback |
| `--engine-bind ADDRESS` | The interface engines listen on; default the `--advertise` address |
| `--no-serve` | Run jobs only; never start engines |

All options: [CLI](../reference/cli.md#minibrain-worker).

## Run the worker in Docker

On a Linux host with NVIDIA GPUs and the NVIDIA Container Toolkit, run the worker from the same image tag as main:

```sh
docker run -d --name minibrain-worker --restart unless-stopped --no-healthcheck \
  --gpus all --shm-size 8g --network host \
  -e MINIBRAIN_JOIN_TOKEN=mbj_… -v minibrain-worker:/data \
  ghcr.io/getminibrain/minibrain:<version>-cuda worker --main https://minibrain.corp --pool gpu-a10
```

- `--network host` lets gateways reach the engines the worker starts on free ports, and gives the worker the host's
  name.
- `--no-healthcheck` turns off the image's check of `/healthz` on port 8000, which only main serves.
- Without the token, the approval code is in `docker logs minibrain-worker`. The volume keeps the approval and the
  working copies.
- The image pins its libraries, so main's tag gives main's versions. This setup is not verified yet on an NVIDIA GPU.

## Network

Every machine must reach main. Nothing connects to a worker; gateways connect to the engines it starts.

| From | To | Port |
|---|---|---|
| Workers, engines | main | 8000, or 443 through a TLS proxy |
| Workers, engines | The bucket endpoint, when Storage is S3 | 443 |
| Gateways (inside main, or `minibrain gateway`) | Engines on other machines | A free port per engine on the `--advertise` address; 8200 for `minibrain engine` |

- `minibrain serve` listens on `127.0.0.1` by default. Start it with `--host 0.0.0.0`, publish the Docker port on an
  address other machines reach, or put a proxy in front.
- main serves plain HTTP, and this channel carries tokens, data and adapters. Put a TLS reverse proxy in front of main
  and give workers its `https://` address. Engines answer gateways over plain HTTP: keep them on a private network.
- Machines need no internet access. Trust zones and ports: [Network and ports](../security/network.md).

Status, drain and remove, and troubleshooting: [Machine health](machine-health.md).
