---
title: Production setup
description: Set up main, gateways, workers and engines on separate machines, with Postgres, an S3-compatible bucket, TLS and backups, then check the result.
sidebar:
  order: 14
---

In production, minibrain's roles run as separate services: main with Postgres and a bucket, gateways behind a load
balancer, and workers with their engines on GPU machines in pools.
[Architecture](../reference/architecture.md#production) draws this layout; this page is the order to set it up in.
Each step links to the page with the detail.

| Part | Runs | Listens on |
|---|---|---|
| main | `minibrain serve` | 8000, behind a TLS proxy |
| Gateways | `minibrain gateway` on one or more machines | 8100, behind a TLS load balancer |
| Workers | `minibrain worker` on each GPU machine | Nothing: they connect to main |
| Engines | Started by the workers, one per deployed model | A free port each, for gateways only |
| Database | Your Postgres | 5432 |
| Files | Your S3-compatible bucket | 443 |

You start and supervise each process yourself, with systemd, containers or your own tooling.

## Before you start

- **One release for every machine.** Pick a version and pin it everywhere. Each machine meets the
  [requirements](requirements.md).
- **Postgres.** A database and a user for minibrain, reachable from main only. Main's availability depends on it.
- **A bucket.** S3-compatible storage (AWS S3, MinIO, Ceph), with an access key and secret for main, and versioning
  on so a restore can find objects deleted after a backup.
- **TLS.** Certificates and a reverse proxy or load balancer for main's address and for the gateways' address. main,
  gateways and engines serve plain HTTP themselves.
- **Network.** Workers and engines reach main, and the bucket; gateways reach main and the engines; nothing else
  reaches the GPU machines. Zones and ports: [Network and ports](../security/network.md#trust-zones).
- **Secrets.** A place for the admin password, the bucket's secret key and a copy of the master key: files such as
  Docker or Kubernetes secrets, never `minibrain.yaml` itself.

## Set it up

### 1. Start main on Postgres

Install the pinned release on main's machine with the `postgres` extra, or use the Docker image, which includes it.
Point it at the database and start it:

```sh
uv tool install --python 3.12 'minibrain[postgres]==<version>'
export MINIBRAIN_DATABASE_URL=postgresql+psycopg://minibrain:password@db.internal/minibrain
minibrain serve
```

- main creates and migrates its tables before it listens.
- It listens on `127.0.0.1:8000`. Keep that when the TLS proxy runs on the same machine; otherwise add
  `--host 0.0.0.0` and let only the proxy and the other machines reach the port.
- In Docker, pass the variable with `-e` and pin the image tag ([Docker](docker.md#environment)). With Compose, it
  goes in `.env` ([Docker Compose](compose.md#set-options-in-env)).
- Settings that should be the same on every start go in `minibrain.yaml`, which locks them in the UI
  ([Configuration](configuration.md)).

### 2. Put TLS in front of main

Point the reverse proxy at port 8000 and give people, workers and gateways the `https://` address.

- Sign-in needs HTTPS anywhere but `localhost`.
- The channel between workers and main carries tokens, data, adapters and data keys.
- main sees the proxy's address as the client of every request, so the sign-in limit of 30 attempts in 5 minutes
  counts everyone together. `auth.proxy.addresses` makes main trust the proxy's `X-Forwarded-For`, and also its
  identity headers: read [Sign in through a reverse proxy](../security/accounts.md#sign-in-through-a-reverse-proxy)
  before you set it.

More: [TLS](../security/network.md#tls).

### 3. Create the first admin

Use one of the three ways on [First admin](first-admin.md):

- The setup link main prints on its first start. Print one with the address people use:
  `minibrain admin setup-link --url https://minibrain.example.com`.
- `MINIBRAIN_ADMIN_EMAIL` and `MINIBRAIN_ADMIN_PASSWORD_FILE`, read on the first start only: set them before
  step 1.
- Single sign-on with a group mapped to admin, set in `minibrain.yaml`.

Then add people and roles, or map groups from your identity provider:
[Accounts and sign-in](../security/accounts.md).

### 4. Keep artifacts in the bucket

Do this before you add the first base model: base models added afterwards keep their files in the bucket, and ones
already on main's disk stay there.

In the UI, open **Settings** › **Storage**. Under **Where artifacts live**, choose **S3-compatible bucket**, fill in
**Endpoint**, **Bucket**, **Access key** and **Secret key**, with **Prefix** and **Region** when your store uses them,
click **Test connection**, then **Save**. Or set it in `minibrain.yaml` before main starts, which locks it in the
UI:

```yaml title="minibrain.yaml"
storage:
  kind: s3
  endpoint: https://minio.internal:9000
  bucket: ml-artifacts
  prefix: minibrain
  access_key: AKIAEXAMPLE
  secret_file: /run/secrets/s3
```

GPU machines fetch base weights straight from the bucket, on short-lived links main signs, so they must reach the
bucket's endpoint. They never hold the bucket's keys. What goes where: [Where data lives](data-folder.md).

### 5. Decide where the master key lives

Encryption at rest is on by default. On its first start main makes a local key file, `keys/master.key` in its home
folder.

- Keep a copy of the key apart from the data: data whose key is lost cannot be read.
- Or keep the key in HashiCorp Vault, a PKCS#11 HSM or AWS KMS, under **Settings** › **Security** ›
  **Encryption at rest** ([Key providers](../security/key-providers.md)).
- minibrain does not encrypt the database, which holds the request inputs and answers kept for the models you
  choose: use storage encryption in Postgres ([What is encrypted](../security/encryption.md#what-is-encrypted)).

### 6. Start the gateways

On each gateway machine, install the same release and start a gateway with main's address and the gateway token.
The token is the contents of `secrets/gateway_token` in main's home folder:

```sh
MINIBRAIN_GATEWAY_TOKEN=<token> minibrain gateway --main-url https://minibrain.example.com --host 0.0.0.0
```

- Put a load balancer with TLS in front of the gateways' port 8100, with `/readyz` as its health check. Apps use its
  address followed by `/v1` as their base URL ([API overview](../api/overview.md#base-url)).
- A gateway keeps the last configuration it received on disk and answers from it while main restarts.
- Gateways call engines over plain HTTP, so keep gateways and GPU machines on one private network.
- Each gateway answers up to 64 calls at once; `MINIBRAIN_GATEWAY_CONCURRENCY` changes that.
- A gateway has no database. It reads its logging, metrics and OpenTelemetry settings from its own environment and
  `minibrain.yaml`.

All options: [CLI](../reference/cli.md#minibrain-gateway). How requests flow:
[How serving works](../reference/how-serving-works.md).

### 7. Join the GPU machines to pools

Install the same release on each GPU machine, then, as an admin, open **Infrastructure** › **Machines**, click
**Add machine**, pick or name a pool and run the command it shows on the machine:

```sh
MINIBRAIN_JOIN_TOKEN=mbj_… minibrain worker --main https://minibrain.example.com --pool gpu-a10
```

- Put machines that should be placed and priced alike in one pool, such as one per GPU type or rack.
- A pool can be used for any work, serving only or training only: the pool row's **…** menu › **Pool settings** ›
  **Used for** ([Pool use](../guides/deployments.md#pool-use)).
- `--advertise` sets the address gateways reach the machine's engines at, when its name does not resolve for them.
- Workers keep plain working copies of the models they run: put their home folder on an encrypted volume
  ([Workers, engines and gateways](../security/encryption.md#workers-engines-and-gateways)).
- main's own machine is the `local` pool, and **Automatic** places a model there when it fits. Name the GPU pool in
  the Deploy dialog and on the Train page to keep models off main's machine.

Joining by approval, join tokens and the Docker form: [Add machines](machines.md).

### 8. Set policies and monitoring

- Policies under **Settings** › **Security**: the Network policy, model sources, session lifetime, log retention and
  API key expiry ([Policies](../security/policies.md)).
- Audit events to your SIEM ([Audit log](../security/audit.md#send-events-to-a-siem)).
- Metrics, traces and JSON logs to your own tools, on main and on each gateway
  ([Metrics](../observability/metrics.md), [OpenTelemetry](../observability/opentelemetry.md),
  [Logs](../observability/logs.md)).

### 9. Plan backups

There is no backup command yet, and restore is not tested end to end. A backup is a set of copies you take yourself,
with main stopped:

| What | How |
|---|---|
| Postgres | `pg_dump` of the database `MINIBRAIN_DATABASE_URL` names |
| main's home folder | A copy of the folder, which holds `secrets/`, `minibrain.yaml` and, with a local key file, `keys/` |
| The master key | Apart from the data, or in Vault, an HSM or KMS |
| The bucket | Versioning on, so objects deleted after the backup can be found |

While main is stopped the UI and new jobs wait; standalone gateways and the engines on other machines keep
answering. Commands and restore: [Upgrades](upgrades.md#back-up-first).

## More than one main

Several mains can share one Postgres database behind main's load balancer. One of them runs the background work and
the others stand by; if it stops, another takes over.

- Give every main the same `MINIBRAIN_DATABASE_URL` and the same `minibrain.yaml`, and keep artifacts in the bucket:
  a folder on one main's disk is not on the others.
- Every main needs the same master key: mount one key file and set `MINIBRAIN_MASTER_KEY_FILE`, or use Vault, an HSM
  or KMS ([Local key file](../security/key-providers.md#local-key-file)).
- Every main needs the same tokens. Each main makes its own `secrets/` folder on first use, so copy the first main's
  `secrets/` folder into the home folder of each other main before it starts. This is manual today.
- For an upgrade, stop every main, then start one and wait until `/readyz` answers before you start the others
  ([Upgrades](upgrades.md#upgrade-main)).

## Check the result

1. main answers: `curl -s https://minibrain.example.com/healthz` returns `{"status":"ok"}`, and `/readyz` returns
   `{"status":"ready"}` once the database answers.
2. Each gateway answers `/readyz` on its port 8100 once it holds a configuration.
3. **Infrastructure** › **Setup** reads **Distributed**, and **Stores** lists the database as **Postgres** and the
   artifacts as **S3 bucket**. With several mains, **Background loops** reads "Runs here (leader)" on one and
   "Standby" on the others.
4. **Infrastructure** › **Machines** lists every GPU machine as online in its pool, with no **Version drift**
   ([Machine health](machine-health.md)).
5. **Home** › **Health** shows no problem.
6. **Settings** › **This install** shows the release under **Software**, the database and bucket under **Locations**,
   and what is turned on under **Network** and **Observability**.
7. `minibrain keys status` on main shows the key provider and the key versions in use.
8. Deploy a model to a GPU pool, call it through the gateways' address with an API key, and find the call under
   **Monitoring** › **Requests** ([Your first model](../get-started/first-model.md)).
9. Restart main while calls run: the gateways keep answering.

Keeping it current: [Upgrades](upgrades.md). When something is wrong:
[Troubleshooting](../reference/troubleshooting.md).
