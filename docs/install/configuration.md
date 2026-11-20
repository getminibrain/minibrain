---
title: Configuration
description: Provision an install with minibrain.yaml, and set the environment variables minibrain reads.
sidebar:
  order: 6
---

Everything can be set in the UI. To provision an install from a file instead, so a new server starts with the same
policies, sign-in, storage and connections, write `minibrain.yaml`. Environment variables set the same keys and a few
more, and win over the file.

## Where the file lives

minibrain reads `minibrain.yaml` from its home folder: `~/.minibrain/minibrain.yaml` on a native install,
`/data/minibrain.yaml` in Docker. `MINIBRAIN_CONFIG` points at a file elsewhere. Without the file, everything is set in
the UI.

## How the file applies

- Anything the file sets is locked in the UI: the row shows **Set by config file** and saving it is refused. Leave a
  setting out to keep it editable.
- `storage:` is all or nothing: once it is in the file, the UI's storage settings are ignored.
- minibrain checks the file when it starts. A bad value stops it with the key named, such as
  `data.row_limit: Input should be greater than or equal to 100`. An unknown section or key is logged as a warning and
  ignored.
- Pools and machines are not in the file: machines join a pool when they start with `--pool`
  ([Add machines](machines.md)). Prices are set by pool name, so they apply once a machine joins.

## Keep secrets out of it

The file never holds a secret. Name where it is instead: `secret_env` (an environment variable) or `secret_file` (a
file, such as a Docker or Kubernetes secret). A `secret`, `password` or `token` key stops the start with the reason,
and so do `auth.oidc.client_secret` (use `client_secret_file` or `MINIBRAIN_OIDC_CLIENT_SECRET`) and header values in
`policy.otel_headers` (use `otel_headers: {secret_env: NAME}` or `{secret_file: /path}`).

## Example

```yaml title="minibrain.yaml"
policy:                               # Settings > Security
  network: allowlist                  # open, allowlist or offline
  allowed_hosts: [hf-mirror.internal, minio.internal]
  model_sources: approved             # approved, any or imports
  log_retention_days: 30
  session_idle_minutes: 480
  encryption: vault                   # local, vault, hsm, kms or off
  vault_address: https://vault.internal:8200

auth:                                 # Settings > Accounts
  default_role: none                  # role for people whose groups map to none
  admins: [ada@corp.example, grace]   # emails or user names that are admins; needs oidc or proxy below
  roles:                              # identity provider group -> viewer, builder or admin
    minibrain-admins: admin
    ml-team: builder
  proxy:
    addresses: [10.0.0.10/32]         # identity headers count only from these addresses
  oidc:
    issuer: https://keycloak.corp/realms/corp
    client_id: minibrain
    client_secret_file: /run/secrets/oidc

logging:
  format: json                        # text or json

metrics:
  addresses: [10.0.0.20/32]           # Prometheus scrapers
  token_file: /run/secrets/metrics

storage:                              # Settings > Storage: where artifacts live
  kind: s3                            # local (under the home folder) or s3
  endpoint: https://minio.internal:9000
  bucket: ml-artifacts
  prefix: minibrain
  region: ""                          # empty unless the store asks for one
  access_key: AKIAEXAMPLE             # the key ID, not a secret
  secret_file: /run/secrets/s3        # or secret_env: NAME

data:                                 # Settings > Data
  row_limit: 200000                   # most rows in one dataset version
  keep_versions: 5                    # unused versions kept per dataset
  checks_off: [personal_data]         # duplicates, conflicts, balance, leakage, length, personal_data
  majority_share: 0.9                 # warn when one label holds more than this share
  min_label_rows: 10                  # warn when a label has fewer rows

compute:                              # Settings > General > Compute prices
  currency: EUR
  prices:                             # per hour of one pool's GPU time, by pool name
    local: 2.5
    a100: 3.2

catalogue:
  daily_sync: true                    # look for a newer model catalogue once a day

connections:                          # Settings > Connections
  - name: Exports bucket
    kind: s3
    endpoint: https://minio.internal:9000
    bucket: exports
    access_key: AKIAEXPORTS
    secret_env: EXPORTS_S3_SECRET
  - name: Warehouse
    kind: postgres                    # or mysql
    host: db.internal
    port: 5432
    database: analytics
    user: reader
    ssl_mode: verify-full
    secret_file: /run/secrets/warehouse
```

