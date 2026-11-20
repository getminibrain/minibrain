---
title: Verify a release
description: Check that a minibrain wheel, file or image came unchanged from minibrain's release workflow, with cosign and GitHub attestations.
sidebar:
  order: 12
---

Every minibrain release is signed, so you can check that what you install was built by minibrain's release workflow
and not changed since. Do it before installing a release by hand, mirroring it, or carrying it into a closed network.

## What a release carries

- On [GitHub Releases](https://github.com/getminibrain/minibrain/releases): the wheel, the sdist, the SBOMs, the
  installer, `SHA256SUMS` and a Sigstore bundle next to each file (`<file>.sigstore.json`).
- In GHCR (`ghcr.io/getminibrain/minibrain`): each image with its signature and SBOM attestations.

All are signed keyless by the release workflow at the release's tag, with a short-lived certificate recorded in
Sigstore's public transparency log. A valid signature names:

| Flag | Value |
|---|---|
| `--certificate-identity` | `https://github.com/getminibrain/minibrain/.github/workflows/release.yml@refs/tags/v0.1.2` (the release's tag) |
| `--certificate-oidc-issuer` | `https://token.actions.githubusercontent.com` |

The commands below use [cosign](https://docs.sigstore.dev/cosign/system_config/installation/) 3 (tested with 3.1.4)
and release 0.1.2. With cosign installed, the [installer](installer.md) checks the signature on `SHA256SUMS`, or on
the image with `--docker`, for you.

## Verify release files

```sh
BASE=https://github.com/getminibrain/minibrain/releases/download/v0.1.2
curl -fsSL -O "$BASE/SHA256SUMS" -O "$BASE/SHA256SUMS.sigstore.json" -O "$BASE/minibrain-0.1.2-py3-none-any.whl"
cosign verify-blob --bundle SHA256SUMS.sigstore.json \
  --certificate-identity https://github.com/getminibrain/minibrain/.github/workflows/release.yml@refs/tags/v0.1.2 \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
```

- The signed `SHA256SUMS` covers every file of the release. On macOS, use
  `shasum -a 256 --check --ignore-missing SHA256SUMS`.
- Each file's own bundle checks it directly:
  `cosign verify-blob --bundle minibrain-0.1.2-py3-none-any.whl.sigstore.json <same flags> minibrain-0.1.2-py3-none-any.whl`.
- Without cosign, `sha256sum --check` alone proves the download matches the release's checksums, not that the release
  came from the workflow.

## Verify images

```sh
cosign verify \
  --certificate-identity https://github.com/getminibrain/minibrain/.github/workflows/release.yml@refs/tags/v0.1.2 \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com ghcr.io/getminibrain/minibrain:0.1.2
cosign verify-attestation --type cyclonedx \
  --certificate-identity https://github.com/getminibrain/minibrain/.github/workflows/release.yml@refs/tags/v0.1.2 \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com ghcr.io/getminibrain/minibrain:0.1.2 > /dev/null
```

- Each index (`0.1.2`, `0.1.2-cuda`) and each per-architecture image is signed, so verifying the digest you run works
  too: `ghcr.io/getminibrain/minibrain@sha256:…`.
- `latest` and `cuda` move between releases. To accept any release tag, use
  `--certificate-identity-regexp '^https://github\.com/getminibrain/minibrain/\.github/workflows/release\.yml@refs/tags/v'`
  in place of `--certificate-identity`.
- The SBOM attestations: the Python and web SBOMs on each index, and the image's own SBOM, operating system packages
  included, on each per-architecture image. The same SBOMs are release files. What they cover:
  [Supply chain](../security/supply-chain.md).

## Check build provenance

GitHub's attestations record the commit and the workflow run that built each file and image (SLSA build provenance):

```sh
gh attestation verify minibrain-0.1.2-py3-none-any.whl --repo getminibrain/minibrain
gh attestation verify oci://ghcr.io/getminibrain/minibrain:0.1.2 --repo getminibrain/minibrain
```

## Verify without network access

Each bundle carries the signature, the certificate, the transparency log's inclusion proof and a signed timestamp, so
verifying needs no network lookup once the verifier has Sigstore's trusted root. To verify on a machine without
internet access: [Air-gapped installs](air-gapped.md#verify-without-network-access).
