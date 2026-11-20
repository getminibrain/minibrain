---
title: Air-gapped installs
description: Run minibrain with no outbound calls, and carry the app, model weights and DuckDB extensions into a closed network.
sidebar:
  order: 13
---

By default minibrain reaches the internet to download base models when you add them. In a closed network, turn that
off and carry everything it needs across on disk: the app, its signatures, the model weights and, for native installs,
the DuckDB extensions.

## Turn off outbound calls

| Variable | Effect |
|---|---|
| `MINIBRAIN_OFFLINE=1` | minibrain makes no outbound calls, and the network policy is locked to Offline |
| `HF_HUB_OFFLINE=1`, `HF_DATASETS_OFFLINE=1` | Hugging Face libraries read local files only and never try to fetch weights |

Set them in the environment that runs minibrain:

```sh title="Docker"
docker run -d --name minibrain --gpus all --shm-size 8g -p 127.0.0.1:8000:8000 -v minibrain-data:/data \
  -e MINIBRAIN_OFFLINE=1 -e HF_HUB_OFFLINE=1 -e HF_DATASETS_OFFLINE=1 \
  ghcr.io/getminibrain/minibrain:0.1.2-cuda
```

```sh title=".env (Compose)"
MINIBRAIN_OFFLINE=1
HF_HUB_OFFLINE=1
```

The compose file passes only those two through; add `HF_DATASETS_OFFLINE: "1"` under `environment:` in
`compose.yaml` as well ([Docker Compose](compose.md)). On a native install, export all three before
`minibrain serve`.

With an internal Hugging Face mirror instead of no network at all, set `MINIBRAIN_HF_ENDPOINT` and use the Allowlist
network policy ([Policies](../security/policies.md)).

## Carry the app across

Docker: on a connected machine, pull the image, [verify it](verify-release.md#verify-images), save it, and load it on
the target. Pull with `--platform linux/arm64` when the target's architecture differs.

```sh
docker pull ghcr.io/getminibrain/minibrain:0.1.2-cuda
docker save ghcr.io/getminibrain/minibrain:0.1.2-cuda | gzip > minibrain-0.1.2-cuda.tar.gz
docker load -i minibrain-0.1.2-cuda.tar.gz
```

With an internal registry, use `cosign save` and `cosign load` instead, so the signatures come along (below).

Native: collect the wheels on a connected machine with the same operating system, CPU architecture and Python 3.12 as
the target, in a checkout of the release tag, with the release wheel downloaded next to it:

```sh
uv export --frozen --no-dev --no-emit-project --extra postgres --extra qlora -o requirements.txt
python3.12 -m pip download --only-binary=:all: -d wheels -r requirements.txt
cp minibrain-0.1.2-py3-none-any.whl wheels/
```

Carry the wheel's `.sigstore.json` and a trusted root along to check it on the target (below). Python 3.12 must already
be installed there. Then install with either of these:

```sh
uv tool install --offline --no-index --find-links ./wheels --python 3.12 'minibrain[postgres]'
pip install --no-index --find-links ./wheels 'minibrain[postgres]'
```

## Verify without network access

Each signature bundle carries everything cosign needs except Sigstore's trusted root. Fetch the root on a connected
machine with cosign, which checks it against the root built into cosign:

```sh
cosign initialize
cp ~/.sigstore/root/tuf-repo-cdn.sigstore.dev/targets/trusted_root.json .
```

:::caution
Do not take `trusted_root.json` from the same place as the release files: a forged release would bring a forged root.
:::

Carry it across with the files and their bundles, then add `--trusted-root` to any command on
[Verify a release](verify-release.md):

```sh
cosign verify-blob --bundle SHA256SUMS.sigstore.json --trusted-root trusted_root.json \
  --certificate-identity https://github.com/getminibrain/minibrain/.github/workflows/release.yml@refs/tags/v0.1.2 \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com SHA256SUMS
```

For images, save the image with its signatures and attestations on the connected machine, verify the saved copy on the
other side, then load it into the internal registry, where `cosign verify --trusted-root trusted_root.json` works too:

```sh
cosign save --dir minibrain-0.1.2 ghcr.io/getminibrain/minibrain:0.1.2
cosign verify --local-image --trusted-root trusted_root.json \
  --certificate-identity https://github.com/getminibrain/minibrain/.github/workflows/release.yml@refs/tags/v0.1.2 \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com minibrain-0.1.2
cosign load --dir minibrain-0.1.2 registry.internal/minibrain:0.1.2
```

`docker load` cannot read the saved folder. For a Docker host without a registry, verify the image on the connected
machine and move it with `docker save`, as above.

## Carry model weights

Download them on the connected machine, pinned to a commit:

```sh
hf download Qwen/Qwen3-0.6B --revision <commit> --local-dir Qwen3-0.6B
```

Copy the folder across. In Docker, mount it first, for example at `/models`. Then in **Add model**, open **Base**,
choose **Your imports** › **Server folder**, and give the folder's path on the server ([Base models](../guides/models.md)).

## Carry the DuckDB extensions

S3, Postgres, Iceberg and Delta Lake sources need DuckDB extensions. The Docker image already has them; native
installs do not. On a connected machine with the same minibrain version, download them for the target's platform
(`linux_amd64`, `linux_arm64`, `osx_arm64`, `osx_amd64` or `windows_amd64`):

```sh
minibrain extensions download --to ./duckdb-extensions --platform linux_amd64 httpfs postgres_scanner iceberg avro delta
```

On the target, install them, or point minibrain at the folder so it installs each one on first use:

```sh
minibrain extensions install --from ./duckdb-extensions
export MINIBRAIN_DUCKDB_EXTENSION_REPOSITORY=/path/to/duckdb-extensions
```

DuckDB still checks each extension's signature when it loads it. `minibrain extensions` and **Settings** ›
**Connections** show what is installed. An upgrade to a release with a new DuckDB version needs that version's set.
