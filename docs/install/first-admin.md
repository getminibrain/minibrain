---
title: First admin
description: Create the first admin account with the setup link, from the environment, or through single sign-on, and recover access.
sidebar:
  order: 7
---

Everyone signs in to minibrain, on loopback too, so a new install starts by creating its first admin. The setup link
is the default; automated deploys and single sign-on have their own ways.

| Way | For |
|---|---|
| [Setup link](#use-the-setup-link) | The default, native and Docker |
| [Environment](#create-the-admin-from-the-environment) | Automated deploys: an email and a password file |
| [Single sign-on](#use-single-sign-on-only) | OIDC or proxy headers, with a group mapped to admin; no local admin |
| [Command line](#recover-access) | Recovery: a new password, or another admin |

## Use the setup link

On the first start with no accounts, `minibrain serve` prints a one-time setup link once it listens:

```text
  minibrain has no admin account yet. Create it with this one-time setup link:

    http://127.0.0.1:8000/setup?token=…

  Lost it? minibrain admin setup-link prints a new one.
```

1. Open the link. The page says **Welcome to minibrain**.
2. Enter an email, then a password of at least 12 characters twice.
3. Click **Create admin account**. You are signed in.

| Install | Find the link | Print a new one, voiding the old one |
|---|---|---|
| Native | The terminal that runs `minibrain serve` | `minibrain admin setup-link` |
| Docker | `docker logs minibrain \| grep setup` | `docker exec minibrain minibrain admin setup-link` |
| Compose | `docker compose logs minibrain \| grep setup` | `docker compose exec minibrain minibrain admin setup-link` |

- On a desktop terminal, minibrain also opens the link in the browser; not in Docker, CI, over SSH or without a
  terminal, and never with `--no-browser`.
- The link works once and survives restarts until it is used. Creating the admin any other way voids it. Later starts
  print a reminder instead, since minibrain keeps only a hash of the token and cannot show it again.
- The link names the address minibrain listens on, `127.0.0.1:8000` unless `--host` or `--port` change it. If people
  open minibrain at another address, keep the path and the token, or print a link with that address:
  `minibrain admin setup-link --url https://minibrain.example.com`. The page asks for the token when the link lacks it.

## Create the admin from the environment

Automated deploys create the admin on the first start from two variables:

- `MINIBRAIN_ADMIN_EMAIL`: the admin's email.
- `MINIBRAIN_ADMIN_PASSWORD_FILE`: a file that holds the password, such as a Docker or Kubernetes secret. A trailing
  newline is dropped.

Both are read on the first start only and ignored once any account exists, so changing them later changes nothing. A
missing or unreadable file, a password under 12 characters or a malformed email stops the start with the reason.
`MINIBRAIN_ADMIN_PASSWORD`, with the password itself, also works but logs a warning: environment variables show in
`docker inspect` and process listings. minibrain never logs the password.

With `docker run`, mount the file read-only; it must be readable by uid 1000, the container's user:

```sh
docker run -d --name minibrain -p 127.0.0.1:8000:8000 -v minibrain-data:/data \
  -e MINIBRAIN_ADMIN_EMAIL=admin@example.com \
  -e MINIBRAIN_ADMIN_PASSWORD_FILE=/run/secrets/admin_password \
  -v "$PWD/admin_password.txt:/run/secrets/admin_password:ro" \
  ghcr.io/getminibrain/minibrain
```

With Compose, add this to `compose.yaml`, with the password in `admin_password.txt` next to it:

```yaml
services:
  minibrain:
    environment:
      MINIBRAIN_ADMIN_EMAIL: admin@example.com
      MINIBRAIN_ADMIN_PASSWORD_FILE: /run/secrets/minibrain_admin_password
    secrets:
      - minibrain_admin_password

secrets:
  minibrain_admin_password:
    file: ./admin_password.txt
```

On Kubernetes, mount a Secret as a volume and point `MINIBRAIN_ADMIN_PASSWORD_FILE` at the file.

## Use single sign-on only

With `auth.oidc` or `auth.proxy` set in `minibrain.yaml`, no local admin is needed when one of these names the admins:
`auth.roles` maps a group to admin, `auth.admins` lists people by email or user name, or `auth.default_role` is
`admin`. minibrain then issues no setup link: the first page is sign-in, and whoever signs in from the admin group,
or is listed, is an admin.
With single sign-on but no admin named, the setup link is issued as usual. Setting it up: [Accounts and
sign-in](../security/accounts.md) and [Configuration](configuration.md).

`minibrain admin create` still adds a local admin, such as a break-glass account.

## Recover access

Run these on the server, or with `docker exec -it minibrain` in front in Docker:

```sh
minibrain admin reset-password --email admin@example.com
minibrain admin create --email ops@example.com
```

- `reset-password` sets a new password for a local account, clears its lockout and ends its sessions.
- `create` adds another admin; `--name` sets the display name.
- Both ask for the password, or read it from standard input with `--password-stdin`, and record `command line` as
  the actor in the [audit log](../security/audit.md).
