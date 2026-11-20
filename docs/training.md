# Training

Training makes a new version of a custom model by fitting a LoRA adapter to its dataset on one of your machines, then
scores it on held-out rows the way version 0 was scored, so you can see whether it was worth it.

This guide starts where [your first model](first-model.md) ends: a custom model with a dataset and a scored v0.

## When to train

Every custom model is created with v0: the base model with the model's instructions and, when it has data, up to 10
few-shot examples from the training rows. v0 has no weights of its own, is scored on the dataset's held-out rows at
once and can be deployed at once. It is the baseline every trained version is compared with.

- Try instructions first. The Train page's **Instructions only (no training)** method saves new instructions as a
  prompt-only version, scored at once.
- Train when the best prompt-only version misses the model's deploy rule (Evaluation › How it's scored), or breaks
  the contract too often. A trained version is scored the same way on the held-out rows of the data it trained on;
  with unchanged data those are v0's rows, so "+18 vs v0" is what the adapter added.
- With fewer than 50 held-out rows the Train page warns that one row moves the score by several points. Add rows to
  the dataset first; its held-out split grows with it.

Training uses the training split of the picked dataset version, with the model's accepted feedback merged in.
Held-out and test rows are never trained on.

## What a run does

1. **Train vN** creates version N and a `train` job. The model's dataset cannot change or be deleted while the run
   lasts.
2. A worker in a pool used for training claims the job, fetches the dataset version and the base, plans how the run
   fits its memory, and trains in a child process.
