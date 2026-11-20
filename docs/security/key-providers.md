---
title: Key providers
description: Where the master key lives (a local key file, HashiCorp Vault, a PKCS#11 HSM or AWS KMS), and how to rotate it, check files and encrypt older ones.
sidebar:
  order: 5
---

The master key wraps the data key of every file minibrain encrypts ([Encryption at rest](encryption.md)). Choose
where it lives under Settings › Security › Encryption at rest (**Master key**), or with `policy.encryption` in
`minibrain.yaml`.

| Provider | `encryption` | Master key | Rotation |
|---|---|---|---|
| Local key file (default) | `local` | `<home>/keys/master.key`, or the file `MINIBRAIN_MASTER_KEY_FILE` names | `minibrain keys rotate` adds a key to the file; a mounted file is never written, so add a line yourself |
| HashiCorp Vault Transit | `vault` | An `aes256-gcm96` Transit key | Transit's key rotate, then re-wrap |
| PKCS#11 HSM | `hsm` | Non-extractable AES-256 key objects with one label, each version's number as `CKA_ID` | A new key object, then re-wrap |
| AWS KMS | `kms` | A symmetric KMS key | KMS rotates key material itself; point minibrain at a new key ARN to move every data key |

Saving a provider tests a wrap and an unwrap first (**Test key** runs the same test) and refuses the change if either
fails. Files wrapped under the old provider stay readable as long as its settings stay in place. The network policy
does not apply to Vault or KMS: an admin chose them, as with artifact storage.

## Local key file

The file holds one base64 256-bit key per line; the last line is the current key, and the others stay readable.
main makes it on first start in `<home>/keys` (folder mode 0700, file mode 0600). The same key encrypts files and
connection secrets, so there is one key for everything.

:::caution
Back the key up separately from the data. A backup that holds both protects nothing, and data whose key is lost cannot
be read.
:::

With more than one main, every main needs the same key file: mount it from your secret store and set
`MINIBRAIN_MASTER_KEY_FILE`. A main that finds the install already encrypting under a local key it does not have
refuses to make its own and says so.

```sh title="Make a key for a secret store"
openssl rand -base64 32 > /run/secrets/minibrain-master.key
export MINIBRAIN_MASTER_KEY_FILE=/run/secrets/minibrain-master.key
```

## HashiCorp Vault Transit

```sh title="Prepare Vault"
vault secrets enable transit
vault write -f transit/keys/minibrain type=aes256-gcm96
vault policy write minibrain - <<'HCL'
path "transit/encrypt/minibrain"     { capabilities = ["update"] }
path "transit/decrypt/minibrain"     { capabilities = ["update"] }
path "transit/keys/minibrain"        { capabilities = ["read"] }
path "transit/keys/minibrain/rotate" { capabilities = ["update"] }
HCL
vault auth enable approle
vault write auth/approle/role/minibrain token_policies=minibrain token_ttl=1h
```

```yaml title="minibrain.yaml"
policy:
  encryption: vault
  vault_address: https://vault.internal:8200
  vault_auth: approle
  vault_role_id: 7f1c…
  vault_ca_bundle: /etc/minibrain/vault-ca.pem
  vault_namespace: ""
```

- With `vault_auth: token`, the token comes from `MINIBRAIN_VAULT_TOKEN` or the file `MINIBRAIN_VAULT_TOKEN_FILE`
  names. With AppRole, the secret ID comes from `MINIBRAIN_VAULT_SECRET_ID` or `MINIBRAIN_VAULT_SECRET_ID_FILE`;
  the role ID is not a secret.
- `vault_mount` (default `transit`), `vault_key` (default `minibrain`) and `vault_auth_mount` (default `approle`)
  name the paths. `vault_namespace` is for Vault Enterprise only.
- Calls go over HTTPS with TLS 1.2 or later.
- Drop the `rotate` path from the Vault policy if Vault admins rotate the key themselves; minibrain then re-wraps to
  whatever version is newest.
- Tested against Vault 1.20.4 in dev mode with AppRole.

## PKCS#11 HSM

Install the `hsm` extra (`pip install 'minibrain[hsm]'`) and your vendor's PKCS#11 module on the server. The extra is
not in the Docker image.

```yaml title="minibrain.yaml"
policy:
  encryption: hsm
  hsm_library: /usr/lib/softhsm/libsofthsm2.so
  hsm_token: minibrain
  hsm_key: minibrain-master
```

- minibrain loads the module into the server process as code, so its path is set only in `minibrain.yaml`
  (`hsm_library`) or `MINIBRAIN_POLICY_HSM_LIBRARY`. Settings shows it read-only and the API refuses to change it
  (409), so an admin account cannot point the server at a library of its choosing. The token and key labels stay
  editable in Settings.
- The user PIN comes from `MINIBRAIN_HSM_PIN` or the file `MINIBRAIN_HSM_PIN_FILE` names.
- If the token has no key with that label the first time minibrain uses it, minibrain generates one (AES-256,
  sensitive, not extractable, `CKA_ID` 1). Create it yourself if your HSM policy reserves key generation for its
  officers.
- Data keys are wrapped inside the HSM with AES-GCM. Tested against SoftHSM 2.7.0.

## AWS KMS

```yaml title="minibrain.yaml"
policy:
  encryption: kms
  kms_key: arn:aws:kms:us-gov-west-1:111122223333:key/1234abcd-…
  kms_fips: true
  kms_endpoint: ""
```

- Credentials come from the server's AWS environment: variables, profile, web identity on EKS, or the instance role.
  Nothing calls AWS unless KMS is the provider.
- The IAM policy needs `kms:Encrypt`, `kms:Decrypt` and `kms:DescribeKey` on the key.
- `kms_fips: true` calls `kms-fips.<region>.amazonaws.com`. `kms_region` defaults to the key ARN's region, and
  `kms_endpoint` takes an `https://` VPC endpoint.
- With S3 storage on AWS, SSE-KMS on the bucket is a useful second layer: it protects the objects at the storage
  layer and logs every read in CloudTrail, but it decrypts for anyone holding the bucket credentials, while
  minibrain's layer keeps the bucket's contents unreadable without the master key.

## Rotate, check and encrypt older files

| Action | Command | Button | What it does |
|---|---|---|---|
| Check | `minibrain keys status` | Check now | Reads every header and counts files under the current key, under older keys, unencrypted and unreadable, per key |
| Rotate | `minibrain keys rotate` | Rotate master key | Makes a new master key version, then re-wraps every data key under it |
| Encrypt older files | `minibrain keys encrypt-existing` | Encrypt existing files | Encrypts files written before encryption at rest, in place |

- Re-wrapping rewrites only each file's header; file contents are never re-encrypted. Connection secrets are
  re-encrypted under the new key in the same pass. A bucket object is rewritten inside the bucket, so only its first
  5 MiB leave main however large it is.
- Older local key versions stay readable until a pass finds nothing uses them and the new key is at least an hour
  old; the leader main then drops them from the key file on its own. `--retire-now` skips the wait when no server is
  running. Vault, HSM and KMS keep their versions: retire them there.
- Encrypting an older file writes an encrypted copy beside it, reads it back and checks its SHA-256 against the file's
  ID, then swaps the two atomically. A file whose content does not match its ID is left alone and reported. The same
  pass deletes leftover plaintext staging files and main's old decrypted cache.
- In the UI these run as one background pass on the leader, with progress. Each is audited: `encryption.rotate`,
  `encryption.rewrap`, `encryption.encrypt_existing`, `encryption.check`, `encryption.retire`, `encryption.key`.

:::caution
Rotation answers "a key version should no longer be used". It does not make copies of files taken before the rotation
unreadable to someone who also has the old key.
:::
