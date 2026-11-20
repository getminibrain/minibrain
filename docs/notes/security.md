# Security: contributor notes

Unpublished. Details from the old `docs/security.md` that are true but too internal for the published Security pages
(`docs/security/`). Kept verbatim or lightly edited.

## Accounts and sign-in

- Local passwords: PBKDF2-HMAC-SHA256 through `cryptography`, stored as `pbkdf2-sha256$<iterations>$<salt>$<key>`
  (URL-safe base64, no padding), password NFKC-normalised first. An unknown or malformed stored hash still runs one
  KDF with a zero salt, so a missing account takes as long as a wrong password (`minibrain/auth/passwords.py`).
- OIDC: authorization code with PKCE (S256) through Authlib; the ID token is checked with joserfc (issuer, audience,
  expiry, nonce, signature from the provider's JWKS; RS256/384/512, PS256/384/512, ES256/384/512 only). On a
  signature failure the JWKS is fetched once more before refusing. The pending cookie is `minibrain_oidc`, path
  `/api/auth/oidc`, 10 minutes. The callback route is `/api/auth/oidc/callback` (`request.url_for("oidc_callback")`
  unless `auth.oidc.redirect_url` is set).
- The session cookie is `minibrain_session`.
- Forwarded client addresses (`X-Forwarded-For`, `X-Forwarded-Proto`) count only from `auth.proxy.addresses`;
  uvicorn's own proxy-header handling is off.
- Roles are enforced by one guard per `/api` route; `tests/test_access.py` lists every route with its role.
- Your account is `/api/me`. Session ids of other accounts answer 404. Audit actions: `account.update`,
  `account.password_change`, `account.password_change_failed`, `account.session_end`, `account.sessions_end`.
- Other account and sign-in audit actions: `account.create`, `account.password`, `account.reset` (password link
  made), `auth.setup_link`, `auth.sign_in`, `auth.sign_in_failed`, `auth.sign_out`.
- Group names from the proxy header are split on commas, trimmed, de-duplicated and capped (`MAX_GROUPS`).

## Machine credentials (trust zones)

- Approval request key: 256 bits, `mbr_…`; main keeps its SHA-256. The 6-character code has no 0, O, 1 or I. A request
  key reaches nothing but its own request's state.
- Machine credential: `mbm_…`, stored as SHA-256, handed out once.
- Either credential reaches `/internal/worker/*` and what engines need on `/internal/gateway/*`, for its pool only.
- Refusals are `join_token.refused` events, one per target, pool and address in 10 minutes (downloads: one per
  credential, reason and address; the first asked id is in the event).
- The worker main starts on its own machine uses `<home>/secrets/worker_token`.
- Engine tokens are signed with `<home>/secrets/engine_token` over the pool and the pool token or approval that
  admitted the worker; main checks that credential on every use. Each refusal is a `join_token.refused` event on the
  credential, rate-limited like the others.
- Lease-bound downloads: `/internal/worker/artifacts/<id>`, `/internal/worker/bases/<key>`, its files and `/stored`
  carry the job's lease in `X-Job-Lease`; main answers only for an artifact or base model named in the params of that
  running job, leased to a worker of the credential's pool. The local worker token is unaffected: that worker shares
  main's machine.

## TLS in DuckDB extensions: evidence

Checked on DuckDB v2.0.0 (osx_arm64 and linux_amd64 builds from extensions.duckdb.org).

| Extension | Sources | TLS and S3 request signing |
|---|---|---|
| httpfs | S3, Iceberg data and metadata | OpenSSL 3.6.0, linked into the extension |
| iceberg, avro | Iceberg | None of their own: they read through httpfs |
| delta | Delta Lake | The table log: delta-kernel-rs's own client, object_store 0.13.2 over reqwest and rustls 0.23 with ring 0.17 (aws-lc-rs is linked too), SigV4 signed with ring's HMAC. Data files: httpfs |

On a local path the kernel opens no connection and does no cryptography: the extension checks DuckDB's
`allowed_directories` (the table's folder), the kernel reads `_delta_log` itself, and DuckDB reads the data files
through its own file system.

- Build: DuckDB v2.0.0 pins duckdb-delta at `9dcfb65`, whose `CMakeLists.txt` builds delta-kernel-rs v0.28.0 with
  `--features default-engine-rustls`. Its scan code says the kernel "resolves the table location using its own file
  and HTTP I/O, outside of the file systems of DuckDB".
- Binary: `delta.duckdb_extension` has no OpenSSL (no `SSL_CTX_new`, no OpenSSL version string; httpfs has both) and
  carries rustls 0.23.37, ring 0.17.14, aws-lc-rs 1.16.2, hyper-rustls and object_store 0.13.2; `otool -L` shows
  only system libraries. `object_store::util::hmac_sha256` calls `ring::hmac::Key::new` and `ring::hmac::sign`.
- Run: S3 (moto) over TLS with a private CA, behind a proxy that logs each ClientHello. With DuckDB's
  `ca_cert_file` (an OpenSSL setting) pointing at the CA, `read_parquet` over httpfs succeeds with OpenSSL's
  ClientHello (30 cipher suites with CBC and DHE, X25519MLKEM768 offered). `delta_scan` on the same connection fails
  in the kernel (`DeltaKernel ObjectStoreError`, "error sending request" after 10 retries), each attempt a rustls
  ClientHello (9 AEAD suites and the renegotiation SCSV, no CBC, groups X25519, P-256 and P-384: ring's set). Over
  plain HTTP, the log requests carry `User-Agent: object_store/0.13.2` and the data file reads `duckdb/v2.0.0`.

Re-check after a DuckDB upgrade: `strings -a delta.duckdb_extension | grep -E 'rustls-|ring-|^OpenSSL [0-9]'`. Delta
on S3 can come back when the kernel reads its log through DuckDB's file system or is built with
`default-engine-native-tls` against OpenSSL; a self-built extension would also need DuckDB's unsigned extensions
setting, which minibrain keeps off.

## Audit chain internals

Writers insert events as before, with no chain fields; the leader seals them about once a second. Sealing locks the
one-row `audit_chain` head (an `UPDATE` of that row, which waits on Postgres and takes SQLite's write lock), takes the
unsealed events in id order and gives each the next `seq`, the previous event's hash (`prev_hash`) and its own `hash`,
then moves the head. On Postgres an id can commit after a higher one; it is sealed later, with a higher `seq`, so the
chain follows commit order and nothing is skipped. A unique index on `seq` backs the lock. Events recorded before the
chain existed are chained on the first seal, in id order.

Verification errors: an event whose fields no longer match its hash, one that does not link to the event before it, a
missing `seq`, events past the head that minibrain did not seal, or a newest event that does not match the head.

Scheduled checks (`minibrain/registry/audit_checks.py`, run after the hourly purge on the leader): an incremental
check from the head's `verified_seq`/`verified_hash`, and a full check when none has run, when 36 hours have passed,
or after 12 hours during the 03:00 local hour. Full checks pace themselves (10 ms every 1,000 rows). Breaks are
deduplicated by `seq`, reason and fingerprint and stored in `audit_chain_breaks`; acknowledging takes a note of up to
500 characters.

The SIEM forwarder keeps its cursor (`forwarded_seq`, the last `seq` sent) in the head row, and writes a TLS
close_notify before closing its side of each batch.

## Encryption at rest internals

### File format

A sealed file is a 4,096-byte header followed by the body in chunks.

| Bytes | Field |
|---|---|
| 0-7 | Magic `89 4D 42 45 0D 0A 1A 0A` |
| 8 | Format version, 1 |
| 9 | Cipher suite, 1: AES-256-GCM in a STREAM construction |
| 10-11 | Reserved, zero |
| 12-15 | Chunk size in plaintext bytes, big-endian (1 MiB) |
| 16-22 | Random 7-byte nonce prefix |
| 23-63 | Reserved, zero |
| 64-2079 | Key slot A |
| 2080-4095 | Key slot B |

- Body: each plaintext chunk is encrypted with AES-256-GCM under the file's data key, with the 96-bit nonce
  `prefix ‖ chunk index (4 bytes, big-endian) ‖ final flag (1 byte)`, the first 64 header bytes as associated data,
  and a 16-byte tag appended. Every chunk but the last is exactly `chunk size + 16` bytes.
- Key slot: a sequence number (4 bytes), the length of a JSON payload (2 bytes), the payload, zero padding, and the
  slot's SHA-256 in its last 32 bytes. The payload is `{"p": provider, "k": key reference, "w": wrapped data key}`.
  Readers use the valid slot with the highest sequence number.
- Binding: the wrap's associated data (local key, HSM), encryption context (KMS) or wrapped plaintext (Vault, which
  carries the SHA-256 of the context next to the key) holds `minibrain.artifact.<id>` for artifacts and
  `minibrain.staging.<key>` for staging databases.
- Files without the magic are read as plaintext.
- Plaintext size is the file size minus the header and 16 bytes per chunk, so random access needs no index.

### Sealed values

Connection secrets, sealed settings (OpenTelemetry headers) and Playground chats are one AES-256-GCM envelope per
value (`envelope1:` then base64 JSON with the wrap and the ciphertext), with the row's id in the associated data.
With encryption Off they are wrapped by the local provider.

### Reads on main

DuckDB reads dataset versions, uploads and staging databases through a filesystem that decrypts on the fly, a chunk at
a time.

### Base weights on other machines

1. A worker or engine asks main over its authenticated channel (`GET /internal/worker/bases/<key>` with the worker's
   token, `/internal/gateway/bases/<key>` with the gateway token, a pool's engine token, a pool token or an approved
   machine's credential).
2. Main answers, with `Cache-Control: no-store`, each file's path, size and SHA-256, a presigned GET link (SigV4,
   valid 15 minutes, for the configured endpoint and nothing else) and the file's data key: main reads the object's
   4 KiB header with its own bucket credentials and unwraps the data key with the master key, through the same
   provider as every other unwrap (`cryptography`, Vault Transit, the HSM or KMS).
3. The machine downloads the object, decrypts the STREAM format chunk by chunk with AES-256-GCM through
   `cryptography`, checks the plaintext's size and SHA-256 against the saved list, and only then renames the file into
   its working copy.

### Providers

| Provider | Wrapped by |
|---|---|
| Local key file | AES-256-GCM through `cryptography`, random 96-bit nonce, the file's context as associated data |
| HashiCorp Vault Transit | Transit `encrypt` and `decrypt` over HTTPS (httpx, TLS 1.2+ through Python's `ssl`), token or AppRole |
| PKCS#11 HSM | `C_Encrypt` with `CKM_AES_GCM` inside the HSM, random 96-bit IV, the context's SHA-256 as associated data (PyKCS11) |
| AWS KMS | KMS `Encrypt` and `Decrypt` through botocore, the context's SHA-256 as encryption context |

### Re-wrapping

Unwrap with the old key, wrap with the new one, write the free slot, sync, then clear the old slot. A bucket object is
rewritten with a multipart upload whose first part is the new header and the object's first 5 MiB, and whose other
parts the bucket copies from the old object (`UploadPartCopy`, pinned to its ETag); an object under 5 MiB is sent
again whole.

## Bills of materials: how they are made

- Every CI run uploads a `minibrain-sbom` artifact beside the wheel with the two CycloneDX files. `mise run sbom`
  writes the same two into `sbom/`.
- Python: `uv export --format cyclonedx1.5` from `uv.lock`, `--all-extras`, no dev group, `--frozen` (never resolves),
  `--preview-features sbom-export`; CI pins uv.
- Web: syft from `web/pnpm-lock.yaml`. `SYFT_CHECK_FOR_APP_UPDATE=false` in CI and in `mise run sbom`. CI downloads
  syft by release version and checks the archive's SHA-256 (`SYFT_VERSION` and `SYFT_SHA256` in
  `.github/workflows/ci.yml`).
- Image SBOMs: the release workflow loads the image it pushes into Docker and runs syft on it; CI does not build the
  image (the CUDA one is about 7 GB). The image's Python packages are the `--no-dev --extra postgres --extra qlora`
  subset.
- Licences: the `Dependency licences` CI job runs `scripts/check_licences.py`; web production dependencies come from
  `pnpm licenses list --prod`.
- Signing and provenance: `docs/releasing.md` › Signing and provenance.
- AI-BOM: properties `minibrain:recipe:*`, `minibrain:training:*`, `minibrain:evaluation:*`; performance metrics in
  `quantitativeAnalysis.performanceMetrics`, limits in `considerations`, personal data findings as `sensitiveData`;
  the model card reference points at `card.json`; folder and remote source fingerprints are SHA-256 over a listing or
  the source's state, so they stay a property rather than a hash. The canonical form is the model card's.
  `tests/test_aibom.py` validates prompt-only and trained versions against the CycloneDX 1.6 JSON schema, vendored in
  `tests/cyclonedx/` (Apache 2.0) so the test needs no network.
