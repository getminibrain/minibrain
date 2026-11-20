# Joining machines

Other machines join an install as workers in a compute pool, so training, scoring and deployed models run on their
GPUs (or CPUs) instead of on main.

## Roles

main is the control plane: the UI, the API, the database, the job queue and, in a plain `minibrain serve`, the
gateway that answers `/v1`. Each other machine runs a worker: it claims training, scoring (`eval`, `judge`) and export
jobs for its pool and starts an engine for each model deployed to that pool. An engine serves one base model with its
adapters; gateways route each request to one. Workers and engines call main over HTTP with a pool credential, never
with database credentials. Downloads and imports of base models stay with the worker main runs on its own machine.
Details: [Roles](architecture.md#roles) and [Local main, remote GPUs](architecture.md#local-main-remote-gpus), the
shape Infrastructure › Setup shows once a machine joins.

## Compute pools

A pool is a named group of machines. Every machine belongs to exactly one, chosen when it joins, because the pool
decides what runs there and who may join:

| The pool sets | Where |
|---|---|
| Where a deployment's replicas run, one per online machine where the model fits | Deploy dialog, Pool and Replicas rows |
| Which workers claim a model's training and scoring jobs | Train page, Pool row |
| Whether it takes **Any** work, **Serving** only or **Training** only | Pool row's **…** menu › **Pool settings** › Used for |
| The price of an hour of its GPU time | Settings › General › Compute prices, or `compute.prices` in `minibrain.yaml` |
| Whether a catalogue model fits, judged on its best machine | Discover |
| Who may join: one join token per pool | Pool row's **…** menu |

`local` is main's own machine and takes no other. Pool names are up to 63 lowercase letters, digits, dots, dashes or
underscores. Put machines that should be placed and priced alike in one pool, such as one per GPU type or rack.
More: [Serving → Compute pools](serving.md#compute-pools) and [Pool use](serving.md#pool-use).

## Add a machine

1. Install minibrain on the machine, the same release as main: `MINIBRAIN_VERSION=<version>` with the
   [installer](install.md#installer), which picks the CUDA build of torch on Linux with an NVIDIA driver.
2. In minibrain, open **Infrastructure › Machines** and click **Add machine** (admins only).
3. Under **Pool**, pick a pool, or **A new pool** and type its name. Click **Continue**.
4. Copy the command under "Run this on the machine". For a pool without a join token, the dialog makes one and shows
   it this once:

   ```sh
   MINIBRAIN_JOIN_TOKEN=mbj_… minibrain worker --main https://minibrain.corp --pool gpu-a10
   ```

   For a pool that has one, the command comes without it and the dialog names the token's prefix: set
   `MINIBRAIN_JOIN_TOKEN` to the token you kept, or click **Rotate** for a new one.
5. Run it on the machine. The dialog shows "gpu-01 joined pool gpu-a10" with **Open**. Click **Done**.

`--main` in the copied command is the address your browser uses for minibrain. If that is `127.0.0.1`, replace it with
an address the machine reaches.

### Join by approval

The same command without `MINIBRAIN_JOIN_TOKEN` (**Copy join command** in the pool row's **…** menu) asks to join:

```text
This machine asked main to join pool gpu-a10. Code K7QM2P: waiting for approval in Infrastructure, Machines (the request lasts an hour).
```

It appears under **Infrastructure › Machines › Waiting for approval** with the machine's name, hardware, code and
the pool it asked for (Any without `--pool`). Approve it only if it shows the same code: **Approve**, pick the pool,
**Approve**; or **Deny**. An open Add machine dialog offers **Approve into gpu-a10** too. The worker prints
"Approved: this machine joins pool gpu-a10." and keeps its credential in `<home>/worker/approval.json`; later starts
with the same `--main` reuse it and ignore `--pool` ([Security](security.md#trust-zones-and-ports)).

### Join tokens

**Rotate join token** in the pool row's **…** menu replaces the token: workers on the old one stop at once
(`this join token was revoked`), their engines are cut off, approved machines stay. Restart each token-joined machine
with the new command, shown once.

### What runs on the machine

`minibrain worker` is the only process to start; it is the same package as main and installs nothing else. It:

- registers its hardware: GPUs, memory, CPU, RAM, installed engines and library versions;
- claims `train`, `eval`, `judge` and `export` jobs for its pool and pulls what each job names from main or, with
  Storage on S3, from the bucket on links main signs ([Security](security.md#base-weights-on-other-machines));
- every 10 s asks main which engines to run, and starts or stops a `minibrain engine` child per deployed model;
- keeps working copies in `worker/` and `engines/` under `MINIBRAIN_HOME` (`~/.minibrain`), pruned as main drops models.

| Option | Does |
|---|---|
| `--main URL` | main's address (`--api-url` also works); default `http://127.0.0.1:8000` |
| `--pool NAME` | The pool to join; required with a join token |
| `--advertise ADDRESS` | The address gateways reach this machine's engines at; default its name |
| `--engine-bind ADDRESS` | The interface engines listen on; default the `--advertise` address |
| `--no-serve` | Jobs only: never start engines |

Keep it running with systemd, a container restart policy or your scheduler. `minibrain engine` serves one model by
hand on a machine without a worker: [Engines](serving.md#engines), [An engine joins](serving.md#an-engine-joins).

### Docker

On a Linux host with NVIDIA GPUs and the NVIDIA Container Toolkit, run the worker from main's image tag:

```sh
docker run -d --name minibrain-worker --restart unless-stopped --no-healthcheck \
  --gpus all --shm-size 8g --network host \
  -e MINIBRAIN_JOIN_TOKEN=mbj_… -v minibrain-worker:/data \
  ghcr.io/getminibrain/minibrain:0.1.1-cuda worker --main https://minibrain.corp --pool gpu-a10
```

- `--network host` lets gateways reach the engines the worker starts on free ports, and gives it the host's name.
- `--no-healthcheck`: the image checks `/healthz` on port 8000, which only main serves.
- Without the token, the code is in `docker logs minibrain-worker`. The volume keeps the approval and copies.
- The image pins its libraries, so main's tag gives main's versions. Not verified yet on an NVIDIA GPU.

## Network

Every machine must reach main. Nothing connects to a worker; gateways connect to engines.

| From | To | Port |
|---|---|---|
| Workers, engines | main | 8000, or 443 through a TLS proxy |
| Workers, engines | The bucket endpoint, when Storage is S3 | 443 |
| Gateways (inside main, or `minibrain gateway`) | Engines on other machines | A free port per engine on the `--advertise` address; 8200 for `minibrain engine` |

- `minibrain serve` listens on `127.0.0.1` by default: start it with `--host 0.0.0.0`, publish the Docker port on an
  address other machines reach, or put a proxy in front.
- main serves plain HTTP, and this channel carries tokens, data, adapters and data keys: put a TLS reverse proxy in
  front of it and give workers its `https://` address. Engines answer gateways over plain HTTP: keep them private.
- Machines need no internet access. Zones and ports: [Security](security.md#trust-zones-and-ports).

## Heartbeats and offline

Workers check in every 10 to 25 s and engines every 10 s, with hardware and a metrics sample
([Serving → Machine heartbeats](serving.md#machine-heartbeats)); the machine's sheet shows Last heartbeat.

| Silent for | Effect |
|---|---|
| 30 s | Its engines leave gateway routing; replicas move to other online machines of the pool |
| 60 s | A job it runs loses its lease and is queued again while attempts are left |
| 2 minutes | Offline: Status reads "Offline" and for how long, and Home › Needs attention warns "gpu-01 is offline" |
| 24 hours | The warning offers admins **Remove** |
| 7 days | Forgotten, except machines that joined by approval: they stay listed until removed |

A drained machine raises no offline warning. When main is down, a worker logs `main is unreachable (…); trying again
in N s` and backs off to 30 s; it needs no restart.

## Versions

Each machine reports minibrain, torch, transformers, peft, trl, bitsandbytes and the engine libraries it has, with
CUDA and the NVIDIA driver, or ROCm; its sheet lists them under Versions beside main's. minibrain, torch, transformers
and peft are compared with main, ignoring a build tag such as `+cu132`. A difference does not stop the machine, but its
Status reads **Version drift**, its row under Versions is highlighted, and Needs attention warns "gpu-01 runs other
library versions than main: torch 2.8.0 (main has 2.9.0)".

Fix: install main's versions, then restart the worker with the command under **How to fix**. The same image tag does
it. A native install resolves torch, transformers and peft when it runs, so pin them (upgrading main:
[Upgrades](upgrades.md)):

```sh
uv tool install --python 3.12 minibrain==<version> \
  --with torch==<version> --with transformers==<version> --with peft==<version>
```

## Drain and remove

Click the machine's row; its sheet's Actions (admins only, audited):

| Action | Effect |
|---|---|
| **Drain** | Running jobs finish; no new job starts. Each engine serves until another machine in the pool has its model ready, then stops; a model no other machine can take keeps serving here. Status: Draining, then Drained |
| **Undrain** | It takes jobs and engines again |
| **Remove from pool** | Only once it is drained and idle, or offline. It leaves the pool and its worker stops at its next heartbeat |

A token-joined worker stops with "An admin removed gpu-01 from pool gpu-a10. Restart minibrain worker on gpu-01 to
join the pool again." To keep it out, stop it there and rotate the token if it may have been copied. An approved
machine must be approved again. Main cannot be drained or removed ([Serving](serving.md#drain-and-remove)).

## Troubleshooting

Problems show on Infrastructure › Machines (in a machine's Status and its sheet, with **How to fix**, or as a badge
on the pool's row) and on Home › Needs attention:

| Problem | Shown as | Fix |
|---|---|---|
| gpu-01 is offline | Offline 3h | Check the worker runs and reaches main; How to fix gives the command that restarts it. After a day, **Remove** |
| gpu-01 runs other library versions than main: … | Version drift | [Versions](#versions) |
| gpu-01 /data has only 6.2 GB free | Disk low | Under 10 GB or 10% free on the disk under `MINIBRAIN_HOME`. The sheet says how much minibrain keeps there; Infrastructure › Storage lists Disks on other machines |
| The engine for Qwen3-8B on gpu-01 failed | Engine failed | Critical. Open the model and check its deployment and weights |
| Support triage is live but no replica is running | Badge on the pool's row | Critical. The model reads "Waiting for a machine in gpu-a10" while no worker of its pool is online: start one, or deploy to another pool |

When `minibrain worker` stops, it prints why after `minibrain worker:` (`main refused this machine:` first for a
refused credential):

| Message | Fix |
|---|---|
| `this join token was revoked` | The token was rotated: use the new one |
| `invalid worker token` | Copy the token again, or rotate it |
| `this join token joins pool gpu-a10 only, not local` | Add `--pool gpu-a10` |
| `the local pool is main's own machine; name another pool with --pool` | Name another pool |
| `an admin denied this machine`, `nobody approved this machine within an hour; …` | Run it again and approve the new code |
| `this approval is for gpu-01 only, not gpu-02` | The machine was renamed: delete `<home>/worker/approval.json` and ask again |
| `5 machines from this address already wait for approval; try again later` | Approve or deny the waiting requests |
| `This machine's name gpu-01 resolves to 127.0.1.1, …` | Pass `--advertise` ([Serving](serving.md#deployments-on-a-pool)) |
| `main is unreachable (…); trying again in N s` (it keeps running) | Check `--main` and the [network](#network) |
