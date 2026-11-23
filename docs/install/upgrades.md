---
title: Upgrades
description: Install a new minibrain release on main and on every machine that joined it, keep the data, and roll back if needed.
sidebar:
  order: 11
---

An upgrade installs a new minibrain release on main and on every machine that joined it, keeps the data, and migrates
the database when main starts.

Today an upgrade stops main for as long as the restart takes. On one machine (`minibrain serve`) that stops inference
too, because the gateway and the local engines run inside main. With standalone gateways and engines on other
machines, inference keeps going from the gateways' cached configuration
([How serving works](../reference/how-serving-works.md)). Not built yet: rolling upgrades of main without downtime, a
policy for running main and machines on different releases, a backup command and a downgrade command. Going back to an
older release means restoring a backup.

:::caution
Upgrades start from 0.1.1. A database made by 0.1.0 predates the current migrations and cannot be upgraded: start
0.1.1 or later on a new home folder and database.
:::

## Check the running version

| Where | Shows |
|---|---|
| The user menu | Its last line, such as `minibrain 0.1.2`, for anyone signed in |
| **Settings** › **This install** › **Software** | The `minibrain` row and the **Build** commit (admins) |
| **Infrastructure** › **Machines**, a machine's **Versions** | Each library on that machine beside main's |

From a shell: `uv tool list`, `pip show minibrain` in the virtual environment, or for Docker:

```sh
docker exec minibrain python -c "import importlib.metadata as m; print(m.version('minibrain'))"
```

## Read the release notes