3. Supervised fine-tuning (TRL's `SFTTrainer` with PEFT): each assistant turn of an example becomes one row, with the
   conversation before it as the prompt. Loss is computed on the answer only. The prompt is built with the model's
   instructions and the base's chat template, through the same prompt code the gateway uses.
4. The adapter (LoRA on every linear layer) is uploaded and pinned to the base's content hash. The version moves to
   scoring: an `eval` job answers the held-out rows and the test set with the adapter on the full-precision base,
   decoding the way serving does, and the model's graders score the answers.
5. The version is ready. Nothing that is live changes: deploying is a separate step.

## Recipe

The Train page's **Training** row offers three presets and Custom:

| Preset | Rank | Learning rate | Epochs |
|---|---|---|---|
| Fast | 8 | 2e-4 | 1 |
| Balanced | 16 | 2e-4 | 2 |
| Best | 32 | 1e-4 | 3 |
| Custom | Your values | Your values | Your values |

All presets share the rest of the recipe:

| Setting | Default |
|---|---|
| Alpha | 2 × rank |
| Dropout | 0.05 |
| Warmup | 5% of the steps |
| Schedule | Cosine |
| Weight decay | 0 |
| Max rows | All training rows |
| Batch and Accumulation | Automatic: an effective batch of 16 rows |
| Score every (steps) | Automatic: held-out loss on up to 64 held-out rows about every tenth of the run |
| Seed | 7 |

- A model's first run starts from Balanced. Later runs start from its last trained version: its preset when the values
  match one, otherwise Custom with its values.
- **Show parameters** opens the groups Adapter, Optimisation, Sequence, Memory, Evaluation and Reproducibility. Fields
  are editable under Custom; the selector then shows "N changed · Reset".
- Rank goes up to 64, the largest rank the serving engines load.
- The same seed, data and settings train the same weights.

## Memory planning

Each run picks how the base fits the memory of the machine that trains it. The fields below show their automatic
choice, such as "Automatic (QLoRA)", and can be overridden under Custom.

| Setting | Options | Automatic |
|---|---|---|
| LoRA type | LoRA: the base in bf16 on GPUs (fp16 where the GPU lacks bf16), fp32 on the Apple GPU and CPU. QLoRA: the base in 4-bit NF4 with double quantisation, bf16 compute | The fastest that fits |
| Checkpointing | Off, or On (non-reentrant gradient checkpointing: less memory, about 25% slower) | Off unless it is needed |
| Batch | 8, 4, 2 or 1 rows per forward pass; 1 on the Apple GPU | The largest that fits |
| Accumulation | Batches per optimiser step | 16 rows per step |
| Length (tokens) | 32 up to the base's context | The longest training example, rounded up to 16 tokens and capped by the context |
| Optimiser | Not a field | Paged 8-bit AdamW on CUDA, 8-bit AdamW on ROCm and Intel GPUs where bitsandbytes is installed; AdamW otherwise |

The planner estimates each option's peak memory and keeps the fastest one under 85% of the machine's memory: the
largest single GPU, GPU-usable unified memory on Apple silicon, or RAM on a CPU.

| Part | Estimated from |
|---|---|
| Weights | The base's shape (from the catalogue, or `config.json` for imports); 4-bit with bf16 embeddings for QLoRA |
| Adapter | The LoRA parameters at the chosen rank, with gradients and optimiser states |
| Activations | Per token and layer; with checkpointing, each layer's input plus one layer |
| Logits | Vocabulary × tokens × 12 bytes for the fp32 loss |
| Overhead | A fixed runtime share, then 10% for fragmentation |

- The plan goes to the online worker with the fastest option, from the hardware and libraries each worker reports.
  **Machine** (under Memory) plans for one machine of the pool instead. When no worker has reported, the worker that
  takes the job plans on its own.
- When nothing fits, the Train page says why under Pool and in the Run summary, naming the smallest plan, the memory
  it needs and what the machine has, and does not start the run. `POST /api/models/{name}/versions` answers 409 with
  the same sentence.
- The worker checks the plan against its own machine and tokenises the rows to fit the sequence length exactly. It
  keeps the stored plan when it fits, plans again whatever you did not override when it does not, and fails with the
  reason when your overrides no longer fit.
- QLoRA needs bitsandbytes on a CUDA, ROCm or Intel GPU worker (the `qlora` [extra](install.md#extras), in the Docker
  image). On the Apple GPU or a CPU the plan says "QLoRA needs an NVIDIA GPU" where it would have fitted.
- Quantised bases (GGUF, AWQ, FP8) serve but do not train ([import formats](models.md#import-formats)).
- The estimates were checked against LoRA runs on Apple silicon and CPU. QLoRA and the CUDA estimates have not yet
  been checked against a run on an NVIDIA GPU.

## Where it runs

Training runs on workers. `minibrain serve` starts one on the same machine (the `local` pool, "This machine"); a GPU
machine joins a pool with `minibrain worker` ([Joining machines](machines.md#add-a-machine)):

```sh
MINIBRAIN_JOIN_TOKEN=mbj_… minibrain worker --main https://main.example.com --pool gpu
```

- Only workers in a pool used for Any or Training take training and scoring jobs ([pool use](serving.md#pool-use)).
  A pool used for Serving shows as "Not used for training" on the Train page. `--no-serve` keeps a worker to jobs.
- A worker runs one GPU job (training, scoring, judging or exporting) at a time; `--gpus N` lets it run N.
- An attempt that runs past 24 hours fails and is not retried.

The worker picks the device PyTorch offers ([PyTorch backends](install.md#pytorch-backends)):

| Machine | Device | Precision | Use |
|---|---|---|---|
| NVIDIA, or AMD through ROCm | `cuda` | bf16, else fp16 | Production; LoRA and QLoRA |
| Intel GPU | `xpu` | bf16, else fp16 | LoRA and QLoRA |
| Apple silicon | `mps` | fp32 | Development; one row at a time |
| Any other | `cpu` | fp32 | Small bases and smoke tests |

On the Apple GPU, a run that fails or stops making steps (15 minutes for the first step, then the longer of 3 minutes
and ten times the slowest step so far) starts again on the CPU and stays there. `MINIBRAIN_TRAIN_DEVICE` forces a
device, with no fallback.

## Start a run

Training needs the Builder role.

1. Open the model and click **Train** in its header. Training › **Train a model** asks "Train which model?" instead.
   **Train again** in a version's row menu on Versions starts from that version and its dataset version, and
   **Train from vN** on a dataset version starts from that data.
2. **Method**: Supervised fine-tuning (SFT).
3. **Data**: a version of the model's dataset, latest first. When the model has accepted feedback, the row says "This
   run adds N accepted feedback rows to" that dataset version.
4. **Pool**: **Automatic** lets any worker in a pool used for training take the job. A named pool holds the job to
   that pool's workers and shows its fit and time ("fits 6.1 of 24 GB · ≈ 12 min").
5. **Training**: a preset, or Custom and **Show parameters**.
6. **Instructions**: the system prompt. The new version keeps its own copy; later versions start from it.
7. Check the **Run summary**: Time, Pool, GPU-hours, Queue ("Starts now" or "N ahead") and the Memory gauge
   (weights, adapter and activations against the machine's memory).
8. Click **Train vN**.

On a serve-only base, **Train** opens the page for instructions only and says why; see
[a new base](#train-on-a-new-base).

## Follow progress

The version page opens on the run. Its Training panel shows the progress, Step, Elapsed, Time left and Ran on (pool
and machine), or "Waiting for a worker" while the job is queued.

- The loss chart draws training loss (raw or smoothed) and held-out loss over a learning-rate lane, marking warmup and
  epochs. One line reads the curve: "Held-out loss still falling", "Held-out loss flattened at step N" or
  "Overfitting from step N: fewer epochs or more dropout may help". **Compare with** draws another trained version's
  loss behind it.
- Under the stats, a note names what changed against the version the run started from, or the live one: "Changed
  from Balanced: …", "Same settings and data as v3".
- **Cancel** stops the run. A failed version shows the reason, **View logs** and **Retry**.
- Logs: **Logs · job #N** in the version's row menu on Versions opens the job page. Its Logs section hides library
  output until **Show library output** is on.
- Training lists every run across your models with its status, score and change, base and dataset version, and
  GPU-hours.
- A failed attempt that can be retried (a lost worker, out of memory) runs again, up to three attempts in all.
  Checkpoints are saved every 50 steps, and an attempt on the same worker resumes from the last one.

## What the version stores

| Stored | Contents |
|---|---|
| Recipe | Strategy, checkpointing, batch, accumulation, sequence length, rank, alpha, learning rate, warmup, schedule, dropout, weight decay, epochs, max rows, seed, optimiser, precision, device, your overrides, and the planned peak against the machine's memory |
| Run | Rows trained on, time, final training loss, measured peak memory, how many rows were longer than the sequence length, and whether the worker planned again |
| Lineage | Dataset version, base and its content hash, and the version the settings started from (Started from) |
| Adapter | Its files with their SHA-256 (Summary › Adapter) |
| Cost | GPU-hours: wall time × the accelerators used |
| Scores | Held-out and test set scores per grader, p50 and p95 latency, GPU time per 1M tokens |

The version's **Model card** puts this on one page: a Training section (method, strategy, rows, epochs, LoRA rank and
alpha, learning rate, schedule, sequence length, batch size, final loss) and an Evaluation section against the
prompt-only v0 and the previous version. It downloads as Markdown or JSON, and each version has an
[AI bill of materials](security.md#ai-bill-of-materials-ai-bom).

## Compare and deploy

- The version page's Summary shows each score's change against the live version and the baseline. **Compare with…**
  (in the "…" menu) opens two versions' scores, settings and held-out answers side by side.
- The model's Evaluation tab has Scores (each version against the deploy rule), Where it fails, What it's tested on and
  How it's scored.
- Evaluations lists every model's live and latest scored version; **Show all versions** lists the rest. A version opens
  with its held-out score, vs live, Data vs live, Test set, p50, p95, GPU time / 1M tokens and its mistakes.
- **Deploy vN** (version page or Evaluations) is enabled once the version is ready and meets the deploy rule; a
  version that was live before can always be deployed again. The previous version stays callable as `name@N`. Pools
  and replicas: [deployments on a pool](serving.md#deployments-on-a-pool).
- **Export…** downloads the adapter only, or the base with the adapter merged, as safetensors.

## Train on a new base

Settings › Base and copies › **Switch base** moves a custom model to another base. New versions are made on it,
starting with a prompt-only version scored at once; then train as above. The live version keeps serving on its old
base until a version on the new base is deployed. Versions made on the old base stay as history and cannot be
deployed. A model on a serve-only base shows **Move to** its full-precision variant instead, which is downloaded
first.

## From the API

The Train page calls two endpoints, which take the same fields (`strategy`, `checkpointing`, `micro_batch`, `seq_len`,
`rank`, `alpha`, `learning_rate`, `warmup`, `scheduler`, `dropout`, `weight_decay`, `epochs`, `max_rows`,
`grad_accum`, `eval_every`, `seed`, `machine`, `pool`):

- `GET /api/models/{name}/training-plan` returns the plan, each option's memory by part, and the defaults.
- `POST /api/models/{name}/versions` with `"kind": "lora"` (and optionally `dataset_version_id`, `from_version`,
  `instructions`) starts the run and returns the version.

A field left out takes Settings › General › Default training recipe (rank 16, learning rate 2e-4, one epoch, at most
3,000 rows). `/api` takes a signed-in session; API keys reach `/v1` only ([accounts](security.md#accounts-and-sign-in)).
