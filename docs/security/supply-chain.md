---
title: Supply chain
description: The software bills of materials each release carries, the dependency licence policy, signed releases, and the AI bill of materials of every model version.
sidebar:
  order: 7
---

Each release says what is in it and proves where it came from: CycloneDX SBOMs for the Python packages, the web UI
and each Docker image, a dependency licence policy checked on every build, and keyless Sigstore signatures with SLSA
build provenance. Each model version gets its own AI bill of materials.

## Software bills of materials

Every release carries these files, each signed:

| File | Format | Covers |
|---|---|---|
| `minibrain-python.cdx.json` | CycloneDX 1.5 | The wheel's Python dependencies with every extra (`postgres`, `mlx`, `llamacpp`, `qlora`, `hsm`) and no dev tools: version, purl, the SHA-256 of every sdist and wheel, platform markers and the dependency graph |
| `minibrain-web.cdx.json` | CycloneDX 1.6 | Every package in the web UI's lockfile, by name, version and purl. Build tools such as Vite, TypeScript and Biome are listed too, since syft cannot tell dev dependencies apart in pnpm lockfiles; the built UI ships only the runtime dependencies |
| `minibrain-image-{cpu,cuda}-{amd64,arm64}.cdx.json` | CycloneDX 1.6 | One per Docker image, operating system packages included |

- The Python and web SBOMs are made from the lockfiles alone: no install and no registry lookups. uv marks its
  CycloneDX export experimental, so the format can change between uv versions.
- syft runs with its network features (remote licence lookups) and its update check off.

## Docker image

The release workflow runs syft on each image it pushes and attests that SBOM on the image in GHCR; the Python and web
SBOMs are attested on both image indexes too. The image's Python packages are the `postgres` and `qlora` subset of
`minibrain-python.cdx.json`, except torch, which comes from the PyTorch index as the CUDA or CPU build.

To list everything in an image you built yourself, operating system packages included:

```sh title="SBOM of a local image"
SYFT_CHECK_FOR_APP_UPDATE=false SYFT_FILE_METADATA_DIGESTS=sha256 \
  syft scan docker:minibrain:cuda --source-name minibrain --source-version "$(git rev-parse HEAD)" \
  -o cyclonedx-json@1.6=minibrain-cuda.cdx.json
```

- `docker:` reads the image from the local Docker daemon; nothing is pulled. To scan elsewhere, save it with
  `docker save minibrain:cuda -o minibrain-cuda.tar` and run `syft scan docker-archive:minibrain-cuda.tar`.
- `SYFT_FILE_METADATA_DIGESTS=sha256` keeps file digests to SHA-256; syft adds SHA-1 by default.
- On the CPU image (syft 1.54.1): about 4,100 components (88 Debian packages, 97 Python packages, the Rust crates
  compiled into Python wheels, and the files those packages own with their SHA-256), 3 MB, in under a minute. Two
  Debian packages carry licence IDs newer than CycloneDX 1.6's SPDX list (`SMAIL-GPL`, `Artistic-dist`), so a strict
  schema check flags those two entries.

## Dependency licences

minibrain is licensed under Apache-2.0. Every CI build fails on a shipped dependency whose licence is outside this
policy:

- Checked: the Python dependencies with every extra, on every platform in the lockfile (licences from PyPI's metadata
  for the locked version), and the web UI's production dependencies. Dev tools are not shipped and not checked.
- Allowed: permissive licences (MIT, BSD, Apache-2.0, ISC, PSF, Zlib, BSL-1.0, Unlicense, CC0, 0BSD and the like),
  OFL-1.1 for fonts, CC-BY-4.0 for data, and weak copyleft used as an unmodified library (MPL-2.0, LGPL). An `OR`
  expression passes when one side does; an `AND` expression needs every part.
- Refused: GPL, AGPL, SSPL, non-commercial or proprietary licences, and packages with no licence metadata, unless named
  as an exception with a reason. There are two today: NVIDIA's CUDA libraries, which torch pulls in on Linux
  (NVIDIA's licence lets an application redistribute them), and PyKCS11 (GPL-2.0-or-later), in the optional `hsm`
  extra only. PyKCS11 is never a requirement of the wheel and is not in the image; you install it yourself.
- The check needs PyPI and runs only in CI. Nothing in minibrain looks up licences at run time.

The licences of models you download are a separate rule: the Allowed licences policy ([Policies](policies.md)).

## Signed releases

The release workflow signs every release file and image keyless through Sigstore at its tag, so no signing key
exists to leak. Each release also carries `SHA256SUMS`, one `.sigstore.json` bundle per file and SLSA build
provenance; the images carry their SBOMs and provenance as attestations in GHCR. How to check them, online or
air-gapped: [Verify a release](../install/verify-release.md).

## AI bill of materials

Every model version has a CycloneDX 1.6 ML-BOM. On the version's model card page choose **Download**, then
**AI-BOM (CycloneDX)** (saved as `{slug}-v{n}-aibom.cdx.json`), or call
`GET /api/models/{slug}/versions/{n}/aibom.json`. It is built from the same data as the model card, without the
deployment history, so deploying or undeploying a version does not change it.

| Part | In the BOM | Holds |
|---|---|---|
| The version | `metadata.component` | Name, number, kind, status, who created it; the recipe, training and evaluation runs as properties; a reference to the model card |
| Model card | `metadata.component.modelCard` | Task, architecture (a LoRA adapter on the base, or the base with the task prompt and few-shot examples), the dataset version, the labels; held-out and test accuracy, macro F1, invalid-answer rate, per-label precision, recall, F1 and support, latency p50 and p95, by split and label; intended use and every derived and written limit |
| Base model | A `machine-learning-model` component | Repository and revision, `pkg:huggingface` purl, licence (SPDX ID where one exists, else its name and URL), content hash (SHA-256), whether it was recorded when training started, who accepted the licence |
| Adapter | A `file` component, LoRA versions only | The adapter archive's ID, which is the SHA-256 of the tar, and its size |
| Training dataset version | A `data` component | Its hash, rows per split, when it was taken, the SQL, every data check and its result, personal data findings |
| Sources | A `data` component per table | Table, source kind and fingerprint; uploads also carry the file's SHA-256 |
| Dependencies | `dependencies` | The version on the base, the adapter and the dataset version; the adapter on the base; the dataset version on its sources |

### Check a download

The output is deterministic: the same version gives the same bytes. `metadata.properties` carries
`minibrain:aibom:sha256`, the SHA-256 of the BOM without `serialNumber` and `metadata.properties`, as JSON with keys
sorted, no whitespace and non-ASCII characters kept. `serialNumber` is a version 8 UUID made from that digest, so it
changes whenever the content does. `metadata.timestamp` is the newest of the version's creation, its training and
evaluation finish times, the base model's licence acceptance and the last card edit.

```sh title="Check an AI-BOM"
python3 -c 'import hashlib,json,sys; b=json.load(open(sys.argv[1])); b.pop("serialNumber"); p=b["metadata"].pop("properties"); s=json.dumps(b,sort_keys=True,separators=(",",":"),ensure_ascii=False); print(hashlib.sha256(s.encode()).hexdigest(), p[0]["value"])' support-triage-v1-aibom.cdx.json
```

Both printed values match for an unchanged file. Prompt-only and trained versions are tested against the CycloneDX
1.6 JSON schema.