Each [GitHub Release](https://github.com/getminibrain/minibrain/releases) carries notes: the install and verify
commands for that version, then every change since the previous release, breaking changes first. Read the notes of
every release between yours and the one you install; main applies the migrations in between in order. Check
`minibrain.yaml` against them: main stops on a value it rejects and names the key, and logs a key it no longer knows
as a warning ([Configuration](configuration.md)).

## Back up first

There is no backup command yet, and restore is not tested end to end. Stop main, then copy:

| What | Where | Note |
|---|---|---|
| The home folder | `~/.minibrain` or `MINIBRAIN_HOME`; `/data` (the `minibrain-data` volume) in Docker | Holds `minibrain.db`, `secrets/`, `minibrain.yaml` and, with local storage, `models/` and `artifacts/` |
| Postgres | The database `MINIBRAIN_DATABASE_URL` names | Instead of `minibrain.db` |
| The master key | `keys/` in the home folder, or the file `MINIBRAIN_MASTER_KEY_FILE` names | Keep it apart from the data. With Vault, an HSM or KMS it stays there ([Key providers](../security/key-providers.md)) |
| The bucket | **Settings** › **Storage**, when artifacts live in S3-compatible storage | Keep versioning on: objects deleted after the backup are gone otherwise |

[Where data lives](data-folder.md) lists the folders minibrain rebuilds, which a backup can leave out. Use the line
for your install (native, Docker, Compose), plus `pg_dump` with Postgres:

```sh
tar czf minibrain-home.tgz -C "${MINIBRAIN_HOME:-$HOME/.minibrain}" .
docker stop minibrain
docker run --rm --user 0 --entrypoint tar -v minibrain-data:/data -v "$PWD":/backup ghcr.io/getminibrain/minibrain:cuda \
  czf /backup/minibrain-data.tgz -C /data .
docker compose stop
docker compose run --rm --user 0 --entrypoint tar -v "$PWD":/backup minibrain czf /backup/minibrain-data.tgz -C /data .
pg_dump --format=custom --file=minibrain.dump --host=db.internal --username=minibrain minibrain
```

The archive holds `keys/`: store it as carefully as the key, or add `--exclude=./keys` and keep the key elsewhere.
Every command that opens the database migrates it: `minibrain serve` and the `admin`, `audit`, `keys` and `config`
commands. Back up before running any of them on the new release.

## Upgrade main

1. Read the release notes. To shorten the stop, pull the new image or download the release first.
2. Stop main. With several mains on Postgres, stop all of them: migrations are not yet written for two releases to
   share one database.
3. Back up (above).
4. Install the new release the way you installed the old one (below). The installer checks the signature when cosign
   is installed; otherwise [verify the release](verify-release.md) first.
5. Start main. It migrates the database before it listens ([What happens on start](#what-happens-on-start)). With
   several mains, start one, wait until `/readyz` answers, then start the others.
6. Check `curl -s http://127.0.0.1:8000/healthz`, the version in the user menu and the log. A release with a new
   DuckDB needs that version's extensions: the image carries them; a native install runs `minibrain extensions install`.
7. Upgrade the machines that joined main ([below](#upgrade-machines-that-joined-main)).

### Installer

```sh
curl -LsSf https://raw.githubusercontent.com/getminibrain/minibrain/main/install.sh | sh
curl -LsSf https://raw.githubusercontent.com/getminibrain/minibrain/main/install.sh | MINIBRAIN_VERSION=<version> sh
```

It checks the wheel's SHA-256 and reinstalls minibrain over the old one. With `--docker` it only pulls the new image:
replace the container as under Docker.

### uv, uvx and pip

```sh
uv tool upgrade minibrain
uvx --refresh --python 3.12 minibrain serve
uvx --python 3.12 minibrain@<version> serve
pip install --upgrade minibrain
```

Run `pip` inside the virtual environment, and name extras again: `pip install --upgrade 'minibrain[postgres]'`.

### Docker and Compose

After stopping and backing up; the last line is the Compose equivalent:

```sh
docker pull ghcr.io/getminibrain/minibrain:<version>-cuda
docker rm minibrain
docker run -d --name minibrain --restart unless-stopped --stop-timeout 30 --gpus all --shm-size 8g \
  -p 127.0.0.1:8000:8000 -v minibrain-data:/data ghcr.io/getminibrain/minibrain:<version>-cuda
docker compose pull && docker compose up -d
```

Keep every flag of your own `docker run` and change only the tag; the CPU image's tag is `<version>`
([Docker](docker.md#image-tags)). With Compose and a release pinned in `.env`, set `MINIBRAIN_IMAGE` to the new tag
first; a local build is `docker compose up -d --build` ([Docker Compose](compose.md)).

## What happens on start

- main runs every migration between the database's revision and the new release's before it listens, on SQLite and
  Postgres alike, then checks `minibrain.yaml`. `/healthz` answers once both are done. A failure stops main with the
  error in its log: restore the backup.
- An older release refuses a database a newer one migrated, with `Can't locate revision identified by '…'`.
- Workers, standalone gateways and engines never open the database, so they run no migrations.
- main extends the leases of running jobs when it starts, so jobs on other machines carry on.

While main is down:

| Part | Does |
|---|---|
| UI, `/api`, new jobs, deploys, API key changes | Wait for main |
| Gateway and engines inside `minibrain serve` | Stop with main |
| Standalone gateways (`minibrain gateway`) | Serve from the last config they saved; keep up to 10,000 request log entries and send them when main is back |
| Engines on other machines | Keep serving; an adapter they have not loaded yet waits for main |
| Workers on other machines | Keep running their jobs, retry main every 30 s at most, and send the jobs' events later |
| Jobs on main's own worker | Stop with main and are retried; training resumes from its last checkpoint |

## Upgrade machines that joined main

Run every worker, engine and standalone gateway on main's release ([Add machines](machines.md)). There is no
version-skew policy yet: mixed releases are not tested, and main does not turn a machine away for its version. Until it
matches, **Infrastructure** › **Machines** marks the machine **Version drift**, and **Health** says, for
example, `gpu-01 runs other library versions than main: minibrain 0.1.1 (main has 0.1.2)`. The check compares
minibrain, torch, transformers and peft, ignoring local build tags such as `+cu132`. For each worker machine, after
main:

1. In **Infrastructure** › **Machines**, open the machine and click **Drain**. Its jobs finish and no new one starts
   there; each engine keeps serving until another machine in the pool has its model ready. A model no other machine
   can take keeps serving here and stops with the worker ([Machine health](machine-health.md)).
2. Wait for "Drained: nothing runs here and it takes no new work. Safe to remove."
3. Stop `minibrain worker`, upgrade it the same way as main, and start it with the same command. It keeps its approval
   in `<home>/worker/approval.json`, or joins again with its token ([Add machines](machines.md)). A drained machine
   stays drained across the restart.
4. Click **Undrain**. Its **Versions** table shows no drift.

Restart standalone gateways one at a time behind the load balancer; each reads its saved config at start and answers
`/readyz` with it. Restart standalone engines (`minibrain engine`) one at a time; gateways fail over to other replicas.

## Roll back

There is no downgrade command: migrations only run forward. To go back, restore the backup and install the older
release.

1. Stop main (every main) and the machines you upgraded.
2. Restore the backup, keeping the upgraded copy aside until the older release runs:

   ```sh
   mv ~/.minibrain ~/.minibrain.upgraded && mkdir ~/.minibrain && tar xzf minibrain-home.tgz -C ~/.minibrain
   docker volume create minibrain-restored
   docker run --rm --user 0 --entrypoint tar -v minibrain-restored:/data -v "$PWD":/backup \
     ghcr.io/getminibrain/minibrain:cuda xzf /backup/minibrain-data.tgz -C /data
   pg_restore --clean --if-exists --host=db.internal --username=minibrain --dbname=minibrain minibrain.dump
   ```

3. Install the older release: the installer with `MINIBRAIN_VERSION=<version>`,
   `uv tool install --python 3.12 'minibrain==<version>'`, `pip install 'minibrain==<version>'`, or the older image
   tag, run with `-v minibrain-restored:/data`.
4. Start main, then the machines on the same release.

Everything after the backup is lost: jobs, trained versions, deploys, request logs and audit events (a SIEM keeps the
events it received). Objects written to a bucket since then stay there, unused.
