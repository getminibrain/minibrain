---
title: Accounts and sign-in
description: How people sign in with a password, single sign-on or a trusted proxy, how sessions work, and what each role may do.
sidebar:
  order: 1
---

Everyone who opens the UI or calls `/api` signs in, on `localhost` too: accounts cannot be turned off. Apps call `/v1`
with API keys only, and workers and engines use their own machine credentials ([How machines join](network.md#how-machines-join)).
Audit events name the person who acted.

The first account is the admin made at install: see [First admin](../install/first-admin.md).

## Ways to sign in

| Source | People sign in with | Set up in |
|---|---|---|
| Password | Their email and a password they choose | Settings › Accounts, or `minibrain admin create` |
| Single sign-on | OpenID Connect: Entra, Okta, ADFS, Keycloak and others | `auth.oidc` in `minibrain.yaml` |
| Reverse proxy | The user, email and groups headers of a proxy you trust | `auth.proxy` in `minibrain.yaml` |

Several can be on at once. **Settings › Accounts › Sign-in and roles** shows what is configured; it is set on the
server, so it cannot be changed there. Single sign-on and proxy accounts have no password in minibrain.

## Invite people

1. Open **Settings › Accounts** and choose **Invite person**.
2. Enter their email, name and role.
3. Send them the link shown. It sets their password, works once and expires after 24 hours. It is not shown again.

For someone who lost their password, choose **New password link** in their row's menu. **Turn off and sign out** in
the same menu signs the person out everywhere at once and deletes the API keys they created; turning the account on
again does not restore the keys. You cannot turn off your own account or the last admin.

On the server, `minibrain admin create --email you@example.com` adds an admin and `minibrain admin reset-password
--email you@example.com` sets a new password, clears lockouts and ends the account's sessions. Both ask for the
password, or read it with `--password-stdin`, and record `command line` as the actor in the audit log.

## Passwords

- 12 to 1,024 characters, and not only spaces.
- Stored as PBKDF2-HMAC-SHA256 with 600,000 iterations and a random 16-byte salt.
- One client address gets 30 sign-in attempts in 5 minutes, then 429 until the oldest ages out.
- 10 wrong passwords for one account from one address lock that account for 15 minutes, from that address only, so
  guessing from one place cannot lock the admin out everywhere. A password reset clears the account's lockouts.
- The client address is the connecting peer, or the address a [trusted proxy](#sign-in-through-a-reverse-proxy)
  forwards.

## Sessions

- Signing in sets a random 256-bit token in an HttpOnly, SameSite=Lax cookie. The database keeps only its SHA-256.
- Two policies under Settings › Security › Sign-in end sessions: **Sign-in idle timeout (minutes)**, 480 by default
  (0 turns it off), and **Session lifetime (hours)**, 168 by default and at most 2,160.
- Signing out, a new password or turning an account off ends its sessions at once.
- The cookie is marked Secure when the request is HTTPS, a trusted proxy says it was (`X-Forwarded-Proto`), or the
  browser's origin is HTTPS. Plain HTTP on `localhost`, `127.0.0.1` or `::1` gets no Secure flag, since Safari drops
  Secure cookies there. Plain HTTP on any other address does get it, so the browser keeps no session: the sign-in page
  says to use TLS or localhost.
- Every state-changing `/api` call from a signed-in person carries `X-CSRF-Token`, an HMAC-SHA256 of the session (or
  proxy identity) under a per-install key. The UI adds it.

**Settings › Your account** is open to everyone signed in, with no role needed: change your name, see your sessions
and end any other one, and change your password (password accounts only). A password change needs the current
password, counts wrong ones toward the same lockout as sign-in, follows the same rules, and ends every other session
of the account while keeping this one.

## Single sign-on with OIDC

```yaml title="minibrain.yaml"
auth:
  oidc:
    issuer: https://keycloak.corp/realms/corp
    client_id: minibrain
    client_secret_file: /run/secrets/oidc
    label: Keycloak
    groups_claim: groups
  roles:
    minibrain-admins: admin
    ml-team: builder
```

- Register `https://<your minibrain address>/api/auth/oidc/callback` as the redirect URI, or set `redirect_url` to
  the one you registered.
- The client secret comes from `MINIBRAIN_OIDC_CLIENT_SECRET` or the file `client_secret_file` names; minibrain
  refuses a secret written into `minibrain.yaml`. Leave both out for a public client.
- `label` names the button (Sign in with Keycloak). `scopes` defaults to `openid`, `email` and `profile`.
  `groups_claim` names the ID token claim that lists the person's groups. `ca_bundle` trusts an internal CA.
- The email is taken only when the provider marks it verified (`email_verified`).

minibrain uses the authorisation code flow with PKCE (S256). State, nonce and verifier sit in a signed, HttpOnly
cookie for 10 minutes. The ID token's issuer, audience, expiry, nonce and signature are checked against the provider's
published keys, with RSA, RSA-PSS or ECDSA signatures only, and the issuer must match the provider's discovery
document. main calls the provider directly; the network policy does not apply to it, since an admin configured it.

## Sign in through a reverse proxy

```yaml title="minibrain.yaml"
auth:
  proxy:
    addresses: [10.0.0.10/32]
```

- minibrain reads `X-Forwarded-User`, `X-Forwarded-Email`, `X-Forwarded-Groups` (comma-separated) and
  `X-Forwarded-Preferred-Username` (the name shown). Rename them with `user_header`, `email_header`,
  `groups_header` and `name_header` under `auth.proxy`.
- These headers count only from the addresses or networks in `auth.proxy.addresses`, which cannot be empty. The same
  headers from anywhere else are ignored.
- `X-Forwarded-For` and `X-Forwarded-Proto` also count only from those addresses.

## Roles

| Role | May |
|---|---|
| Viewer | See models, scores and deployments; versions, jobs and model details without data rows |
| Builder | Also work with data, train, evaluate, deploy, and manage API keys |
| Admin | Also run security, accounts, infrastructure and settings |
| No role | Sign in, and see Ask an admin for access until an admin gives them a role |

The server checks the role on every `/api` route, not only the UI. A person's role comes from the first of these that
applies:

1. `auth.admins`: emails or user names that are always Admin.
2. `auth.roles`: identity provider groups mapped to roles. Someone in several groups gets the highest; group names
   match regardless of case.
3. The role an admin gives in Settings › Accounts (**Edit name and role**).
4. For single sign-on and proxy people: **Role for new people** under Settings › Security › Sign-in, or
   `auth.default_role` in `minibrain.yaml`. No role by default.

Roles from `auth.admins` and `auth.roles` are locked in Settings › Accounts. The last admin cannot be given another
role.
