# minibrain roadmap

Private platform for building models of any size on your own data, task-specific or general purpose. Point at a data
source → build examples → train a LoRA → eval against the base → serve an OpenAI-compatible API. Many models per
install. On-prem, VPC or cloud: connected by default, air-gapped as an option. One deployable in v1, split into
services later.

Standards: HF transformers + PEFT + TRL, OpenAI API. No Axolotl, no LLaMA-Factory.

## Positioning

- Easy first (2026-11-26): one product, one command, on the customer's own servers or cloud, with nothing to
  assemble. Every feature keeps the path from data to a live model straightforward; where it is not easy yet, it
  is made easy on the way.
- Size follows the job: a small base where latency and cost matter, a large one where breadth matters. A model can
  do one task or be a general-purpose assistant for a domain.
- A model learns **behaviour** (task, format, house style, labels) and **stable domain knowledge** (jargon, how
  things relate, rarely changing policy). Exact, changing or citable facts come from retrieval.
- Facts that change, need citations, or sit behind per-document access rules come from the model's own index
  (RAG), built from the same sources as training.
- Train only when it pays off. Every model starts prompt-only on a local base model; the eval shows whether a
  trained version beats it on score, latency or cost.
- Two products on one install: a **private frontier endpoint** (the large open model behind the gateway, offline) and
  **models** built on the customer's data, from small task models to large general-purpose ones.
- The customer owns the result: weights, data, evals, and the decision when anything changes. Every model carries
  forward to each new base model (rebase).

### Use cases

Good fit, v1 targets:

| Use case | Task |
|---|---|
| Support automation | Triage, routing, reply drafts in house voice, from ticket history |
| Contract review | Clause extraction and classification → JSON |
| Industry domain model | Jargon, formats, proprietary label sets |
| Financial analysis | Text-to-SQL on the customer's own schema |
| Distillation | Logged frontier-model calls → a private model at lower cost and latency |
| Domain assistant | A general-purpose model adapted to the organisation's language, formats and policies |

Need the index (Answer task type): internal knowledge Q&A, sales enablement, codebase assistant, compliance and
policy, HR helpdesk, customer success onboarding.

### Why raw documents are not enough

- Training on raw pages (`{"text": ...}`) teaches vocabulary and style, not reliable recall. The model answers in the
  right tone, gets details wrong, cannot cite, and goes stale on every edit.
- Fine-tuning learns input → output. Every example needs the correct output: the **label**.
- Documents become examples three ways: teacher-generated Q&A (`generate_qa`), teacher labels for a task, or raw text
  for house style only.

## Task types

Every model has an output contract and graders. Training data is always chat examples (`messages`); a column mapping
is a template that turns table rows into them. A task type is a preset that picks the contract, the default graders,
the mapping form and the serving constraint, so a team without ML specialists gets a scored, promotable model.
Fireworks and Together expose only the parts; minibrain exposes both, on one engine.

| Preset | Contract (served as) | Default graders | Example |
|---|---|---|---|
| Classify | One value from a label set (an enum in `response_format`) | Exact match: accuracy, per-label F1 | Ticket → `billing` |
| Extract | A JSON schema (`response_format: json_schema`) | JSON validity, per-field match | Invoice → `{"total": 120, "due": "2026-12-01"}` |
| Rewrite | Free text | Judge model with a rubric, similarity to the reference | Draft reply → reply in house style |
| General / Chat assistant | Free text, multi-turn; structured output on request | Text similarity; a judge model with a rubric once a judge model is set | Support conversation → answer in company tone |
| Text-to-SQL | SQL | Execution match on a read-only database | Question + schema → query |
| Custom | Any contract above, chosen | Chosen | Bring chat JSONL |

- Two contracts: free text and a JSON schema. A label set is a JSON schema with one enum field (`label`) and is served
  as the bare label.
