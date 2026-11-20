---
title: CLI
description: Every minibrain command and its main options.
sidebar:
  order: 3
---

`minibrain` is the one command for every role and every admin task. `minibrain --help` and `minibrain <command> --help`
list the same options as this page.

Commands that work on the install's data (`admin`, `config`, `keys` and `audit`) run on main's machine, with main's
`MINIBRAIN_HOME` and environment. In Docker, run them inside main's container:

```sh
docker exec minibrain minibrain admin setup-link
```

## minibrain serve

```text
minibrain serve [--host HOST] [--port PORT] [--no-worker] [--no-browser]
```

Runs main: the UI, the API, the gateway, a local worker for jobs, and an engine per model served on this machine.

| Option | Default | Does |
|---|---|---|
| `--host` | `127.0.0.1` | The interface to listen on; `0.0.0.0` lets other machines reach main |
| `--port` | `8000` | The port to listen on |
| `--no-worker` | | Starts main without its local worker, so no job runs on this machine |
| `--no-browser` | | Does not open the first admin's setup link in a browser |

## minibrain worker

```text
minibrain worker [--main URL] [--pool POOL] [--advertise ADDRESS] [--engine-bind ADDRESS]
                 [--no-serve] [--gpus N] [--kinds KIND ...]
```

Runs a worker on another machine: it joins a pool, runs jobs and starts engines for the models deployed there.

| Option | Default | Does |
|---|---|---|
| `--main`, `--api-url` | `http://127.0.0.1:8000` | main's address |
| `--pool` | | The pool to join; required with a join token. Without one, an admin approves the machine and may pick another pool |
| `--advertise` | The machine's name | The address gateways reach this machine's engines at |
| `--engine-bind` | The `--advertise` address | The interface engines listen on |
| `--no-serve` | | Runs jobs only; never starts engines |
| `--gpus` | `1` | How many GPU jobs run at once |
| `--kinds` | `train eval judge export` | The job kinds this worker claims |

`MINIBRAIN_JOIN_TOKEN` holds the pool's join token. Steps and messages: [Add machines](../install/machines.md).

## minibrain engine

```text
minibrain engine --model KEY [--main-url URL] [--pool POOL] [--host HOST] [--port PORT] [--url URL] [--engine ENGINE]
```

Serves one model on a machine without a worker. It needs the pool's join token in `MINIBRAIN_JOIN_TOKEN`, or a machine
already approved for the same main.

| Option | Default | Does |
|---|---|---|
| `--model` | | The model key, as shown on the Models page |
| `--main-url` | `http://127.0.0.1:8000` | main's address |
| `--pool` | `local` | The pool this machine joins |
| `--host` | `127.0.0.1` | The interface to listen on; `0.0.0.0` for gateways on other machines |
| `--port` | `8200` | The port to listen on |
| `--url` | `http://<host>:<port>`, with the machine's name for `0.0.0.0` | The address gateways use to reach this engine |
| `--engine` | `auto` | `auto`, `sglang`, `vllm`, `mlx`, `transformers` or `llamacpp` ([Engines](how-serving-works.md#engines)) |

## minibrain gateway

```text
minibrain gateway [--main-url URL] [--host HOST] [--port PORT]
```

A gateway that answers `/v1` from the last configuration it saved, so it keeps answering while main restarts.

| Option | Default | Does |
|---|---|---|
| `--main-url` | `http://127.0.0.1:8000` | main's address |
| `--host` | `127.0.0.1` | The interface to listen on |
| `--port` | `8100` | The port to listen on |

On another machine, set `MINIBRAIN_GATEWAY_TOKEN` to the contents of `secrets/gateway_token` in main's `MINIBRAIN_HOME`.

## minibrain admin

```text
minibrain admin create --email EMAIL [--name NAME] [--password-stdin]
minibrain admin reset-password --email EMAIL [--password-stdin]
minibrain admin setup-link [--url URL]
```

- `create` adds an admin account. It asks for the password twice, at least 12 characters; `--password-stdin` reads
  it from standard input instead.
- `reset-password` sets a new password for a local account, unlocks it and ends its sessions.
- `setup-link` prints a new one-time link that creates the first admin; earlier links stop working. `--url` sets the
  address people open minibrain at. It refuses once any account exists.

```sh
printf '%s\n' "$ADMIN_PASSWORD" | minibrain admin create --email admin@example.com --password-stdin
```

More: [First admin](../install/first-admin.md) and [Accounts and sign-in](../security/accounts.md).

## minibrain config

```text
minibrain config export [--output FILE]
```

Prints the install's current settings as `minibrain.yaml`, with every secret named but never included; `--output`
writes them to a file. Format: [Configuration](../install/configuration.md).

## minibrain keys

```text
minibrain keys status [--json]
minibrain keys rotate [--retire-now]
minibrain keys encrypt-existing
```

- `status` shows the key provider, the key versions and how many files use each.
- `rotate` makes a new master key version and re-wraps every data key under it. Older local key versions stay
  readable until nothing uses them and the new key is an hour old; `--retire-now` drops them at once, for use only
  when no server is running.
- `encrypt-existing` encrypts files written before encryption at rest was on, in place.

More: [Encryption at rest](../security/encryption.md).

## minibrain audit

```text
minibrain audit verify [--file FILE] [--json]
```

Walks the audit log's hash chain and reports the first break, with exit code 1 on a break. `--file` checks a full JSONL
export instead of the database; `--json` prints the report as JSON. More: [Audit log](../security/audit.md).

## minibrain extensions

```text
minibrain extensions [status]
minibrain extensions install [--from SOURCE] [NAME ...]
minibrain extensions download --to FOLDER [--platform PLATFORM] [--from SOURCE] [--version VERSION] [NAME ...]
```

DuckDB extensions read S3, databases, Iceberg and Delta Lake sources. The Docker image has them; native installs fetch
them with these commands.

- `status`, or no action, shows which are installed.
- `install` installs them from `--from` (a folder or mirror URL), else `MINIBRAIN_DUCKDB_EXTENSION_REPOSITORY`, else
  extensions.duckdb.org.
- `download` saves them to a folder on a connected machine, for `--platform` such as `linux_amd64` (repeatable) and
  DuckDB `--version` such as `v2.0.0`.

More: [Air-gapped installs](../install/air-gapped.md).

## minibrain openapi

```text
minibrain openapi [--output FILE]
```

Prints the OpenAPI schema of main's API, or writes it to `--output`.
