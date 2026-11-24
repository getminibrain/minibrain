# Changelog

What changed in each minibrain release, newest first. To move to a new version, see
[Upgrades](https://getminibrain.com/docs/install/upgrades).

## Unreleased

- Busy models answer 503 with Retry-After instead of slowing the app, and a model still starting says when to try again.
- The documentation moves to [getminibrain.com/docs](https://getminibrain.com/docs), rewritten as one short page per
  topic: getting started, install and run, guides, the API, security, observability and reference.
- Home follows your path from data to requests with live counts and the next step, lists your models with their state,
  score and traffic, and puts running jobs first.
- The sidebar shows the installed version above the user menu, and both link to this changelog from **What's new**.
- The logo is one drawing in the sidebar and on the sign-in pages, the same as on getminibrain.com.
- Dark mode is a little lighter, with borders you can see.
- Health on Home shows every check, not only problems: serving, machines, memory and disk of this machine (with the
  fullest other one), training and the audit log. Memory names the loaded models holding it and turns amber when it
  runs short on a Mac or a machine without a GPU.
- A live model's page has an **Undeploy** button next to **Deploy**.
- A model asks you to train again only when there is a reason, and says which: new answers from feedback or new data.
- A model's overview shows its latest activity above its versions.
- Every usage bar looks the same, the one Train uses, including on Infrastructure › Storage.
- The user menu groups Settings and Theme, then the API reference, docs and What's new, then Sign out.
- In the Playground, Enter sends and Shift+Enter starts a new line.
- Plainer words: **Invalid answers** on Evaluations, and the Playground and Train say what a model answers with
  instead of "its contract".
- Only live models keep a model loaded in memory. A model you only tried in the Playground or scored is unloaded
  after 15 minutes without requests; before, every model with a version stayed loaded until restart.

## 0.1.2 - 2026-11-20

- The Docker image and the Compose file download models by default. Air-gapped installs set `MINIBRAIN_OFFLINE=1`.
- Playground settings are grouped by what they change, with a count of changed values, presets in one row with a menu,
  and a summary of exactly what the request sends. Numbers you have not set read **Default**.
- With no model to answer, the Playground stays open read-only and offers to download one.
- The user menu links to the docs and names the installed version. People signed in through single sign-on see why
  there is no **Sign out**.
- A new logo, and sign-in and setup pages centred under it.
- New guides: your first model, training, adding machines and upgrades.

## 0.1.1 - 2026-11-20

The first release built around the full journey: data in, a scored baseline, training, deployment on your own
machines and calls from your apps.

### Data

- A data catalogue with folders, sources and datasets. Sources come from uploads, server folders, S3, databases and
  Iceberg or Delta Lake tables.
- A dataset is a DuckDB SQL query over your sources, written in an editor with completion, examples and a live
  preview beside it.
- Quality checks list each finding with its rows and offer one-click fixes.
- Every save is a new dataset version. Train on as few as 10 rows; under 100, the check warns that scores will be
  rough.

### Models

- Add a model from the base catalogue or import your own, with the memory and disk it needs on each pool.
- Every model starts as version 0, a scored baseline, with an output of labels, JSON or free text.
- A Train page with Fast, Balanced and Best presets or your own parameters. Each run plans its memory (LoRA or QLoRA,
  gradient checkpointing, 8-bit optimisers) and shows loss and learning rate live.
- The Evaluation tab shows scores by version, where a model fails, what it is tested on and how it is scored.
- Export any version as a merged model in safetensors, with its model card.

### Serving and the API

- Deploy to a compute pool of your choosing; moving a live deployment hands over once the new pool is ready.
- The OpenAI-compatible API gains `/v1/completions`, tool calling, reasoning on or off at an effort, sampling
  parameters on every engine, and a vLLM engine.
- A Playground with settings, presets, streaming, reasoning, tool calls and the code for each request.
- **Connect** creates an API key, fills it into code for your language, sends a test request and shows when the first
  request arrives. API keys can cover every model.

### Machines

- Add machines to a pool with a join token per pool; drain, undrain and remove them.
- Machines report live GPU memory, load and disk, and Infrastructure shows what runs where.
- Storage shows what is using the disk and what can be freed.

### Security and administration

- The audit log gets filters, an event panel and export; its hash chain is checked hourly and nightly, and breaks are
  kept until an admin acknowledges them.
- Provision the whole install from `minibrain.yaml`, locked in the UI.
- Sessions end after a working day idle or a week in total, and the sign-in page says why.
- A **Your account** page to rename yourself, change your password and sign out other sessions.

## 0.1.0 - 2026-11-04

The first release.

- Data sources from uploads, server folders, S3, databases, Iceberg and Delta Lake tables, and datasets as SQL queries
  over them, copied as a snapshot for each training run.
- Discover and compare open models, with licence filters, and add them as base models.
- Train and score versions against a baseline, with a model card, a validation report and an AI-BOM per version.
- An OpenAI-compatible API with structured output, a feedback endpoint and a review queue, and ready-made configs for
  curl, Python, JavaScript, LangChain, LlamaIndex, LiteLLM and more.
- Accounts with Viewer, Builder and Admin roles, single sign-on through OIDC or a trusted proxy, and the first admin
  from a one-time setup link.
- Encryption at rest, each file under its own key, with a local master key, AWS KMS, HashiCorp Vault or a PKCS#11
  HSM.
- A hash-chained audit log with SIEM export over syslog.
- Prometheus metrics, OpenTelemetry export and JSON logs.
- Signed releases: an installer, a wheel and Docker images, each with a Sigstore signature, SBOMs and SLSA provenance.
