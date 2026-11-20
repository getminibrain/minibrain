---
title: Where data lives
description: The home folder minibrain writes to, what each part holds, and what to back up.
sidebar:
  order: 10
---

minibrain keeps everything it writes in one home folder: the database, keys, base models, datasets, adapters and
logs. Know where it is before you back up, move or upgrade an install.

## The home folder

| Install | Folder |
|---|---|
| Native | `~/.minibrain`, or the folder `MINIBRAIN_HOME` names |
| Docker and Compose | `/data` in the container: the `minibrain-data` volume |

In Docker, a bind mount in place of the volume must be writable by uid 1000, the container's user:
`sudo chown -R 1000:1000 /srv/minibrain-data`.

## What is inside

| Path | Holds | Back up |
|---|---|---|
| `minibrain.db` | Metadata in SQLite, unless `MINIBRAIN_DATABASE_URL` points at Postgres | Yes |
| `keys/` | The local master key for encryption at rest | Yes, apart from the data |
| `secrets/` | Worker and gateway tokens, the engine token key and the storage secret key. Keep it private | Yes |
| `models/` | Downloaded and imported base models when storage is local; with a bucket, working copies | Yes, when storage is local |
| `artifacts/` | Uploads, dataset versions, adapters and logs, encrypted, when storage is local | Yes |
| `minibrain.yaml` | Optional settings that provision the install ([Configuration](configuration.md)) | Yes |
| `cache/`, `staging/`, `work/` | Unpacked artifacts, DuckDB databases built from uploads, job scratch space | No: rebuilt on use |
| `gateway/`, `engines/`, `worker/` | Copies kept by the gateway, the engines and the worker | No: fetched again |
| `duckdb/extensions/` | Installed DuckDB extensions | No: installed again |
| `huggingface/` | The Hugging Face cache, in Docker. Native installs use `~/.cache/huggingface` | No |

## Keep metadata in Postgres

By default the metadata is in SQLite, `minibrain.db` in the home folder. To keep it in Postgres instead, install the
`postgres` extra (the Docker image has it) and set:

```sh
export MINIBRAIN_DATABASE_URL=postgresql+psycopg://user:password@host/db
```

Back it up with `pg_dump` alongside the home folder.

## Keep artifacts in a bucket

With local storage, base models and artifacts stay under the home folder. To keep them in S3-compatible storage
instead, set the bucket under **Settings** › **Storage**, or in the `storage:` section of `minibrain.yaml`
([Configuration](configuration.md)). Keep versioning on in the bucket, so a restore can find objects deleted after a
backup.

## Keep the master key apart

`keys/` holds the local master key that encrypts artifacts at rest. Back it up, but store it apart from the data: a
copy of the data with its key is readable to anyone who holds both. With Vault, an HSM or a cloud KMS, the key stays
there instead ([Key providers](../security/key-providers.md)).

## Back up

There is no backup command yet. Stop minibrain, then copy the home folder, plus a `pg_dump` with Postgres:

```sh
tar czf minibrain-home.tgz -C "${MINIBRAIN_HOME:-$HOME/.minibrain}" .
```

The commands for Docker and Compose, and how to restore: [Upgrades](upgrades.md#back-up-first).
