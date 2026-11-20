---
title: Encryption at rest
description: What minibrain encrypts on disk and in buckets, what it leaves to you, and how other machines read encrypted files.
sidebar:
  order: 4
---

Encryption at rest is on by default. Every file main stores is encrypted with its own random 256-bit data key, and
that data key is wrapped by a master key kept somewhere else: a local key file made on first start, HashiCorp Vault
Transit, a PKCS#11 HSM or AWS KMS ([Key providers](key-providers.md)).

**Settings › Security › Encryption at rest** picks the provider and tests it before saving, lists the key versions and
how many files use each, and runs checks, rotations and the encryption of older files. Everything there is
admin-only and audited, and locked when `minibrain.yaml` (`policy:`) or `MINIBRAIN_POLICY_<NAME>` sets it.

## What is encrypted

| Kept by main | Encrypted | Notes |
|---|---|---|
| Uploads, dataset versions, adapters and job logs | Yes, in the local folder and in an S3 bucket | The bucket only ever holds ciphertext: files are encrypted before they are sent |
| Staging databases built from uploads (`<home>/staging`) | Yes | Built in a private temporary folder, encrypted, and the plaintext removed straight away |
| Base model files in an S3 bucket | Yes | Each file is encrypted like any other artifact |
| Connection secrets, OpenTelemetry collector headers, saved Playground chats | Yes, with the same master key | Encrypted one value at a time, each bound to its row |
| The database (SQLite or Postgres) | No | It holds the request inputs and answers kept for the models you choose: put SQLite on an encrypted volume, or use Postgres with storage encryption |
| Base model files on main's disk (`<home>/models`, when Storage is the folder) | No | Public weights; imported private weights are not encrypted by minibrain either |

main never writes decrypted copies of these files. Queries, previews, diffs and the gateway's prompt context read the
encrypted files directly, decrypting a chunk at a time; the data sandbox still refuses every path it was not given.
The cost is a little CPU per read ([Performance](#performance)) instead of a decrypted cache on disk.

## Workers, engines and gateways

Training, evaluation and serving read plain files, and those machines hold no master key. main decrypts an artifact
when a worker or engine pulls it, and the machine keeps plain working copies of what it uses in its own home:
`<home>/worker`, `<home>/worker/models`, `<home>/engines`, `<home>/gateway` and `<home>/models`.

- Put those folders on an encrypted volume, or tmpfs, on GPU machines. They are caches and can be wiped at any time.
- A worker's outputs are encrypted the moment main stores them.
- Run the channel to main over HTTPS ([TLS](network.md#tls)).

### Base weights from a bucket

With Storage on S3, base model files stay encrypted in the bucket and machines download them from there, not
through main:

1. The machine asks main for a base model over its authenticated channel.
2. main answers, marked not to be cached, with each file's path, size and SHA-256, a presigned download link valid
   for 15 minutes for the configured endpoint only, and the file's data key, which main unwraps with the master key.
3. The machine downloads the object, decrypts it chunk by chunk, checks the plaintext's size and SHA-256, and only
   then moves it into its working copy. A changed byte, chunk or header fails, and the file is refused.

The machine never holds the bucket's keys or the master key. A data key opens one file only, stays in memory and is
never written to disk; a verify job gets its links and keys on standard input, not in its job file. The channel to
main carried these files' plaintext before, so it carries nothing new.

## How a file is encrypted

- AES-256-GCM over 1 MiB chunks, each with its own nonce and tag, under a data key used for this one file only, so
  a nonce never repeats under a key.
- Reordering, dropping, duplicating or appending chunks, cutting the file anywhere, or changing its header all fail
  authentication.
- A 4 KiB header holds the wrapped data key in two slots, so a rotation can replace it without a moment where a crash
  leaves the file unreadable.
- The wrapped data key is bound to its file: a header copied onto another file does not open.
- Files without the header are read as plaintext, so files written before encryption at rest stay readable.

Content hashes stay over the plaintext: an artifact's ID is still the SHA-256 of its plain bytes. Identical uploads
and dataset versions are still stored once, a re-saved version still matches its earlier copy, and model cards and
AI-BOMs keep hashes you can check against your own files. The hash reveals only what any copy of the same content
would hash to, which the content-addressed file name already revealed.

## Turn it off or on later

Set the master key to Off (`MINIBRAIN_POLICY_ENCRYPTION=off`) only for an install with several mains that do not
share a key file yet. While it is off, new files are written unencrypted; connection secrets and other encrypted
settings still use the local key file.

Turned on again, every new file is encrypted, and files stored while it was off stay readable as they are. Encrypt
them when convenient, without downtime, with `minibrain keys encrypt-existing` or **Encrypt existing files**
([Rotate, check and encrypt older files](key-providers.md#rotate-check-and-encrypt-older-files)).

## Performance

Measured on an Apple M1 Pro (macOS, `cryptography` 50.0.2 on OpenSSL 4.0.3) with a 1 GiB file of random bytes,
reading and writing the local SSD, best of two runs:

| Operation | Plaintext | Encrypted |
|---|---|---|
| Store: read, SHA-256, write | 1,009 MB/s | 712 MB/s |
| Read: read, SHA-256 | 1,929 MB/s | 1,427 MB/s |
| AES-256-GCM alone, in memory, 1 MiB chunks | | 4,349 MiB/s encrypt, 2,104 MiB/s decrypt |

Memory stays flat: chunks are encrypted and decrypted one at a time, and random reads keep at most 8 decrypted chunks
per open file.
