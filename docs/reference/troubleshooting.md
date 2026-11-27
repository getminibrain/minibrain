---
title: Troubleshooting
description: What you see when something goes wrong, why it happens and what to do, from install and sign-in to machines, downloads, training, evaluation and the API.
sidebar:
  order: 4
---

Find the place you are stuck, then the message or symptom. Each entry says why it happens and what to do, and links
to the page with the detail.

## Where to look first

- **Home** › **Health** lists what needs attention, worst first, each with a link to the page that fixes it
  ([Monitoring](../guides/monitoring.md#health)).
- A job that failed keeps its reason and its logs: open it under **Jobs** or **Training**. **Show library output**
  adds the libraries' own lines.
- A process that stops prints why. Read the terminal that ran it, or `docker logs minibrain`.
- For a support request, an admin downloads a zip of versions, settings and recent warnings, without secrets, under
  **Settings** › **This install** › **Download diagnostics**.

## Install and start

| You see | Why | What to do |
|---|---|---|
| `minibrain install: PyTorch has no builds for Intel Macs: use Docker instead (install.sh --docker)` | A native install needs PyTorch, which has no Intel Mac build | Run the installer with `--docker` ([Installer](../install/installer.md#pull-the-docker-image)) |
| `minibrain install: PyTorch has no builds for musl (Alpine): use Docker or a glibc distribution` | The same, on Alpine and other musl distributions | Use the Docker image or a glibc distribution |
| The shell does not find `minibrain` after the installer | uv's tool folder is not on your `PATH` yet | Run `uv tool update-shell`, then open a new shell ([Installer](../install/installer.md#what-it-does)) |
| main stops with `minibrain.yaml:` and a key, such as `data.row_limit: Input should be greater than or equal to 100` | A value in `minibrain.yaml` is not valid, or the file holds a secret | Fix the key the message names. Secrets go in a file or a variable the file names ([Configuration](../install/configuration.md#keep-secrets-out-of-it)) |
| main stops on its first start with a reason about the admin email or password | `MINIBRAIN_ADMIN_PASSWORD_FILE` is missing or unreadable, the password is under 12 characters, or the email is malformed | Fix it and start again ([First admin](../install/first-admin.md#create-the-admin-from-the-environment)) |
| The setup link is lost, or the page says `This setup link was used or replaced. Run minibrain admin setup-link on the server for a new one.` | The link works once, and a new link voids the old one | `minibrain admin setup-link`; in Docker, `docker exec minibrain minibrain admin setup-link` ([First admin](../install/first-admin.md#use-the-setup-link)) |
| `This install already has accounts. Sign in, or run minibrain admin reset-password.` | `setup-link` only creates the first admin | Sign in, or [recover access](../install/first-admin.md#recover-access) |
| In Docker, minibrain cannot write to `/data` | A bind mount there must be writable by uid 1000, the container's user | `sudo chown -R 1000:1000` on the host folder ([Docker](../install/docker.md#how-the-container-runs)) |
| `Can't locate revision identified by '…'` | An older release was started on a database a newer release migrated | Install the newer release, or restore the backup taken before the upgrade ([Roll back](../install/upgrades.md#roll-back)) |
| A database made by 0.1.0 does not upgrade | It predates the current migrations | Start 0.1.1 or later on a new home folder and database ([Upgrades](../install/upgrades.md)) |
| `this install already encrypts with a local master key that is not on this server: …` | Another main made the key file, and every main needs the same one | Copy the key file from the main that made it, or mount it and set `MINIBRAIN_MASTER_KEY_FILE` ([Local key file](../security/key-providers.md#local-key-file)) |
| `The DuckDB … extension is not installed on this server, …` when adding a data source | A native install does not carry the DuckDB extensions, and minibrain never downloads them while it runs | `minibrain extensions install` ([Python and uv](../install/python.md#install-the-duckdb-extensions)) |

## Sign-in

| You see | Why | What to do |
|---|---|---|
| "This page is not served over HTTPS, so your browser will not keep you signed in." | On plain HTTP anywhere but `localhost`, the browser drops the session cookie | Put a TLS proxy in front of main, or open it at `localhost` on the machine ([Sessions](../security/accounts.md#sessions), [TLS](../security/network.md#tls)) |
| "Wrong email or password" | The message does not say which of the two is wrong | An admin sends a **New password link** from **Settings** › **Accounts**, or runs `minibrain admin reset-password --email …` on the server |
| "Too many failed sign-ins. Try again in N minutes." | 10 wrong passwords for one account from one address lock it for 15 minutes, from that address only | Wait, or reset the password, which clears the lockout ([Passwords](../security/accounts.md#passwords)) |
| "Too many sign-in attempts from this address. Try again in N minutes." | One client address gets 30 sign-in attempts in 5 minutes. Behind a reverse proxy main does not trust, everyone shares the proxy's address | Wait. To count people apart, see [Sign in through a reverse proxy](../security/accounts.md#sign-in-through-a-reverse-proxy) |
| "This link has expired or was already used. Ask an admin for a new one." | An invite or password link works once and expires after 24 hours | An admin sends a new one ([Invite people](../security/accounts.md#invite-people)) |
| **Ask an admin for access** | You are signed in, through single sign-on or a proxy, but have no role | An admin gives you a role under **Settings** › **Accounts**, or maps your group ([Roles](../security/accounts.md#roles)) |
| "This account is turned off. Ask an admin to turn it back on." | An admin turned the account off | An admin turns it on again. The API keys it created were deleted and do not come back |
| Single sign-on returns to the sign-in page with a message | The message says which step failed, such as "The identity provider's settings do not match this install." | Check `auth.oidc` and the redirect URI ([Single sign-on with OIDC](../security/accounts.md#single-sign-on-with-oidc)) |
| `minibrain admin reset-password` says the email `has no local account` | Single sign-on and proxy accounts have no password in minibrain | Reset it at the identity provider, or add a local admin with `minibrain admin create` |

## Machines and GPUs

| You see | Why | What to do |
|---|---|---|
| `minibrain worker` stops with a line that starts `minibrain worker:` | The line says why; `main refused this machine:` comes first for a refused credential | Each message and its fix: [Machine health](../install/machine-health.md#troubleshooting) |
| `main is unreachable (…); trying again in N s` | The worker cannot reach main. It keeps running and carries on when main is back | Check `--main` and the [network](../install/machines.md#network) |
| `This machine's name gpu-01 resolves to 127.0.1.1, …` | Gateways on other machines cannot reach the engines at that address | Pass `--advertise` with an address other machines reach ([Add machines](../install/machines.md#what-runs-on-the-machine)) |
| A machine reads **Offline** | It has not checked in for 2 minutes | Check that the worker runs and reaches main. The machine's sheet gives the command under **How to fix** ([Heartbeats and offline](../install/machine-health.md#heartbeats-and-offline)) |
| A machine reads **Version drift** | Its minibrain, torch, transformers or peft differ from main's | Install main's versions on it ([Version drift](../install/machine-health.md#version-drift)) |
| A machine reads **Disk low** | Under 10 GB or 10% free on the disk under `MINIBRAIN_HOME` | Free space: **Infrastructure** › **Storage** shows what uses it |
| A machine has a GPU but trains and serves on the CPU | The PyTorch build decides the device. Windows gets the CPU build from PyPI, Docker on macOS has no GPU access, and uv's `auto` falls back to the CPU build when it finds no driver | **Infrastructure** › **Setup** shows the device main uses. Install the build for your GPU ([GPUs](../install/gpus.md#choose-another-build)) |
| The CUDA image does not see the GPU | The host needs an NVIDIA driver that supports CUDA 13.2, the NVIDIA Container Toolkit and `--gpus all` | `nvidia-smi` on the host must show CUDA Version 13.2 or higher ([Docker](../install/docker.md#run-on-nvidia-gpus)) |
| `Waiting for a GPU on gpu-01 with 38 GB free for training job 12: …` | Every GPU on the machine is in use, and none has that much room | The job or engine starts when a GPU frees up ([Engines and jobs on one machine](../install/gpus.md#engines-and-jobs-on-one-machine)) |

## Model downloads

| You see | Why | What to do |
|---|---|---|
| **Needs access from the publisher**, or a download that fails with `… is gated. Accept its licence at … and set HF_TOKEN on the minibrain server, then retry.` | The model is gated on Hugging Face | Accept its licence on the publisher's page, set `HF_TOKEN` on the minibrain server and restart it ([Download a catalogue model](../guides/models.md#download-a-catalogue-model)) |
| `Needs …; … free on the disk that holds models (…). Delete unused models or free up space.` | A model needs its download size, and 1 GB more, free on the disk that holds model files | Free space or delete unused models. A download stopped by a full disk resumes from the files already written |
| `Network policy is Allowlist and … is not on it`, or `Network policy is Offline: minibrain does not contact …` | The Network policy does not allow the host | An admin adds the host or changes the policy under **Settings** › **Security** ([Policies](../security/policies.md#the-policies)) |
| `Offline: downloads need a connection. Import the model files instead.` | The install runs offline | Import the model from a folder on the server ([Carry model weights](../install/air-gapped.md#carry-model-weights)) |
| A model cannot be added from Hugging Face, or its download is refused | The Model sources policy allows approved publishers only by default, and the Licences policy only selected licences | An admin changes the policy ([Licences and policies](../guides/models.md#licences-and-policies)) |
| `Only pickle weights found: pickle weights can run code when loaded; use the safetensors version` | Imports take `.safetensors` weights only | Use the safetensors version of the model ([Import a model](../guides/models.md#import-a-model)) |
| A base model's files are damaged or have moved | Each file is recorded with its SHA-256, so a changed or missing file shows | An admin can **Verify files**, then repair, re-import or point the model at its new location ([After it is on the install](../guides/models.md#after-it-is-on-the-install)) |

## Training

| You see | Why | What to do |
|---|---|---|
| **Train** is greyed out | Its tooltip says why: the base is still downloading, the dataset has fewer than 10 rows, or the base is a quantized format that cannot be trained | Wait for the download, add rows, or build on the full-precision format ([Start a run](../guides/training.md#start-a-run)) |
| The run stays on "Waiting for a worker" | No worker of a pool used for training is free or online | Check **Infrastructure** › **Machines**. A pool used only for serving reads "Not used for training" on the Train page ([Pool use](../guides/deployments.md#pool-use)) |
| The Train page says no plan fits, and does not start the run | Even the smallest plan needs more memory than the machine has. The page names the plan, what it needs and what the machine has | Pick another pool or machine, or a smaller base. QLoRA needs the `qlora` extra on the worker ([Memory planning](../guides/training-recipes.md#memory-planning)) |
| A version reads failed, with a reason | An attempt that fails for a reason worth retrying, such as a lost worker or running out of memory, runs again, up to three attempts. An attempt past 24 hours fails for good | **View logs**, fix the cause, then **Retry** ([Cancel, fail and retry](../guides/training.md#cancel-fail-and-retry)) |
| On a Mac, the run starts again on the CPU | A run that fails or stops making steps on the Apple GPU starts again on the CPU and stays there | Nothing to do ([Apple silicon](../install/gpus.md#apple-silicon)) |
| "Overfitting from step N: fewer epochs or more dropout may help" under the loss chart | The reading of the run's loss curves | Train again with fewer epochs or more dropout ([Follow the run](../guides/training.md#follow-the-run)) |
| The training API answers 409 | Nothing fits; the body carries the sentence the Train page shows | [Training API](../guides/training-recipes.md#training-api) |

## Evaluation

| You see | Why | What to do |
|---|---|---|
| **Deploy vN** is greyed out, with "Doesn't meet your deploy rule: …" | The version fails a check of the model's deploy rule on its held-out rows | Train a better version, or change the rule under the model's **Evaluation** tab › **How it's scored**. A version that was live before can always be deployed again ([The deploy rule](../guides/evaluation.md#the-deploy-rule)) |
| A version has no score yet, or reads "Queued · waiting for a worker to start scoring" | Scoring is a job. It needs the base on the install and a free worker in a pool used for training | Wait for the base to download, and check **Infrastructure** › **Machines** |
| Scores move a lot between versions | Under 100 rows, scores are rough. With fewer than 50 held-out rows, one row moves the score by several points | Add rows to the dataset; the held-out rows grow with it ([When to train](../guides/training.md#when-to-train)) |
| **Data vs live** says the data changed | The two versions were made from different dataset versions, so they were scored on different held-out rows | Follow its link to compare the data ([How a version is scored](../guides/evaluation.md#how-a-version-is-scored)) |
| **Invalid answers** is above zero | Some answers fall outside the model's labels or JSON schema | Open the version on **Evaluations** and read its **Mistakes** ([The Evaluations page](../guides/evaluation.md#the-evaluations-page)) |
| Scores take a while to change after you change the graders | **Save and re-score** starts one scoring job for each scored version | Follow the jobs under **Jobs** ([How it's scored](../guides/evaluation.md#how-its-scored)) |

## Serving and the API

Every status the API answers with, and its body: [Errors](../api/overview.md#errors).

| You see | Why | What to do |
|---|---|---|
| 401 `invalid API key` or `API key expired` | The key is missing, unknown, revoked or past its expiry | Create a key, and send it as `Authorization: Bearer mb_…` ([Create an API key](../api/overview.md#create-an-api-key)) |
| 403 `this API key does not cover support-triage` | The key names other models | **Edit scope** on the key, or create one for this model |
| 404 `support-triage is not deployed; deploy it, or call one of its versions such as support-triage@1` | The model has no live version | Deploy a version, or call one by number ([Deployments](../guides/deployments.md#deploy-a-version)) |
| 400 with a field in `param` | The field is invalid, out of range or not supported by this model or its engine. A custom model also needs the last message to be a `user` message or a `tool` result | Fix the field ([Chat completions](../api/chat-completions.md#messages)) |
| 409 `… will not load against them: restore …'s original files or train a new version.` | The base model's files changed after the version was trained | Restore the base's original files, or train a new version |
| 422 from `/v1/feedback`, starting `Send input with the feedback:` | The model does not keep request inputs and answers, so the feedback must carry the input | Send `input`, or turn the switch on ([Feedback](../guides/feedback.md#send-feedback-from-an-app)) |
| 503 with `code: overloaded` and `Retry-After: 5` | The gateway already answers as many calls as it takes at once, 64 by default | Retry as the header says. Raise `MINIBRAIN_GATEWAY_CONCURRENCY`, or add gateways and replicas ([Busy and starting models](../api/overview.md#busy-and-starting-models)) |
| 503 with `Retry-After: 10` | The model's engine is still starting or fetching weights | Retry. Raise the SDK's `max_retries` for models that take long to start |
| The model's header says "Waiting for a machine in gpu-a10" | No machine of its pool is online | Start a worker in that pool, or deploy to another pool ([Deploy a version](../guides/deployments.md#deploy-a-version)) |
| "Fetching weights" stays for a long time | A machine is copying the base weights from the bucket or from main; its engine logs the progress every 30 seconds | Wait, and read the engine's log on that machine ([Weights on other machines](../reference/how-serving-works.md#weights-on-other-machines)) |
| "Moving to gpu-a10 failed: its engine in pool gpu-a10 failed to start. It stays on local." | The new pool's engine did not start, or none of its machines was online for 5 minutes | The model keeps serving where it was. Fix the pool, then move again ([Move to another pool](../guides/deployments.md#move-to-another-pool)) |
| A pool reads "Too small", "No machine online" or "Not used for serving" in the Deploy dialog | The model does not fit its machines, none is online, or the pool is used for training only | Pick another pool, add a machine, or change **Used for** ([Pool use](../guides/deployments.md#pool-use)) |
| Health says "The engine for … on … failed" or "… is live but no replica is running" | An engine failed, or no machine of the model's pool runs it | Open the model and check its deployment and weights ([Machine health](../install/machine-health.md#troubleshooting)) |
| A custom model ignores your system message | It answers after its own instructions and drops `system` and `developer` messages | Change the model's instructions instead ([Messages](../api/chat-completions.md#messages)) |
| A revoked key still answers for a moment | Gateways pick up key changes within about a second | Nothing to do ([The request path](../reference/how-serving-works.md#the-request-path)) |
