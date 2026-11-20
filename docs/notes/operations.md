# Operations notes (contributors)

Internal detail moved out of the published pages Add machines, Machine health, Metrics, OpenTelemetry, Logs,
Architecture, How serving works and CLI. Unpublished; true as of 0.1.2.

## Sources

- Endpoints (`/v1`, `/api`, `/internal/gateway`, `/internal/worker`, `/internal/join`): `web/openapi.json`.
- Tables: `minibrain/registry/migrations/versions/`.
- Failure modes, database, artifacts, several mains: `docs/state.md`. Job contract, lifecycle, retries: `docs/jobs.md`.
- `docs/diagrams/topology.html` is the interactive version of the three deployment shapes, with failure drills. It is
  not linked from the published pages.

## Roadmap stages for starting workers and engines

| Stage | Who starts workers and engines |
|---|---|
| v1 (today) | People or their tooling: `minibrain worker` and `minibrain engine` on each box (systemd, Compose, Slurm) |
| v2 | A Kubernetes launcher: main creates Jobs for training and Deployments for engine replicas, autoscaled |
| Later | A cloud VM launcher for rented GPUs |

## Design decisions: alternatives and costs

| Decision | Why | Cost |
|---|---|---|
| Own jobs table | Leases and fencing in one table, no broker, works on SQLite. Procrastinate is Postgres-only, Huey keeps a second record without leases, Celery / RQ / Dramatiq need a broker, Temporal / Hatchet / Prefect are separate servers | We own the bugs; DBOS Transact is the candidate for multi-step pipelines |
| Jobs found by polling | No broker | Up to one poll interval of latency; Postgres LISTEN/NOTIFY later |
| No coordination service | The database coordinates jobs; a Postgres advisory lock picks the leader | HA depends on Postgres HA (Patroni or managed) |
| One package for every role | One install, one version | A large install; split extras later |
| Python gateway | Same code and models as main | More replicas than a native proxy; Go or Rust only if ever needed |
| No Compose or Kubernetes requirement | Docker on macOS has no GPU; `uvx minibrain serve` works on a laptop and air-gapped | Workers and engines started by hand in v1; a Kubernetes launcher in v2 |

- Very high request log volume moves to ClickHouse or Parquet in object storage, or to sampling (not built).
- Engine scale-out autoscaled on Kubernetes is v2 (not built).

## Engines

- SGLang runs with `--enable-lora`, adapters loaded at runtime; vLLM with `--enable-lora` and runtime LoRA updates on.
  The vLLM engine shares SGLang's request path (an OpenAI-compatible server per base model).
- MLX (`mlx-lm`) converts PEFT LoRA on load and swaps it per request.
- Remote engine working copy: `<home>/engines/<key>/weights`; pruned against main at start and every 10 minutes.
- Local engines on main use main's working copy, `<home>/models/<id>`, fetched from the bucket the first time they
  start when the model lives there.
- Fetching the working copy is its own step before load: `/health` answers 503 with
  `{"state": "fetching", "done", "total", "message"}` and the engine announces state `fetching`. Each file gets a
  freshly signed link, so a fetch longer than the links' 15 minutes still completes. The 600 s startup window starts
  only when loading starts.
- With a bucket, main hands out a presigned link and the data key per file.

## Machine heartbeats

Every worker claim or engines call (about every 10 to 25 s) and every engine announcement (every 10 s) carries the
machine's static `hardware` and a `metrics` sample:

| Field | Source | Unknown |
|---|---|---|
| `gpus[]`: `index`, `memory_used_bytes`, `memory_total_bytes`, `utilization` (percent) | `nvidia-smi`, else `rocm-smi`, when on the PATH | No GPU tool: an empty list; a field the tool prints as `[N/A]`: null |
| `ram_used_bytes`, `ram_total_bytes`, `cpu_percent` | psutil | null; `cpu_percent` is null on the first sample |
| `disks[]`: `path`, `mount`, `total_bytes`, `free_bytes`, `minibrain_bytes` | The disk under `MINIBRAIN_HOME`; minibrain's share is recounted every 5 minutes | No disk found: an empty list |

- Samples are taken at most every 15 s per process.
- main keeps the last hour per machine in memory, at most one sample every 10 s, and samples itself the same way.
  `GET /api/compute/pools` returns each machine's latest sample while it is under 2 minutes old (`metrics`, with
  `memory_used_bytes` and `memory_total_bytes` summed where models run) and its last reported disks even when it is
  offline (`disks`); `GET /api/compute/pools/{pool}/machines/{host}/metrics` returns the latest sample and the hour of
  history.
- Each pool has `room`: how many more models of one size still fit (the largest size the pool already serves that
  fits, else the largest catalogue size that fits) and the largest catalogue model the planner can train, from the
  measured free memory of its online active machines, or estimates from weights, adapters and training plans where a
  machine does not measure. SGLang and vLLM reserve most of a GPU up front, so measured free memory is small there.

## Drain and remove: API

| Action | Effect |
|---|---|
| Drain (`POST …/machines/{host}/drain`) | The machine's claims return no job; jobs it runs finish. It drops out of engine placement; each engine keeps serving until a replica on another machine of the pool is ready, then stops |
| Undrain | It takes jobs and engines again |
| Remove (`DELETE …/machines/{host}`) | Refused (409) while it runs a job or a live engine, and while it is online and not drained. Its next claim or engine call gets 410 and the worker exits |

Audit actions: `machine.drain`, `machine.undrain`, `machine.remove`.

## Flows with internal endpoints

- Inference: load balancer HTTPS :443 to gateway :8100; gateway `POST /generate` to the engine with model and adapter
  ID; the engine pulls an adapter by artifact ID.
- Deploy: the gateway long-polls `GET /internal/gateway/config` with an ETag; main rebuilds the snapshot about every
  second.
- Join by approval: `POST /internal/join/requests` (request key, host, hardware, pool) returns the code; the worker
  polls `GET /internal/join/requests/self` every 3 s; the credential is saved in `<home>/worker/approval.json`.

## CLI internals

- Hidden options: `worker --parent PID` and `engine --parent PID`, `engine --spec JSON` (main's supervisor uses them).
- `minibrain serve` starts its worker with `--kinds` set to every job kind (download, import, catalog_sync, verify,
  repair included) and `MINIBRAIN_JOIN_TOKEN` set to `<home>/secrets/worker_token`.
- Engines started by a worker get `MINIBRAIN_ENGINE_TOKEN`; `minibrain engine` reads it first, then
  `MINIBRAIN_JOIN_TOKEN`, then a saved approval for the same `--main-url`, then `MINIBRAIN_GATEWAY_TOKEN`, then
  `<home>/secrets/gateway_token`.
- `minibrain gateway` reads `MINIBRAIN_GATEWAY_TOKEN`, else `<home>/secrets/gateway_token` (made on first use). The
  CLI page tells users to copy main's file into the variable on another machine; the old docs never said how a remote
  gateway authenticates.
- Any `<home>/secrets/<name>` can be overridden with `MINIBRAIN_<NAME>` (for example `MINIBRAIN_WORKER_TOKEN`).
