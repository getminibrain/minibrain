# Install: contributor notes

Unpublished. True material from the old `docs/install.md`, `docs/upgrades.md` and `docs/security.md` › First admin
that is too internal for the user pages under `docs/install/` and `docs/get-started/`, plus what the rewrite found.

## Verification status (from the old install.md, as written before the 0.1.x tags)

Verified: `uvx` and `minibrain serve` on macOS (Apple silicon) and on Linux (Debian, CPU torch); the CPU image; the
CUDA image built for amd64 and arm64 and started without a GPU; the release workflow's dry run (wheel, sdist and all
four images built); the installer on macOS (Apple silicon) and in clean Debian 13 and Ubuntu 24.04 containers (arm64),
against a dry run's files served from a local folder. Not verified yet: native Windows, the CUDA image on a machine
with an NVIDIA GPU, and a tagged release (no image is on GHCR until the first one), so the installer's default
download and the signature checks against a real release.

v0.1.0 to v0.1.2 are now tagged, so the last item is probably stale; re-check before quoting it. The user pages keep
"native Windows has not been tested yet" (python.md) and "SGLang in Docker has not been tested yet" (docker.md).

## Releases

How releases are made, signed and attested: [`releasing.md`](../releasing.md), in particular
[Signing and provenance](../releasing.md#signing-and-provenance). The package is on PyPI as `minibrain`.

## Docker build internals

- The build runs the UI build (`pnpm build`) and `uv build` in builder stages, installs the wheel into
  `/opt/minibrain`, and downloads the DuckDB extensions for the image's platform in an `extensions` stage.
- Base images and tools are pinned by version and digest at the top of the `Dockerfile`; Python packages come from
  `uv.lock` with hashes. torch is installed first under a constraint from the lock, then the rest with
  `--require-hashes --no-deps`.
- The CUDA image is about 7 GB, most of it torch and its CUDA libraries; the CPU image is about 1.7 GB.
- With a `wheel` build context the UI and wheel stages are skipped. The release workflow builds its images this way,
  from the wheel it publishes.
- A CycloneDX SBOM of the built image comes from syft (old `security.md` › Docker image).
- The image also sets `PYTHONUNBUFFERED=1`. Its health check runs a Python one-liner against
  `http://127.0.0.1:8000/healthz` with proxies disabled: interval 30 s, timeout 5 s, start period 60 s, 3 retries.
- Since 0.1.2 (commit 21039954) the image no longer sets `MINIBRAIN_OFFLINE`, `HF_HUB_OFFLINE` or
  `HF_DATASETS_OFFLINE`, and `compose.yaml` defaults `MINIBRAIN_OFFLINE` and `HF_HUB_OFFLINE` to `0`.

## DuckDB extensions

- delta is the largest of the default set: 30.5 MB compressed on linux_amd64 and 28.3 MB on linux_arm64 (DuckDB
  v2.0.0), about 100 MB once installed into `/data`. It takes the default set from 54 MB to 85 MB on amd64 (50 MB to
  78 MB on arm64).
- delta reads Delta tables from folders on the server only; why not S3: old `security.md` › TLS in DuckDB extensions.
- Extension paths are versioned by DuckDB release, so the sets of two DuckDB versions can sit side by side after an
  upgrade.
- minibrain never downloads an extension at run time (`autoinstall_known_extensions` and `autoload_known_extensions`
  are off). With `MINIBRAIN_DUCKDB_EXTENSION_REPOSITORY` pointing at a local folder, it installs from there on first
  use; that is what the Docker image does.
- `MINIBRAIN_DUCKDB_EXTENSIONS` overrides the install folder (default `<home>/duckdb/extensions`). Not on a user page.

## Apple GPU

Training on MPS runs one example at a time with gradient accumulation because the Metal GPU hangs in LoRA backward
otherwise; see [`findings.md`](../findings.md).

## First admin internals

- The setup token is 256 random bits from `secrets`. The database keeps only its SHA-256 (in `app_settings`).
- The browser opens only on a desktop session: stdin and stdout are TTYs, none of `CI`, `SSH_CONNECTION`, `SSH_TTY`
  or `container` is set, `/.dockerenv` does not exist, and on Linux `DISPLAY` or `WAYLAND_DISPLAY` is set.
- Password-guess throttling and lockouts are documented on the Security › Accounts page (writer D).

## Environment variables read by the code but not on the install pages

`MINIBRAIN_CATALOG_URL` (catalogue sync; without it the bundled catalogue stays in use), `MINIBRAIN_UI_URL`,
`MINIBRAIN_WEB_DIST`, `MINIBRAIN_JOB_CONNECTION` (internal), `MINIBRAIN_MAIN_URL`, `MINIBRAIN_JOIN_TOKEN`,
`MINIBRAIN_WORKER_TOKEN`, `MINIBRAIN_GATEWAY_TOKEN`, `MINIBRAIN_ENGINE_TOKEN`, `MINIBRAIN_CONNECTION_<NAME>`
(config export), and the key-provider variables (`MINIBRAIN_MASTER_KEY_FILE`, `MINIBRAIN_VAULT_*`, `MINIBRAIN_HSM_*`),
which belong to the machines and key-provider pages.

## Found during the rewrite

- The old docs said to add mounted weights with "Models → Add model → Folder". The UI path is **Add model** › **Base**
  (dialog "Choose a base model") › **Your imports** › **Server folder** ("Folder on the server").
- The old offline section said minibrain downloads "base models and the catalogue" by default. Catalogue sync needs
  `MINIBRAIN_CATALOG_URL`; the pages now say only base models.
- `compose.yaml` passes `MINIBRAIN_OFFLINE`, `HF_HUB_OFFLINE` and `MINIBRAIN_DATABASE_URL` from `.env`, not
  `HF_DATASETS_OFFLINE`; the old doc said to set all three in `.env`.
- `install.sh` still names `docs/install.md` in its Windows error message, and `web/src/components/navigation.ts`
  links `DOCS_URL` to the GitHub `docs/` tree.
- `minibrain serve --no-worker` is not on a user page; its user-facing purpose was not clear from the old docs.
