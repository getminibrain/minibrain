---
title: Network and ports
description: Trust zones, ports, how machines join, where TLS goes, and every connection that can leave your network.
sidebar:
  order: 3
---

main, gateways, workers and engines talk to each other over HTTP. This page shows which zone each belongs in, which
ports to open, how other machines prove who they are, where to add TLS, and what minibrain sends outside your network.

## Trust zones

<img class="dark:sl-hidden" src="../diagrams/production.svg" alt="Production: load balancers, gateways, two mains, GPU pools, Postgres and S3, in trust zones">
<img class="light:sl-hidden" src="../diagrams/production-dark.svg" alt="Production: load balancers, gateways, two mains, GPU pools, Postgres and S3, in trust zones">

| Zone | Holds | Accepts connections from | Ports |
|---|---|---|---|
| Corporate network | Apps, browsers | | |
| Edge | Load balancers | The corporate network | 443 |
| Internal network | Gateways, mains, Postgres, S3 | The edge; the GPU network reaches main only, and the bucket when Storage is S3 | Gateway 8100, main 8000, Postgres 5432, S3 443 |
| GPU network | Workers, engines | Engines: gateways only. Workers: nothing | Outbound HTTPS to main, and to the bucket when Storage is S3 |

- GPU machines need no internet access. Workers and engines pull dataset versions, adapters and base weights from
  main or, when Storage is S3, from the bucket on short-lived links main signs. They never hold bucket keys.
- Gateways reach engines on a free port per engine at the worker's `--advertise` address, or 8200 for
  `minibrain engine`.
- `minibrain serve` listens on `127.0.0.1:8000` unless `--host` or `--port` change it, and serves `/v1` on the same
  port.

## TLS

main, gateways and engines serve plain HTTP. Put TLS in front:

- A TLS reverse proxy or load balancer in front of main and gateways. Give workers main's `https://` address: that
  channel carries tokens, data, adapters and data keys.
- Engines answer gateways over plain HTTP: keep them on a private network.
- Sign-in needs HTTPS anywhere but localhost ([Sessions](accounts.md#sessions)).

For the TLS connections minibrain makes itself, these settings trust an internal CA; empty trusts the system's CAs:

| Connection | Setting |
|---|---|
| OIDC provider | `auth.oidc.ca_bundle` |
| SIEM | `siem_ca_bundle` |
| OpenTelemetry collector | `otel_ca_bundle` |
| HashiCorp Vault | `vault_ca_bundle` |

Content hashes and signatures use SHA-256 through OpenSSL or the `cryptography` library, never MD5 or SHA-1.

## How machines join

A worker or engine on another machine joins a pool with a pool token or with an admin's approval: never with
database credentials, and there is no switch that lets machines join unchecked. Steps: [Add machines](../install/machines.md).

- Pool token (`MINIBRAIN_JOIN_TOKEN`): 256 random bits after `mbj_`, shown once when an admin makes or rotates it.
  main keeps only its SHA-256 and first 12 characters. Rotating revokes the old token at once: its workers get 401
  and stop with the reason, and the engine tokens minted from it end too.
- Approval: a worker started without a token asks to join with its host name, a hardware summary and the pool it
  wants, and prints a 6-character code. The request waits under Infrastructure › Machines › **Waiting for approval**
  for an hour, then expires. An admin checks the code and approves it into a pool, or denies it. The worker then gets
  a machine credential bound to that pool and host, handed out once, kept by main only as a SHA-256, and saved by the
  worker in `<home>/worker/approval.json` (mode 0600). Removing the machine revokes it; rotating the pool token does
  not.
- Join requests are limited to 5 waiting per address and 50 in all (429). A new request from the same host and
  address replaces its older one.
- Each credential works for its own pool only. Registering, claiming jobs, asking for engines or announcing an engine
  in another pool answers 403, as does an approved credential used from another host.
- Engines a worker starts get a narrower engine token for their pool: announce in that pool, read base weights, and
  read adapters of models served in that pool. They never get the gateway token, whose configuration carries routes
  and API key digests. Rotating the pool token or removing the approved machine ends its engines' tokens at once
  (401), in that pool only.
- A worker downloads only what the jobs it holds need: main serves only the dataset version, adapter and base model
  named in a running job leased to a worker of the same pool. Anything else, including another pool's dataset or the
  same job's inputs after its lease ends, answers 403. An engine gets an adapter only when a version on a base model
  deployed, or running, in its pool uses it.
- The worker main starts on its own machine joins only the `local` pool, which takes no other machine. Its engines
  use the gateway token, and the pool token rules above do not apply to them.
- Making and rotating tokens, first joins, requests, approvals, denials, revocations and every refusal (wrong pool or
  host, revoked, too many requests) are audit events (`join_token.*`, `join_request.*`), refusals at most one per
  credential, reason and address in 10 minutes.

## What leaves your network

minibrain sends no telemetry: no usage data, crash reports or analytics go to its developers or anyone else.

- Governed by the Network policy (Open, Allowlist or Offline; [Policies](policies.md)): Hugging Face downloads, model
  imports from S3, catalogue updates, connections to buckets and databases, and DuckDB extension installs from a URL.
- Always used, because an admin configured them: artifact storage in a bucket, the SIEM, the OpenTelemetry collector,
  Vault or AWS KMS holding the master key, and the OIDC provider.

With Offline, nothing leaves the install except to that second list. **Settings › This install › Network** lists each
destination and whether it is allowed; Settings › Security shows the key service. The OpenTelemetry exporter ignores
proxy variables and does not follow redirects. Installs with no outside access: [Air-gapped installs](../install/air-gapped.md).

`/metrics` is off until `metrics.addresses` or a scrape token is set, and then needs that address or token, not a
session ([Metrics](../observability/metrics.md)). Every response carries an `X-Request-ID`, and JSON logs
(`MINIBRAIN_LOG_FORMAT=json`) carry it on each line.

## TLS in DuckDB extensions

S3, Iceberg and Delta Lake sources are read by DuckDB extensions: native code that minibrain's Python crypto checks
cannot see. Checked on DuckDB v2.0.0:

| Extension | Sources | TLS and S3 request signing |
|---|---|---|
| httpfs | S3, Iceberg data and metadata | OpenSSL 3.6.0, linked into the extension |
| iceberg, avro | Iceberg | None of their own: they read through httpfs |
| delta | Delta Lake | The table log: its own Rust HTTP client with rustls and ring, not OpenSSL. Data files: httpfs |

So minibrain reads Delta tables only from server folders listed under Settings › Security › Data ›
**Folder sources**: local disk, NFS or SMB, or a bucket mounted by a client whose TLS you control.

- `s3://`, `https://` and every other URL is refused when the source is added, and dataset SQL cannot call `delta_*`
  functions.
- On a local path the extension opens no connection and does no cryptography, and may read only the table's folder.
- A `_delta_log` that is a symbolic link is refused.
- DuckDB's unsigned extensions setting stays off.
