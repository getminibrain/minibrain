---
title: Recipes and memory
description: Training presets and settings, how a run is fitted to a machine's memory, the devices it trains on, and the training API.
sidebar:
  order: 4
---

Every run has a recipe: the LoRA and optimiser settings, and a memory plan that fits it to the machine that trains it.
The presets cover most runs; this page is for when you want to change them. How to start a run:
[Train a version](training.md).

## Presets

The Train page's **Training** row offers three presets and **Custom**:

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
| Score every (steps) | Automatic: held-out loss on up to 64 held-out rows, about every tenth of the run |
| Seed | 7 |

- A model's first run starts from Balanced. Later runs start from its last trained version: its preset when the values
  match one, otherwise Custom with its values.
- **Show parameters** opens the groups Adapter, Optimisation, Sequence, Memory, Evaluation and Reproducibility. Fields
  can be edited under Custom; the selector then shows "N changed · Reset".
- Rank goes up to 64, the largest rank the serving engines load. The schedule is cosine, linear or constant.
- The same seed, data and settings train the same weights.

## Memory planning

Each run picks how the base fits the memory of the machine that trains it. The fields below show their automatic
choice, such as "Automatic (QLoRA)", and can be overridden under Custom.

| Setting | Options | Automatic |
|---|---|---|
| LoRA type | LoRA: the base in bf16 on GPUs (fp16 where the GPU lacks bf16), fp32 on the Apple GPU and CPU. QLoRA: the base in 4-bit NF4 with double quantisation, bf16 compute | The fastest that fits |
| Checkpointing | Off, or On: gradient checkpointing, less memory and about 25% slower | Off unless it is needed |
| Batch | 8, 4, 2 or 1 rows per forward pass; 1 on the Apple GPU | The largest that fits |
| Accumulation | Batches per optimiser step | 16 rows per step |
| Length (tokens) | 32 up to the base's context | The longest training example, rounded up to 16 tokens and capped by the context |
| Optimiser | Not a field | Where bitsandbytes is installed, paged 8-bit AdamW on NVIDIA and 8-bit AdamW on AMD and Intel GPUs; AdamW otherwise |

The planner estimates each option's peak memory and keeps the fastest one under 85% of the machine's memory: the
largest single GPU, the GPU-usable unified memory on Apple silicon, or RAM on a CPU. It counts the weights, the adapter
with its gradients and optimiser states, the activations, the logits for the loss, and a share for the runtime and
fragmentation.

- The plan goes to the online machine with the fastest option, from the hardware each worker reports. **Machine**
  (under Memory) plans for one machine of the pool instead. When no worker has reported yet, the worker that takes
  the job plans on its own.
- When nothing fits, the Train page says why under **Pool** and in the **Run summary**, naming the smallest plan, the
  memory it needs and what the machine has, and does not start the run.
- The worker checks the plan against its own machine before it trains. It keeps the plan when it fits, plans again
  whatever you did not override when it does not, and fails with the reason when your overrides no longer fit.
- QLoRA needs bitsandbytes on an NVIDIA, AMD or Intel GPU: the `qlora` extra ([Python and uv](../install/python.md)),
  included in the Docker image. On the Apple GPU or a CPU the plan says "QLoRA needs an NVIDIA GPU".
- Quantized bases serve but do not train ([Formats](models.md#formats)).

:::caution
The estimates were checked against LoRA runs on Apple silicon and CPU. QLoRA and the NVIDIA estimates have not yet
been checked against a run on an NVIDIA GPU, so leave some headroom there.
:::

## Devices

The worker trains on the device PyTorch offers ([GPUs](../install/gpus.md)):

| Machine | Device | Precision | Use |
|---|---|---|---|
| NVIDIA, or AMD through ROCm | `cuda` | bf16, else fp16 | Production; LoRA and QLoRA |
| Intel GPU | `xpu` | bf16, else fp16 | LoRA and QLoRA |
| Apple silicon | `mps` | fp32 | Development; one row at a time |
| Any other | `cpu` | fp32 | Small bases and smoke tests |

- On the Apple GPU, a run that fails or stops making steps (15 minutes for the first step, then the longer of 3
  minutes and ten times the slowest step so far) starts again on the CPU and stays there.
- `MINIBRAIN_TRAIN_DEVICE` forces `cuda`, `xpu`, `mps` or `cpu`, with no fallback.
- A worker runs one GPU job (training, scoring, judging or exporting) at a time; `minibrain worker --gpus N` lets it
  run N.

## Training API

The Train page calls two endpoints, which a script can call too:

- `GET /api/models/{name}/training-plan` returns the plan, each option's memory by part, and the defaults.
- `POST /api/models/{name}/versions` with `"kind": "lora"` starts the run and returns the new version. It also takes
  `dataset_version_id`, `from_version` (the version the settings started from) and `instructions`. When nothing fits,
  it answers 409 with the same sentence the Train page shows.

Both take the recipe fields `strategy` (`lora` or `qlora`), `checkpointing`, `micro_batch`, `grad_accum`, `seq_len`,
`rank` (1 to 64), `alpha`, `learning_rate`, `warmup` (a share of the steps, 0 to 0.5), `scheduler` (`cosine`, `linear`
or `constant`), `dropout`, `weight_decay`, `epochs`, `max_rows`, `eval_every` (steps), `seed`, `machine` and `pool`. A
field left out takes Settings › General › Default training recipe: rank 16, learning rate 2e-4, one epoch, at most
3,000 rows.

`/api` takes a signed-in session, not an API key: sign in with a password account, then send the session cookie with
every call and the returned `csrf_token` as `X-CSRF-Token` on every POST, PUT, PATCH and DELETE. The account needs the
Builder role.

```python title="train.py"
import os

import requests

BASE = "http://127.0.0.1:8000"
MODEL = "support-triage"
RECIPE = {"rank": 32, "learning_rate": 1e-4, "epochs": 3}

session = requests.Session()
signed_in = session.post(
    f"{BASE}/api/auth/login",
    json={"email": os.environ["MINIBRAIN_EMAIL"], "password": os.environ["MINIBRAIN_PASSWORD"]},
)
signed_in.raise_for_status()
session.headers["X-CSRF-Token"] = signed_in.json()["csrf_token"]

plan = session.get(f"{BASE}/api/models/{MODEL}/training-plan", params=RECIPE)
plan.raise_for_status()
print(plan.json()["level"], plan.json()["minutes"], "minutes")

run = session.post(f"{BASE}/api/models/{MODEL}/versions", json={"kind": "lora", **RECIPE})
run.raise_for_status()
print("Training version", run.json()["number"])
```

These paths can change between releases: pin scripts to a minibrain version. Every endpoint is listed under **API
reference** in the app's account menu.