Every policy name and value: [Policies](../security/policies.md). Sign-in sections: [Accounts and
sign-in](../security/accounts.md).

- `auth.admins` names people who sign in with single sign-on or through the proxy. They are admins whatever their
  groups, need no setup link, and their role is locked. Without `auth.oidc` or `auth.proxy` it is logged as a warning
  and the setup link works as before.
- Connections from the file show **Set in minibrain.yaml** and cannot be edited or deleted in the UI. Each keeps its
  id while its name stays, so sources that use it keep working; renaming it makes a new one. One removed from the file
  stays, marked, while sources still use it. A connection made in the UI becomes managed by the file when the file
  names it.

## Export the current settings

```sh
minibrain config export > minibrain.yaml
```

It prints the install's current settings in this format, with every secret named but never included, and a comment
listing what to provide on the new server. Starting on the exported file gives the same settings, now locked.

## Environment variables

`MINIBRAIN_<SECTION>_<KEY>` sets a key of `storage`, `data`, `catalogue` or `compute.currency`, such as
`MINIBRAIN_DATA_ROW_LIMIT=500000` or `MINIBRAIN_STORAGE_BUCKET=ml-artifacts`. Policies use `MINIBRAIN_POLICY_<NAME>`,
such as `MINIBRAIN_POLICY_LOG_RETENTION_DAYS=30`. The UI shows **Set by environment** for these.

| Variable | For |
|---|---|
| `MINIBRAIN_HOME` | The home folder, `~/.minibrain` by default ([Where data lives](data-folder.md)) |
| `MINIBRAIN_CONFIG` | The path of `minibrain.yaml`, when it is not in the home folder |
| `MINIBRAIN_DATABASE_URL` | Metadata in Postgres, such as `postgresql+psycopg://user:password@host/db`; needs the `postgres` extra |
| `MINIBRAIN_STORAGE_S3_SECRET` | The storage bucket's secret key, unless `storage` names another |
| `MINIBRAIN_HF_ENDPOINT` | An internal Hugging Face mirror; with the Allowlist network policy, allow its host |
| `MINIBRAIN_MODELS_S3_URL`, `AWS_*` | Base models from an S3-compatible bucket ([Base models](../guides/models.md)) |
| `MINIBRAIN_TRAIN_DEVICE` | Force `cuda`, `xpu`, `mps` or `cpu` for training ([GPUs](gpus.md)) |
| `MINIBRAIN_SGLANG_PYTHON`, `MINIBRAIN_VLLM_PYTHON` | The Python of a separate SGLang or vLLM environment ([GPUs](gpus.md)) |
| `MINIBRAIN_ADMIN_EMAIL`, `MINIBRAIN_ADMIN_PASSWORD_FILE` | Create the first admin on the first start ([First admin](first-admin.md)) |
| `MINIBRAIN_OIDC_CLIENT_SECRET` | The single sign-on client secret ([Accounts and sign-in](../security/accounts.md)) |
| `MINIBRAIN_LOG_FORMAT` | `json` for one JSON object per log line ([Logs](../observability/logs.md)) |
| `MINIBRAIN_METRICS_TOKEN`, `MINIBRAIN_METRICS_ADDRESSES` | Turn on `/metrics` for Prometheus ([Metrics](../observability/metrics.md)) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` | Export to your OpenTelemetry collector ([OpenTelemetry](../observability/opentelemetry.md)) |
| `MINIBRAIN_OFFLINE`, `HF_HUB_OFFLINE`, `HF_DATASETS_OFFLINE` | `1` turns off every outbound call ([Air-gapped installs](air-gapped.md)) |

Encryption keys and their providers have their own variables: [Key providers](../security/key-providers.md).
