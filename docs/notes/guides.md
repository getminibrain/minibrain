# Guides: notes for contributors

Unpublished. Content from the old `docs/models.md`, `docs/training.md`, `docs/serving.md` (Deployments on a pool,
Routing, Compute pools, Pool use) and the code that is true but too internal for the Guides pages
(`docs/guides/`). Verbatim where marked.

## Catalogue

From `docs/models.md` › Catalogue:

- Built at release by `scripts/build_catalog.py` from live Hugging Face metadata and bundled as a snapshot. At runtime
  minibrain never calls Hugging Face for the catalogue; the optional sync reads only our own catalogue URL
  (`MINIBRAIN_CATALOG_URL`).
- Rules: approved publishers (Qwen, Google, Meta, Mistral, Microsoft, IBM, NVIDIA, DeepSeek, OpenAI gpt-oss, Allen AI,
  HuggingFaceTB, Z.ai GLM), instruct or chat variants, reviewed commercial licences, architectures our engines support,
  safetensors present.
- GLM: GLM-4-0414 (`glm4`) and GLM-4.5 / 4.6 (`glm4_moe`) run on transformers 5, SGLang, mlx-lm and llama.cpp. GLM-4.5
  and 4.6 are hybrid reasoning models; minibrain turns thinking off through the chat template. GLM-4.5-Air and 4.6 are
  XL (mixture of experts, 106B and 355B).
- Default order: recommended for the selected pool. Filters include hardware fit levels on the selected pool and
  download access; long filter groups show five options and "Show more", with removable chips. A row opens
  `/discover/<id>`. Discover judges hardware fit against the selected pool: the best machine in the pool decides.
- The bundled snapshot (Nov 2026) has 65 entries: 66 safetensors formats and 4 GGUF formats.

## Base model sources

- Add from Hugging Face (`POST /api/catalog/hub`): `main` reads that one repository's metadata, on request, from the
  configured endpoint (Hugging Face or a mirror), reads `config.json` and adds the model to Discover. Only when the
  Model sources policy is Any.
- Weights are pinned by repository and revision and fetched by a `download` or `import` job (`docs/jobs.md`).
- Quantized weights are GGUF, or safetensors whose `config.json` has a `quantization_config`, such as FP8. They serve
  but are not fine-tuned: transformers refuses to train FP8 layers on the GPUs that run them natively. Training a
  quantized base is refused up front.
- The importer requires `config.json` with a `*ForCausalLM` architecture, `.safetensors` weights (every shard named in
  `model.safetensors.index.json`) and `tokenizer.json` or `tokenizer_config.json`. A GGUF file cannot be imported
  today ("GGUF and adapter imports" is planned); GGUF formats come from the catalogue only.
- An import's revision is read from `.cache/huggingface/download/config.json.metadata` when present, to match a
  catalogue variant.
- Gated downloads read `HF_TOKEN` (or `HUGGING_FACE_HUB_TOKEN`) on the server.

## Data

- Splits (`minibrain/data/splits.py`): rows are cleaned (empty and repeated inputs dropped), shuffled with seed 7, then
  test set (`golden`) = min(50, 10%), held-out (`eval`) = min(500, 15%) of the shuffled rows; few-shot (`shots`) is one
  row per label up to 10 (3 for free text), taken from the rest and removed from the training rows. Settings › General
  › Dataset splits shows these limits read-only.
- Held-out rows are chosen per dataset version. A new dataset version is split again from scratch, so its held-out
  rows can differ from the previous version's; the Evaluations page's "Data vs live" flags this.
- Rows whose `split` column is `eval` in the version's file are pinned into the held-out split on top of the 15%.
  This is how accepted test examples (feedback with `split = eval`) join the held-out rows when feedback is merged into
  a training run's dataset version. A user query that returns its own `split` column with `eval` values would pin rows
  the same way; this is not documented for users.
- Chat data: a `messages` column (JSON list of `{role, content}`), system turns skipped, must start with `user`,
  alternate, and end with `assistant`; the last assistant turn is the expected answer. In the dataset editor, Pick
  columns does not map a lone `messages` column; Write SQL (`SELECT messages FROM chats`) does. Models › Add model ›
  Dataset › Upload new… maps it automatically (`guessed_template`).
- Column guesses: input from `input, text, message, question, query, prompt, utterance, body, content`; answer from
  `label, category, intent, class, target, topic, tag`, then `answer, response, output, completion, reply, expected`.
- Large demo sets, Demo DBpedia-14 (630,000 rows) and Demo Amazon reviews (4,000,000 rows), are listed only when built
  with `uv run python demo_data/build.py --large`.
- Delta Lake on S3 is refused because DuckDB's delta extension reads a table's log with its own HTTP and TLS client
  (delta-kernel-rs with rustls and ring), outside OpenSSL, so it is not FIPS-ready. Iceberg on S3 goes through
  OpenSSL.
