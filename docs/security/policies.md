---
title: Policies
description: The install-wide rules under Settings › Security, how to lock them from the settings file, and what request logs keep.
sidebar:
  order: 2
---

Policies are install-wide rules that admins set under **Settings › Security**: which hosts minibrain may reach, which
models it may download, how long sessions and logs last, and where audit events, traces and keys go. The server
enforces each one where the action happens, and every change is written to the audit log with who made it and the
value before and after (`policy.update`).

## Lock a policy from the file or the environment

Set a policy in `minibrain.yaml` under `policy:`, or with `MINIBRAIN_POLICY_<NAME>` (the name in capitals, such as
`MINIBRAIN_POLICY_LOG_RETENTION_DAYS`), and it is locked in the UI, which shows **Set by config file** or
**Set by environment**. The environment wins over the file. Policies set neither way stay editable in Settings.

```yaml title="minibrain.yaml"
policy:
  network: allowlist
  allowed_hosts: [hf-mirror.corp.example]
  log_retention_days: 90
  key_expiry_days: 180
  audit_retention_days: 365
```

`MINIBRAIN_OFFLINE=1` forces the Network policy to Offline, and `auth.default_role` locks Role for new people.
`minibrain config export` prints the effective settings as `minibrain.yaml`, with secrets named but never included.
More on the file: [Configuration](../install/configuration.md).

## The policies

In the order Settings › Security shows them:

| Policy (name) | Values | Enforced at |
|---|---|---|
| Network (`network`) | Open (default), Allowlist or Offline | Model downloads and retries, S3 imports, catalogue updates, Add from Hugging Face, connections to buckets and databases, DuckDB extension installs from a URL ([what leaves your network](network.md#what-leaves-your-network)) |
| Allowed hosts (`allowed_hosts`) | Host names, such as your Hugging Face mirror | The same, when Network is Allowlist |
| Model sources (`model_sources`) | Approved publishers (default), Any model or Imports only | Download and retry; Add from Hugging Face is offered only with Any model |
| Allowed licences (`licence_mode`, `licences`) | Only selected licences (default: those reviewed for commercial use), or Any licence, including unreviewed ones | Download, retry, Add from Hugging Face |
| Safetensors weights only (`safetensors_only`) | Always on | The download file filter: pickle weights, which can run code, are never loaded |
| Folder sources (`data_folders`) | Server folders; empty allows none | Folder sources and Delta Lake tables read only these folders and what is under them ([why](network.md#tls-in-duckdb-extensions)) |
| Role for new people (`default_role`) | No role (default), Viewer, Builder or Admin | Single sign-on and proxy people with no mapped group ([Roles](accounts.md#roles)) |
| Sign-in idle timeout, minutes (`session_idle_minutes`) | 480; 0 turns it off | Every session ([Sessions](accounts.md#sessions)) |
| Session lifetime, hours (`session_hours`) | 168, from 1 to 2,160 | Every session |
| Request inputs and answers (`request_bodies`) | Off (default) or on | The value new models start with ([below](#request-logs)) |
| Lock for every model (`request_bodies_locked`) | Off (default) or on | Every model's switch |
| Log retention, days (`log_retention_days`) | 30 | Hourly purge of request logs and idle Playground chats |
| API key expiry, days (`key_expiry_days`) | 0, never (default) | New keys ([below](#api-key-expiry)) |
| SIEM export, host, port, CA bundle (`siem_*`) | Off (default), TLS, TCP or UDP | [Send events to a SIEM](audit.md#send-events-to-a-siem) |
| Audit log retention, days (`audit_retention_days`) | 0 keeps every event (default) | [Retention](audit.md#retention) |
| OpenTelemetry export, endpoint, headers, service name, CA bundle (`otel_*`) | Off (default) or OTLP over HTTP; also `OTEL_EXPORTER_OTLP_*` | Exporters in main and gateways, within 5 seconds; header values are stored encrypted and never shown again ([OpenTelemetry](../observability/opentelemetry.md)) |
| Master key and provider settings (`encryption`, `vault_*`, `hsm_*`, `kms_*`) | Local key file (default), HashiCorp Vault Transit, PKCS#11 HSM, AWS KMS or Off | Every file main stores ([Encryption at rest](encryption.md), [Key providers](key-providers.md)) |

## Request logs

Every `/v1` request is logged with its time, model, version, API key, status, latency, tokens in and out, finish
reason and response ID. These logs hold no content. Monitoring, the model pages, cost and the Requests tab are built
from them, so they cannot be turned off; **Log retention** deletes them.

The request's input (its last user message) and the model's answer are kept only for models whose
**Keep request inputs and answers** switch is on, on the model's Settings tab under Request content. It is off by
default.

- Builders change the switch. Each change is audited as `model.request_bodies` with the value before and after.
- Kept inputs and answers let apps send feedback with the response ID alone, feed distillation, and show on the
  Requests tab to Builders and Admins. They are stored in the database next to the request log and deleted with it.
  minibrain does not encrypt the database: see [What is encrypted](encryption.md#what-is-encrypted).
- **Request inputs and answers** is the value new models start with, and the setting for base models served directly
  through `/v1`.
- **Lock for every model** makes every model, existing and new, follow it: each model's switch shows the value and
  cannot be changed, and a Builder's change is refused (409). Setting `request_bodies` in `minibrain.yaml` or
  `MINIBRAIN_POLICY_REQUEST_BODIES` locks it for every model too, unless `request_bodies_locked: false` is set beside
  it.
- `POST /v1/feedback` without `input`, for a model that does not keep them, answers 422 and names the model's switch.
- Gateways, standalone ones included, pick up each model's value within a second of a change.
- Playground chats are deleted once idle for the log retention period, and are not saved at all while the lock holds
  inputs and answers off.

## API key expiry

**API key expiry (days)** sets when new keys expire; existing keys keep their expiry. The gateway answers 401 for an
expired key, and 403 for a model the key does not cover. Making keys: [API overview](../api/overview.md).
