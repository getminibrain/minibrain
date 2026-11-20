---
title: Architecture
description: The roles minibrain runs, the three ways to lay them out, and the design decisions behind them.
sidebar:
  order: 1
---

minibrain is one package with one command. It runs as a few roles: main, gateways, engines and workers. On one machine
they are one process tree started by `minibrain serve`; in production they run as separate services on many machines.
The code is the same; only where each role runs changes.

## Roles

main is the control plane. It owns the database, the jobs, the policies and the configuration, and serves the UI and
the API. Gateways and engines are the serving plane: they answer inference requests from a cached copy of the
configuration, so they keep serving while main restarts. Workers are the batch plane: they run data preparation,
training and evaluation.

Workers and engines talk to main only over HTTP. A GPU machine elsewhere runs the same program with main's address,
a token and a pool name.

| Role | Plane | On one machine | As separate services | Scales by |
|---|---|---|---|---|
| main | Control | `minibrain serve`, the parent process | Its own service; two or more with Postgres | Copies behind a load balancer |
| Gateway | Serving | Inside main | `minibrain gateway` | Copies behind a load balancer |
| Engine | Serving | A child process per model | A child of a worker in the deployment's pool, or `minibrain engine` | Replicas per deployment, across machines |
| Worker | Batch | A child process | `minibrain worker --pool …` on each GPU machine | More machines per pool |
| Training and evaluation | Batch | A child of the worker | The same, on the worker's machine | One per job |

Only main reads and writes the database. Gateways serve from a configuration snapshot they keep on disk; engines and
workers reach main over HTTP and hold no database credentials.

## Deployment shapes

The three pictures share one layout: callers on the left, the inference path across the top, main and its state in the
middle, GPU pools on the right. Colour is the plane: blue control, green serving, amber batch.

### One machine

For trying minibrain and for evaluation. `minibrain serve` runs main, the gateway, a worker and engines, with SQLite and
a folder for files.

<img class="dark:sl-hidden" src="../diagrams/one-machine.svg" alt="One machine: minibrain serve runs main, the gateway, a worker and engines with SQLite and a folder">
<img class="light:sl-hidden" src="../diagrams/one-machine-dark.svg" alt="One machine: minibrain serve runs main, the gateway, a worker and engines with SQLite and a folder">

### Local main, remote GPUs

main and its gateway run on a laptop or a small VM; workers and engines run on GPU machines that
[join a pool](../install/machines.md). **Infrastructure › Setup** shows this shape once a machine joins.

<img class="dark:sl-hidden" src="../diagrams/local-main-remote-gpus.svg" alt="Local main, remote GPUs: main and its gateway on a laptop or small VM, workers and engines on a GPU machine">
<img class="light:sl-hidden" src="../diagrams/local-main-remote-gpus-dark.svg" alt="Local main, remote GPUs: main and its gateway on a laptop or small VM, workers and engines on a GPU machine">

### Production

Separate services in trust zones: two or more mains on Postgres, standalone gateways behind a load balancer, GPU racks
in several pools and S3-compatible storage. Zones and ports: [Network and ports](../security/network.md).

<img class="dark:sl-hidden" src="../diagrams/production.svg" alt="Production: load balancers, gateways, two mains, GPU pools, Postgres and S3, in trust zones">
<img class="light:sl-hidden" src="../diagrams/production-dark.svg" alt="Production: load balancers, gateways, two mains, GPU pools, Postgres and S3, in trust zones">

| | One machine | Local main, remote GPUs | Production |
|---|---|---|---|
| main | `minibrain serve` | `minibrain serve` on a laptop or small VM | Two or more behind a load balancer |
| Gateways | Inside main | Inside main | `minibrain gateway` on several machines behind a load balancer |
| Workers and engines | Child processes, pool `local` | On GPU machines, one pool per rack | GPU racks, several pools |
| Database | SQLite | SQLite | Postgres, highly available |
| Files | A folder | A folder | S3-compatible storage |

You start workers and engines on each machine yourself, with systemd, Compose, Slurm or your own tooling.

## Design decisions

- One control plane. main and one database are the single source of truth, which keeps operations simple. Changes
  need main, and high availability needs Postgres and several mains.
- Machines pull from main over HTTP. GPU machines make only outbound connections and never hold database credentials.
  Files flow through main, except base weights in a bucket: machines fetch those straight from the bucket on links
  main signs, so GPU machines must reach the bucket too.
- HTTP, not gRPC. The job channel carries a few requests a second and inference is bound by the GPU; HTTP streaming
  serves both. Messages are larger than with protobuf.
- Jobs live in main's database. Leases and retries sit in one table, with no message broker, and work on SQLite.
  Workers find jobs by polling, so a job can wait up to one poll interval before it starts.
- No coordination service to run. The database coordinates jobs; with several mains, a Postgres lock picks the one
  that runs background tasks. High availability depends on Postgres being highly available.
- Configuration up to a second stale. Gateways never read the database for a request, so a revoked API key works for up
  to a second.
- One base model per engine process, with many adapters on it. The lifecycle stays simple; more models mean more
  processes, and more traffic means more replicas.
- One package for every role: one install and one version on every machine, at the cost of a large install.
- A Python gateway, with the same code and models as main. It needs more replicas than a native proxy would.
- No Compose or Kubernetes requirement. Docker on macOS has no GPU, and `uvx minibrain serve` runs on a laptop.

## Read next

- [How serving works](how-serving-works.md): planes, the request path, engines and the main flows.
- [Add machines](../install/machines.md) and [Machine health](../install/machine-health.md).
- [Network and ports](../security/network.md) and [Policies](../security/policies.md).
- [Base models](../guides/models.md), [Deployments](../guides/deployments.md) and the [API overview](../api/overview.md).
- [CLI](cli.md): every command and its options.