- Add model asks for a base, a dataset, its output and a name (Output built 2026-11-14). Once a dataset is picked,
  Output (Labels, JSON or Free text) is suggested from its answers by `GET /api/datasets/<slug>/output`: the latest
  dataset version's label set when there is one, else JSON with a schema inferred from up to 200 answers when nine in
  ten are JSON objects (property types, nested objects and arrays, required when every answer has the field), else
  free text. Labels show as an editable list, JSON as an editable schema, and creating sends the contract with its
  preset (Classify, Custom or Chat assistant), so v0 is scored the right way from the start. The API's default stays
  `general`. A model made as a Chat assistant narrows later, in two ways:
  - From the dataset: if its latest dataset version's expected answers look like a label set (the check's rule:
    at most 256 short single-line values, each repeated on average), the model page proposes them ("Answers look like
    labels: billing, bug, refund (+2). Restrict answers to these?"). Accept switches the model to Classify with those
    labels, its graders and its view, and scores a prompt-only version with them when the data splits; Dismiss keeps
    it a Chat assistant and is remembered for that dataset version (`PUT
    /api/models/<slug>/label-proposal/dismissal`), so a later dataset version asks again.
  - By hand: Settings → Evaluation → Answers → Edit picks free text (Chat assistant), one of these labels (Classify) or a
    JSON schema (Custom), all through `PUT /api/models/<slug>/contract`. A new kind of answer moves the model to that
    kind's preset and resets its graders and promotion rule to the preset's defaults; the same kind keeps the preset.
- The contract lives on each version and evolves additively: a new version may add enum values or optional fields
  freely. Until the model has gone live (a version promoted once, `models.first_live_at`) every change is free, a new
  kind of answer included. After that, removing, renaming, retyping or making a field required, or switching the kind
  of answer, is a breaking change that needs an explicit confirmation (`breaking: true` on `PUT
  /api/models/<slug>/contract` or on the new version), because apps depend on it. Contracts are numbered per model
  (contract 1, 2, …); every version records its number, and every `/v1` request log records the number it was served
  with. `POST /api/models/<slug>/contract/check` lists the changes against the latest version first and says whether
  they need that confirmation.
- Constrained decoding enforces the contract on one path: XGrammar on SGLang and vLLM, a grammar on llama.cpp, a token
  trie on MLX and `transformers`. The gateway checks a JSON answer against the schema and answers 422 when it breaks
  it.
- Graders share one interface, `score(answer, example) -> {metric: value}`, and summarise a split. Built in: exact
  match, label accuracy (with macro F1, per-label scores and the confusion matrix as its report), JSON valid, JSON
  field match (per field), text similarity (token F1), and a judge model with a rubric (a model on this install, so it
  runs air-gapped, scoring 1 to 5 with a one-sentence reason as its own job). Later: SQL execution and Python graders
  run sandboxed. Every score records its grader's name and version, so scores stay comparable.
- The promotion rule is a plain list of thresholds over metric names (`label_accuracy >= 0.85`, `json_valid == 1`) on
  the held-out split, plus "at least as good as the live version on the main metric" (the first metric of the first
  grader; ties pass). No rule language. A version goes live only when the rule passes; a version that was live before
  can always be rolled back to.
- Distill is a data source, not a preset: answers logged from a teacher model become the examples for any preset.
- Rewrite also accepts raw documents as a style source, not only input/output pairs.
- Training methods: SFT with LoRA by default; full fine-tuning; DPO from feedback pairs; reinforcement fine-tuning
  (GRPO) with the same graders as rewards.

### For ML engineers

- The Custom preset: chat JSONL, the contract and graders chosen, Python graders.
- Training settings: LoRA rank, learning rate, epochs, sequence length, full fine-tuning, DPO; saved recipes.
- Everything the UI does through the API and CLI; `minibrain.yaml` per model in git (Config as code); `minibrain train`
  in CI with the promotion rule as the gate.
- Export adapters or merged weights (safetensors; GGUF in v2), with training logs and metrics.

### Product priorities

Set on 2026-11-06. The premise is owning your intelligence: run and adapt strong open models in place of the
ChatGPT, Claude or Gemini APIs. Training a frontier model from scratch is not the goal; adapting a strong open one is.

1. A private endpoint that is a drop-in for the OpenAI API: tool calling (function calling) with streaming,
   `/v1/completions` for code completion, a chat UI for staff, and sizing guidance for 30B to 120B models on several
   GPUs.
2. Retrieval over company documents with per-user access, for internal knowledge assistants. It brings embedding
   models as their own kind (catalogue type, embed-mode engines, deploy without versions or training, a compare-texts
   view instead of chat) and `/v1/embeddings`, because the index is built from them.
3. Adapting the chat assistant: instructions, fine-tuning on your best answers, distillation from a teacher, DPO from
   feedback.
4. Extract, for document processing.
5. Specialist presets (Classify is done) and the ML-engineer tooling below.

Item 1 progress (2026-11-06): sampling fields on every engine, a vLLM engine, tool calling through each family's
chat template (Qwen and Hermes, Llama 3.x, Mistral, gpt-oss), reasoning off or at an effort with
`reasoning_content` apart from the answer, token streaming from every engine, and a safety model (Llama Guard,
ShieldGemma, Qwen3Guard, gpt-oss-safeguard) per install, model or request, and a Playground with every setting,
Recent chats saved per person and Save as test example, and `/v1/completions` (2026-11-12). Not yet: sizing
guidance, the staff Chat app. `/v1/embeddings` moved to item 2 with retrieval.

The staff Chat app comes next and is separate from the Playground: a ChatGPT-like app for everyone in the
organisation, with per-person history, retrieval over company documents, sharing and admin retention. The Playground
stays the tool for trying models with the API's settings and turning bad answers into test examples.

Add model asks for a base, a dataset and a name; every model starts as a Chat assistant and narrows later (labels
proposed when the dataset looks like a label set, or set in Evaluation › How it's scored › Answers; see Task types). Built (2026-11-06).

### Order

There are no users yet, so the engine is built from scratch with no compatibility layer; today's Classify code is
replaced, not migrated.

1. Done (2026-11-05). The engine, usable as Custom: chat examples, a contract (free text, label set, JSON schema),
   built-in graders (exact match, label accuracy, JSON field match, text similarity, a judge model on this install)
   and a promotion rule over them.
2. Done (2026-11-05). Classify as a preset on it.
3. Done (2026-11-05). General, shown as Chat assistant: free text over turns, chat JSONL and question and answer
   tables as data, a system prompt, text similarity plus a judge with a default rubric, the judge model setting, the
   answer review and the default rule. Later: distillation from a teacher, DPO from feedback.
4. Extract, then Rewrite (decided 2026-11-27: the two presets buyers ask for first, built before Rebase and the
   rest of v1).
5. For ML engineers: sandboxed Python graders, training settings and saved recipes, the CLI with `minibrain.yaml`,
   reinforcement fine-tuning with the graders as rewards, exports.
6. Text-to-SQL with the execution grader.

### Presets

A preset is a definition file in `minibrain/presets/<key>.yaml`: the contract (`labels` from the data, or `choose`),
the mapping template, the version 0 prompt and the trained prompt per contract kind, the default graders, the data
checks, the default promotion rule and at most a results view. Adding Extract is one such file plus its
view in the UI; `GET /api/presets` lists the presets, the ones coming and the graders.

- Classify: a label set from the accepted proposal or the labels typed in Evaluation › How it's scored › Answers, joined by those found in
  the data (new ones join it on the next version); mapping `input` → user, `label` → assistant; a version 0 prompt
  listing the labels and a trained prompt without them; graders `label_accuracy` (with `macro_f1`); checks at least
  two labels and label balance; the results view shows per-label counts and the confusion matrix, and feedback picks
  the right label. A version's results view follows its own contract (labels: Classify; free text: Chat assistant),
  so versions from before a switch keep theirs.
- General, shown as Chat assistant: a free-text contract over turns; chat JSONL (`messages`, system messages
  dropped) or a question and answer table (`question`/`answer`, `prompt`/`completion`, `input`/`output` and the
  like) as data; every assistant turn trains and the last one is scored; version 0 is the base with the model's
  system prompt (written on the model page) plus a few examples from the dataset; graders text similarity, plus the
  judge with a default rubric (correct, follows the instructions, concise) once a judge model is set; no checks; the
  default rule. `expected: data` takes expected answers from the data; the hook for distillation is `expected:
  teacher`, which will fill them from a teacher model. Try with demo data on the empty Models page creates a Chat
  assistant on the demo travel intents (base and name, like Add model); its model page then proposes the five
  intents as labels, which shows the narrowing flow rather than skipping it.
- Custom: a JSON schema pasted in Evaluation › How it's scored › Answers (free text or labels through the API), any graders that fit it
  (free text: exact match and text similarity; JSON: JSON valid and field match by default), optional instructions as
  the system prompt, chat JSONL (`messages`) as data.

## Concepts

The platform is six things and three rules (2026-11-12):

| Thing | Is |
|---|---|
| **Model** | A named thing apps call by its API name (`support-triage`); custom (base + versions) or base |
| **Version** | An immutable result: base + adapter + instructions + dataset version + settings |
| **Dataset** | Versioned training data |
| **Deployment** | A desired state: this model's live version runs on this pool with N replicas, kept true continuously |
| **Job** | Any finite work: train, score, judge, download, import, verify, export, deploy, undeploy |
| **Pool** | Compute: machines and GPUs, used for serving, jobs or both |

API keys decide who may call which models.

1. **Everything you do runs as a job**, with steps, logs, a duration, cancel and retry, on one Jobs page. Deploy and
   undeploy are jobs (rollouts) that bring the deployment to the state asked for.
2. **Everything that runs is a deployment**: its health shows on the model and in Infrastructure, and it is kept alive
   (restarts and reloads) without new jobs.
3. **Everything is recorded**: jobs keep their logs, every change is in the audit log, and Activity shows it per model.

New capabilities add a job kind (export, distill, rebase) or a pool type (Kubernetes, your cloud, managed compute),
not a new concept.

A custom model needs a dataset when it is created and keeps it for life; the dataset's versions change underneath,
and retraining uses the newer ones. A model never switches dataset; Duplicate covers that, and the copy takes another
dataset (2026-11-13). v0 is created at once as the untrained baseline (the base with the model's instructions), scored
on the dataset's held-out rows and deployable at once.

A custom or base model's Settings tab (Builders, last tab) replaces the header's ⋯ menu: General (name, API name,
avatar, description, tags), Base and copies (Switch base, Duplicate), Deployment (Undeploy) and a Danger zone
(Delete). A custom model's Evaluation tab (`/models/<name>/evaluation`, between Versions and Monitoring, 2026-11-13)
holds everything about scoring: Scores (the headline score of each ready version as a line, the promotion rule's
threshold on the main metric as a dashed level and the deployed version marked, under one line such as "v4 · 89% ·
passes the rule · deployed v3 · 86%", the same height with an empty frame and "No scores yet" before any score),
Where it fails (Builders: the held-out rows a picked version, the latest scored by default, does not get fully right,
with input, expected, answer and the grader's score and reason, or against the deployed version the rows newly right
or newly wrong; a row opens the whole conversation in a sheet), What it's tested on (one section, 2026-11-14: the
held-out rows of the latest scored version, its dataset version with a link and newer data, then for Builders the test
examples with their count, Add test example and From the Playground, and a Remove on a row's hover or focus, which
rejects the row with `DELETE /api/models/<slug>/test-examples/<id>`, audited as `feedback.example_remove`) and How it's scored (Builders: answers,
graders, judge, judge rubric, promotion rule). Changing the graders or the judge asks to re-score every version and
runs it as a `score` job, so versions stay comparable; changing the promotion rule saves without re-scoring.

| Term | Meaning |
|---|---|
| minibrain | Slug, sources, base model (pinned revision), `current` version pointer, system prompt, index, API keys |
| Version | Prompt-only (model + instructions + few-shot examples) or trained (dataset version + recipe + base model revision + adapter), plus its contract and number, graders and eval result. Immutable. Version 0 is always prompt-only, the untrained baseline, and is created with the model |
| Dataset version | A dataset's rows copied to content-hashed Parquet when the dataset is created, its query is saved or it is updated; numbered per dataset (v1, v2, …); splits are derived from it |
| Pool | One serving engine, one base model, N adapters loaded. The teacher runs as its own pool |
| Job | Finite work run by a worker: data build, training, eval, judge, transfers, exports, deploy and undeploy rollouts |
| Preset | General (Chat assistant), Classify or Custom today (Extract, Rewrite, Text-to-SQL coming); sets the contract, mapping, prompts, graders, checks and promotion rule defaults |
| Contract | Free text or a JSON schema (a label set is one enum field); numbered, additive, on each version |
| Grader | `score(answer, example) -> {metric: value}`, named and versioned |
| Golden set | 20–50 human-verified examples; defines the task and scores every version |
| Teacher | A larger local open model that labels data, sets the quality bar and serves prompt-only versions. An API teacher is opt-in, off by default |
| Rebase | Rebuilding a model on a new base model from its dataset version, golden set and config, then comparing it with `current` |
| Feedback | A flagged or corrected output from the gateway or playground; lands in the review queue. A test example from the Playground is accepted feedback held out for scoring |
| Index | The model's fact store, built from the same sources as training: chunks, embeddings, access metadata, synced continuously |

## The core journey

Every UI change serves one of these steps or questions itself (2026-11-13). Home's journey strip, empty states and
each model's next-step line follow them.

Home (2026-11-23, replaces the 2026-11-14 Get started checklist): a strip "From data to an app" that never hides, with
Data, Models, Trained, Evaluated, Live, Connected and Requests, each a live count from real state (datasets, custom
models, models with a ready trained version, with a scored trained version, deployed, API keys on models, requests in
the last 7 days) that links to its page. The first step not yet run is marked and carries its action (Builders; Viewers
see the counts without Data). Below it: Models (live first, then the most recently changed; state, score against v0,
requests over 7 days, p50 and each model's next step) and, side by side, Jobs (running first) and Health.

A model's next step offers training only with a reason (2026-11-24): never trained, a dataset version newer than the
one its newest trained version used, or accepted feedback no version has trained on. The label says which ("Train v2
with 3 new answers", "Train v2 on new data"). A live model with none of these has no next step: a finished model
serves and is not trained again for its own sake.

Health on Home (2026-11-24) always lists its checks, one line per area with what it found: Serving (live models and
their replicas, running or starting), Machines (online, the release), Memory (this machine's share used and which
loaded models hold how much; amber at 90% and red at 95% where memory is RAM or unified, never for GPU memory, which
engines reserve on purpose), Storage (this machine's fullest disk, what is free and minibrain's share), each with the
fullest other machine and, for admins, Open; Training (running and finished in 24 h) and, for admins, Audit log. A
problem replaces its area's line, worst first, with "+N more" and Show all. `GET /api/problems/checks` returns the
areas and the problems from one pass. Home shows no usage bars: they belong where memory or disk is the subject
(Train, Add model, Infrastructure), and every usage bar there is the one gauge at one size.

A model's Overview (2026-11-24) shows its last five activity entries above Versions, at the same height, with All
activity opening the Activity tab.

1. **Install** on one server; sign in with the setup link as the admin.
2. **Add data**: upload a CSV or JSONL, or connect Postgres; it becomes a dataset with held-out rows set aside.
3. **Add a model**: base (downloads or imports in the background if missing), dataset, name, output (labels, JSON or
   free text).
4. **Baseline**: v0 (base + instructions) is scored at once on the held-out rows.
5. **Train**: one click from the Train page; the new version is scored on the same rows ("+18 vs v0").
6. **Deploy** the version that passes the promotion rule; a deploy job loads it and routes the API name to it.
7. **Connect**: create an API key; apps call `/v1` with the model's API name.
8. **Run**: Monitoring shows requests, latency, errors and cost per version; the audit log records every change.
9. **Improve**: reviewed feedback and new dataset versions show "vN available · Train"; retrain, compare, deploy.
10. **Own it**: weights, data, scores and logs stay on the server; export the adapter or a merged model at any time.

## Flow

base + dataset + name → version 0 as a Chat assistant: prompt-only on the base at once, scored on the held-out rows
→ narrow the answers (labels proposed from the data, or set in Evaluation › How it's scored) → stop here if it passes the promotion
rule and the cost is acceptable.

Otherwise: source → DuckDB (query in place or stage) → mapping / SQL → built-in steps → teacher labels + human review
→ dataset version (train/eval split) → quality + PII + preview → LoRA training (worker subprocess) → eval vs base,
teacher and version 0 on the golden set + human review → promote → load adapter into pool → gateway
`/v1/chat/completions`

Distill shortcut: the gateway forwards calls to an upstream model and logs them → the logs are the dataset → train →
apps change the model name. The upstream is a reference model in v1 and the local teacher in v2.

Index, alongside: the same sources → chunks → embeddings → index, synced continuously → the gateway retrieves from it
at answer time.

## Architecture

One install is one supervised process tree: one command starts it, and minibrain starts and restarts the rest.
main is the control plane; gateways and engines are the serving plane. Production runs on GPU racks, rented or on-prem;
a laptop install is onboarding. A local main can drive remote GPU workers and engines. Details and tradeoffs:
`docs/reference/architecture.md` and the docs it links.

| Process | Runs |
|---|---|
| main | UI and `/api`, management, job submission, deployments, gateway (`/v1`) and routing; supervises the others |
| worker | Ingestion and data preparation; launches training jobs |
| training | One child per training or eval job; writes checkpoints and results |
| engine | One model (base + many adapters) per process; SGLang, MLX, `transformers` or llama.cpp, chosen per node |

- The serving plane keeps serving without main. main publishes a versioned config snapshot (routes, versions, adapters,
  key hashes, limits); gateways keep the last good copy on disk and serve from it, and buffer request and audit logs
  until main is back. A main outage or upgrade pauses only the UI and new jobs; rollback republishes a snapshot.
- Everything long-running is a job on one contract: data preparation, training, eval, batch jobs, pipeline steps.
- One binary, many roles: `minibrain serve` runs all; `--role api|gateway|worker|engine` runs one. Compose, Helm and
  Kubernetes only start roles separately.
- The jobs table is the only job state: status, attempt, lease with heartbeat, idempotency key, cancel flag. A job is
  stored before it runs and the API returns its ID at once.
- Workers never touch the database. They claim, heartbeat, report and finish through the API, so the main process is
  the only writer and a remote worker is the same program with a URL and a token.
- At-least-once execution: jobs write to a temporary location and commit atomically; training resumes from its last
  checkpoint after a lost lease.
- Progress is events: workers post them, the UI follows over SSE. Logs are artifacts read by offset.
- Job output is parsed as the worker reads it (built 2026-11-06): a JSON line with minibrain's shape (`ts`, `level`,
  `event`, `message` and fields) is a structured event; anything else is a library line with a guessed level (glog
  `W…`/`E…` prefixes, `Warning:`, `ERROR`), and a traceback with its chained causes is one error. Events keep their
  level and name in `job_events`, so charts read them by name and never re-parse logs.
- Artifacts are referenced by SHA-256 ID, never by path: sources, dataset versions, adapters, checkpoints, eval results, logs,
  batch outputs. Base model weights are pinned by repo and revision, and each file by its SHA-256.
- The gateway is separate from management: routing lives in memory, refreshed on version changes, with no database
  read per request. Engines are children with health checks.
- The main process leases GPUs: training and engines share them on one box, so a job states its needs and waits.
- Compute pools: workers and engines join a named pool and report GPUs, memory, CPU, platform and installed engines.
  Discover judges fit against the selected pool; the Compute page lists pools, machines and engines.
- [x] Simple joining (2026-11-16): a pool has one join token (no roles or expiry), shown once when made or rotated;
  rotating cuts off the old one and the engine tokens minted from it. Add machine is pick a pool, copy one command
  (`minibrain worker --main URL --pool NAME`). Without a token the worker asks to join and prints a code; an admin
  approves it under Machines › Waiting for approval, and the machine gets a credential bound to its pool and host,
  kept across restarts and revoked by removing the machine. Never a token-free join. Details: `docs/install/machines.md`;
  `docs/security/network.md`.
- [x] Deploy to a pool (2026-11-14): Deploy and Promote take a pool (or auto: this machine when it fits, else the
  pool with most memory left) and a replica count; a pool where the model does not fit is refused. Workers in that pool
  start and stop the engines to match, gateways route the deployed name only to that pool, and the model says where
  it runs or that it waits for a machine. Details: `docs/guides/deployments.md`.
- [x] Rolling pool moves (2026-11-14): moving a live deployment keeps the old pool serving until the new pool's
  engines are ready, then switches the route and stops the old ones; a failed engine or no machine for 5 minutes
  rolls it back and the model says why.
- [x] Pool use (2026-11-18): each pool is used for **Any** work, **Serving** or **Training** (default Any, so one
  machine works out of the box), stored as a list of workloads so more kinds need no schema change. Deployments go
  only to pools used for serving; training and scoring jobs only to pools used for training; downloads, imports,
  checks and exports anywhere. A production pool set to Serving can never be starved by training. Pools stay one
  concept (capacity, like Kubernetes node pools) rather than separate training and inference pools, because the same
  machine is often both. Details: `docs/guides/deployments.md`.
- [ ] Serving first on Both pools: GPU leases prefer engines; a job takes only GPUs no engine needs and waits (or, for
  a long run, checkpoints and yields) when serving needs them back.
- [ ] Infrastructure shows each pool's use and load, e.g. "gpu-a10 · Serving · 2 engines · 0 jobs", and the Train
  page and Deploy dialogs only offer pools that allow jobs or serving respectively (done 2026-11-18); Discover's fit
  check still judges every pool.
- Engines pick their engine at start from the node and the weights: SGLang on Linux with NVIDIA or ROCm, MLX on Apple
  silicon, llama.cpp for GGUF, `transformers` otherwise. Remote engines (`minibrain engine --model --pool`) pull
  adapters from main and base weights from the bucket on links main signs (from main itself when Storage is the
  folder), and announce themselves; replicas scale horizontally.
- Gateways route per model: fewest requests in flight, sticky by adapter or prompt prefix, overflow when busy, health
  checks and failover. HAProxy, Envoy or a cloud load balancer in front; sgl-router or llm-d under the gateway later.
- Several mains on Postgres: an advisory lock picks the leader for lease expiry, catalogue sync and log purge. No
  ZooKeeper; consensus is Postgres HA's or Kubernetes'. SQLite stays a single main.
- Orchestration: workers started by hand or by the customer's tooling in v1, and they start the engines of the
  deployments on their pool; a Kubernetes launcher in v2, a cloud VM launcher later.
- Children die with the parent and restart with backoff. A launcher starts work: a local subprocess now, a remote
  worker or a Kubernetes Job later.
- Module boundaries (registry, data, train, serve, gateway) are the future service boundaries; no in-memory state
  crosses them.
- One database code path: SQLAlchemy 2 and Alembic, no raw SQL or dialect branches. `MINIBRAIN_DATABASE_URL` picks
  SQLite (default) or Postgres; tests run on both. The job claim is one statement (`UPDATE … RETURNING` with
  `FOR UPDATE SKIP LOCKED`, which SQLite ignores).

| | Local | Deployed |
|---|---|---|
| Metadata | SQLite (WAL) | SQLite; Postgres for a highly available main |
| Artifacts | Local folder | S3-compatible store |
| Workers | Local processes | Local or remote, same contract |
| Engines | Local children | Local or remote, per pool, routed by gateways across replicas |
| Roles | One process tree | Separate processes or services |

### Tradeoffs

- No Compose or Kubernetes locally: Docker on macOS has no GPU, and `uvx minibrain serve` must work air-gapped.
- Own jobs table: Procrastinate is Postgres-only, Huey keeps a second job record without leases, Celery / RQ /
  Dramatiq need a broker, Temporal / Hatchet / Prefect are separate servers. DBOS Transact is closest but its workers
  need database access. Revisit it if pipelines need durable multi-step workflows.
- Workers through the API: no database credentials outside the main process and one SQLite writer, for more API
  surface and workers that wait while the main process is down.
- At-least-once, not exactly-once: simpler, correct while every job is idempotent.
- SQLite is single-writer: one main. With a statically stable serving plane that is enough; Postgres buys a main that
  fails over without downtime.
- SQLite and Postgres only: other SQLAlchemy dialects may work but are not tested.

## Stack

| Layer | Choice |
|---|---|
| API | FastAPI + uvicorn |
| Jobs | Own jobs table with leases; workers claim through the API; Ray for multi-node training in v2 |
| Metadata | SQLAlchemy 2 + Alembic; SQLite by default, Postgres optional |
| Staging and transforms | DuckDB, one file per model, disposable |
| Connectors | DuckDB scanners in v1; dlt from the first API source |
| PII | Presidio |
| Embeddings | Local open embedding model, pinned (e.g. Qwen3-Embedding-0.6B, Apache-2.0) |
| Index | LanceDB, embedded on disk: vector + full-text (hybrid) search. DuckDB `vss` persistence is still experimental |
| Training | torch + transformers + peft + trl + datasets + accelerate |
| Serving, production | SGLang or vLLM |
| Serving, Apple silicon | MLX (`mlx-lm`), optional extra |
| Serving, GGUF | llama.cpp (`llama-cpp-python`), optional extra |
| Serving, fallback and tests | `transformers` backend |
| Teacher | A larger local open model (default); the pool's base model when GPUs are small; an API only by opt-in |
| Object store | fsspec over local FS or S3-compatible storage; no MinIO dependency |
| Frontend | Vite SPA: TanStack Router + Query + Table, obp-ui, Tailwind v4 |
| Packaging | uv; Docker image for production |

### Why not

- **Celery**: needs Redis or RabbitMQ; with Redis, a job longer than `visibility_timeout` (1h default) is redelivered
  while still running, so two trainings land on one GPU.
- **SQLite for datasets**: row store, slow scans, cannot read Parquet / S3 / Postgres.
- **DuckDB for metadata**: one read-write process per file; the API and the worker both write metadata.
- **Streaming without staging**: every preview hits the source, dedupe and quality need the full set, runs are not
  reproducible, and SQL would run in each source's own dialect.

## Data

Data is shared across models:

- A **source** is something minibrain reads: an upload (stored once, content-addressed, staged into DuckDB), a
  folder on the server, an S3 path, a database table or query, or a Lakehouse table: Iceberg on S3 or Delta Lake in a
  server folder (all but uploads read in place; S3, database and Iceberg through a connection). Each source is a
  table in dataset SQL under a stable, readable name taken from its name when it is added (`support_tickets`,
  `support_tickets_2`); renaming the source keeps the table name, so saved SQL keeps working.
- A **dataset** stands on its own: one saved DuckDB query over one or more sources that returns `input` and `label`,
  or a `messages` column of chat turns. Columns mode picks one source and a mapping template (an input and a label
  column, templates such as `Subject: {subject}\n\n{body}` for the user turn, or the messages column, picked for chat
  JSONL uploads) and compiles the SELECT; SQL mode joins, unions, filters and cleans across sources. A dataset over
  one source can also say `FROM source`.
  Each custom model points at one dataset, and several models can use the same dataset to compare fairly.
  Dataset names are unique within their folder, like files in a folder, case aside; slugs stay unique across the
  install. A typed name that is taken is refused with a 409 naming the dataset that holds it and a free name
  (`detail`, `name`, `suggestion`, `taken`); a name minibrain suggests that is taken gets the next number
  (`Tickets (2)`). Moving a dataset into a folder where its name is taken is refused; deleting a folder numbers a
  dataset whose name is taken one level up.
- A **dataset version** is a full copy of a dataset's rows, never a reference (see Dataset versions). Each model
  version records the dataset version it trained and scored on.
- A dataset or source still in use cannot be deleted.
- Catalogue: sources and datasets carry a name, an optional description and tags. Search covers names, table names,
  column names, descriptions and tags. Column stats (type, empty share, approximate distinct count, range for non-text
  types) come from a bounded sample (`SUMMARIZE` over the first 10,000 rows); the preview runs the query live, shows
  its first 20 rows and counts rows per label across the whole result; a dataset shows its train / held-out / test /
  few-shot split while its latest version still matches its data and query.
- User SQL is parsed first (`json_serialize_sql`): exactly one SELECT, whose table names pick the sources to expose.
  It then runs in an in-memory DuckDB with external access off and the configuration locked: uploads are attached
  read-only, a folder is a view over its listed files and `allowed_paths` names exactly those files, and a query
  stops after 30 seconds. Sources are named by table name alone: a catalog- or schema-qualified name and the scanner
  table functions (`postgres_query`, `mysql_*`, `iceberg_*`, `delta_*`, `query`, `query_table`) are refused, so
  dataset SQL cannot reach past its sources into the rest of an attached database.
- The dataset editor's preview (first rows, then the full count and quick checks) runs as you type only when the
  sources it reads hold under 1,000,000 rows by their known counts; larger or uncounted sources run when Run (⌘↵ /
  Ctrl+↵) is pressed, one action for both. All previews together take at most a quarter of the machine's memory: it
  is split evenly over every run that can be going at once (`PREVIEW_SLOTS` × a page's rows, shape and count = 6),
  each run at least 256 MiB (`SET memory_limit`, `minibrain/data/runs.py`). Half the cores are split over the two
  slots (`SET threads`, at least one), so a lone preview is not slowed to one thread; with both slots busy, CPU is
  shared but never memory. A 64 GB, 16-core server gives each run 2.7 GiB and four threads. A run that outgrows
  its share spills to a folder of its own under `<home>/tmp/previews` (saves and other sandboxed queries spill to
  their own folders under `<home>/tmp/queries`, without a size cap) (all runs together at most the machine's
  memory on disk, removed when the run ends, never readable by another run's SQL); past that it answers 422 "This
  preview needs more memory than previews are allowed; press Run on a smaller query, or save the dataset to check
  the full data". Saves and training-data builds keep DuckDB's own limits. Each run keeps the 30-second stop. A new
  preview stops only the previous one from the same page (its rows, shape and count still run side by side), so two
  tabs never cancel each other. At most two previews run on the server at once (`PREVIEW_SLOTS`, a page's runs
  counting as one); another waits up to 5 seconds for a turn, then answers 503 "Previews are busy. Press Run to try
  again."
- The editor (`/data/datasets/new`, `/data/datasets/<slug>/edit`) is a page of its own beside the app's menu, without
  the Data tree and header: a title bar (back, the name as an editable title, Details for description and tags, Pick
  columns / Write SQL, Run, Cancel, Save) over the query and the preview side by side at full height, split by a
  divider whose position the browser keeps; the SQL editor fills its pane.

### Sources

- Uploads: CSV, TSV, JSON, JSON Lines or Parquet, staged into a DuckDB file keyed by content hash.
- Source names are unique across the install, case aside. A name minibrain takes from a file, folder, path or table
  gets the next number when it is taken (`tickets (2).csv`, table `tickets_2`); a typed name (Add, Rename,
  Edit) that is taken is refused with the same 409 as datasets.
- One content is one upload source: uploading a file whose SHA-256 is already a source's, under any name, stores
  nothing and returns that source (`200`, `outcome: existing`), and the UI says "This file is already uploaded as
  <name>" with Open. A second source over the same content is not offered: it would be a second table name for the
  same rows, and datasets already share sources and SQL can read one table twice. Samples follow the same rule.
- A new file whose name an upload with other content holds: `POST /api/sources?name_taken=keep_both` (the default)
  adds it as `tickets (2).csv` with its own table; `replace` points the existing source at the new file, keeping its
  id, name and table, so datasets reading it say "Sources changed since vN" and Update saves the next version (a
  source that is not an upload cannot be replaced); `fail` stores nothing and answers 409 with the taken name and a
  free one. The upload button sends `fail` and, only then, asks Replace or Keep both (Keep both selected), so the same
  content never prompts; Training's upload keeps both.
- A folder, S3 path, database table or query, or Lakehouse table added again at the same location (connection,
  path or table or query, and format when one is given) returns the existing source the same way (`200`,
  `outcome: existing`) without reading it again. An S3 or Iceberg path is the same location with or without trailing
  slashes.
- An upload's stored file and staged table are deleted when it is replaced or deleted and no other source, dataset
  version or model version uses that content.
- Folders: a directory on the server, read in place as one table: every file of one format (CSV, TSV, JSON, JSON
  Lines or Parquet) under it, hidden files and symlinks skipped, joined by column name (`union_by_name`), at most
  10,000 files. Only folders inside the Folder sources policy (Settings → Security, lockable from config or
  `MINIBRAIN_POLICY_DATA_FOLDERS`) can be added, and a folder taken off that list stops being readable. Each folder
  shows its file count, size and last change.
- S3: a connection plus `s3://bucket/prefix/*.parquet` (or `.csv`, `.json`, a single object, or a prefix whose most
  common format wins), read in place by DuckDB's httpfs as one table, at most 10,000 objects; names starting with `.`
  or `_` (`_SUCCESS`) are skipped. The listing (s3fs) gives the exact objects DuckDB reads, `allowed_paths` names
  exactly those, and a DuckDB secret scoped to the bucket carries the keys. Fingerprint: SHA-256 of key, size and
  ETag per object.
- Database: a PostgreSQL or MySQL connection plus a table (`name` or `schema.name`) or one read-only query (SELECT or
  WITH, no second statement; it runs wrapped as a subquery). DuckDB's postgres or mysql scanner attaches the database
  `READ_ONLY` through a DuckDB secret; PostgreSQL sessions also get `default_transaction_read_only=on` and a 30-second
  `statement_timeout`. Fingerprint: with an updated-at column, the row count plus its maximum; without one, the query
  plus the time read, so every read counts as new data. Use a read-only database user: minibrain never writes, but
  the user's grants are the real control.
- Lakehouse tables, one group in the Data tree whose items each show their table format (the source kind stays
  `iceberg` or `delta`, so no migration); Add → Lakehouse table picks the format, then the connection or folder:
  - Iceberg: an S3 connection plus the table's folder. minibrain lists `metadata/`, takes the highest-numbered
    `*.metadata.json` and its `current-snapshot-id`, and DuckDB's iceberg extension reads that snapshot
    (`iceberg_scan(…, version, snapshot_from_id)`) with `allowed_directories` limited to the table folder.
    Fingerprint: the snapshot id. REST catalogues come later; DuckDB can attach them, but tables on S3 need nothing
    beyond the S3 connection.
  - Delta Lake: a table folder on the server, inside the Folder sources policy (local disk, NFS, SMB or a mounted
    bucket). minibrain lists `_delta_log/`, takes the newest commit (or checkpoint) version, and DuckDB's delta
    extension reads that version (`delta_scan(…, version)`) with `allowed_directories` limited to the table folder.
    Fingerprint: `v<version>-` plus a SHA-256 of the folder, the version and the newest log file's name, size and
    modification time, so a dataset version names the table version it copied. Not from S3 or HTTPS: the extension's
    delta-kernel-rs reads the log over its own rustls and ring TLS, outside OpenSSL, so it is not FIPS-ready
    (`docs/security/network.md`, TLS in DuckDB extensions); those paths are refused with that reason. A folder holding
    `_delta_log` cannot be added as a plain folder source.
- Remote fingerprints are cached for 30 seconds per source so listing pages does not hit a bucket or database on
  every request. Everything goes through the row limit and the 30-second timeout, and dataset versions copy the
  rows to Parquet like any other source.
- Materialize into the model's DuckDB file only when previews get slow or the source must not be hit repeatedly.
- dlt arrives with the first API source (Zendesk, Jira, Confluence), loading into the same DuckDB file. Its incremental
  state is what v2 "retrain on new data" runs on.
- The DuckDB file is a cache, rebuildable from the source. The only durable data artifact is the dataset version.
- Gateway request logs are a source like any other; the Distill task reads them directly.
- Sources are defined once per model and feed both training (a saved dataset version) and the index (continuous sync):
  one connector, one PII policy, one set of access rules, one lineage.
- Training uses only rows every user of the model may see. Rows with narrower access go to the index only, where
  retrieval filters them per user.

### Example format

OpenAI chat messages, one per line: `{"messages": [{"role": "...", "content": "..."}]}`, optional `tools`.

### Transforms

One execution path, three ways in:

1. **Mapping UI**: fields → message slots, compiled to SQL.
2. **SQL editor**: the mapping, ejected and edited by hand.
3. **Built-in Python steps**, picked not written: `strip_html`, `chunk`, `pii_scrub`, `dedupe_near`, `generate_qa`
   (teacher model on the pool).

```sql
COPY (
  SELECT [
    {'role': 'system',    'content': 'Classify the ticket.'},
    {'role': 'user',      'content': subject || chr(10) || body},
    {'role': 'assistant', 'content': category}
  ] AS messages
  FROM tickets WHERE category IS NOT NULL
) TO 'train.jsonl' (FORMAT json);
```

- With a task type, SQL returns the task's columns (`input`, `label` or fields); the task type builds the messages.
- The SQL editor completes table and column names and the DuckDB functions and keywords people shape text with
  (string, regexp, list, struct, date, aggregate and window functions, `QUALIFY`, `USING SAMPLE`, `EXCLUDE`,
  `REPLACE`…), each with its signature and one line, from a static list that ships with the UI. Its Examples menu
  rewrites the query with a recipe over the current one (or a starter over the first table): drop empty rows, remove
  duplicates, one label an input, relabel with `CASE`, trim and lowercase, combine sources (`UNION ALL BY NAME`), N
  rows a label, a random sample; the same SQL steps as the editor's fixes, one undoable edit. The tables box inserts
  a table or column name on click, quoting a name that needs it.
- User SQL runs on a locked-down connection: only attached sources, no other file or network access, timeout.
- Arbitrary Python is v2: admin-only, sandboxed subprocess, no network.
- Auto-mapping: the pool's base model proposes a mapping from sampled rows; the user edits it.
- Preview: 5–10 examples rendered as chat transcripts, instantly via `LIMIT` pushdown.

### Labelling

The label is the assistant message: the correct output for an input.

| Data | Labels come from |
|---|---|
| Already paired (ticket → category, question → resolution) | The data; mapping only |
| Inputs only (tickets without a category, contracts) | Teacher labels every row; the user reviews a sample |
| Documents (wiki, PDFs) | Teacher writes Q&A per chunk and checks each pair against it (`generate_qa`); or raw text as a Rewrite style source |
| Gateway logs | The teacher's logged answers (Distill) |

Teacher labelling (in v1 the teacher is a reference model, opt-in; the local teacher pool is v2):

1. The teacher labels every row with the task's prompt and output schema.
2. Review queue: the user accepts or corrects rows, uncertain ones first (the teacher disagrees with itself across a few
   samples), until ~50–200 are verified.
3. Corrections go into the teacher prompt as examples; low-agreement rows are relabelled.
4. Verified rows feed the golden set and the eval split; the rest train.

Generated Q&A (`generate_qa`):

1. The teacher writes several question/answer pairs per chunk, including rephrasings and questions the chunk cannot
   answer, so the model learns to say it does not know.
2. Check pass: the teacher rereads each pair against its chunk and drops answers the chunk does not support.
3. The drop rate per source is shown; the user reviews a sample before training.

### Quality score

Empty fields, exact and near duplicates (MinHash), token length vs `max_seq_len`, label imbalance, train/eval leakage,
PII counts.

Version checks, run on every dataset version (and every feedback copy) and stored with it; the report shows on the
dataset and on the Training page before a run starts:

- Hard stops, always on: no row with both an input and an answer, or, when the answers are a label set (at most 256
  short single-line values, each repeated on average), a single label. These refuse the version, so a dataset is not
  created and a query is not saved while they hold. Label balance is checked for label sets only; a Classify model
  refuses a dataset version without at least two labels.
- Warnings, each with an on/off switch under Settings → Data, never block: repeated inputs; the same input with
  different labels; label balance (one label above a share, 90% by default, or labels under a row count, 10 by
  default, both editable); train/test leakage (a test or held-out input also in training once case, spacing and
  punctuation are ignored); empty inputs and inputs past the training example's length (estimated at four characters
  a token); personal data found by local patterns: email addresses, phone numbers, card numbers (Luhn-checked) and
  IBANs (mod-97-checked), each card or IBAN candidate tried at shorter lengths before it is rejected, so trailing
  words or digits do not hide it. The report says plainly that the patterns can miss names and addresses. Mask and
  drop, and Show rows, call the same detector through two functions registered on the sandboxed DuckDB connection
  (`has_personal_data`, `personal_data_masked`), so a fix acts on exactly the rows the check flags.
- "Dismiss for this dataset" stores the check and a signature of its result on the dataset; the warning shows again
  when a later version's result for that check differs.
- The dataset editor runs the quick checks (all but train/test overlap, which needs the split) on every row up to
  50,000 and on a random 50,000 of a larger result, fewer when inputs are long so the rows read hold about 5
  million characters; personal data only while they hold under 10 million. Label balance and the single-label stop
  count every row of the result, not the sample. Checks and fixes strip the same whitespace (every Unicode space,
  tab and line break); an empty label is not a second label of an input. Each finding says how many rows it touches and lists them as a small table (input and labels,
  label and rows, input and tokens, input and what was found); repeated and empty inputs show as info, since training
  already drops them. The preview's Quality tab gives the verdict (ready to train, N to look at, or why it cannot
  train), the thresholds with a link to Settings › Data, Show rows (the current query wrapped in SQL that keeps the
  affected rows) and Fix: keep the most common label of an input or drop it, keep at most N rows a label, drop labels
  under the rare threshold, drop inputs over the long threshold, mask or drop personal data. In Pick columns mode a fix
  ticks a Clean up option saved with the mapping (`cleanup`, compiled into the dataset's SQL as CTE steps, in that
  order); in Write SQL mode it wraps the query in `WITH base AS (...)` as one undoable edit.

### PII

1. Presidio scans during the quality step.
2. UI shows counts per entity type and highlighted samples.
3. User picks an action per type: keep, mask, replace with a consistent fake, drop the row.
4. User spot-checks the preview.

- Custom regex recognizers per model for internal IDs (customer numbers, employee IDs).
- Consistent fakes, not `<PERSON>` tags, or the model learns to emit the tags.
- Detection is risk reduction, not a guarantee; the UI says so. minibrain access control stays the real control.

### Dataset versions

A dataset saves its rows when it is created, and each refresh is a new version, so what the preview shows and what
trains are the same rows (the `dataset_versions` table, `/api/datasets/<slug>/versions`).

- Saved when a dataset is created with its columns or SQL (version 1), when its query or columns are saved, and with
  Update on the dataset (or on Training, when its sources changed). A dataset created with no columns picked has no
  version until its first successful mapping. Saving runs the dataset's query once in the main process, turns each
  row into a chat example in DuckDB (`messages`: the turns before the answer, system turns dropped; `input`: the user
  turn, or every turn as `role: text` lines; `expected`: the last assistant turn), sorts them (`ORDER BY ALL`) and
  writes them to Parquet; the file's SHA-256 is the version's hash and its artifact id, so identical rows are stored
  once. Training, evaluation and serving read only these examples, never columns: a multi-turn example trains on every
  assistant turn and is scored on the last one. Rows identical to the latest version make no new version (Update then only records
  the sources' new fingerprints); rows identical to an older one make the next version, sharing its file.
- Versions are numbered per dataset (`dataset_versions.number`, unique per dataset) and listed newest first: number, saved,
  rows, labels, checks, the model versions that use it, size and hash. A copy with merged feedback has no number of
  its own.
- Saving a query and saving its version are one step: a query that cannot be saved as a version (over the row limit,
  no rows, a hard-stop check) is refused with the reason and nothing changes. Creating a dataset is refused the same
  way.
- Row limit: 200,000 rows by default (Settings → Data). A larger result is refused with a message to filter or sample
  in the query (`USING SAMPLE reservoir(… ROWS) REPEATABLE (7)`) or raise the limit; the bound is what keeps saving a
  version quick enough to run in the request.
- Splits are derived from the version alone and deterministically (empty and repeated inputs dropped, seeded
  shuffle), so training, evaluation and the gateway's prompt-only context read only the version. Fewer than 10
  usable rows block training and scoring, not saving; under 100 a warning says scores will be rough (decided
  2026-11-17: like hosted fine-tuning, small data is allowed).
- Data changed: every source has a cheap fingerprint (an upload's content hash; for a folder, a hash of its file
  list with sizes and modification times; for a Delta table, its version and newest log file). A version records
  its sources' fingerprints and the query; the dataset, the model page and the Training page say "Sources changed
  since v3" or "Query changed since v3" and offer Update. Nothing updates on its own.
- Training and scoring pick a dataset version of the model's dataset (`dataset_version_id` on `POST
  /api/models/<slug>/versions`), the latest by default; a run never reads the live query. A model's data is its
  dataset's latest version.
- Feedback: a model's accepted feedback rows merge into the picked version when a model version starts, as a
  feedback copy (`base_id` names the dataset version, no number of its own); feedback that changes nothing reuses the
  version itself (see Feedback loop). Test examples saved from the Playground merge the same way, marked `split =
  'eval'` in the copy's Parquet, and the split puts those rows in the held-out split whatever the shuffle says, so the
  version is scored on them and never trains on them.
- Diff: any two versions compare by input (trimmed): rows added, removed and relabelled, row counts, and the share of
  rows per label, with samples of each. The model page links each model version to the diff against the one before
  it, next to the change in held-out accuracy; a model version's scores say whether its data matches the live one's.
- Retention: dataset versions a model version uses are kept (with the version a used feedback copy starts from), and
  so is each dataset's latest; feedback copies of deleted model versions are removed with their files; of the
  versions no model uses, the last N per dataset stay (Settings → Data, 5 by default). Infrastructure → Storage shows
  how much they use.
- Later, not built: zero-copy versions for Iceberg and Delta tables that pin the table's snapshot id instead of
  copying rows (the version then records the table version, not a file), and an opt-in "update when sources change".
- `HF_DATASETS_CACHE` points at the job directory and is deleted when the job ends.

### Artifact storage

- One location per install, set in Settings → Storage: a local folder under `MINIBRAIN_HOME` (default) or an
  S3-compatible bucket (AWS, MinIO, Ceph) by endpoint, bucket, prefix, region and keys. It is an `ArtifactStore`
  backend over s3fs, so uploads, dataset versions, adapters, logs and base model weights all follow it. Workers and
  engines pull artifacts through main, and base weights in a bucket straight from the bucket (Base models on disk).
- minibrain connects only to the endpoint set there, with explicit keys (no instance-metadata lookups), and signs every
  request with SigV4 (HMAC-SHA256; never SigV2, which is HMAC-SHA1). The secret key is kept in a 0600 file under
  `secrets/` (or `MINIBRAIN_STORAGE_S3_SECRET`) and never returned. "Test connection" writes, reads back and removes a
  probe object; saving S3 runs the same check. Artifacts already stored stay readable after switching either way.
- Both locations hold only ciphertext: main encrypts each artifact with its own data key before it reaches the folder
  or the bucket (client-side), so the bucket's own SSE-KMS is an optional second layer.
- One contract for both, so the folder behaves like a bucket and switching is configuration: an object is addressed by
  the SHA-256 of its plaintext, written once and never changed, and read by id. A bucket write is create-only
  (`If-None-Match: *`); the folder stages in `artifacts/.incoming` and renames into place only when the id is new.
  Nothing depends on a listing, an append or a lock: the `artifacts` table says what exists, and deletes, retention and
  key passes start from it (a key pass also lists the store, only to find strays; a registered object it cannot find
  blocks retiring the key). The one change in place is re-wrapping a key header, which never touches the content or
  its id: the folder rewrites a header slot; the bucket gets a multipart upload whose first part is the new header and
  the first 5 MiB and whose other parts it copies from the old object itself (`UploadPartCopy`, pinned to the old
  ETag), so only 5 MiB travel however large the object (one under 5 MiB is sent again whole). Uploads from workers
  stream into the store, never into memory.
- What under `MINIBRAIN_HOME` is data and what is a cache. Data: `minibrain.db`, `keys/`, `secrets/`, `artifacts/` (the
  folder store) and `models/` (base weights when Storage is the folder). Caches and scratch, safe to wipe while
  minibrain is stopped: `cache/` (unpacked artifacts), `staging/` (DuckDB databases built from uploads, rebuilt from
  the upload), `work/` (job scratch), `gateway/`, `engines/` and `worker/` (copies on serving and batch machines).
- Infrastructure → Storage answers two questions and nothing else (no forecasts). What is using the space: one list
  grouped by minibrain's own things (base models with the models built on them, adapters per model, dataset versions
  per dataset, uploads, job logs and checkpoints per job, the database), biggest first, with group totals, under the
  disk gauges. What could go: suggestions only, each with its size and why it is safe (no model uses this base, no
  model version trained on these dataset versions, no dataset uses this upload, jobs finished over 7 days ago). Each
  links to the item, deleted one at a time by its own delete action, which refuses anything in use. Never a bulk or
  automatic delete of models, adapters or datasets; job logs are the one thing deleted from the page (admin, audited).
- Job log retention: Settings → Storage → Job logs, 30 days by default, 0 keeps them. The leader's hourly purge removes
  the log files, library output lines and `work/job-N` checkpoints of jobs finished longer ago; queued and running
  jobs keep theirs, and job results and metrics stay. Each purge is audited (`job_logs.purge`).
- Each worker and engine machine reports its cache (model copies, downloaded artifacts, `engines/`) with its disk.
  Later, not built: "Clear cache" for an idle machine (admin, audited; the machine deletes what it does not need on
  its next heartbeat), and retention of `work/` checkpoints on remote workers.

### Connections

Storage is where minibrain keeps its own files; a connection is someone else's bucket or database that minibrain reads
from. They have different endpoints and keys, so they are configured apart.

- Settings → Connections: named connections of three kinds. S3-compatible: endpoint, region, bucket (optional; when
  set, paths must be in it), access key, secret key, path-style addressing. PostgreSQL and MySQL: host, port,
  database, user, password, SSL mode. "Test connection" lists the bucket (or the buckets) or the database's tables;
  it works on unsaved changes too.
- Each connection's endpoint must pass the network policy when it is saved, tested and every time it is used; a
  blocked one says which host to add under Allowed hosts.
- Secrets are write-only: encrypted at rest with AES-256-GCM (`cryptography`, through OpenSSL) under their own data
  key, wrapped by the install's master key (see `docs/security/encryption.md`: `<home>/keys/master.key`,
  the file `MINIBRAIN_MASTER_KEY_FILE` names, Vault Transit, a PKCS#11 HSM or AWS KMS), with the connection's id as
  associated data. The API only says whether a secret is set; Replace
  writes a new one. Create, update and delete are audited (`connection.create`, `connection.update` with the changed
  field names and whether the secret was replaced, `connection.delete`), never with secret values.
- Locked-down installs declare connections in `minibrain.yaml` under `connections:` (a list with `name`, `kind` and
  the fields above), with the secret only as a reference: `secret_env: NAME` or `secret_file: /run/secrets/name`. They
  show as locked ("Set in minibrain.yaml"); a plaintext `password` or `secret_key` there is refused, and a variable or
  file that is missing shows "secret not found". A connection removed from the file goes away, unless a source still
  uses it.
- A connection used by a source cannot be deleted. Sources keep their connection's id, so renaming one is safe.
- Model import uses connections for `s3://` paths: the Import tab picks the first S3 connection whose bucket matches,
  or asks. The job's parameters hold only the connection id; the worker receives the credentials with the claim and
  hands them to the import or repair child in its environment, never on disk. Without a connection, the server's
  environment credentials (`AWS_*`) stay the fallback.

## Training

- The worker claims a job and spawns `accelerate launch train.py <job.json>`. Never inside uvicorn.
- GPUs are divided per machine, not locked per pool: a GPU job gets an idle GPU, or what is left of one beside
  live engines when its plan fits there (Training memory, Serving › GPUs on one machine). Dedicated training GPUs
  are a pool used for training only.
- On a single GPU the worker runs the steps in order: load the teacher pool → label / generate → unload → train → eval
  → load the adapter into the serving pool.
- Progress: a TRL `TrainerCallback` emits a `train.step` event every step (loss, learning rate, grad norm, epoch,
  tokens per second, peak memory, time left) and a `train.eval` event with the held-out loss on up to 64 held-out rows
  at every tenth of the run; scoring, judging and transfers emit their own progress events.
- Cancel kills the process group. On start, the worker marks orphaned `running` jobs `failed`.
- One install-wide default recipe (rank, alpha, learning rate, epochs), assistant-only loss, a small general instruction mix to
  limit forgetting. How it fits in memory is planned per run (Training memory).
- The Train page (`/models/<slug>/train`) starts from the model's last run: rank, epochs and learning rate prefill
  from it, selecting the preset they match, else Custom; a model's first run starts from Balanced. `?from=<n>` starts
  from version n instead, its dataset version included (Versions › Train again), and `?data=<id>` picks the dataset
  version. There is no per-model default recipe (2026-11-13).
- The teacher can be a base model too: LoRA on the large model when prompting gets close but stays inconsistent
  (QLoRA keeps it on one GPU).
- Training from code (2026-11-13): retraining on a schedule or on new data, CI gates ("train, score, block the merge
  if the score drops"), parameter sweeps, one model per customer or region, and pipelines (Airflow, Dagster) all start
  runs without the UI. Three ways in:
  - **API**: `POST /api/models/{name}/versions` documented and stable, callable with a builder API key, not only the
    browser session; the same body as the Train page (method, dataset version, preset or parameters, pool,
    instructions), returning the version and its job. `GET` the job to wait.
  - **CLI**: `minibrain train <model> [--preset balanced] [--data v12] [--pool gpu-pool] [--from v3] [--wait]`, and
    `minibrain deploy <model> v<n>`; exit code non-zero when the run fails or scores below the promotion rule, for CI.
  - **Rules instead of scripts**: per model, in Settings: "Train when a new dataset version is saved" and "Deploy when
    the new version passes the promotion rule", each run a job with the rule as its reason in Activity.

### Training memory

Built (2026-11-05). Each run picks how the base fits the memory of the machine that trains it.

- Strategies: LoRA on the base in bf16 (CUDA, ROCm, Intel XPU) or fp32 (Apple MPS, CPU), and QLoRA: the base in
  4-bit NF4 with double quantisation through bitsandbytes, bf16 compute, adapters on every linear layer. Each with or
  without gradient checkpointing (non-reentrant). Micro-batches of 8, 4, 2 or 1 rows with gradient accumulation to an
  effective batch of 16; MPS takes one row at a time. 8-bit optimiser states from bitsandbytes where a worker has it:
  paged AdamW on CUDA, plain 8-bit AdamW on ROCm and XPU; fp32 AdamW otherwise.
- QLoRA runs where the pinned bitsandbytes (0.50.2, the `qlora` extra, installed in the Docker image) ships kernels:
  its Linux x86_64 wheel carries CUDA 11.8–13.2, ROCm 6.4–7.2 and Intel XPU builds, the aarch64 and Windows wheels
  CUDA. Never on Apple silicon or the CPU: there the plan says "QLoRA needs an NVIDIA GPU" whenever QLoRA would have
  fitted. MLX training stays parked (v2).
- Sequence length: the longest training example, rounded up to 16 tokens and capped by the base's context from the
  catalogue. The plan estimates it from characters (four a token plus 48 for the prompt); the worker tokenises the
  rows the way TRL does and fits it exactly.
- Peak memory per option: base weights (parameters from the catalogue's `shape`: hidden size, layers, vocabulary,
  heads, MLP width, tied embeddings; NF4 with bf16 embeddings for QLoRA), adapter with gradients and optimiser states,
  activations per token and layer (every layer, or each layer's input plus one layer with checkpointing), logits
  (vocabulary × tokens × 12 bytes for the fp32 loss), a fixed runtime overhead and 10% fragmentation. Imported bases
  take their shape from `config.json`; a base with neither gets one guessed from its size.
- Choice: the fastest option whose peak stays under 85% of the machine's memory (the largest single GPU, GPU-usable
  unified memory on Apple silicon, RAM on the CPU). Speed is relative: QLoRA ×0.7, checkpointing ×0.75, smaller
  micro-batches slower. The machine is the online worker with the fastest plan, from the hardware and libraries
  workers report (`bitsandbytes` among them); with none reported the plan is unknown and the worker that takes the job
  plans on its own.
- Nothing fits: `POST /api/models/{slug}/versions` refuses up front (409) with the smallest plan, its memory and
  the machine's ("Qwen3 14B does not fit for training on L4: the smallest plan, LoRA bf16 with checkpointing at 1 row
  of 160 tokens, needs about 30 GB, …").
- Overrides on the Training page and in that call: strategy, gradient checkpointing, micro-batch, sequence length,
  LoRA rank (up to 64, the SGLang pools' limit; alpha is twice the rank), learning rate, epochs and rows, each field
  showing its default. `GET /api/models/{slug}/training-plan` takes the same settings and returns the plan, every
  option's memory with its parts, and the defaults.
- The version's recipe stores the plan (strategy, checkpointing, micro-batch, accumulation, sequence length, rank,
  alpha, learning rate, dropout, optimiser, precision, device, the overrides, and the planned peak against the
  machine's memory), so a run is reproducible. The worker keeps it when it fits its machine, plans again what was not
  overridden when it does not, and fails with the refusal when overrides no longer fit. The summary records what ran,
  the measured peak memory and how many examples were longer than the sequence length.
- Evaluation scores the adapter on the full-precision base, the way serving runs it, whatever trained it.
- Discover, Add model and the base picker show Memory to run and Memory to train (QLoRA): QLoRA 4-bit with
  checkpointing on an NVIDIA GPU, one 512-token row at a time, with "Trains here" when a worker in the pool can train
  it. Runs here stays about serving.
- On an NVIDIA machine the job runs on the one GPU main gave it at claim (Serving › GPUs on one machine): it sees
  only that GPU (`CUDA_VISIBLE_DEVICES`) and plans within the memory it was given (`MINIBRAIN_GPU_BYTES`, the
  whole GPU when it was idle, else what was left on it), held there by PyTorch's per-process memory fraction, so an
  overrun fails the job and never the engine beside it. The claim needs the smallest workable plan over 85% (any
  strategy, checkpointing on, one row at a time, at the recipe's sequence length; else the planned peak, at most the
  largest GPU's usable memory), since the job plans again inside whatever it gets; scoring, judging
  and exports need the base's serving memory (`weights × 1.2 + 0.5 GB`). A run uses that one GPU; the Trainer no
  longer spreads it over every visible GPU (multi-GPU training is v2).
- Measured on an M1 Pro (`docs/findings.md`); QLoRA and the CUDA estimates have not run on an NVIDIA GPU yet.

### Base model registry

- Short allowlist with the license recorded (Qwen, Mistral: Apache-2.0; Llama, Gemma: custom terms).
- Model and tokenizer pinned to an HF commit hash; every adapter records it.
- One base model per pool. Adapter rank ≤ pool `max_lora_rank`; target modules match the pool.
- Chat template parity test per base model: the prompt rendered at training time equals the one rendered at serving
  time.

### Base model health

Every install (download, import) saves a SHA-256 list of its files: the hub's LFS hashes where published, a local hash
otherwise. It is stored on the model and as `minibrain-model.json` in its folder. The base's content hash is the
SHA-256 of that list. Health handling never deletes anything: a repair writes to `.part` files and replaces a file only
once it matches; only deleting a base removes its files.

| Failure | Detected by | State | Primary action |
|---|---|---|---|
| Corrupt files | "Verify files": a job that re-hashes every file, with progress, log and cancel | Corrupt (n files) | Repair: re-download only the bad files; Re-import when the hub is unreachable or the model has no hub source |
| Missing files | Size check at start-up, on every list, before load, deploy and train | Missing files | Repair, Point to new location (checked against the saved list, then verified), Remove |
| Interrupted download | Failed or cancelled transfer job; `.part` files resume with HTTP ranges | Download failed | Resume (keeps complete files) |
| Disk full | Free space checked in the job before writing; `ENOSPC` while writing | Not enough space | Free up space (Infrastructure → Storage), then Try again |
| Access revoked, token expired | 401 or 403 from the hub | Needs access | Get access (the gated-model steps), then Retry |
| Upstream revision gone | 404 on the pinned revision | Can't repair from source | Re-import; the local copy stays usable if it verifies |
| Runtime missing or not supported | Engine load error reported to main; GGUF with no llama.cpp in any pool | Can't run here | The reason with what to install, or another variant |
| Not enough memory | Out of memory while loading | Failed to start | A smaller or quantized catalogue variant |
| Adapter vs base mismatch | Each LoRA version records the base's content hash when training starts | Base changed | Refused at the gateway, the engine and deploy; train again |

- Repair and Re-import are one job kind (`repair`) that reads from the hub at the pinned revision, a folder or an S3
  path, and accepts only files matching the saved list; a copy with different files is refused ("import it as a new
  model"), so adapters keep their base.
- Failure codes travel with the job (`needs_access`, `source_gone`, `no_space`, `offline`); engines report load
  failures (`cant_run`, `no_memory`) to main, which records them on the model until "Try again".
- A base with any of these problems is not started by the gateway; requests get a 503 with the reason. Custom models
  and deployments on it show "Base …" with a link to the base.
- Audit events: `model.verify`, `model.repair`, `model.reimport`, `model.relocate`. Deleting a relocated model keeps
  its external folder.
- UI: the state is the Models list status cell, the primary action is the row button, the rest are in the row menu.
  The model page's View files panel lists each file with size and hash state, the last verified time and "Verify files".

### Base models on disk

- A base stays until someone deletes it, and deleting it removes its files. A base with models built on it is deleted
  together with them, once the cascade checkbox in the delete dialog is ticked.
- Where a base's main copy lives follows Settings → Storage when it is downloaded, imported or repaired
  (`base_models.store`). Folder: main's `<home>/models/<id>`. S3: each file is an object in
  the bucket under its SHA-256, sealed with its own data key like every artifact and registered as a `weights`
  artifact; identical files are stored once.
- Files reach the bucket one at a time. The job checks a file's size and SHA-256 in `<home>/work/models/<id>`, the
  worker streams it to main, main seals and uploads it (create-only) and the staged file goes, so main's disk needs
  about twice the largest file free: the download check and the Add model gauge use that. A resumed job skips files
  already in the bucket.
- Every machine that runs a base keeps a working copy, because engines need local files: main (its local engines and
  its worker share `<home>/models/<id>`), remote engines (`<home>/engines/<key>/weights`) and remote workers
  (`<home>/worker/models/<key>`). It is made when an engine starts or a training or eval job needs it. Each file is
  checked against the saved list as it arrives (size and SHA-256) and lands under a temporary name; the folder's
  `minibrain-model.json` records the content hash it holds. A copy whose content hash no longer matches is replaced; a
  missing or short file is fetched again. Remote machines get each file's size and SHA-256 from the saved list, never
  from a folder listing.
- Machines fetch from the bucket, not through main, and never hold bucket keys. main answers
  `/internal/gateway/bases/<key>` (gateway token) and `/internal/worker/bases/<key>` (worker token) with a presigned
  GET link per file, SigV4 and valid 15 minutes, for the configured endpoint only, plus the file's data key, which main
  unwraps with the master key; the answer is `Cache-Control: no-store`. The machine decrypts with AES-256-GCM through
  `cryptography`, checks the plaintext SHA-256 and keeps the data key in memory only. A data key opens that one object;
  the node channel carried the plaintext itself before.
- Working copies have no budget and nothing is removed to free space; the bucket is the copy that counts. The Models list and health read the database (an `artifacts` row per file), never a working copy,
  so a model does not go missing with one. Verify files reads every object through signed links; Repair writes a
  damaged object again.
- Deleting a base deletes its bucket objects (unless another model has the same file), main's working copy and its
  rows. Remote engines and workers remove copies of models main no longer has when they start and every 10 minutes.
- Switching Storage to S3 leaves bases on main's disk usable, served from main as before; a base moves to the bucket
  only when it is downloaded, imported or repaired again. A base in the bucket stays there if Storage goes back to the
  folder, while the bucket settings remain.
- Free space: S3 reports none. The Add model gauge names its store ("S3 · <bucket>" or "Main server disk"); for S3 it
  shows the model's size and main's free disk instead of a fill level.

### Deleting and undeploying

- Deleting a custom or base model and undeploying one are teardowns: a row in `teardowns` (one per model) that a loop on
  the leader main advances, so they survive a restart and run however small or large the model is. Not jobs: workers
  never touch the database or the artifact store, and only main can remove rows and files. The API stores the teardown
  and answers 202 with the new state at once.
- States on the Models table and the model pages: Deleting (row greyed, actions off, gone when done),
  Delete failed, Stopping and Stop failed, each failure with its reason and a Retry that repeats the same call. Toasts
  come from a watcher in the shell, so they show on whichever page the person is on.
- Stopping waits until every live gateway (main's own and standalone ones, which report what they route) has stopped
  routing the model's names and every engine of its base has drained its requests in flight through those names and
  unloaded its adapters. A base no route needs any more is released: main stops its local engines once they are idle.
  Ten minutes without that is Stop failed, naming what did not confirm.
- While a custom model stops (Stopping or Stop failed), its versions do not answer either: `/v1` gives 404
  `model_not_found` "support-triage is being undeployed, so its versions do not answer until it has stopped" to keys
  that cover it, and the Playground 409 with the same words, so no open client reloads an adapter and stalls the stop.
  The stop drains every version route and unloads every adapter of the model; once it has stopped, `name@N` answers
  again like any undeployed model's versions (2026-11-16).
- Deleting a deployed model needs `undeploy=true`; it stops first, then removes versions, adapters, dataset versions only it
  uses, feedback and API key scopes. A base with models built on it answers 409 with their names unless
  the call says `cascade=true`; the cascade deletes them first, then the base.
- Active jobs (queued or running) of what is being deleted block the delete: 409 naming each one ("guy1 v13: Train,
  running") with the list in a `jobs` field. `cancel_jobs=true` on the version, model and base deletes (cascades
  included) cancels them first through the job cancel path, each audited as `job.cancel` with `reason: delete`. A job
  already asked to cancel no longer blocks. Cancelling a running job is asynchronous, so nothing is removed while one
  could still write artifacts or events: a model or base teardown waits for them (shown as "Cancelling N jobs", then
  "Deleting"), and the ten-minute limit fails it naming the jobs, which the delete dialog reopens on ("Delete again…").
  A version delete with running jobs answers 202 with the version as `deleting` (not routed, not retryable, its
  failure effects skipped); the leader removes it once its jobs end and audits `version.delete_finished`. It needs no
  timeout: a cancelled job always ends, by the worker killing its process or by its lease expiring. With only queued
  jobs (cancelled at once) or none, it goes at once (204).
- A worker reporting for a job whose model or version is gone, or whose version is being deleted, is told to cancel on
  its heartbeat, and its completion or failure ends the job `cancelled` with its snapshot kept; a report after the job
  ended gets 409 (lease lost), which the worker treats as the end of the job.
- The delete dialogs list the active jobs of everything selected (a cascade adds its models' jobs), each linking to its
  job page, with "Cancel these N jobs first" ticked; unticked, Delete stays off with "Cancel the running jobs to delete".
- History stays: jobs (with their events, logs and metrics) and request logs outlive the model. Their links to the
  model, version and base are `ON DELETE SET NULL`, and each row keeps a snapshot written when it is created: the
  model's slug and name and the version number on jobs, the base key on jobs, the slug and name on request logs (the
  base's name is written there when the base goes). Filters match the snapshot slug, so a deleted model still filters,
  and lists show its name with "(deleted)" and no link. A job whose model or version is gone is not retried (409, and
  refused per job in the bulk retry).
- API names are never reused (2026-11-12). Deleting a custom or base model keeps a row in `reserved_names` (the API name,
  kind, the model's name, `deleted_at`, `deleted_by`), written with the model's removal. Migration 0014 backfills one
  for every slug or base key that jobs or request logs still mention and no model holds. Wherever an API name is
  chosen (create, duplicate, import, download) it is the name's slug, or the next free one with a suffix
  (`support-triage-2`) when another model holds it, it is reserved or it is a route word (`new`, `base`, `custom`,
  `name`); display names stay unique (409). An explicit `api_name` on create, duplicate or import that is reserved
  gets 409 "support-triage belonged to a deleted model (deleted Nov 12); pick another name". `/v1` answers a reserved
  name (or `name@N`) with 404 `model_not_found` "support-triage was deleted on 2026-11-12" (the gateway config carries
  the reserved names to standalone gateways); unknown names get the same code. The model page, model lookups and the
  Playground show that message (`GET /api/reserved-names/{name}`), and the Add model page and Duplicate dialog show the
  API name the model will get (`GET /api/models/name?name=`).
- Histories stay apart. A row with a model id belongs to that live model (slugs never change); a filter on a live
  slug matches by id, and on a slug no model holds, the rows without one. Rows of a deleted model whose slug a later
  model took before names were reserved get their own facet, `deleted:<slug>` ("(deleted)"), on Requests, Monitoring,
  Jobs and Training; a base's rows from before it was added count as `deleted:<key>`.
- Deleting jobs: history stays until a Builder deletes it. Failed and cancelled jobs, finished jobs whose model or
  version is gone, and finished housekeeping jobs (download, import, verify, repair, catalogue sync) can be deleted. A
  finished train, eval or judge job of a version that still exists (or a copied version that cites its run) is
  refused with 409 "Used by <model> v5. Delete the version first." Queued and running jobs need `cancel_jobs=true`:
  a queued one is cancelled and goes at once; a running one is cancelled, marked `delete_requested` (202, shown as
  Deleting) and removed by the leader once its worker stops, so nothing races a live process. Deleting removes the
  row, its attempts, events (logs and metrics), its log artifacts nothing else references and its scratch
  (`work/job-<id>`); a retry of it keeps running with no `retry_of`. `DELETE /api/jobs/{id}` and `POST
  /api/jobs/delete` (`{ids, cancel_jobs}`, per-job `done`, `error`, `reason`) are Builder-only and audited as
  `job.delete` with the kind, model snapshot and status; the audit log stays. The Jobs and Training selection bars
  have Delete N (refused ones counted in a tooltip) with a confirm dialog listing the jobs, the skipped ones with their
  reasons and "Cancel running jobs first", ticked; the job page's ⋯ menu has Delete job, off with the reason when
  refused, and goes back to the list after.
- Audit: `model.delete` and `model.undeploy` when a person starts one (`retry` on a retry), and `model.delete_finished`
  and `model.undeploy_finished` with the outcome, what went and the reason a failure gives.

## Eval and promote

- Eval first: the golden set (20–50 human-verified examples) is written or picked before any training.
- Version 0 is created with the model: prompt-only on the base, the preset's prompt (or the model's instructions)
  plus few-shot examples when data exists. It answers at once in the Playground, through `slug@0` and through
  `POST /api/models/<slug>/versions/<n>/test` (one conversation, scored by the graders when an expected answer is
  sent), and is scored on the dataset's held-out rows at once (once the base is on this install). It is the
  untrained baseline and can be deployed at once. Going live is a separate step; training makes v1 and up, compared against the live version.
- Evaluation calls the gateway's own prompt and constraint code (`minibrain/tasks/prompting.py`), so scores are what
  apps get. The eval job only generates answers and times them; main grades them with the version's graders, and a
  judge grader queues a `judge` job for the answers the cache lacks (`judge_scores`, keyed by the SHA-256 of the
  conversation, expected answer and answer, the rubric, the version's system prompt, and the judge model and its
  content hash). The judge also returns a one-sentence reason, kept with the score.
- The judge model is a setting: Settings → General → Judge model for the install (`GET`/`PUT /api/settings/judge`,
  audited as `settings.judge`) and a per-model override (`PUT /api/models/<slug>/judge`), any base on this install.
  The per-model judge, the graders and the promotion rule are set in the model's Evaluation tab; changing the judge or
  the graders re-scores every version in one `score` job, and the Versions tab shows "Scored by …" with a link there.
  A preset with a default rubric (General) adds the judge to its graders once either is set, ahead of its other
  graders, so the judge score becomes the main metric. A judge turned on without a judge model uses the model's own
  base, and the model page says so.
- Free-text versions (General, and Custom with free text) open on the answer review
  (`GET /api/models/<slug>/versions/<n>/answers`): per held-out example the conversation, the expected answer, the
  version's answer and the live version's answer side by side, with each one's scores and the judge's reason, filtered
  to the examples where the version scores below the live one on the main metric.
- Few-shot examples never come from the golden set, which must stay unseen: they come from other labelled rows, or,
  when the golden set is all there is, a few of its rows move out of it and stop being scored.
- If version 0 meets `target.min_score` and its latency and cost are acceptable, the UI says no training is needed.
  Otherwise the report shows the gap a trained version has to close.
- Every version runs on the golden set and the held-out split: base, teacher and adapter on the same examples, scored
  with the task type's metric.
- Eval decodes the way serving does: a Classify answer is held to the label set, so the score is what apps get and
  "not a label" only counts answers cut off by the token limit.
- Reported per model: score, p50 / p95 latency, cost per 1M tokens (GPU time for local models, list price for API
  teachers): the unit API providers price in, so the saving against an API reads directly. The headline reads like
  "base 54% → minibrain 91% at 1/20 of the teacher's cost".
- Local cost: the eval job times the device per batch of 8 held-out rows and records GPU-seconds, requests, tokens in
  and out, the device and the worker's pool (`metrics.cost`, source `device_time`). Cost per 1M tokens (prompt and
  output) is that time × the pool's price per hour from Settings → General → Compute prices (one currency per
  install, audited as `settings.prices`). With no price it shows the GPU time instead; prices are never looked up
  online. An API teacher will record source `list_price` with its token counts.
- Deploy at any step. A custom model can be deployed the moment it exists: with no version live it serves its base
  model. A ready version goes live only when it passes the model's promotion rule (Task types); one that was live before
  can always be rolled back to. Training or scoring never changes what is live.
- Side-by-side review screen. The golden set alone is too small to decide: in the spike, one of 50 rows moved the
  score 2 points and golden and held-out scores differed by 8–11 points.
- Deploying a version moves `current` and loads its adapter into the pool. Rollback deploys an earlier version.

### Reference models

Added 2026-11-26. The question every buyer asks first: is it better than GPT, Claude or Gemini, and how much cheaper?

- An admin adds a reference model: OpenAI, Anthropic, Google or any OpenAI-compatible URL, with its key as a
  write-only connection secret and its list price per 1M tokens. A policy, off by default and lockable, allows it;
  `MINIBRAIN_OFFLINE=1` turns it off.
- A model's Evaluation tab picks the reference models to score: they answer the same held-out rows as version 0, with
  the same instructions and contract, through the same graders. The page says plainly that those rows go to that
  provider, and every run is audited.
- Results sit beside the versions, never as one: a reference model is never deployable and never the live baseline of
  the promotion rule. The headline adds it ("v3 91%, GPT-x 89%, at 1/40 of its cost"), its cost at list price
  (`list_price`) beside local GPU time.
- The same connection serves upstream routes and labelling in v1 (API and access, Labelling) and becomes the API
  teacher in v2.

### General ability

Added 2026-11-26. Training on one task can cost general skills an app still relies on: following instructions,
reasoning, formats.

- A small fixed suite ships with each release and runs offline: a few hundred rows each of instruction following,
  maths word problems and general knowledge, from permissively licensed benchmarks, scored with their own graders.
- It runs on version 0 once per base and on every trained version as its own job after the task scores; the version
  page shows "General ability 71 → 69" beside the task score.
- A drop past a threshold warns on the version, and the promotion rule can require it
  (`general_ability >= v0 - 2`).

### Rebase

1. A new base model is registered (offline bundle, pinned commit). Its chat template parity test runs first.
2. `minibrain rebase --base <model>`, or one button, reruns every model: training from the stored dataset version
   (relabelled first if the teacher changed), then eval on the golden set.
3. The report compares each rebased version with `current` on score, latency and cost.
4. Deploying stays per model and explicit. Nothing that is live changes until someone deploys.

Switch base (per model, shipped) is the one-model form, and the way off a serve-only base:

- A custom model on a GGUF, AWQ or FP8 base serves, takes instructions, a contract and graders, is scored and
  collects feedback, but cannot train. Train stays visible and disabled with the reason ("<base> is GGUF, which serves
  only. Switch to <full-precision variant> to train."); `POST /api/models/{slug}/versions` with `lora` and the
  training plan answer 409 with the same sentence. The model page's next step offers "Move to <variant> to train"
  instead of "Train vN" when the catalogue has a trainable variant of the base, and nothing when it has none.
- `POST /api/models/{slug}/base` with `{base_model}` (builder, audited as `model.base_change` with the old and new
  base) sets the base for new versions and creates a prompt-only version on it, scored at once like v0 (or once the
  base finishes downloading). Name, slug, API keys, instructions, contract, graders, promotion rule, dataset,
  feedback and test examples stay. `GET /api/models/{slug}/base-options` lists the installed bases, each with what
  the model loses there (tool calls, reasoning, from the chat templates) and why it is refused, plus the catalogue's
  full-precision variant, which the dialog downloads first through the Add model path and licence check.
- Live traffic never breaks: every version records the base it was made on (`versions.base_model`, migration 0010,
  backfilled from the model), and the gateway routes each version on its own base. The live version keeps serving on
  its old base, with its adapter, until a version on the new base is deployed. A model deployed with no version live
  keeps serving the base it was deployed on (`deployments.base`) until a version goes live or it is deployed
  again. Chosen over refusing the switch while a LoRA version is live, which would have blocked the common case: a
  serve-only model already in production moving to its trainable variant.
- Versions made on another base stay as history, grouped under their base on the Versions tab, and cannot be
  deployed: promote answers 409 ("v2 was made on X, and the model is on Y now…") and Deploy buttons are disabled with
  that reason. Their `slug@N` routes still answer while their base is installed.
- Refused: the same base, a base not on this install, a base being deleted, a base with a health problem, a model
  being deleted, and a version still training. Deleting the old base counts a model whose live traffic runs on it as
  built on it.

### Feedback loop

1. `POST /v1/feedback` with an API key: `model`, `response_id` (the chat completion's `id`), `rating` (`up` or
   `down`), and optionally `correction` (the right answer, with `down` only) and `comment`. The key must cover the
   model; base models take no feedback. When the model does not keep request inputs and answers, the call carries
   `input` too (and optionally `output`, the answer the app got), and a call without it gets a 422 that names the
   model's switch; otherwise the response id is enough. A second call on the same
   response while it waits for review updates it. The standalone gateway forwards the call to main. Playground thumbs
   and "Correct it" store the same record through `/api/models/<slug>/feedback`.
2. Request logs always carry each response id. "Keep request inputs and answers", a per-model switch on the model's
   page (off by default; see API and access), also keeps the last user message and the answer, for as long
   as the logs. Feedback is stored per model and version and links to its request log by response id.
3. Feedback lands in the review queue (the Feedback page): accept the suggested answer (the correction, or the model's
   own answer for a thumbs-up), fix and accept with another answer, or reject. Disagreement comes first (feedback on
   the same input, ignoring case and spacing, that suggests different answers), then thumbs-down with no answer, then
   the rest, newest first. Assignment is "Assign to me"; every review and assignment is audited.
4. Accepted feedback becomes the model's feedback rows: input and accepted answer, the latest review winning per input.
   When a model version starts, they merge into the dataset version it trains on: a row with the same trimmed input
   is replaced, a new input is added, and a row the dataset already agrees with changes nothing. The result is a
   feedback copy of that dataset version that records how many rows feedback added or relabelled (the model card
   shows "Version 3, plus N rows from feedback"); dataset versions themselves never hold feedback, so models that
   share a dataset do not see each other's. Feedback rows fall into the derived splits like any
   other row; sending the worst failures to the golden set waits for golden set authoring.
5. The model's Overview shows the feedback waiting for review and the accepted rows, and every run from the Train page
   merges the accepted rows into its training data (the old "Train with feedback" button left with the Training tab,
   2026-11-13).
6. Test examples (built 2026-11-06): Save as test example in the Playground, on the whole conversation or on one
   answer, opens the conversation up to that answer with the expected answer to fix first (the model's answer, or a
   label picked from the model's labels). `POST /api/models/<slug>/test-examples` (Builders) stores it as accepted
   feedback, with its turns (`feedback.messages`) and `split = 'eval'`, audited as `feedback.example`; it goes through
   step 4 like any accepted row and lands in the held-out split of the next version's data. The model's Evaluation tab
   lists them (Test examples: conversation, expected answer, the model's answer, the version it was found on, who saved it),
   the Data page says per model in Used by how many it adds, and the Feedback page marks them as Playground test
   examples, where rejecting one takes it out again.

### Live scoring

Added 2026-11-26. Held-out scores say how a version did before it went live; live scoring says how it does now, the
ongoing monitoring model-risk rules ask for.

- Per model, off by default: score a share of live answers (5% by default) with the graders that need no expected
  answer (JSON valid, in the label set, the judge with the model's rubric). It needs "Keep request inputs and
  answers".
- Scores land on each request log; the model's Overview and Monitoring chart the live score by day against the live
  version's held-out score, and a gap past a threshold is a problem (Problems), and a notification in v2.
- Failure modes: low-scoring answers grouped by the judge's reason, the label or the schema field that broke, and by
  topic once embedding models land (Retrieval); each group shows its count, its trend and examples.
- One action sends a failure mode's examples to the review queue, where accepted answers become training rows or test
  examples (Feedback loop).
- Scoring runs as jobs on the judge's pool, never in the `/v1` path.

## Retrieval

- Each model has an index built from its sources: chunks, embeddings, full-text terms, source and access metadata.
- Sync is incremental: dlt state for API sources, change columns or file hashes otherwise. Rows deleted at the source
  leave the index.
- At answer time the gateway's context step retrieves top chunks (hybrid search, filtered by the caller's access),
  adds them to the prompt and returns citations with the answer.
- Per minibrain, retrieval is off, on, or required (no answer without supporting chunks).
- The embedding model and index run on local GPU or CPU; nothing leaves the network.
- Eval: retrieval hit rate and answer correctness on golden questions with known sources.

## Serving

- A pool is one SGLang instance started with `--enable-lora`, `--max-lora-rank` and `--lora-target-modules`.
- Adapters load and unload at runtime (`/load_lora_adapter`, `/unload_lora_adapter`), so hot-swap is v1 and needs no
  restart.
- Teacher pool: the larger model, with no adapters unless it was trained itself. Permanent when GPUs allow, otherwise
  loaded for labelling jobs and unloaded after. Prompt-only versions are served from it, so they need it permanent.
- `ServingBackend` interface: `load(model)`, `complete(request)`, `status()`. Implementations: `sglang`
  (production), `mlx` (Apple silicon, PEFT LoRA converted on load), `transformers` (fallback and tests), `llamacpp`
  (GGUF base models), `vllm` (the same OpenAI-server path as SGLang, with runtime LoRA updates; built 2026-11-06,
  not yet run on a GPU).
- Requests carry OpenAI's sampling fields plus `top_k`, `min_p` and `repetition_penalty`, passed to every engine
  (`docs/api/chat-completions.md`, Sampling); unset fields keep the model's default, custom models answer at temperature 0, and
  `max_tokens` unset runs to the context limit. An engine that cannot honour a field refuses it with a 400.
- Engines are never exposed; the gateway proxies every call. Every engine endpoint, health included, needs a call
  token for the engine's pool (HMAC-SHA256 of the pool keyed with the gateway token, compared in constant time):
  main and gateways derive it, engines learn it from main when they announce, and anything else gets 401
  (2026-11-24). Details: `docs/security/network.md`.

### GPUs on one machine

Built 2026-11-24, for NVIDIA (CUDA) machines; Apple silicon, the CPU, ROCm and Intel GPUs start engines and jobs as
before. Not yet run on an NVIDIA GPU.

- Every engine and every GPU job on a machine gets an explicit GPU, so a second engine or a training run next to a
  live model no longer runs out of memory and restarts in a loop.
- main keeps the book per machine: engines on its own machine directly, engines on joined machines through the
  worker that starts them (it reports its engines' GPUs on every call to main), and running jobs on the job row.
  Each GPU counts 90% of its memory as usable; the rest covers CUDA contexts and activations.
- Whole GPUs first: an engine or job takes an idle GPU when one has room, else a share of the GPU with the most
  room, and only when the base fits in what is left.
- An engine needs the base's serving memory (`weights × 1.2 + 0.5 GB`, as Runs here). Alone on a GPU it takes the
  whole usable GPU for its KV cache, except on the machine's last idle GPU, where it leaves the smallest training
  run of its base (`planner.smallest_run`: QLoRA where the worker quantizes, else LoRA, one 512-token row, over
  85%) so the next version trains beside the live one; if both cannot fit it takes the whole GPU. On a GPU already
  in use it takes its serving memory plus a KV allowance of a quarter of the weights, at least 2 GB (2026-11-24). It
  starts with `CUDA_VISIBLE_DEVICES` and a memory fraction: SGLang `--mem-fraction-static` (its share plus what
  others held on that GPU when it started, since SGLang counts every process's memory against the fraction), vLLM
  `--gpu-memory-utilization` (its own share). One GPU per engine; tensor parallel across GPUs comes later.
- A GPU job takes all that is left of its GPU (the whole GPU when it was idle) and is claimed only where that is
  enough (Training memory). Otherwise it stays queued and says why on the job page and the version: "Waiting for
  a GPU on gpu-01 with 38 GB free for training job 12: GPU 0 has 12 GB free (the engine for qwen3-8b holds
  24 GB)".
- An engine with no room waits too: on main the request gets a 503 with the same sentence, on a worker it is
  logged; it starts once a job or engine frees the GPU. A GPU id in the worker's own `CUDA_VISIBLE_DEVICES` (such
  as Docker's device list) is kept: grants index into it.

## API and access

- `/v1/chat/completions` with streaming (tokens as each engine generates them, since 2026-11-06), `/v1/models`.
- `/v1/completions` (built 2026-11-12): a raw `prompt` continued without the chat template, for code completion and
  base models, streamed too; keys, `name@N`, sampling, safety and request logs (kind `completion`) as in chat. A custom
  model applies its adapter but not its instructions or contract. One prompt per call; `logprobs`, `echo` and
  `suffix` are refused with a 400. Details in `docs/api/text-completions.md`.
- Limits (2026-11-24): chat and text completions run on their own threads, at most `MINIBRAIN_GATEWAY_CONCURRENCY`
  (64) at once per gateway, main included, streams counted for their whole length; one more gets a 503 at once
  (`code: overloaded`, `Retry-After: 5`). A call to an engine still starting or fetching waits 5 s, then gets a 503
  with `Retry-After: 10`. Model traffic never takes the threads the UI, worker check-ins and lease renewals use.
  Keys are not rate-limited.
- `response_format` (`json_object`, `json_schema`) passed through and the answer checked against the schema; without
  one, a custom model's contract holds decoding: its labels for a label set, its schema for a JSON contract (checked
  the same way). A request's format only narrows a model whose contract is free text; a label or schema contract
  refuses one with a 400 (built 2026-11-06). A custom model answers the user and assistant turns of the conversation after its instructions
  (prompt-only versions with their few-shot turns first); system messages from the app are dropped.
- Tool calling: `tools`, `tool_choice` and `parallel_tool_calls`, rendered by the base's chat template and read back
  as `tool_calls` (format detected from the template; SGLang and vLLM use their own parsers). Built 2026-11-06;
  details in `docs/api/tool-calling.md`.
- Reasoning: `reasoning_effort` (`none`, `low`, `medium`, `high`) mapped per family (Qwen3 `enable_thinking`,
  gpt-oss `reasoning_effort`, DeepSeek-R1 always on), detected from the template; the reasoning returns as
  `reasoning_content` and never reaches answers, logs or graders. Built 2026-11-06; `docs/api/reasoning.md`.
- Safety model: a guard base checks requests and optionally answers (install default under Settings, a per-model
  override, a per-request `safety` field that can add but not remove); a block is an OpenAI refusal with
  `finish_reason: content_filter` and the categories, kept in the request log and audited as `safety.block`. The
  catalogue carries Llama Guard 3, ShieldGemma, Qwen3Guard and gpt-oss-safeguard. Built 2026-11-06;
  `docs/api/safety.md`. Hidden from the UI for v1 (2026-11-14): running a guard means deploying and
  keeping a second model, too much to manage at first; the API and settings stay and the UI returns as an advanced
  option.
- Upstream routes: the gateway forwards a model name to an upstream model and logs the calls. Apps switch to the
  trained model by changing the model name. In v1 the upstream is a reference model (Reference models): opt-in, off
  by default and off with `MINIBRAIN_OFFLINE=1`, and the page says plainly that those calls go to that provider. In
  v2 it is the local teacher, the default from then on.
- Private frontier endpoint: the teacher model exposed by name through the gateway, with scoped keys, audit and
  logging like any model.
- `POST /v1/feedback` (see Feedback loop).
- `model: "support-triage"` → current version; `"support-triage@3"` → pinned. The gateway maps it to SGLang's
  `<base>:<adapter>` name.
- API keys cover one or more models, or all models (`api_keys.all_models`, every custom and base model, including
  ones added later and `name@N`); a call to a model the key does not cover gets 403, and an unknown or deleted name
  404 whatever the key. One check, `Grant.covers`, decides for every `/v1` route. Only admins create or widen a key to
  all models. A key whose models were all deleted stays, with "No access"; it never widens to all models.
- Keys are managed on the API keys page (Operate › API keys, `/api-keys`): name, scope, created by, created, last
  used, expires and status, with search, a scope filter, Edit scope and Revoke. Builders see and manage the keys they
  created; admins see and revoke every key. Create key takes a name, the scope (picked models, or all models for
  admins) and an optional expiry within the `key_expiry_days` policy; the secret is shown once with Connect snippets.
  A model's API keys tab is the same list filtered to the keys that reach it, all-model keys included. Audit log: who
  created, changed or revoked which key, when, and its scope (`scope: all` or `models`).
- Request metadata is logged for every `/v1` call: time, endpoint, model, version, key, status, latency, tokens,
  finish reason and response id, never content. Monitoring, cost and the Requests tab depend on it, so it cannot be turned
  off; log retention deletes it.
- Request inputs and answers (the last user message and the model's answer) are kept per model: "Keep request inputs
  and answers" on the model's page, off by default, changed by Builders and audited as
  `model.request_bodies` (before and after). They feed feedback by response id, distillation and the Requests tab, and
  are deleted with the request logs. The install-wide "Request inputs and answers" policy is the default for new models
  and for base models served through `/v1`; an admin can lock it for every model ("Lock for every model" under
  Settings → Security, or `request_bodies` in `minibrain.yaml` or the environment), and then each model's switch shows
  the locked value and cannot be changed. Gateways, standalone ones included, get each model's value in their config
  snapshot. Playground chats are request content too: they are saved only for a model that keeps them (bases follow
  the install default), and Log retention deletes them.
- A context step between auth and the model call retrieves from the model's index (see Retrieval).
- Citations come back in an extra `citations` field on the response.
- Login in v1: local accounts, OIDC (Entra, Okta, ADFS, Keycloak), and trusted headers from a reverse proxy. SAML
  reaches minibrain through the customer's identity provider or a broker (Keycloak); CAC / PIV through the proxy's
  client-certificate check. Proxy headers are trusted only from configured proxy addresses.
- Harness config export: base URL, key and model name for common harnesses.
- API reference (`/developers`): Scalar, bundled into the web build and loaded as its own chunk, with its telemetry,
  fonts, request proxy, agent, MCP, developer tools, SDK generation and client.scalar.com links off, so the page makes
  no call outside the install. Two documents cut from main's schema, for any role: `GET /api/openapi/v1.json`, the
  OpenAI-compatible API ("Stable. For apps. Drop-in for the OpenAI API."; `/v1` as its server, the bearer key scheme,
  and an intro on API names, `name@N`, keys and the base URL), and `GET /api/openapi/api.json`, the Management API
  ("For the minibrain UI and automation. May change between versions."; every `/api` route with the role it needs and
  the CSRF header on changes). Management routes carry one tag each from `minibrain/api/sections.py` (Models,
  Versions, Data, Training and jobs, Evaluations, Feedback, Playground; Monitoring, Keys, Infrastructure; Settings,
  Accounts, Audit, Reference), grouped by `x-tagGroups` into Build, Operate and Administer. `/internal` (workers and
  gateways), `/healthz`, `/readyz` and `/metrics` are left out of the schema (`docs/observability/metrics.md` covers the
  operator endpoints). The page fills in this install's base URL and deployed
  model names, and curl, Python and JavaScript samples (the `openai` SDK for `/v1`). Try it: `/v1` with a key pasted
  into the page, kept in memory and never sent to main; `/api` with the signed-in session, the page adding the CSRF
  token to same-origin `/api` calls only, so a call runs with the person's role and is audited like the same change in
  the UI. FastAPI's `/docs`, `/redoc` and `/openapi.json` are off on main, gateways and engines (404), and the schema
  carries the package version; `minibrain openapi` still prints the public schema (`/v1` and `/api`) for generated
  clients.
- Models are one `/api` resource keyed by the shared API name: `GET /api/models` (`?kind=custom|base`),
  `GET|PATCH|DELETE /api/models/{name}` and `POST /api/models/{name}/deploy` for either kind (a base's rename and
  delete need Admin), custom-only sub-resources (`/versions`, `/training-plan`, `/contract`, `/dataset`, ...),
  base-only actions (`/verify`, `/repair`, `/reimport`, `/relocate`, `/recheck`, `/retry`, `/test`), and the page's
  views (`/overview`, `/traffic`, `/activity`).

### MCP server

Added 2026-11-26. Claude, Cursor and other agents run minibrain with a key.

- `minibrain mcp` (stdio) and `/mcp` on main (streamable HTTP), both calling the same `/api` routes with the key's
  role, so a key cannot do through MCP what it cannot do through the API.
- Tools: list and read models, datasets, versions and scores; add a model; train; score; compare two versions; deploy
  a version that passes its rule; call a model. Each call is audited under the key.

### Accounts and roles

Built, with the details in `docs/security/accounts.md`; OIDC is tested against an in-process fake provider and proxy headers
against test clients, not yet against Entra, Okta, ADFS, Keycloak or a real proxy. People sign in; apps keep using API
keys, and `/v1` stays key-only.

- Sign-in sources, any mix: local accounts, OIDC (authorization code with PKCE; Entra, Okta, ADFS, Keycloak) and
  trusted proxy headers (user, email and groups headers, honoured only from configured proxy addresses).
- Accounts are always on, loopback included; there is no single-user mode. Audit actors are always people; workers,
  engines and `/v1` keep their tokens and API keys.
- First admin, any of: a one-time setup link that `minibrain serve` prints on the first start with no accounts (and
  opens in the browser on a desktop; token from `secrets`, stored as its SHA-256 so it survives restarts until used;
  `minibrain admin setup-link` prints a new one); `MINIBRAIN_ADMIN_EMAIL` plus `MINIBRAIN_ADMIN_PASSWORD_FILE` for
  automated deploys, read on the first start only; or single sign-on with a group mapped to admin, which issues no
  link. Recovery: `minibrain admin create` and `minibrain admin reset-password`. Air-gapped installs need no identity
  provider.
- Passwords: PBKDF2-HMAC-SHA256 through `cryptography` (FIPS-approved; not argon2 or scrypt). OIDC through Authlib,
  which uses `cryptography` for its tokens.
- Sessions: a server-side row per session holding the SHA-256 of its token; an HttpOnly, SameSite=Lax cookie,
  Secure except on plain HTTP loopback (Safari drops Secure cookies on `http://localhost`); idle and absolute
  lifetimes as policies; a CSRF token on every state-changing `/api` call. Signing out or disabling an account ends
  its sessions at once.
- Roles are install-wide in v1. Per-model and per-team rights arrive with Teams in v2.

| Can | Viewer | Builder | Admin |
|---|---|---|---|
| See models, versions, scores, deployments, Monitoring and Infrastructure | Yes | Yes | Yes |
| Use the Playground | Yes | Yes | Yes |
| See data rows: previews, golden sets, mistakes | No | Yes | Yes |
| Upload data, edit mappings, add, train and evaluate models, label | No | Yes | Yes |
| Deploy, undeploy, roll back; create and revoke API keys | No | Yes | Yes |
| Download, import and delete base models | No | No | Yes |
| Security policies, install settings, worker and engine tokens | No | No | Yes |
| Accounts, role mapping, audit log | No | No | Yes |

- Role mapping: identity-provider groups (the OIDC `groups` claim or the proxy groups header) map to roles in
  `minibrain.yaml` (`auth.roles: {minibrain-admins: admin, ml-team: builder}`); values set there are locked in the UI,
  like policies. A person with no mapped group gets the `auth.default_role` policy: none by default, so they see "Ask
  an admin for access" until an admin assigns a role.
- Enforcement is in the backend: one dependency per route states the role it needs, and a test lists every `/api`
  route with its role so a new route cannot ship unguarded. The UI hides what a role cannot do, but never decides.
- Audit events record the person and how they signed in (local, OIDC, proxy). API keys record who created them. Events
  already record the client address of the connection; a forwarded address will count only from configured proxy
  addresses.
- UI: a sign-in page; Settings → Accounts for admins (people, role, sign-in source, last sign-in, disable, reset a
  local password with a one-time link shown once); the user menu shows the person and Sign out.
- Tables: `users` (email, name, source, subject, role, disabled, password hash for local accounts, last sign-in) and
  `sessions` (user, token hash, created, last seen, expiry, address, user agent).

## UI

- obp-ui, operator-console style.
- Sidebar (2026-11-11): Home · Explore (Models, Discover, Playground) · Create (Data, Training, Evaluations,
  Feedback) · Operate (Monitoring, Jobs, Infrastructure, API keys) · Settings, with the release ("minibrain 0.1.2",
  hidden while collapsed) and the user menu (Settings, API reference, Theme, Sign out) below. It follows the role: Viewers see Home, Models, Playground, Monitoring and Settings; Builders
  add the rest; Admins add Infrastructure and the admin settings. Sidebar links are plain paths; no page carries a
  model into another. Deployments and Pipelines left it: a model's endpoint and keys are on its API tab, and
  `/deployments` redirects to Models, `/deployments/<slug>` to `/models/<slug>/api` and `/pipelines` to Home.
- Training, Evaluations and Feedback cover every model, like Monitoring and Jobs. Training and Evaluations are the
  kit's `DataGrid` with model and status filters kept in the URL: `?model=<slug>,<slug>&status=<status>,<status>`.
  - Training (rebuilt 2026-11-11) is one "Runs" section: every model's training jobs with job, model (its logo),
    the version it produced, status, held-out score, method ("SFT · LoRA r32"), duration and started. Model, status
    and method filters (`?method=sft`; DPO, continued pretraining and reinforcement learning show as coming soon),
    a search, ticks with bulk Cancel and Retry. A row opens the job's page; the old `?job=<id>` redirects there.
    "Train a model" asks which model and opens `/models/<slug>/train`, the model's Train page.
    `/training/<slug>`, the old per-model workspace, redirects to `/models/<slug>/versions`.
  - Evaluations lists every version: model, version, kind, held-out accuracy, change against the live version, created,
    status. A row opens its scores and held-out mistakes (`?version=<slug>@<n>`); Deploy sits on the row and in that
    view.
  - Feedback is the review queue across models: status tabs with counts (To review, the default, Accepted,
    Rejected, All; `?status=accepted`), then input, the model's answer and the suggested answer with the changed
    words marked, status and model, paged on the server and filtered by model and assignee
    (`?model=<slug>&assignee=me`), disagreement first. Above the tabs, each model with answers accepted since its
    newest version gets one line: "Support Triage: 24 accepted answers since v3 · Train v4". Review next (or a
    row) opens the review screen (`?item=<id>`, `?item=next` for the first to review): input, the model's answer
    and the suggested answer side by side with a word diff, the comment, who sent it (the person in the
    Playground, or the API key), other feedback on the same input; Accept (A), Edit answer (E, then ⌘ or Ctrl
    Enter), Reject (R), Skip (S), Previous (K), Esc back to the list, Assign to me. Each decision moves to the
    next item in the tab and filters, with "n left".
- Jobs (`/jobs`, 2026-11-11) lists every job of every kind (training, scoring, judging, downloads, imports, verify,
  repair, catalogue sync, and exports once they exist): job, kind and version, model or base, status, started and
  took. Tabs by kind with their counts (`?kind=`), a status filter and a search (`?status=&q=`), ticks with bulk
  Cancel and Retry; a row opens the job's page. It replaced Monitor's Jobs tab: `/monitor/jobs` redirects here.
- A job has one canonical URL (2026-11-11): a training job is `/training/<id>` (Training highlighted, breadcrumb
  Training › Job #id), every other kind `/jobs/<id>` (Jobs › Job #id); the other URL redirects to it, and every
  link in the app uses `jobHref(job)`. Under the title "Job #id" a line says what it belongs to ("Trains Support
  triage → v5", "Scores Support triage v5", "Downloads Qwen3 8B · BF16") and when it started; then kind, status,
  attempt, device and duration, with Cancel and Retry, the failure or "Serving" line, and sections: Progress (the
  bar, step, epoch, time left, losses, tokens per second, peak memory, or bytes, speed and file for transfers, rows
  for scoring, then queued, started and worker) beside Settings and data (the version it produces, the dataset
  version and rows, base, method, the settings as planned by the worker with what changed from the defaults,
  sequence length, train and held-out rows; for a base, its variant, revision and size), then Loss (training and
  held-out on one axis, the previous version's run behind them, a warning when held-out loss rises while training
  loss falls), Learning rate (its own chart), Scores for scoring jobs (against the live version, the promotion rule
  and Deploy), and Logs: the kit's `LogViewer` with a level filter, library output off by default, search, follow,
  timestamps, events that open to their fields, copy and download. `GET /api/jobs/{id}` carries the setup;
  `GET /api/jobs` adds the base name, publisher and variant, the held-out score, method, strategy and rank, and
  filters by `method`; facets count kinds.
- Monitoring has two tabs: Overview (`/monitor`) and Requests (`/monitor/requests`), every `/v1` call as it
  arrives. Overview charts the request logs for a time range and models
  (`?range=&model=<slug>,<slug>`): requests per minute (stacked), error rate, p50 or p95 latency and tokens in or out,
  one series per model for the five busiest and "Other models" for the rest, in buckets sized to the range (about 60;
  15 seconds for 15 minutes, 30 minutes for a day), aggregated in SQL that runs on SQLite and Postgres
  (`/api/requests/overview`). The Requests summary sits above, a per-model table below (requests, error rate, p50,
  p95, tokens, last request; a row opens Requests for that model), refreshed every 10 seconds unless paused. Requests
  is the kit's `DataGrid`, paged on the server by request id: time, model@version, key, status, latency, tokens in and
  out, finish reason, response id and a feedback mark. New rows join the top every 3 seconds (Pause stops that) and
  leave a scrolled reader in place. Model, version, key, status (OK, 4xx, 5xx), a response id search and a time range
  (`?model=&version=<slug>@<n>&key=&status=&q=&range=`) filter the list and the summary above it: requests, error
  rate, p50 / p95 latency, tokens in and out. A row opens its detail (`?request=<id>`): the metadata, the key's name,
  the kept input and answer for Builders and Admins (Viewers see that it needs the Builder role; when the model does
  not keep them, "Not kept for this model", with a link to its switch for Builders) and the feedback on its response
  id.
- API reference: two `TabNav` pages, OpenAI-compatible API (`/developers`) and Management API
  (`/developers/management`), each a Scalar reference themed from the obp-ui tokens (Cobalt, light and dark, the
  kit's sans and mono). API keys (Builders) links to the API keys page; the user
  menu and a model's API tab link to it, and the copy-paste harness configs stay where they are.
- Playground (built 2026-11-06): the chat on the left, a settings panel on the right (a drawer below 1024px, hidden on
  request) with Model (any version of your models, the live name, or any installed base, deployed or not;
  `?model=<name or slug>` for links, the last pick remembered in the browser), Presets (saved, named sets of every
  setting below, per person in `playground_presets`, one loading by default; sharing later), Settings (max tokens,
  temperature, safety model, reasoning), Format options (response format with a JSON schema editor, functions with
  JSON-schema parameters and a tool choice) and Sampling (top P, top K, min P, presence, frequency and repetition
  penalties, stop sequences, seed). Every control has the kit's `InfoTip`; numbers are `OptionalNumberField`s whose
  Unset sends nothing. Answers stream in, reasoning in a collapsible block, tool calls as cards with a box for the
  result that continues the chat, JSON pretty-printed, a refusal marked Blocked, and each answer's latency, tokens and
  finish reason; custom models keep thumbs and corrections. View code shows the next request as curl, Python
  (`openai`, extensions in `extra_body`) and JavaScript. It calls `POST /api/playground/chat/completions`, the `/v1`
  pipeline under the person's session: not request logs, safety blocks audited with the person. Comparing two versions
  side by side moved to Evaluations' answer review.
- Playground history (built 2026-11-06): a Recent column on the left (from 1280px, a drawer from the left below it,
  hidden on request) lists the person's chats, newest first, with a filter box, New chat, and Rename and Delete in
  each row's menu; `?chat=<id>` reopens one. A chat saves itself after each answer (and after a settings change once
  it has one), titled from its first message, with its turns, model and version, every setting and the preset, in
  `playground_sessions` through `/api/playground/sessions` (create, list, read, update or rename, delete), scoped to
  the signed-in person: no route lets anyone, admins included, read another person's chats. The title and the content
  are sealed at rest with `seal_text` under contexts naming the chat and resealed on key rotation like connection
  secrets. A chat is saved only when its model keeps request inputs and answers (per model, or the install default
  for bases, or the admin lock); otherwise nothing is saved and the Recent list says why in one line. Chats with no
  new message for Log retention (days) are deleted by the leader's hourly purge, with the request logs. No folders,
  sharing or search beyond the filter: that is the staff Chat app's job.
- Models (`/models`, built 2026-11-11) lists every model in two sticky, collapsible groups, Your models then Base models
  (title and count only); base models are grouped by catalogue model, one row per catalogue entry with its installed
  variants. One toolbar line: Search, the active filter chips, then a view-options button and Add model. The view panel
  filters by status (Deployed, Not deployed, Needs attention, Training, Failed, with live counts), kind and base model,
  sorts (Needs attention first by default, Name, Score, Requests, Recently updated; within each group) and holds
  Display: Show versions and the Quality, Requests, Cost and p95 columns (Cost and p95 off by default); filters and sort
  stay in the URL (`?q=&state=&kind=&base=&sort=`), display choices in the browser. A row shows the logo or avatar, name
  and base, the live score with a sparkline over versions, then 7-day requests, device time per 1M tokens and p95
  measured as the model page's Monitoring measures them (without traffic, the cost the eval measured, muted), and one
  status line ("v5 beats live +1.4 · Make v5 live", "v6 training 45%", "v3 failed", Deployed with "· 2 replicas" from
  the live engines, Not deployed), then Connect or Try and a menu. A row opens the model page; arrows move, Enter opens,
  Space opens the quick look. Show versions adds version rows under custom models (status as a dot and text, "beats live
  +1.4" or "below rule", never on v0 · Baseline, and Make vN live) and variant rows under base models (format, size,
  trainable or serve-only, API name, Deployed, Update available). Only those child rows tick: versions can be compared
  (two of one model) or deleted, variants deployed, undeployed or deleted, live ones skipped, through the shared delete
  dialog. The quick look is a `Sheet`: score over versions, a week of traffic, p95, errors and cost, the latest
  requests, the model page's next step, and Open model, Make vN live and Playground. `GET /api/models` carries what it
  needs in a fixed number of queries: versions loaded in one batch, requests, p50, p95, 4xx/5xx and device time from the
  model page's traffic statistics in one ranked query (so the 7-day numbers match its Monitoring), live replicas per
  base, and each base's catalogue model, format and trainability. Viewers see no builder actions.
- A model's page (built 2026-11-06, rebuilt 2026-11-11 from the approved prototype) is one route for both kinds,
  `/models/<name>`: base keys and custom slugs share one namespace with `/v1`, so create and rename refuse a name
  another model holds (409), and create, import and download give the next free API name when the address is held,
  reserved by a deleted model or a route word (`new`, `base`, `custom`, `name`). Old
  `/models/base/<key>` and `/models/custom/<slug>` links redirect. A breadcrumb sits above a compact header: the logo or
  avatar, the name, a Custom or Base badge, Deployed or Not deployed, "v4 live 86.7%" and a subtitle (description ·
  On base). Its actions, for Builders, are Train · Deploy · Use ▾ on a custom model and Create custom model · Deploy ·
  Use ▾ on a base (Use: Playground, Connect); Viewers get Use ▾. There is no ⋯ menu and no state-driven primary
  button. Tabs are `TabNav` pages with their own URLs: Overview · Versions · Evaluation · Monitoring · API keys ·
  Settings for a custom model (Viewers lose Settings), Overview · Monitoring · API keys · Settings for a base (one installed format is
  one base, so there is no Variants tab); `training` and `data` redirect to Versions, `keys` to API keys, and an
  unknown tab to Overview. One training run makes exactly one version, so the Training tab merged into Versions
  (2026-11-13): its runs and score columns are the Versions table, its loss curves and logs are on each version's page,
  its instructions are on the Train page, and its answers, rubric and test examples are on Evaluation.
  - Overview: Usage, About and Details in sections titled outside their panels, Activity in a right column. Usage
    starts with a status line of one action computed on the server (`ModelPage.status`), broken first, then ship, then
    improve, then start: a failed teardown or bad health, errors at three times the usual rate, a failed newest
    version (Retry), a version that beats live (Make vN live), a running job ("Training v8 · 45% · 8 min left · View"),
    feedback to review, not deployed (Deploy), else "Live: v4 · 2 replicas". Under it the shared
    line chart of requests by version (the four newest versions that were ever live take the validated series colours,
    in order; the rest fold into Other versions), with made-live markers, a Requests · p95 · Errors · Cost switch and a
    24h · 7d · 30d range shared with Monitoring, an empty frame when there is no traffic, and a footer line with p95,
    errors and replicas. About lists Task, Live, Base, Data, Deployed and API name (with copy), then Tags, Created,
    Updated and Description, the last two editable in place by a pencil on hover. Details, always shown: task setup
    (labels, instructions, then graders and promotion rule read-only, changed on Evaluation), data (splits, feedback
    waiting, test examples), serving (safety, kept inputs, machines), lineage and integrity (the live adapter's and the
    base's SHA-256 with copy, the model card). Activity is the audit log filtered to the model, its versions, keys and
    jobs (`/api/models/<name>/activity`), as sentences with day separators and runs of three or more folded; All
    activity opens the audit log searched for it (Admins).
  - Versions: one table of versions and their runs, under a "Scored by … · Change in Evaluation" line: Version (v0 ·
    Baseline marked untrained), Status (Training 45% with a small progress bar, Queued, Scoring, Ready, Deployed,
    Failed linked to its job), the main score with a badge against the deployed version ("beats live +1.4" or "below
    rule", none on v0), Data (the dataset version, v10), Training (Fast, Balanced, Best, Custom, or Instructions for a
    prompt-only version), Started and Duration of its run. A row has Deploy vN and Retry (the newest failed one), and a
    ⋯ menu with Compare with…, Train again (`/models/<slug>/train?from=N`), Logs (its job) and Delete; ticking two
    compares them, ticking any deletes them (the deployed one is kept).
  - A version's page (`/models/<name>/versions/<n>`): a breadcrumb, Make vN live (its confirmation says the direction,
    "v5 scores +1.4 over live v4" or "v4 replaces live v5 (−1.4)") and a ⋯ menu (Try in Playground as `name@N`, Compare
    with…, Copy the name, Model card, Export…, Delete version); then Score (against live and v0 · Baseline), Where it
    differs (better and worse counts from the held-out answers, then the rows), its run's loss (training and held-out
    loss by step, with the previous run behind) and learning rate while or after it trains, Made from (dataset version,
    method, training preset, settings, the machine, the job), Identifiers, Exports and the job's logs. Export offers the adapter as a download and the merged full
    model as safetensors (an `export` job on a worker whose memory holds the base, bf16 on a GPU and fp32 on a CPU or
    Apple GPU; QLoRA adapters merge onto the bf16 base; one tar with SHA256SUMS, reused per version and base files,
    deleted with the version, listed in the AI-BOM); GGUF says Coming soon (v2). Compare (`/models/<name>/compare?a=&b=`) puts two versions in a
    `CompareTable` (scores, latency, data, settings), their differing answers (the answers API takes `against`) and a
    link to the data diff.
  - Train (the header's Train) opens the Train page (`/models/<slug>/train`, Builders): on the left Method (Supervised
    fine-tuning (SFT) or Instructions only (no training), `?method=instructions`), Instructions (the system prompt's
    first line and Edit, which opens it; saved with the new version through `POST /api/models/<slug>/versions
    {instructions}`, and each version keeps its own snapshot), Data (the model's dataset, fixed, and the version to
    use, with the changed-since notice and its Update), Training (Fast · Balanced · Best, each with rank, epochs and the
    planner's time, or Custom) and Compute (Automatic, then every training machine by pool, one that does not fit
    disabled with the reason); under them Parameters in two columns (adapter, optimisation, sequence, memory,
    evaluation, seed), locked unless Custom, with a reset, re-planned live; then Train vN and Cancel, with the first
    problem beside Train vN. Train vN stays enabled (2026-11-14): clicking it with a problem marks the fields in red
    (data, pool, rank, sequence length, instructions), opens Parameters when one is there, and scrolls to and focuses
    the first. Instructions grow to about ten lines and then scroll, capped at the API's 8,000 characters with a count
    from 90%. When no training machine has reported its memory, the plan is "planned by the worker" and Train vN
    still starts the run. On the right a sticky run summary without buttons: the time, machine and pool,
    GPU-hours, the queue, the memory bar, rows, held out, the version it creates and planner errors in red. Narrow
    screens stack it and keep the buttons in a bottom bar. The plan comes from the real planner (`/training-plan`
    returns every machine, the time and the queue). Instructions only hides Training, Compute and Parameters, makes a
    prompt-only version scored at once, and its summary reads "Scores in ≈ N s on N held-out rows", timed from the
    last prompt-only version's scoring job. A serve-only model (its base cannot train here) opens it in Instructions
    only.
  - Monitoring: the range switch, then Traffic (requests, p95, p99, error rate and cost per 1M tokens against the period
    before, and the shared chart), Latency (p50, p95, p99), Errors (the rate against the usual one and a table by
    status linking to the request log), By version, Callers (API keys) and the latest requests, all from
    `/api/models/<name>/traffic`, one query per range, so its numbers match the Overview and the Models list.
    Line charts only.
  - API keys: the model's keys (a name is required and unique among the keys that call the same model, shown in the
    list, Callers and the request log; the secret is shown once), the endpoint and harness configs, the feedback API,
    kept inputs and answers, and the safety model, so everything the old deployment page showed is here.
- Add model (`/models/new`) asks for the base model, from one picker (the kit's `TabbedSearchList` in a dialog:
  one search over four tabs), a dataset (required; the menu lists the datasets, then Upload new…, which opens a dialog
  with a drop zone that uploads the file, makes a dataset of it, named after the file, and picks it, then a Demo data
  group of the demo files not yet added, where a pick adds the file as a dataset and picks it, 2026-11-14), an output
  and a name; description and tags live in the model's Settings. It is the create-page pattern
  (2026-11-13): the form in one card with labels in a 9rem column, a sticky summary card on the right with the
  consequences and cost (memory and storage gauges, "v0 · untrained baseline, scored on N held-out rows", blocked
  reasons), Create model and Cancel under the form, and below 48rem one column with a sticky bottom bar. Output, under
  the dataset, is suggested from its answers (see Task types). The name row (built 2026-11-12) is the
  avatar button, then the name, then a dice Shuffle (R): the name is prefilled and required, a generated adjective
  and noun ("Brisk Heron") never held by a base or custom model, with an inline error when a typed one is taken.
  Typing a name or picking an avatar keeps it ("Name kept · Undo"), and Shuffle then rerolls only the other. Under the picker, a base under 7B parameters gets a hint, never a block: "For a chat
  assistant, 7B+ works best." The picker lists base models only; to start from one of your models, Duplicate it
  (below). The model page proposes labels found in its data (see Task types), and Evaluation › How it's scored shows the
  answers (free text, one of these labels or a JSON schema, with the contract number; after going live, a breaking
  change asks to confirm) and the judge's rubric as plain defaults with an Edit action, beside the graders, judge
  model and rule. The Train page's Instructions edit the system prompt with the next version.
  - Recommended: recently used bases, then 2–3 that run on this machine and 1–2 that need more compute, ranked by fit
    for a chat assistant (capability, size tier favouring 7B and up, the catalogue's tested default; superseded
    models left out), then popularity. Being downloaded is not a ranking factor.
  - Catalogue: every entry, with size, fit and licence-use filters. Imported: bases imported on this install. Import:
    a Hugging Face id or link, an `s3://` path or a folder.
  - Each option shows publisher, parameters, licence use, "On this install" or the download size, and a fit hint.
  - Logos: a base model shows its publisher's logo (a letter tile when the publisher is unknown); a custom model
    shows its avatar, with its base named in text, on every page.
  - Avatars (built 2026-11-12): the picker is a dialog in three steps, Style (Initials, Planets, Voxel Bot,
    Pixelbot; the last three CC0 DiceBear styles, lazy-loaded), Shape (12 seeds, or the letters for Initials, with
    custom letters) and Colour (the kit's ten `--file-*` tones), with a large preview, "In the app" at 48, 32 and
    20 px, Recent and Surprise me. A model stores `{style, seed, tone, letters?}` (`models.avatar`, tone by name,
    never hex), so it redraws in the current theme. `POST /api/models` takes it; `PUT /api/models/{slug}/avatar`
    (Builder, audited as `model.avatar`) changes it from the model's Settings › General; Duplicate copies it.
    A model without one shows its initials in a tone from its name's hash.
  - Under the picker: the download against free space on the model files disk (blocked when it does not fit), the
    variant and licence, and for a base that needs more compute, the pools it fits and how to join a GPU machine to a
    pool. It can always be downloaded now and run later.
  - `?model=<catalogue id>&variant=` and `?base=<key>` preselect the base, `?dataset=` the dataset, and
    `?source=import` opens Import.
- Duplicate (built 2026-11-07), in a custom model's row menu on Models and its Settings tab, asks for a name
  ("<name> copy", the next free one in the shared namespace) and calls `POST /api/models/{slug}/duplicate` (Builder,
  audited as `model.duplicate` with the source slug and version; 409 on a taken name or a source being deleted). The
  copy gets the same base, preset, answers, instructions, graders, rule, judge, safety, training data, description,
  tags and avatar, and a fresh v0. The source's live version (else its latest ready one) becomes the copy's v1, ready and not
  deployed, with its scores, recipe and data version; it points at the same adapter artifact by SHA-256, so no bytes
  are copied (the store is content-addressed and write-once), and `versions.duplicated_from` records the source name,
  version and training job ("Duplicated from guy1 v4" on the Versions tab and the model card, whose run facts come
  from that job). Deleting either model drops an adapter only when no version still references it.
- Settings replaces the sidebar with its own: Back (the last page outside Settings, else Home), then its sections.
  General: You (appearance; profile once accounts exist), the model catalogue, recipe and splits. Security: the
  policies, locked when set by config, with a link to their changes in the audit log. Accounts (admin) once accounts
  exist. Install settings and the audit log become admin-only with accounts.
- Settings → Audit log: every audited change in the kit's `DataGrid`, newest first: time, actor and client address,
  action, target and a details summary. Search, action, actor and a date range (`?q=&action=&actor=&from=&to=`, local
  days) stay in the URL; paging is server-side by event id (`?before=<id>`, `?after=<id>`), so history size does not
  matter. A row opens the full event as fields with before and after values (`?event=<id>`). Export downloads CSV or
  JSONL of the current filter from `/api/audit/export`, with each event's `seq`, `prev_hash` and `hash`. The page
  only browses: one line under the header gives the chain state, how long events are kept and the SIEM state, with
  Change in Settings. Settings › Security holds the rest. Audit retention is the `audit_retention_days` policy: keep
  forever by default; the hourly purge deletes older sealed events up to a chain anchor and records an `audit.prune`
  event with the `seq` and hash it cuts at. Audit integrity shows whether the hash chain verifies, or its first
  break, and whether SIEM export (set in the section above it) is keeping up, with Verify again. The leader checks the
  chain on its own: hourly from the last verified `seq` and hash kept on the chain head, and in full nightly (paced,
  in the maintenance loop). A break records `audit.chain_broken` and stays a critical problem until a full check
  passes; a SIEM error or sealed events waiting over 15 minutes is a warning. Exports record `audit.export` with the
  format and filters; reading the log records `audit.view` at most once an hour per person.
- Settings → This install, read only: minibrain version and build commit, Python, DuckDB, PyTorch, Transformers, OS
  and architecture; home, database (location and size), artifact storage (folder, or bucket and endpoint; never
  credentials) and the web build; catalogue version and when catalogue and model files were last checked; pools,
  machines, workers and engines online; outbound access and which endpoints the network policy allows. "Download
  diagnostics" is a plain link to `/api/system/diagnostics`: a zip of versions, settings, policies, job counts and
  recent server warnings, with every known secret value scrubbed and secret-named fields redacted.
- Panels are the kit's `Card`; a table sits edge to edge in its panel.
- Data is an explorer: a resizable, searchable tree (the kit's `Tree`) on the left with two sections, Datasets and
  Sources; the selected item's detail on the right. Sources holds one group per kind (Uploads, Folders, S3, Databases,
  Lakehouse), shown only once it has a source; an empty Sources points to Add, and a link to an empty group
  opens Sources. Lakehouse holds Iceberg and Delta Lake tables, each with its format's `FileTypeIcon` and a format
  badge (`group:iceberg` links open it). One primary Add button in the page header, whatever is selected (`N` opens
  it, except in a text field, the tree or a dialog), opens one menu in three groups. Dataset: New dataset (in the
  selected folder or the selected dataset's folder, or from the selected source), New folder (in the same folder), and
  "From N selected sources" when rows are ticked in a source table, else "From sources…", which opens Uploads. Source:
  Upload file, Folder on the server, S3, Database, Lakehouse table (Iceberg, Delta Lake; the dialog picks the format
  first); an item that cannot work stays disabled and says why in its second line and a tooltip (no folders allowed,
  no S3 or database connection), and admins get Open connections or Open security settings. Demo data: the bundled
  demo datasets. Group pages and Datasets have no add buttons of their own; a folder keeps Rename, Move to… and Delete, and
  the tree's row menus keep their items. Uploads
  also takes a file dropped on it (the kit's `DropZone`, with Choose a file for keyboard and click), through the same
  checks as the button: the same content opens the existing source, a taken name asks Replace or Keep both. A source
  shows its table name, columns, stats, first rows and the datasets that read it; a folder also shows its file count,
  size and last change; a connected source shows its connection, path, table or query, and
  how its changes are tracked.
  A dataset shows the sources it reads, its query (Columns or SQL mode, the table names beside the SQL editor), a live
  preview, the saved version's rows, splits, label balance and duplicates (with one line when the query now returns
  another row count), its versions (tick two to compare), the models that use it, Update when its sources or query
  changed since the latest version, Save full version when the latest is a sample the row limit now covers, and "Train
  a model" (disabled while the latest version has fewer rows than training needs). Every item shows its sources →
  dataset → models trail. Every item has a path: `/data/datasets`, `/data/datasets/<slug>` (plus
  `?compare=<id>~<id>` for a version diff), `/data/folders/<id>`, `/data/sources`, `/data/sources/<group>`
  (`uploads`, `folders`, `s3`, `databases`, `lakehouse`) and `/data/sources/<group>/<id>`; the tree pushes history, so
  back and forward walk the selection, and a middle-click opens a row in a new tab.
- Dataset folders (`dataset_folders`, `datasets.folder_id`) only organise; nothing a model trains on depends on them.
  They nest, sort before datasets (both by name), and a folder name is unique among its sibling folders and a dataset
  name among the datasets beside it, case aside. Every dialog that names or renames a folder, dataset or source (New
  folder, Rename, Edit, New dataset, Make a dataset, Add's source dialogs) checks the name as it is typed, says which
  item holds it and keeps the button off, and a suggested name is already free; Move to… and drag and drop refuse a
  folder where the name is taken. New folder is in Add and in the row menu of Datasets and every folder; a folder shows
  its contents with counts, and Rename, Move to… and Delete. Rows move by drag and drop in the tree (the kit's `Tree`
  with `onMove`), or from the keyboard with "Move to…", a dialog with a folder picker; a folder cannot move into itself
  or below itself. Deleting a folder moves its datasets and subfolders up one level (a clashing name gets a number,
  `Billing (2)`) and deletes nothing else. Search still finds datasets inside folders and opens their path. Create,
  rename, move and delete are audited (`dataset_folder.*`), and so is a dataset changing folder (`dataset.move`).
- Settings → Data: most rows in one version, how many unused versions stay per dataset, and the version checks with
  their limits. Settings → Storage: where artifacts live.
- Settings → Connections: the buckets and databases that sources and imports read (see Connections), with each
  one's address, secret state, sources and test, and which DuckDB extensions are installed.

| Need | obp-ui |
|---|---|
| Sidebar | `shell`: `AppShell`, `Rail`, `NavItem`, `SectionLabel`, `AccountMenu` |
| Status | `Badge`: queued `neutral`, training `info`, ready `approval`, live `success`, failed `destructive` |
| Job logs | `LogViewer` |
| Preview, playground, side-by-side eval | `chat`: `ChatBubble`, `AssistantTurn`, `ChatComposer` |
| Forms, tabs, tables | Primitives |

- Missing, added to obp-ui as an opt-in entry: SQL editor (CodeMirror 6). Added to obp-ui for the Playground
  (2026-11-06): `Slider`, `OptionalNumberField`, `JsonEditor`, `Sheet` and `Collapsible`.
- App-level: preview grid (TanStack Table over `Table`), loss and eval charts (Recharts).
- The chat is a playground for any model with the API's settings (see UI, Playground), not open chat for end users.
- The review queue is built for domain experts (doctors, analysts, lawyers), not ML engineers: plain-language labels,
  rows assigned to people, agreement between reviewers tracked, no model terms on screen.
- Every output in the playground and review screens has thumbs-down and correct.

## Config as code

One `minibrain.yaml` per model: task type, source, SQL, steps, teacher, recipe, golden set, target score.
The UI reads and writes the same file. `minibrain run <name>` rebuilds, labels, trains and evals from it, so a team
can keep models in git and rerun them in CI.

```yaml
name: support-triage
task: classify
labels: [billing, bug, account, feature]
source:
  sql: |
    SELECT subject || chr(10) || body AS input, category AS label
    FROM src.tickets WHERE created_at > '2025-01-01'
steps: [strip_html, pii_scrub]
teacher: large-local
golden: golden.jsonl
recipe: default
target:
  min_score: 0.85
```


## Config file

Done (2026-11-05). One `minibrain.yaml` per install, apart from the per-minibrain file above: everything an admin sets
in the UI can be provisioned from it, so a locked-down or GitOps install starts fully configured with no clicks.

- Sections: `policy`, `auth` (with `admins`, roles by group, proxy, OIDC), `logging`, `metrics`, `storage`, `data`,
  `compute` (currency and prices by pool), `catalogue` and `connections`. Pools and machines stay runtime: they join
  with `--pool`.
- Set in the file or by `MINIBRAIN_<SECTION>_<KEY>` means locked in the UI; the API refuses the change with 409.
- Secrets are named, never written: `secret_env` or `secret_file`. A secret in the file stops the start.
- main validates the file at startup and names the key; unknown keys are warnings.
- `minibrain config export` prints the effective settings in the same format without secrets, and round-trips.
- Next: hot reload on file change, and a JSON Schema for editors.

## Observability

Off by default, and only ever towards systems the customer runs. Details: `docs/observability/opentelemetry.md`.

- OpenTelemetry: OTLP over HTTP (protobuf; no gRPC) to the customer's collector, set as admin policies (endpoint,
  headers encrypted and write-only, protocol, service name, CA bundle) that `minibrain.yaml` and the standard
  `OTEL_EXPORTER_OTLP_*` variables lock. The collector is reached whatever the network policy, like the SIEM, and
  nothing else: no proxy variables, no redirects. Standalone gateways read the same settings from their own
  `minibrain.yaml` and environment.
- One SERVER span per `/v1` request on the GenAI semantic conventions (`gen_ai.operation.name`,
  `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.response.id`, `gen_ai.usage.input_tokens` and
  `output_tokens`, `gen_ai.response.finish_reasons`, `server.address`, `error.type`) plus `minibrain.model.slug`,
  `minibrain.model.version` and `minibrain.api_key.id`, joined to the caller's trace by `traceparent`. Never a prompt
  or an answer.
- Metrics: `gen_ai.client.operation.duration` and `gen_ai.client.token.usage` histograms, `minibrain.gateway.requests`
  by route, status and model, `minibrain.jobs.queued` by kind, `minibrain.jobs.queued.oldest_age` and
  `minibrain.workers.online` by pool. Unknown models count as `_unknown`, so callers cannot grow the series.
- Prometheus: `/metrics` in text format with the same metrics, answering only once `metrics.addresses` or a scrape
  token (`metrics.token_file`, `MINIBRAIN_METRICS_TOKEN`) is set, like the trusted proxy addresses; no user session.
- Logs: `MINIBRAIN_LOG_FORMAT=json` (or `logging.format`) writes one JSON line per event with level, logger, message,
  request id and response id; plain text stays the default. Every response carries `X-Request-ID`.
- A Grafana dashboard over the Prometheus metrics ships in `docs/grafana/minibrain.json`.

### Usage statistics

Decided 2026-11-27: on by default, so we learn which features people use; one setting turns them off. The only
thing minibrain sends to us.

- Sent: anonymous counts only. The version, the operating system, the engines and accelerators in use, how many
  models, versions, datasets, machines and requests there are (in ranges, not exact numbers) and which features were
  used. A random install id made on first start.
- Never sent: prompts, answers, data, the names of models, datasets, machines or people, addresses, keys.
- Said out loud: `minibrain serve` prints one line at every start while they are on, with how to turn them off.
  Settings › This install shows the same line and the last payload sent, in full.
- Off with `MINIBRAIN_TELEMETRY=0`, `telemetry: false` in `minibrain.yaml`, or the switch in Settings (a policy, so
  config locks it). `MINIBRAIN_OFFLINE=1` and the Offline network policy turn them off; under Allowlist they are sent
  only when our host is on the list.
- At most once a day, over HTTPS, to our own endpoint. A send that fails is dropped: it never retries in a loop and
  never delays start or a request.
- Every field is listed in `docs/observability/usage-statistics.md`, and the destination shows under This install ›
  Network like any other.

## Offline

Air-gapped installs are an option, not the main audience (2026-11-20): most installs are connected and download base
models from Hugging Face, and the UI may link to online docs. With `MINIBRAIN_OFFLINE=1`, nothing in the data,
labelling, training, serving or gateway path calls out, and everything below holds.

- Teacher: a larger open model on local GPUs. An API teacher is opt-in per install and off by default; the UI marks
  every model whose data went to one.
- Model weights: downloaded on a connected machine, pinned to a commit (`hf download <repo> --revision <sha>`), copied
  in by disk or an internal mirror, registered by local path. `HF_HUB_OFFLINE=1` everywhere.
- Install bundle: Docker images, Python wheels, Presidio's spaCy model, the frontend build. Nothing downloads at install
  or run time.
- Usage statistics are off (Observability › Usage statistics). OpenTelemetry export is opt-in and goes only to the
  customer's collector (see Observability).
- DuckDB extensions: S3, database, Iceberg and Delta Lake sources need httpfs, postgres_scanner, mysql_scanner,
  iceberg, avro and delta. DuckDB downloads extensions from the internet by default; minibrain never lets it
  (`autoinstall_known_extensions` and `autoload_known_extensions` off on every connection) and loads them only from its
  own extension directory (`<home>/duckdb/extensions`, or `MINIBRAIN_DUCKDB_EXTENSIONS`). They are not in git or the
  wheel: the image's set is 85 MB compressed on linux_amd64 for DuckDB v2.0.0, 30.5 MB of it delta (78 and 28.3 MB on
  linux_arm64). Vendoring: on a connected machine,
  `minibrain extensions download --to ./duckdb-extensions --platform linux_amd64 --platform linux_arm64` saves
  DuckDB's repository layout (`<version>/<platform>/<name>.duckdb_extension.gz`) for the installed DuckDB version; the
  folder goes into the install bundle or the image (`MINIBRAIN_DUCKDB_EXTENSION_REPOSITORY` pointing at it), and
  `minibrain extensions install --from <folder or internal mirror URL>` installs it. A missing extension is installed
  from that local folder on first use; never from a URL at run time. DuckDB still checks each extension's signature
  when loading it. Updating DuckDB means downloading the set for the new version (paths are versioned, so both can
  sit side by side). `minibrain extensions` and Settings → Connections show what is installed, and a source that needs
  a missing extension names it and the install command.
- Air-gap test in CI: the M1 flow runs in a container with networking disabled.
- Updates: signed bundles for the app and for new base models, carried across the gap by disk. Verified offline before
  install; the previous version stays installed for rollback. Bundles reuse the release's blob signing: one
  `.sigstore.json` per bundle, checked offline with Sigstore's trusted root.

## Security and accreditation

v1, the evidence regulated buyers ask for first:

- SBOM (CycloneDX) for every image and Python dependency set. Built: CI uploads Python (uv export from `uv.lock`)
  and web (syft from `web/pnpm-lock.yaml`) SBOMs beside the wheel; each release adds an SBOM per image (syft against
  the image it pushes), attached to the release and attested on the image. Details: `docs/security/supply-chain.md`.
- AI bill of materials per version: base model weights hash, license, training dataset version hash, recipe, eval result.
  Built: a deterministic CycloneDX 1.6 ML-BOM per version (`aibom.json`, Download AI-BOM on the model card) with
  the adapter's SHA-256, the sources' fingerprints and its own SHA-256, validated against the schema in tests.
- Signed images and update bundles (cosign), verified offline. Built for releases: keyless Sigstore signing from the
  release workflow (OIDC identity, Rekor; no long-lived key), a `.sigstore.json` bundle per release file, signatures
  on every image digest, SBOM attestations and SLSA provenance (`actions/attest`). Offline checks use the bundle and
  Sigstore's trusted root carried across, not a shipped key. Update bundles not yet. Details: `docs/releasing.md`.
- Audit log: append-only and hash-chained so tampering shows, exported to the customer's SIEM over syslog. The
  chain has to survive retention: a prune is itself an audited event that carries the hash it cuts at. Built: the
  leader seals each event with a sequence number, the previous hash and the SHA-256 of its canonical form (so
  out-of-order commits on Postgres just seal later); `minibrain audit verify`, `GET /api/audit/chain` and the Audit log
  page report the first break; SIEM export is RFC 5424 over TLS, TCP or UDP with a stored cursor. Format, canonical
  form and guarantees: `docs/security/audit.md`.
- Encryption at rest for dataset versions, staging files and adapters. Built: every stored file (uploads, dataset versions,
  adapters, logs, staging databases, base weights in a bucket; local folder or S3 bucket) is sealed with its own
  AES-256-GCM data key in a chunked STREAM format, wrapped by a master key from a local key file (default), HashiCorp
  Vault Transit, a PKCS#11 HSM or AWS KMS (FIPS endpoints); content hashes stay over the plaintext. DuckDB reads sealed
  files through a decrypting filesystem, so main keeps no plaintext copies; workers, engines and gateways keep plain
  working copies.
  `minibrain keys status | rotate | encrypt-existing` and Settings → Security re-wrap headers without re-encrypting
  bodies and encrypt older files in place. Format, providers and measurements: `docs/security/encryption.md`,
  `docs/security/key-providers.md` and `docs/notes/security.md`.
- Engines answer only main and gateways: a per-pool call token on every call, so nobody on the GPU network skips API
  keys, safety models and request logs, drains an engine or unloads its adapters, and one pool's machines cannot call
  another pool's engines (see Serving).
- Model card and validation report generated per version from the eval data: purpose, data, metrics, limits, who
  promoted it. This is the model-risk documentation US banks owe under SR 11-7.
- PII and PHI handling as in Data; access to every model is scoped and audited.
- SSO: OIDC and trusted proxy headers (see API and access).
- FIPS-ready design, so FIPS mode in v2 is a build setting, not a rewrite:
  - SHA-256 for every content hash and signature; never MD5 or SHA-1 (ruff `S324` in CI).
  - Non-security hashing (MinHash) passes `usedforsecurity=False`.
  - All crypto through OpenSSL or the `cryptography` library; nothing hand-rolled. Native code that brings its own TLS
    stays off the network: DuckDB's delta extension (rustls and ring in delta-kernel-rs) reads Delta tables from
    server folders only, while httpfs does S3 and Iceberg TLS through OpenSSL (`docs/security/network.md`).
  - Base images that can run in FIPS mode (Red Hat UBI).
  - Enforced in CI and `mise run check` by ruff `S324` and `scripts/check_crypto.py` (tested in
    `tests/test_check_crypto.py`), which fails on: MD5, SHA-1 or BLAKE2 through `hashlib` without
    `usedforsecurity=False`; HMAC or PBKDF2 with anything but SHA-256; scrypt; imports of PyCryptodome, PyNaCl,
    bcrypt, argon2, passlib, `rsa`, `ecdsa` and other crypto outside OpenSSL and `cryptography`; `cryptography`'s
    non-approved primitives (MD5, SHA-1, BLAKE2, ChaCha20, the `decrepit` module); `random` feeding a token, secret,
    password, salt, nonce or API key (`secrets` does that); in `web/`, SHA-1 or MD5 literals (Web Crypto included)
    and JavaScript crypto libraries (crypto-js, tweetnacl, noble, node-forge, the md5 and sha1 packages). The same
    library lists are checked against `uv.lock`, `web/package.json` and `web/pnpm-lock.yaml`, so no dependency
    brings one in transitively.

v2, for defense and critical infrastructure:

- FIPS 140-3 validated crypto mode: FIPS-enabled images, test suite run in FIPS mode.
- Hardened images: DoD STIG, Iron Bank listing.
- Native SAML and CAC / PIV login, if customers' proxies are not enough; roles by team.
- Control mappings: CMMC / NIST 800-171, NIST 800-53, HIPAA.

## CI

GitHub Actions (`.github/workflows/ci.yml`) on every branch push and pull request; no secrets, and tests make no
outbound calls.

- Python, on 3.12 and 3.13: `uv sync --locked`, ruff, ruff format, `scripts/check_crypto.py`, pyright, pytest. The
  mlx and llama.cpp extras are not installed on Linux, so pyright reports their imports as warnings, only in the three
  files that use them (`executionEnvironments` in `pyproject.toml`).
- Both stores: tests marked `both_stores` (uploads, dataset versions, adapters, logs, deletes, key passes) run twice,
  on the folder and on an S3 bucket. The bucket is moto's `ThreadedMotoServer`, started once per test run on
  127.0.0.1 with a random port, a fresh bucket per test; `uv run pytest -q` runs both, offline, locally and in CI.
  Base weights in a bucket (downloads, imports, signed links, working copies, verify, repair, delete) have their own
  tests on the same server.
  moto is a dev dependency only (`moto[s3]` with flask, not its heavy `server` extra) and never ships. If moto's
  fidelity falls short of a real server, the next step is a nightly job against a real S3-compatible server (SeaweedFS
  or MinIO); there is none yet.
- Web: `pnpm install --frozen-lockfile`, Biome, `tsc`, `vite build`.
- Wheel and sdist, once both pass: `uv build` with the built UI inside both, uploaded as the `minibrain-wheel` and
  `minibrain-sdist` artifacts.
- Releases: a `v*` tag runs `.github/workflows/release.yml`, which calls this workflow (`workflow_call`), builds the
  CPU and CUDA images for amd64 and arm64 from its wheel, signs and attests everything keyless with cosign, and
  publishes the images to GHCR and the wheel, sdist, SBOMs, `install.sh`, `SHA256SUMS` and their Sigstore bundles to
  GitHub Releases; `workflow_dispatch` is a dry run. Details: `docs/releasing.md`.
- ShellCheck on `install.sh` and `scripts/*.sh`.
- `mise run check` runs the same checks locally; change both together.
- Third-party actions pinned to full commit SHAs; uv, Node and pnpm versions fixed; uv and pnpm caches on.

## Platforms

Two modes, same code, same adapter format (PEFT safetensors).

| | Local | Production |
|---|---|---|
| OS | Linux, macOS, Windows | Linux |
| Install | Native via uv (Docker on macOS has no GPU access) | Docker image + compose, or the Helm chart on Kubernetes; OpenShift in v2 |
| Compute | PyTorch picks CUDA, ROCm, MPS, Intel XPU or CPU | NVIDIA CUDA; AMD ROCm in v2 |
| Training | Same TRL/PEFT code; LoRA in fp32 on MPS or CPU, sized by the planner (~2B on a 16 GB Mac) | LoRA or QLoRA, picked by the training planner |
| Serving | `transformers` backend, PEFT multi-adapter | SGLang pool |
| Teacher | The base model itself, a larger compressed model if memory allows, or an opt-in API | Larger local model on its own pool |
| For | Evaluating, developing, small teams | Real workloads |

- `uv pip install --torch-backend=auto` (or `UV_TORCH_BACKEND=auto`) picks CUDA, ROCm, Intel or CPU wheels. Docker
  builds have no GPU, so they set `UV_CUDA_DRIVER_VERSION` or `UV_AMD_GPU_ARCHITECTURE`, otherwise they get CPU wheels.
- Engine auto-select, per engine process: Linux + CUDA or ROCm + SGLang → `sglang`; Apple silicon + `mlx-lm` → `mlx`;
  GGUF weights → `llamacpp`; otherwise `transformers`. `--engine` overrides; a failed automatic choice falls back to
  `transformers`. SGLang pins its own torch, so it runs from its own environment (`MINIBRAIN_SGLANG_PYTHON`).
- SGLang on Windows: WSL2 only. SGLang's own MLX backend is not used; minibrain drives `mlx-lm` directly.
- MPS gaps fall back to CPU with `PYTORCH_ENABLE_MPS_FALLBACK=1`.
- Local training falls back to CPU when the Metal GPU hangs. Seen in the spike: LoRA backward on an M1 Pro (macOS
  27.0.1, torch 2.15) hangs the GPU within 3–8 steps, while inference runs fine. CPU training there was only ~1.8×
  slower. MPS trains one example per micro-batch with gradient accumulation, which does not hang there; a GPU error
  or a step that takes ten times the slowest one so far (at least 3 minutes; 15 for the first) starts the job again
  on the CPU, and it stays there.
- Tests run on the `transformers` backend with a ~0.5B model; integration tests run on a GPU box.
- `llamacpp` serves GGUF base models (Metal, CUDA, CPU). Adapters on llama.cpp need PEFT → GGUF conversion: later.

### Non-NVIDIA hardware

| Hardware | Status |
|---|---|
| AMD Instinct MI300X / MI325X / MI35x | Second production target. PyTorch, PEFT and TRL run on ROCm; SGLang ships ROCm images and runs LoRA tests in AMD's CI on MI325X / MI35x. Verify LoRA on MI300X before promising it |
| Apple Silicon | Local only |
| CPU | Local only, tiny models |
| Intel GPUs (XPU) | Local, through PyTorch XPU |
| Intel Gaudi 3 | Separate trainer (optimum-habana) and vLLM plugin. Skip |
| Google TPU, AWS Trainium / Inferentia | Cloud VPC only, separate stacks reachable through vLLM. Skip |

### Production hardware

- 8B student, planner estimates at 160-token rows and an effective batch of 16: LoRA in bf16 ~32GB at micro-batch 8
  (~20GB with checkpointing), QLoRA with checkpointing ~10GB; serving ~16GB weights plus KV cache.
- Teacher: ~30B class ~32GB in FP8 or ~64GB in bf16; ~70B class ~40GB in 4-bit; plus KV cache.
- Minimum: one 80GB GPU. A live 8B engine holds about 24GB of it and training runs beside it in the remaining
  ~48GB (Serving › GPUs on one machine); a run that does not fit waits for the GPU. Recommended: two (teacher and
  training on one, serving on the other) so prompt-only versions stay up.
- Reference configs: 2–3 tested servers (1× 80GB, 2× 80GB, 8× for many models), each with exact driver, CUDA and
  image versions. A preinstalled appliance comes later.

## Milestones

### M1: one task, end to end

- One task type: Extract or Classify
- Sources: Postgres, files
- Golden set, prompt-only version 0 on the base, data that already has answers
- Training; eval vs base with cost and latency; promote
- `transformers` and `sglang` backends
- Gateway: chat completions, `response_format`, scoped API keys

### v1

Everything in the v1 scope below, after M1.

v1 names a scope, not a version number (2026-11-27). Releases stay 0.x while the scope is built. 1.0.0 comes later:
once everything in the v1 scope is done and real users have run it for a while, since 1.0.0 is the promise that the
API and the data survive upgrades.

### Large datasets

Small, curated fine-tunes stay the default path. This milestone makes training scale to datasets that do not fit in
memory or on one GPU: continued pretraining on a domain corpus (billions of tokens), instruction tuning or distillation
on 100k to millions of examples, classification or extraction over millions of rows. The data side (DuckDB over
Parquet, S3 and Postgres, dedupe, dataset versions) already scans millions of rows; training does not yet: it loads
every row into memory (`Dataset.from_list`), defaults to 3,000 rows and runs on one GPU.

1. Streaming training data: the dataset version is written as sharded Parquet in the object store and streamed into
   training, with packing (short examples joined into full-length sequences), so memory does not grow with the data.
2. Multi-GPU on one machine with FSDP or DeepSpeed ZeRO, planned by the training memory planner like LoRA and QLoRA
   are today.
3. Multi-node through Ray (v2).
4. Full fine-tuning and continued pretraining as methods, with a data mix (the corpus plus general text) to limit
   forgetting; a full fine-tune produces new base weights, stored and hashed like Make base model.
5. Checkpoints every N steps to the object store and resume from the last one, so a days-long run survives a crash or
   a lost node.
6. An estimate before starting: tokens, GPU hours and finish time on the chosen machines, shown before the run is
   queued.

Order: 1 and 2 together, then 5 and 6, then 3 and 4.

## v1 scope

- [x] models: create, list, select, delete
- [ ] Task types: Classify, Extract, Rewrite, Text-to-SQL, Answer (the engine, General, Classify and Custom done;
      the rest come as presets)
- [ ] Index per model: chunks, local embeddings, hybrid search, incremental sync, per-user access filter,
      citations
- [ ] Golden set authoring; eval-first flow
- [x] Prompt-only version 0 on the base at creation (on the teacher pool in v2)
- [ ] `response_format` with `json_schema` (built: SGLang gets EBNF or `json_schema`, llama.cpp grammars, MLX and
      `transformers` token tries for labels and finite schemas, every JSON answer checked in the gateway; llama.cpp,
      MLX and `transformers` verified on Qwen3-0.6B, SGLang only against a fake process: verify on a GPU box)
- [ ] Cost and latency in eval (p50 / p95, GPU time and cost per 1M tokens priced per pool, and the headline
      against v0 on Evaluations and model cards done; list price for API teachers waits for the teacher pool, and
      "no training needed" for `target.min_score`, which does not exist yet)
- [ ] `minibrain.yaml` and `minibrain run`
- [x] Sources: uploads, server folders, S3, PostgreSQL, MySQL and Lakehouse tables via DuckDB (Iceberg on S3; Delta
      Lake from server folders only, as its S3 reads use TLS outside OpenSSL), through connections with encrypted
      write-only secrets; DuckDB extensions, delta included, installed offline and baked into the image
- [ ] Auto-mapping proposal, mapping editor compiled to SQL, SQL editor (column picker and SQL over several sources
      done; CodeMirror editor and auto-mapping not yet)
- [ ] Built-in steps: `strip_html`, `chunk`, `pii_scrub`, `dedupe_near` (`generate_qa` in v2)
- [ ] Preview of 5–10 examples as chat transcripts (the preview shows the query's first 20 rows as a table, with
      label counts; chat transcripts not yet)
- [ ] Quality score and PII report (version checks with pattern-based PII done; Presidio and near duplicates
      not yet)
- [x] Dataset versions: content-hashed Parquet copies saved when a dataset is created or updated, picked at training
      time; derived splits, row limit, diff, retention
- [x] Artifact store on a local folder or an S3-compatible bucket
- [x] Job contract: jobs table with leases, workers over HTTP, retries with backoff, cancel, events over SSE
- [x] Artifacts by SHA-256 ID; Alembic migrations from one baseline; `MINIBRAIN_DATABASE_URL`
- [ ] Base model registry, default recipe, chat template parity tests
- [ ] Training memory: LoRA or QLoRA (bitsandbytes), gradient checkpointing, 8-bit optimisers and a fitted sequence
      length, chosen per run by the planner, with overrides stored on the version (built and measured with LoRA on
      MPS and CPU; QLoRA and the CUDA estimates: verify on a GPU box)
- [x] Base model health: saved SHA-256 file list, verify, repair, re-import, relocate, failure states with one action
      each, adapters pinned to their base's content hash
- [x] Base models stay on disk until deleted; deleting removes their files, and a base with models built on it goes
      with them after the cascade checkbox
- [x] Eval against the base (a prompt-only version on it, scored on the same held-out rows), side-by-side review,
      deploy any version at any step, rollback; against a teacher waits for the teacher pool
- [ ] SGLang pool with runtime adapter load/unload (built; tested against a fake SGLang process, verify on a GPU box)
- [x] Catalogue by rules: approved publishers, all generations, size tiers, built at release, no runtime Hugging Face
      calls, optional sync from our catalogue URL; Add from Hugging Face with support badges
- [x] Security policies under Settings: network, model sources, licences, safetensors only, request inputs and answers
      (default and lock), log retention, key expiry; config-locked values; audited; enforced in the backend
- [x] Compute pools with hardware reported by workers and engines; fit per pool in Discover
- [x] Engines chosen per node (SGLang, MLX, `transformers`, llama.cpp); remote engines join pools
- [x] Gateway routing across replicas: least in-flight, sticky, overflow, health checks
- [x] Several mains on Postgres with an advisory-lock leader for background loops
- [x] `transformers` backend for local mode and tests
- [x] Gateway: chat completions with streaming, models, `name@version`, scoped API keys, batched request logs; serves
      from a versioned config snapshot, standalone role, engines as supervised children with LRU adapters
- [x] Gateway: `/v1/completions` (raw prompt, every engine, streamed, logged as `completion`)
- [ ] Gateway: `response_format`, per-model request bodies, retrieval context step (`response_format`, response ids
      on request logs and per-model request inputs and answers done)
- [x] Monitor → Requests: live `/v1` request log, server-paged, with filters and a summary, finish reasons recorded
      and a detail with the kept input and answer (Builder and up) and linked feedback
- [x] Request metadata always logged; request inputs and answers kept per model, with an install default and an admin
      lock
- [x] Monitor → Overview (first tab): requests per minute, error rate, p50 / p95 latency and tokens by model (top 5
      and Other) in buckets sized to the range, a per-model table, live with Pause; SQL checked on SQLite and Postgres
- [x] OpenTelemetry export, opt-in: OTLP over HTTP/protobuf to the customer's collector only; a GenAI-convention span
      per `/v1` request and duration, token, request, queue and worker metrics; settings as policies with
      write-only encrypted headers, `OTEL_EXPORTER_OTLP_*` honoured (checked against OpenTelemetry Collector 0.130)
- [x] Prometheus `/metrics`, off by default, by scrape token or scrape addresses, no session (scraped by Prometheus 3.5;
      `promtool check metrics` passes)
- [x] JSON logs on standard output (`MINIBRAIN_LOG_FORMAT=json`) with request and response ids; `X-Request-ID` on every
      response
- [ ] Grafana dashboard (`docs/grafana/minibrain.json`; imports into Grafana 12 and its queries run against
      Prometheus, not yet looked at with real traffic)
- [x] Playground
- [x] Harness config export: curl, Python, JavaScript, .env, LangChain, LlamaIndex, LiteLLM, Continue, Open WebUI
- [ ] Login: local accounts, OIDC, trusted reverse-proxy headers; sessions; always on, with the first admin from a
      one-time setup link, the environment or single sign-on (built; OIDC tested against a fake provider: verify on
      Entra, Okta, ADFS and Keycloak and behind a real proxy)
- [x] Roles: Admin, Builder, Viewer enforced per route; group-to-role mapping; Settings → Accounts
- [x] FIPS-ready crypto rules enforced in CI: ruff `S324` and `scripts/check_crypto.py`
- [x] Local install via uv on Linux and macOS
- [ ] Local install via uv on Windows (documented in `docs/install/python.md`; not verified yet)
- [ ] Production Docker image, CUDA 13.2 with a CPU variant and the DuckDB extensions baked in (built for amd64 and
      arm64 and started without a GPU; verify on a GPU box)
- [x] Wheel ships the built UI: `uvx minibrain serve` needs no Node
- [x] Developer tasks in `mise.toml` (setup, dev, check, build)
- [x] CI on every push: the `mise run check` checks, then build the UI and the wheel
- [ ] docker-compose for one VM: main, gateway, a worker and an engine on one GPU host, Postgres optional, volumes for
      `MINIBRAIN_HOME`, the same images as Helm
- [ ] Helm chart for Kubernetes: main (one replica on SQLite, several on Postgres), gateway (scalable, behind an
      Ingress), workers and one engine Deployment per pool with GPU requests, node selectors and tolerations,
      `replicas` per pool in values, storage as a PVC or S3, secrets from Kubernetes Secrets, and an air-gapped values
      file pointing at a private registry. The customer scales with `replicas` or their own autoscaler; minibrain
      creating pods itself is the Kubernetes launcher in v2
- [x] Releases: wheels on GitHub Releases, then PyPI or a private index; Docker image built from the same wheel
      (`release.yml` on `v*` tags puts the wheel, sdist, SBOMs and `SHA256SUMS` on GitHub Releases, CPU and CUDA
      images for amd64 and arm64 on GHCR installing that same wheel, and the wheel on PyPI; v0.1.0 and v0.1.1 shipped
      this way. No private index)
- [x] Install docs for `uvx`, `uv tool install`, `pip install` and Docker: `docs/install/`
- [x] `curl … | sh` installer (`install.sh`): the release wheel with uv and the right torch backend, checked against
      `SHA256SUMS` and, with cosign, its signature; `--docker` pulls the image (tested on macOS, Debian 13 and
      Ubuntu 24.04 against dry-run files; not yet against a tagged release)
- [x] Python 3.13: allowed in `requires-python`; CI tests 3.12 and 3.13
- [x] Switch base: per model, live traffic stays on its own base until a version on the new one is deployed
- [ ] Rebase: rebuild every model on a new base model, compare, promote
- [x] Feedback endpoint (`POST /v1/feedback`, scoped keys, input required unless kept), thumbs and "Correct it"
      in the playground → review queue; accepted rows join the next version's training data; "Train with feedback";
      Save as test example in the Playground → held-out rows of the next version's data
- [ ] Review queue for domain experts: plain language, assignment, reviewer agreement (plain language,
      Assign to me, keyboard review and disagreement first done; agreement between reviewers not yet)
- [x] SBOM, AI bill of materials per version, signed images (Python and web SBOMs in CI, image SBOMs per release,
      the per-version AI-BOM, and keyless cosign signatures, SBOM attestations and SLSA provenance on every image and
      release file; ran for real on the v0.1.0 and v0.1.1 tags)
- [x] Audit log page: filters, server-side paging, CSV and JSONL export, retention policy, client address
- [x] This install page with a diagnostics zip that never carries secrets
- [ ] Problems (added 2026-11-17): `GET /api/problems` computes what needs attention from current state on each request
      (no table, no per-user state), filtered by role and by scope (`infrastructure`, `model`, one model): live models
      with no running replica and failed engines (critical), then low disk on main and on machines, library versions
      that differ from main, training that failed in the last 24 hours and offline machines (warnings; past a day,
      admins get Remove). One Health panel shows it, same-kind problems grouped on one line, four lines
      then Show all. Done on Infrastructure › Machines, the model page and Home (per-area checks since 2026-11-24)
- [x] Hash-chained audit log with SIEM export; encryption at rest: hash chain sealed by the leader, prune anchors,
      verify in the UI, API and `minibrain audit verify`, RFC 5424 syslog over TLS, TCP or UDP; every stored file
      under its own AES-256-GCM data key wrapped by a local key file, Vault Transit, a PKCS#11 HSM or AWS KMS, with
      rotation and in-place encryption of older files (Vault tested on 1.20.4 dev, HSM on SoftHSM 2.7.0, KMS on moto;
      not yet on a production HSM or real AWS KMS; worker, engine and gateway caches stay plain)
- [x] Model card and validation report per version: in-app page, Markdown and JSON with a SHA-256 of the canonical card, editable intended use and known limits (audited)
- [x] Export a version as a merged full model (safetensors): an `export` job merges the adapter into the base with
      PEFT on a worker that fits the base (bf16 on a GPU, fp32 on a CPU or Apple GPU), packs safetensors, the tokenizer,
      the generation config and SHA256SUMS into one tar uploaded as an artifact; reused per version and base files,
      deleted with the version, audited when started and downloaded
- [ ] Reference hardware configs
- [x] PyPI publishing through Trusted Publishing (`release.yml`, environment `pypi`, steps in `docs/releasing.md`;
      v0.1.1 is the first release on PyPI)

### Before release (added 2026-11-17)

Each page gets a review pass (layout, empty, loading and error states, light and dark at 1024–1440px) and the fixes
it finds:

- [ ] Infrastructure: Machines, Storage, Setup
- [ ] Data: catalogue, sources, datasets, versions
- [ ] Monitoring: the global page and each model's Monitoring tab
- [ ] Feedback page
- [ ] Evaluations: the global page and each model's Evaluation tab
- [ ] Home page
- [ ] Playground
- [ ] Settings: every section checked against what it controls
- [ ] Light mode fixed across the app: every page, dialog and chart checked and corrected in light, not only dark
- [ ] Security review: auth, roles, joining, worker and engine tokens, secrets, audit; an outside review if possible
- [x] Free checks on GitHub (2026-11-27): CodeQL code scanning on every push, Dependabot alerts, secret scanning with
      push protection, private vulnerability reporting and `SECURITY.md`
- [ ] Dependency audit in CI: `pip-audit` on the locked Python packages and `pnpm audit` on the UI, failing on a
      known vulnerability that has a fix
- [ ] Image scan at release: Trivy or Grype on the CPU and CUDA images, the result published with the release
- [ ] Abuse tests of our own, run in CI: every `/api` route against each role, the SQL sandbox, connections and
      imports pointed at internal addresses, path traversal on artifacts and server folders, join and call tokens
- A paid penetration test is not a v1 gate: commission one when a customer asks for the report
- [ ] Documentation: install, first model, joining machines, training, serving, API, security, upgrades
- [x] Logo and icon set: the Volt badge with the bolt-split brain (`web/src/components/brand/mark.ts`), the favicon in
      the app and on getminibrain.com
- [x] Website: product page, docs, install, contact (getminibrain.com in its own repo, served by Cloudflare since
      2026-11-27, with release email signups through Resend)
- [x] Core journey end to end on a fresh install, scripted as a release check: `web/e2e/core-journey.spec.ts`
      (Playwright, Chromium; `mise run e2e`, and the CI job Core journey in a browser) takes the setup link, adds the
      demo travel intents, adds a model on Qwen3 0.6B with v0 scored, trains v1 (scored against v0), deploys it,
      creates a key on the model's API keys tab, calls `/v1/chat/completions` with it and checks Home's strip shows
      every step done. `scripts/e2e_server.py` runs main on a free port with a fresh `MINIBRAIN_HOME`, a fake serving
      backend and a worker whose download, train and score jobs are `scripts/e2e_jobs.py` (placeholder weights, v0 at
      60% and trained versions at 90%), so it needs no model download and no GPU
- [ ] A real GPU run: gpt-oss-20b serving and LoRA training on an NVIDIA box
- [ ] Backup and restore, tested and documented
- [ ] Licences: third-party notices, model licences shown before download, LICENSE and the CLA
- [ ] Release process: versioning, changelog, signed artefacts
- [ ] Deployment manifests: docker-compose for one VM and a Helm chart for Kubernetes
- [ ] Prometheus alert rules shipped with minibrain (main or gateway down, live model without replica, error rate or
      p95 over threshold, disk nearly full, machine offline, job queue backlog, audit chain broken), each with a
      runbook page
- [ ] Upgrades: rolling, zero-downtime (migrations both versions run against), a main/worker version-skew policy,
      and rollback
- [ ] Trace ids carried across main, gateway and engines in the JSON logs

### Review follow-ups (added 2026-11-24)

From the project review of 2026-11-24. Most bugs it found are fixed (Fixes); these are left.

- [ ] Rent an NVIDIA GPU for a day and run the core journey for real: SGLang serving with adapters, LoRA and QLoRA
      training, the CUDA image, gpt-oss-20b. Check the GPU split there: fractions honoured, two engines on one GPU,
      training beside a live model, planning again inside a share, device numbering under Docker `--gpus`.
- [ ] Real runs as a release gate, not only fakes: a GPU box, Postgres (CI job since 2026-11-24), two machines joined
      over a network, and the browser test (since 2026-11-24). Every bug the review found surfaced on first contact
      with the real thing.
- [ ] Upgrade test: install the previous release, add data and a model, upgrade to the new wheel, check it migrates,
      serves and trains. Releases are public now, so a migration that shipped in a release is never edited again.
- [ ] TLS between gateways and engines on other machines: the engine call token and request bodies cross the network
      in clear.
- [ ] Models larger than one GPU: tensor-parallel serving (SGLang `--tp`) and multi-GPU training (FSDP or ZeRO, Large
      datasets). Today an engine and a job each get one GPU, which caps the 30B to 120B sizes in Product priorities.
- [ ] A pinned version of a model that is not live (`name@2`) starts its engine on the first call and answers 503
      with `Retry-After` until it is up; say so in the API docs.
- [ ] The Playground and the model Test buttons still run on main's shared thread pool, outside the `/v1` limit.
- [ ] Undeploy then delete, with a base switch in between, may not wait for an engine on the old base.
- [ ] Windows (WSL) install verified.
- [ ] Measure time from install to the first scored and trained model, on a Mac and on a GPU box.
- [x] Decide: labels before more presets. Most new users have data without answers. Decided 2026-11-27: Upstream
      routes, Distillation data and labelling by a reference model are v1 (Added to v1, 2026-11-27). The Extract
      preset, then Rewrite, are built first, before Rebase (Order).

### Added to v1 (2026-11-26)

Gaps found against comparable platforms.

- [ ] Training methods: full fine-tuning, DPO from feedback pairs, GRPO with the graders as rewards (Task types).
- [ ] Models larger than one GPU (Review follow-ups) is v1, not v2: tensor-parallel serving and multi-GPU training on
      one machine. Multi-node stays v2.
- [ ] Reference models: GPT, Claude or Gemini scored on the same held-out rows, opt-in (Reference models).
- [ ] Live scoring and failure modes (Live scoring).
- [ ] General ability per version (General ability).
- [ ] MCP server (MCP server).

### Added to v1 (2026-11-27)

Moved back from v2: a team with no labelled data can still start, from the model it already calls.

- [ ] Upstream routes to a reference model: apps send their existing OpenAI-style calls through the gateway, which
      forwards them and logs the request and the answer (API and access).
- [ ] Distillation data: those logs as a dataset source for any preset, so a smaller model is trained on them and
      scored against the reference model on the same held-out rows (Labelling, Reference models).
- [ ] Labelling by a reference model: rows without answers get one from a reference model, with the task's prompt and
      output schema, then go to the review queue, uncertain rows first. Opt-in and off with `MINIBRAIN_OFFLINE=1`,
      like every use of a reference model; the page says those rows go to that provider, and each run is audited
      (Labelling).
- [ ] Usage statistics, on by default with one setting to turn them off (Observability › Usage statistics).
- [ ] Several mains share their tokens: today each main makes its own gateway and worker tokens in its home folder,
      so a second main needs `MINIBRAIN_GATEWAY_TOKEN` and `MINIBRAIN_WORKER_TOKEN` set by hand, and a bucket key
      saved in the UI lives on one main only. Keep them in the database, encrypted under the master key like
      connection secrets, so every main reads the same ones.
- [ ] The vLLM backend run on a GPU (moved from v2): built on 2026-11-06 and tested against a fake process; serve a
      base and load adapters at run time on the rented GPU day (Review follow-ups).

## v2

- Air-gapped installs (moved from v1 on 2026-11-20: air-gapped is an option, not the main audience; `MINIBRAIN_OFFLINE=1`
  keeps working in v1):
  - Offline install bundle and an air-gap CI test
  - Signed offline update bundles (app and base models) with rollback, reusing the cosign signing of release files
  - The offline bundle tested on an air-gapped machine, then an upgrade with rollback
- Teacher (moved from v1 on 2026-11-17; v1 trains on data that already has answers, or on answers logged from or
  written by a reference model):
  - Teacher pool, permanent or temporary; API teacher opt-in, off by default; prompt-only version 0 on it
  - Labelling by the local teacher (labelling by a reference model with the review queue moved to v1 on 2026-11-27)
  - `generate_qa` with check pass: documents into checked question and answer pairs
  - Distill from the local teacher: upstream routes to the teacher pool (routes to a reference model and their
    logs as training data moved to v1 on 2026-11-27)
  - Private frontier endpoint: the teacher model through the gateway, scoped keys
  - Synthetic data aimed at failure modes (Live scoring): the teacher writes new examples like a failure mode's,
    checked by the graders, a sample reviewed by a person; multi-turn tool-use conversations from a model's tools
  - On-policy distillation: the student answers, the teacher scores its tokens, and the student learns from its
    own answers, needing fewer rows than distilling logged answers
- Split into services: data, train, serve, gateway
- Adapters trained to answer from retrieved context and cite it
- dlt API connectors: Zendesk, Jira, Confluence, Salesforce, HubSpot
- One-click retrain on new data (dlt incremental)
- Automatic retrain when feedback since the last version crosses a threshold
- Version diff (scores; the data diff is done)
- Notifications: an inbox and a bell in the top bar over the v1 problems (`GET /api/problems`) plus failed jobs,
  results ready to review, models that need examples and missing files; read and unread, snooze and acknowledge per
  person, history of what was raised and cleared, and delivery by email (SMTP) and webhooks
- Global search (⌘K) in the top bar, built with it, projects and notifications: jump to models, versions, datasets,
  sources, jobs, settings and pages, and run actions (Add model, Upload data, Create key, Deploy vN). One `/api/search`
  returns only what the caller's role may see; logs match by title, ID and status, never by content. Page searches
  (Models list, Data tree) stay and filter in place. The palette is an obp-ui component.
- Batch jobs (Run → Batch jobs): run a version over a file, dataset version or SQL query in the background, on the job
  worker; resumable, with progress; results as CSV or Parquet with inputs, outputs and the version; OpenAI-compatible
  `/v1/files` and `/v1/batches`
- Preset recipes
- Arbitrary Python transforms (admin-only, sandboxed)
- Teams, sharing
- Multi-node training (Ray) and serving pools across nodes; multi-GPU on one machine is v1
- Launchers: Kubernetes (training as Jobs, engine replicas as autoscaled Deployments), Slurm, and cloud VMs
  started for a run and stopped after it
- Guided setup: describe the task in plain language or point at a table; a model on this install proposes the
  preset, mapping, graders, base and recipe, runs version 0 and the first training, and stops for a person's
  approval at each step. It never deploys on its own (replaces Start from data)
- Agents: score and train multi-turn tool-use conversations; bring your own harness (an app's agent loop calls
  `/v1` and minibrain records and scores the whole conversation); GRPO in environments the customer defines
- Hyperparameter search: a few runs over learning rate, rank and epochs, chosen by Bayesian search within a GPU
  budget, the best on held-out rows kept
- Vision-language models: images in datasets, the Playground and `/v1`; LoRA on vision bases
- sgl-router per pool under the gateway for many SGLang replicas of one model; llm-d on Kubernetes
- AMD ROCm production image, LoRA adapters on llama.cpp (the vLLM backend run on GPUs moved to v1 on 2026-11-27)
- Dedicated or merged-adapter instances for high-traffic models
- Optional MLflow
- FIPS 140-3 mode, STIG / Iron Bank images, native SAML + CAC / PIV, control mappings
- OpenShift certification (the Helm chart ships in v1)
- [ ] OCI / container registry model sources (Harbor, Quay; KitOps ModelKits)
- [ ] Catalogue export/import and model bundles for air-gapped sites — only if needed
- [ ] Import GGUF models (llamacpp backend) and standalone LoRA adapters
- [ ] Export a version merged and quantised as GGUF via llama.cpp (`convert_hf_to_gguf` and `llama-quantize`),
      packaged per platform for offline installs; the Export dialog lists it as Coming soon (moved from v1 on
      2026-11-17)
- [ ] Export a version merged and quantised as AWQ, GPTQ or FP8 for vLLM and SGLang
- [ ] Public catalogue page on the website (browse, pinned revision, checksums, download command)
- [ ] Security overview and architecture overview as PDFs on the website, for a buyer's security and architecture
      review: generated from the docs at each release, never written by hand, stamped with the version and date,
      linked from the Security page and not behind a form (added 2026-11-27)
- Preinstalled appliance
- [ ] Release a reserved name: an admin frees a deleted model's API name from Settings, with a warning that apps
  still calling it will reach the next model to take it, audited as `model.name_release`
- Later, kept simple until the engine settles:
  - [ ] Pick the base from a chart: train two or three bases at once, plot quality against cost and latency
  - [ ] Recipes: worked use cases, designed properly later.
  - [ ] Shadow mode: copy live requests to a new version, grade both, promote only if it wins
  - [ ] Change a model's dataset: re-point a custom model to another dataset, built only if users ask; Duplicate
    covers it until then
  - [ ] Continue from a version: train the next version on top of a chosen version's adapter (warm start) instead of
    fresh from the base, picked per run ("Continue from v4"); the version records what it started from, and the
    promotion rule still guards the result. Comes first: it is how most people improve one model
  - [ ] Make base model: merge a custom model's live version into new full weights (SHA-256 hashed, stored like any
    base) and list it as a base, e.g. "guy1 v4 (base)", built from guy1 v4 on Qwen3 0.6B, for a house model that
    several specialist models build on. Always an explicit action, never automatic: a version that wins its own task
    can be worse at chat. It keeps the original base's licence and naming rules (Llama requires "Llama" in the name),
    costs full disk and its own GPU memory where adapters share one loaded base, and its lineage shows on its model
    card
  - [ ] MLX training on Macs behind a flag, only if MPS training is too slow for local use: a second trainer plus an
    MLX-to-PEFT adapter converter, so Mac-trained adapters still serve on SGLang and vLLM

## v3

- [ ] Managed compute (minibrain Cloud): GPUs run by us, added from "Add compute" like any pool, for teams without
  hardware. Opt-in per install, never the default: installs stay self-hosted and air-gapped by default, and the UI says
  plainly that data and weights leave the customer's network when a managed pool is used. Jobs and deployments place
  onto it with the same pool rules; usage is metered per pool.
- [ ] Keyboard shortcuts `[` and `]` for previous and next version on the version page.

## Fixes

Known defects and leftovers, smallest first. No users yet, so leftovers are deleted rather than kept.

- [x] The GPU split capped a live engine at its serving memory plus a quarter of its weights even alone on a GPU
  (about a third of the KV cache SGLang's default gave), training only planned within its share and was not held to
  it, and a training job waited for its fastest plan, so beside a live model on one GPU it never started. An engine
  now takes its whole GPU except a training reserve on the machine's last idle GPU, a GPU job is held to its grant
  by PyTorch, and a training job waits only for its smallest workable plan (2026-11-24).
- [x] A fresh install on Postgres stopped at migration 0008: migrations 0008, 0010, 0011, 0015, 0016, 0019, 0021 and
  0038 rebuilt their table (`batch_alter_table(recreate="always")`, SQLite's way to change columns and foreign keys),
  and Postgres refuses to drop `jobs_pkey` while other tables point at it. On Postgres they now run plain `ALTER
  TABLE`s, and 0008 swaps the `ON DELETE` of `jobs.model_id`, `jobs.version_id` and `request_logs.model_id` by
  dropping and re-adding `<table>_<column>_fkey`; SQLite keeps the rebuild, so its schema and the dev databases do
  not change. `tests/test_schema.py` also migrates an empty Postgres to head, and down to base and up again, and
  checks columns, types, defaults, foreign keys with `ON DELETE`, indexes, uniques and checks against the ORM. CI
  runs it and the other `needs_postgres` tests against a `postgres:17` service (2026-11-24).
- [x] Where a model is deployed was stored twice, as the same columns on `models` and `base_models` (`deployed`,
  `pool`, `replicas`, `moving_from`, `moving_since`, `move_failure`, plus `models.deployed_base`), so the gateway
  config, placement, pool moves, teardown, the deploy endpoints, problems and the model rows each read both. One
  `deployments` row per deployed custom or base model now holds it (owner `model_id` or `base_model_id`, one of the
  two, unique per owner; `base` is what a custom model serves with no version live); deployed means the row exists,
  and every reader and writer goes through `minibrain/models/deployments.py`. Migration 0039 copies the rows and
  drops the columns. Teardowns stay their own table: they also cover deletes and outlive the deployment (2026-11-24).
- [x] `/v1` calls held a thread of main's shared pool (about 40) for their whole generation, up to 300 s, or up to
  600 s while an engine started, so a burst of model traffic could stall the UI, worker check-ins and lease renewals
  until 60 s job leases ran out. Chat and text completions now run on their own bounded threads
  (`MINIBRAIN_GATEWAY_CONCURRENCY`, 64), streams included; a call past the limit gets a 503 with `Retry-After` at
  once, and one to an engine still starting gets one after 5 s. Standalone gateways do the same (2026-11-24).
- [x] Nothing divided a machine's GPUs between engines and jobs: SGLang and vLLM started with their default memory
  share and no `CUDA_VISIBLE_DEVICES`, training and scoring loaded onto the first GPU, and GPU job slots counted
  jobs, not engines, so a second engine or a training run next to a live model ran out of memory and restarted in
  a loop. Each engine and GPU job on an NVIDIA machine now gets its own GPU, or a share sized to its model, with
  `CUDA_VISIBLE_DEVICES` and an explicit memory fraction; a job with no room stays queued and says why
  (2026-11-24).
- [x] Engines answered `/generate`, `/drain` and `/health` without any credential, so anyone who could reach an engine
  on a joined machine (`--engine-bind 0.0.0.0`) could skip API keys, safety models and request logs, or unload
  adapters. Every engine endpoint now needs a call token for the engine's pool, derived from the gateway token;
  main, gateways and teardown drains send it, and anything else gets 401 and runs nothing (2026-11-24).
- [x] Create model made a free-text model when clicked while the Output field was still reading the dataset's answers:
  the suggested labels were dropped without a word (the core journey test hit it under load). Create now waits for
  the suggestion (2026-11-24).
- [x] Train vN ignored a click made while its plan was still loading: nothing started and nothing said why (the core
  journey test hit it). The button is now disabled until the plan is in (2026-11-24).
- [x] Engines for models that were not live never stopped: every ready version has a pinned route, so main counted its
  base as needed and the idle stop never applied. Main now keeps engines running only for live models (and their
  safety models); the rest start on the first request and stop after 15 minutes idle (2026-11-24).
- [ ] `test_long_polls_leave_threads_for_other_requests` is flaky in CI: `/api/jobs` took 2.98 s and 3.87 s (limit 1 s)
  in 2 of its first 4 runs, finishing only when the 3 s long polls did. It always passes locally, even with every CPU
  busy. Ruled out by slowing each step in turn: the gateway config rebuild and its lock, worker check-in, claims, and
  session-touch writes.
- [x] Switching the OS from dark to light with the page open left some Cobalt colours dark (`--input-background`):
  the preset is applied with obp-ui's `applyPresetStyle`, which clears every preset property before setting a mode.
- [x] Training on a Mac used the CPU: training now picks CUDA (or ROCm), Intel XPU, the Apple GPU, then CPU, in bf16 or
  fp16 where the GPU has it and fp32 on MPS, with the MPS fallback in Platforms.
- [x] Quantized bases in the bucket were not refused for training up front: the check read `config.json` from main's
  disk, which a bucket model may not have. It reads it through the store from the saved file list.
- [x] A local engine's first start included downloading its model, which could exceed the 600 s startup limit for very
  large models. Fetching the working copy is now its own step before loading, with progress (`docs/reference/how-serving-works.md`), and
  each file gets a fresh signed link.
- [x] Key rotation re-uploaded every bucket object whole, which is slow for large weights. It sends the new header and
  the first 5 MiB and the bucket copies the rest server-side (Artifact storage).
- [x] Deleted Copy to the bucket (moving bases from main's disk when Storage switches to S3) and the repair seed behind
  it; it only served older installs.
- [x] Deleted the job format version check that turned away older workers; there are no older workers.
- [x] Squashed the 42 migrations into one baseline, `0001_baseline.py`, that builds exactly the ORM schema
  (`tests/test_schema.py` compares them clause by clause) and seeds the audit chain head; the tests of single old
  migrations and the server defaults that only filled rows during them are gone. Reset `.minibrain` once.
- [x] Deleted every path kept for old installs: the `evicted` base status with Download again and its Re-import
  restore (`evicted_at`, `evicted_by` and the unused `pinned` column), the move of `secrets/master.key` and the
  `aesgcm1` secret format, the startup backfill of snapshot folders (`snapshots.directory`, `versions.adapter_dir`)
  and the non-Parquet guards, model-owned snapshots from before shared datasets (`snapshots.minibrain_id`,
  `minibrains.snapshot_id`) and `<home>/minibrains/<slug>`, the retired `request_logs` policy warning, the stamp for
  databases made before Alembic, audit labels for actions nothing records (`model.evict`, `model.remove_files*`,
  `settings.model_cache`) and the redirects for old UI links (`/m/<slug>`, `?minibrain=`, `/compute`,
  `/data/datasets/<slug>`, `/models?tab=discover`, `/profile`, `/preferences`).
- [x] Deleted inline secrets in `policy.otel_headers` and `auth.oidc.client_secret`: the headers are named with
  `secret_env` or `secret_file` (or `OTEL_EXPORTER_OTLP_HEADERS`), the client secret with `MINIBRAIN_OIDC_CLIENT_SECRET`
  or `client_secret_file`, and a value written in `minibrain.yaml` stops the start.
- [x] Deleted three routes no UI used: `POST /api/minibrains/{slug}/source` (uploading straight to a model, with its
  own replace-the-dataset rule; the UI uploads a source and picks a dataset), `GET /api/minibrains/bases` (the Models
  list replaced it) and `GET /api/snapshots/{snapshot_id}` (versions come from the dataset's list and the diff).
- [x] Renamed to what the UI says: `Minibrain` and the `minibrains` table are `Model` and `models` (a model you own),
  the old `Model` (base weights) is `BaseModel` and `base_models`, `minibrain_id` is `model_id` and a base's key is
  `base_model_id`. `/api/minibrains/{slug}/…` is `/api/models/{slug}/…`, `/api/models/base/{key}/…` is
  `/api/base-models/{key}/…`, the import routes are `/api/base-models/inspect` and `/api/base-models/import`, and the
  Models list (models you own and bases) is `GET /api/all-models`. Jobs carry `model` and `base_model`; gateway key
  owners are `model:<id>` and `base:<key>`, and a gateway config without `owners` is no longer read.
- [x] One models resource keyed by the API name (2026-11-12): `GET /api/models` lists both kinds as rows
  (`?kind=custom|base`), `GET|PATCH|DELETE /api/models/{name}` and `POST /api/models/{name}/deploy` take either kind,
  base-only actions are `/api/models/{name}/verify|repair|reimport|relocate|recheck|retry|test`, imports are
  `POST /api/models/inspect` and `/import`, and the page views are `/api/models/{name}/overview|traffic|activity`.
  `/api/all-models`, `/api/base-models/…` and `/api/model-pages/…` are gone.
- [x] "Snapshot" is "dataset version" in code, API and docs, as in the UI: the `dataset_versions` table and
  `DatasetVersion`, `dataset_version_id` on model versions, `/api/datasets/{slug}/versions`,
  `/api/models/{slug}/dataset-versions`, `/api/dataset-versions/{id}/diff/{other_id}`, the `dataset_version` job
  input and `data.keep_versions` in `minibrain.yaml`. Iceberg's snapshots, the catalogue snapshot and the gateway's
  config snapshot keep their names.
- [x] S3 locations differing only by a trailing slash counted as different sources; an S3 or Iceberg path is compared
  without its trailing slashes.
- [x] Prototype pages (`/proto/*`, such as `/proto/logos`) were reachable in production builds. Their routes are
  registered only in development (`import.meta.env.DEV`), and the build leaves them and their code out. Since
  2026-11-14 they are deleted (`web/src/pages/proto`): UX is built in the real product. `/proto/logos` came back on
  2026-11-20 for logo exploration, development only, and went again the same day once the logo was chosen.
- [x] Add model offered six tasks but only Classify works: the others are listed under Coming and cannot be picked.
  "Preview of 5–10 examples" is unticked (the preview is a table of rows, not chat transcripts) and "Eval vs base" says
  what it is (a prompt-only version on the base; no teacher yet).
- [x] Data → Uploads takes a dropped file: obp-ui's `DropZone` (dashed 1px edge, a quiet solid edge and fill while
  dragging, a Choose a file button), through the same duplicate and Replace / Keep both flow as the upload button.
- [ ] Training says it mixes in "a small general instruction mix to limit forgetting" (Training), but
  `minibrain/ml/train.py` trains only on the dataset version's rows. Add the mix: a pinned, licence-clean, bundled
  general instruction set (works air-gapped, hashed like any dataset version), sampled at a recipe share (default
  about 10% of rows, 0 to turn it off), recorded in the version's recipe and model card, and kept out of held-out
  scoring. Check on a chat base that general answers stay as good while the task score holds.

## Risks to verify early

- SGLang LoRA on ROCm, MI300X specifically.
- `transformers` backend throughput with several adapters; serialize requests if PEFT adapter switching is not safe
  under concurrency.
- DuckDB Postgres scanner load on customer databases: read replicas, `LIMIT`, materialize.
- MPS dtype and op gaps during local training; Metal GPU hangs in LoRA backward (seen on M1 Pro, macOS 27.0.1).
- Teacher quality on generated Q&A: track the check-pass drop rate per source.
- Banking77 on a GPU (`docs/findings.md` has the laptop run): the teacher as version 0, a 4B student on full data,
  SGLang with runtime adapters, constrained decoding to zero invalid labels, and cost per 1M tokens.