- Version checks run on save; `empty` (no rows) and `single_label` block saving; fewer than 10 rows saves but blocks
  training and scoring.
- Uploads (`POST /api/sources`) are streamed, with no body limit.

## Training internals

From `docs/training.md`:

- Supervised fine-tuning (TRL's `SFTTrainer` with PEFT): each assistant turn of an example becomes one row, with the
  conversation before it as the prompt. Loss is computed on the answer only. The prompt is built with the model's
  instructions and the base's chat template, through the same prompt code the gateway uses.
- The adapter (LoRA on every linear layer) is uploaded and pinned to the base's content hash. An `eval` job then
  answers the held-out rows and the test set with the adapter on the full-precision base.
- On a serve-only base, **Train** opens the page for instructions only and says why.
- The worker tokenises the rows to fit the sequence length exactly.

Memory estimate parts (verbatim):

| Part | Estimated from |
|---|---|
| Weights | The base's shape (from the catalogue, or `config.json` for imports); 4-bit with bf16 embeddings for QLoRA |
| Adapter | The LoRA parameters at the chosen rank, with gradients and optimiser states |
| Activations | Per token and layer; with checkpointing, each layer's input plus one layer |
| Logits | Vocabulary × tokens × 12 bytes for the fp32 loss |
| Overhead | A fixed runtime share, then 10% for fragmentation |

- Checkpointing is non-reentrant gradient checkpointing.
- API field ranges (`TrainingSettings`): `micro_batch` 1–64, `seq_len` 32–1,048,576 (capped by the context),
  `rank` 1–64, `learning_rate` (0, 0.01], `warmup` 0–0.5, `dropout` 0–0.3, `weight_decay` 0–0.2, `epochs` (0, 10],
  `max_rows` ≥ 10, `alpha` 1–512, `grad_accum` 1–256, `eval_every` 1–100,000, `seed` 0–2,147,483,647.
- `POST /api/models/{name}/versions` also takes `breaking: true` to confirm a contract change on a model that has been
  live; without it the API answers 409 "Confirm it as a breaking change to go on."
- Model card Training section (verbatim): method, strategy, rows, epochs, LoRA rank and alpha, learning rate, schedule,
  sequence length, batch size, final loss.

## Evaluation internals

- The scoring job (`minibrain/ml/evaluate.py`) answers one test-set row to warm up, then the test set one row at a
  time (latency p50/p95 and mean prompt tokens come from this pass), then the held-out rows in batches of 8 (GPU time
  per 1M tokens comes from this pass). Classifier answers use constrained decoding over the label set
  (`decoding: constrained`).
- Evaluation and judge jobs strip reasoning, so a reasoning base is scored on its answers.
- Judge scores are cached by a digest of the messages, the expected answer and the answer.
- Deploy rule (`minibrain/tasks/promotion.py`): thresholds use `>=`, `<=`, `>`, `<`, `==` (UI: at least, at most,
  above, below, exactly); `beats_live` compares the main metric with `>=`. It passes when nothing is live or when the
  live version has no score on the main metric. API: `PUT /api/models/{name}/promotion`; deploying goes through
  `POST /api/models/{name}/versions/{number}/promote`.

## Deployments on a pool

From `docs/serving.md` › Deployments on a pool (verbatim where quoted):

- Deploy and Promote take `pool`: a pool name, or `auto` (the default for a model not deployed yet). A pool that does
  not exist, is not used for serving or where the model does not fit, is a 422 with the reason; a deployment already
  on a pool that stopped serving may stay there. Deploying a deployed model with another pool moves it; left out, it
  stays where it is. `GET /api/models/{name}/placement` lists each pool's fit for the model and the pool `auto` would
  pick. The `model.deploy` audit event records the pool, the replicas and, on a move, `from_pool`.

| Pool | Who starts the engine |
|---|---|
| `local` (this machine) | `main`, as a supervised child, as before |
| Any other | A worker in that pool (`minibrain worker --pool NAME`) runs `minibrain engine` as its child |

- Each worker in a pool other than `local` asks `main` every 10 s which engines to run (`POST
  /internal/worker/engines`, with its pool token or approval) and starts or stops children to match. The answer carries
  an engine token for that pool (`engine.<t|m><id>.<pool>.<HMAC-SHA256 of both>`, `t` for a pool token and `m` for an
  approval, keyed by `<home>/secrets/engine_token` on main), handed to the engines as `MINIBRAIN_ENGINE_TOKEN`, so a
  worker needs only its own credential and never sees the gateway token. The engine token lives as long as that
  credential: once the pool token is rotated or the approved machine removed, its engines get 401. An engine token
  reaches only what an engine needs: announcing engines in its own pool, base weights and the adapters of versions on
  a base model deployed or running in its pool. The gateway config (routes and API key digests), request logs,
  feedback, gateway reports and other adapters answer it with 403, an announcement for another pool too, and a worker
  in `local` gets no engine token at all.
- `main` places replicas on the pool's machines with a worker seen in the last 30 s, one worker per machine, skipping
  machines too small for the model, by rendezvous hashing on the model and machine name.
- Replicas: `room` on each pool in `GET /api/models/{name}/placement`. Asking for more is a 422 ("Pool gpu-a10 has
  room for 2 replicas of Support triage: one per online machine where it fits"). Overview shows "1 of 2 replicas"
  while they start.
- The engine binds and announces the worker's `--advertise` address (the machine's name by default; `--engine-bind`
  sets another interface) on a free port. It pulls weights and adapters from `main` like any remote engine and dies
  with the worker.
- A name that resolves only to loopback (common on Linux, where `/etc/hosts` maps the hostname to `127.0.1.1`) would
  announce an address no gateway can reach. Without `--advertise`, the worker then takes the address its own traffic
  to `main` leaves from, and logs it. When that is loopback too, or `main` is unreachable, it refuses to start:

  ```text
  minibrain worker: This machine's name gpu-01 resolves to 127.0.1.1, which gateways on other machines cannot
  reach, and no other address of this machine reaches main at http://main.corp:8000. Pass the address or name other
  machines reach it at: minibrain worker --pool rack --advertise <address> (add --engine-bind 0.0.0.0 to listen on
  every interface), or --no-serve to run jobs only.
  ```

  With `main` on the same machine (`--api-url http://127.0.0.1:8000`) a loopback name is kept: `main`'s gateway
  reaches it, gateways on other machines do not.
- Gateways route a deployed name only to that deployment's pool (`pool` on the route in the config snapshot).
- Moves: `placements` lists both pools during a move. Main checks moves every time it rebuilds the gateway config
  (every second); each move that ends writes a `model.move` audit event (`outcome` `moved` or `rolled_back`, with
  `from_pool`, `pool` and the error).
- Status "Deployed · v2 on gpu-a10" shows in the header, Overview, Models list and Monitoring.

## Routing

From `docs/serving.md` › Routing (verbatim): a sticky replica's binding stays when it overflows; on failover the key
rebinds to the replica that answered. In front of gateways: HAProxy, Envoy or a cloud load balancer. Under the
gateway, per pool, later: sgl-router or llm-d. llm-d needs Kubernetes (Gateway API inference extension, its own
scheduler), and minibrain must run without it. sgl-router only routes SGLang and pays off with many SGLang replicas of
one model; then it slots under the gateway as one replica per pool, and the gateway keeps keys, routes and adapters.

## Compute pools

From `docs/serving.md` › Compute pools (verbatim; the user-facing parts belong on the machine pages):

A pool is a named group of machines. Workers and engines join one with `--pool NAME` (default `local`, shown as "This
machine") and report their hardware when they register, each time a worker asks for work and each time an engine
announces itself.

| Reported | Example |
|---|---|
| Platform, architecture | `linux`, `x86_64` |
| Accelerator | `cuda`, `rocm`, `xpu`, `mps`, `cpu`, with the GPU name |
| GPUs | Each with its memory |
| Memory for models | Sum of GPU memory; Apple GPU-usable unified memory; RAM on CPU |
| CPU, RAM | Cores, bytes |
| Engines installed | `sglang`, `vllm`, `mlx`, `transformers`, `llamacpp` |

- Infrastructure › Machines lists pools, their machines (online if seen in the last 2 minutes) and the engines
  serving: one row per machine with its GPUs, memory, CPU, RAM, models and jobs, sortable by each, grouped under a row
  per pool (machines online, GPUs, memory, engines, jobs, room, join token, use). Group by Model lists each deployed
  model with the machines that serve it.
- Discover judges hardware fit against the selected pool: the best machine in the pool decides. Multi-GPU (XL)
  models need a machine with two or more GPUs.
- Machines unseen for 7 days and engines unseen for an hour are forgotten. An approved machine stays listed, offline,
  until it is removed, which revokes its approval.

## Pool use

From `docs/serving.md` › Pool use:

- API: `GET`/`PUT /api/compute/pools/{pool}/settings`, `{"workloads": ["serving"]}`; `GET /api/compute/pools` returns
  `workloads` on each pool. Job kinds held back by Serving: `train`, `eval`, `judge`.
- Stored as a list of workloads per pool (`pool_settings`), so a new kind of work is one more value, not a schema
  change. Any with no description is no row at all, so it also takes kinds added later.
- The same row holds an optional one-line description (up to 120 characters, whitespace collapsed; empty clears it),
  returned as `description` on pools, deploy placements, the catalogue's pools and the training plan. The
  `PUT .../settings` body takes `description`, `workloads` or both; a field left out stays as it is.
- `auto` placement skips pools not used for serving; asking for one is a 422 with the reason. A job asked for a pool
  not used for training is refused with the reason (422). A pool with queued training or scoring jobs held to it
  cannot stop taking training: the change is a 409 naming those jobs.
- Each change writes a `pool.workloads` or `pool.description` audit event with `from` and `to`.
