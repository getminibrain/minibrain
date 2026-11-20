---
title: Train a version
description: Fine-tune a LoRA adapter on a model's dataset, follow the run and read what the new version keeps.
sidebar:
  order: 3
---

Training makes a new version of a custom model by fitting a LoRA adapter to its dataset on one of your machines. The
new version is then scored the way v0 was, so you can see whether training was worth it. Nothing that is live
changes until you deploy it. This page starts where [Your first model](../get-started/first-model.md) ends: a custom
model with a dataset and a scored v0.

## When to train

Every custom model starts with v0: the base model with the model's instructions and a few examples from its data. v0
has no weights of its own, is scored on the held-out rows at once and can be deployed as it is. Every trained version
is compared with it.

- Try instructions first. On the Train page, the method **Instructions only (no training)** saves new instructions as
  a prompt-only version (**Create vN**), scored at once.
- Train when the best prompt-only version misses the model's [deploy rule](evaluation.md#the-deploy-rule), or breaks
  the contract too often. A trained version on unchanged data is scored on v0's held-out rows, so "+18 vs v0" is what
  the adapter added.
- With fewer than 50 held-out rows the Train page warns that one row moves the score by several points. Add rows to
  the dataset first; its held-out split grows with it.

A run trains on the training split of the dataset version you pick, plus the model's accepted feedback. Held-out and
test rows are never trained on.

## Start a run

Training needs the Builder role.

1. Open the model and click **Train** in its header. **Training › Train a model** asks "Train which model?" instead.
   **Train again** in a version's menu on **Versions** starts from that version's settings and data, and **Train from
   vN** on a dataset version starts from that data.
2. **Method**: **Supervised fine-tuning (SFT)**.
3. **Data**: a version of the model's dataset, latest first. With accepted feedback, the row says "This run adds N
   accepted feedback rows to" that version.
4. **Pool**: **Automatic** lets any machine in a pool used for training take the job. A named pool holds the job to
   that pool and shows its fit and time ("fits 6.1 of 24 GB · ≈ 12 min"). Pools used only for serving show "Not used
   for training".
5. **Training**: **Fast**, **Balanced**, **Best** or **Custom**, and **Show parameters** for every setting
   ([Recipes and memory](training-recipes.md)).
6. **Instructions**: the system prompt. The new version keeps its own copy, and later versions start from it.
7. Check the **Run summary**: time, pool, GPU-hours, queue ("Starts now" or "N ahead") and the memory the run needs
   against what the machine has.
8. Click **Train vN**.

When **Train** is greyed out, its tooltip says why: the base is still downloading, the dataset has too few rows, or
the base is a quantized format that cannot be trained ([Formats](models.md#formats)). When the new version would
change the contract apps rely on, such as the label set of a model that has been live, the page asks you to confirm
it.

Training runs on workers. `minibrain serve` starts one on its own machine, shown as "This machine"; GPU machines join
with `minibrain worker` ([Add machines](../install/machines.md)). Only pools used for Any or Training take training
and scoring jobs ([Pool use](deployments.md#pool-use)).

## What a run does

1. **Train vN** creates version N and a training job. The model's dataset cannot change or be deleted while the run
   lasts.
2. A worker takes the job, fetches the dataset version and the base, plans how the run fits its memory and trains.
3. Supervised fine-tuning with TRL and PEFT: each answer in an example becomes one training row, with the conversation
   before it as the prompt, and the loss is computed on the answer only. The prompt is built from the model's
   instructions and the base's chat template, the same way the API builds it.
4. The adapter, LoRA on every linear layer, is stored with the version, which moves to scoring: it answers the
   held-out rows and the test set on the full-precision base, decoding the way serving does
   ([Evaluation](evaluation.md)).
5. The version is ready. Deploying it is a separate step ([Deployments](deployments.md)).

## Follow the run

The version page opens on the run. Its **Training** panel shows the progress, step, elapsed time, time left and where
it runs, or "Waiting for a worker" while the job is queued.

- The **Loss** chart draws training loss (raw or smoothed) and held-out loss over the learning rate, marking warmup
  and epochs. One line reads the curve: "Held-out loss still falling", "Held-out loss flattened at step N" or
  "Overfitting from step N: fewer epochs or more dropout may help". **Compare with** draws another trained version's
  loss behind it.
- A note under the figures names what changed against the version the run started from, or the live one, such as
  "Changed from Balanced: …" or "Same settings and data as v3".
- **Training** in the sidebar lists every run across your models with its status, score and change, base, dataset
  version and GPU-hours. Tick runs to cancel, retry or delete them together.

## Cancel, fail and retry

- **Cancel** stops the run. A failed version shows the reason, **View logs** and **Retry**.
- **Logs · job #N** in the version's menu on **Versions** opens the job page. Its logs hide library output until
  **Show library output** is on.
- An attempt that fails for a reason worth retrying, such as a lost worker or running out of memory, runs again, up to
  three attempts in all. Checkpoints are saved every 50 steps, and an attempt on the same worker resumes from the last
  one.
- An attempt that runs past 24 hours fails and is not retried.

## What a version keeps

| Part | Contents |
|---|---|
| Recipe | Adapter type, checkpointing, batch, accumulation, sequence length, rank, alpha, learning rate, warmup, schedule, dropout, weight decay, epochs, max rows, seed, optimiser, precision, device, your overrides, and the planned peak memory against the machine's |
| Run | Rows trained on, time, final training loss, measured peak memory, how many rows were longer than the sequence length, and whether the worker planned again |
| Lineage | Dataset version, base and its content hash, and the version the settings started from |
| Adapter | Its files with their SHA-256 |
| Cost | GPU-hours: wall time × the accelerators used |
| Scores | Held-out and test set scores per grader, p50 and p95 latency, GPU time per 1M tokens |

The version's **Model card** puts this on one page, with a Training section and an Evaluation section against v0 and
the previous version. It downloads as Markdown or JSON, and each version also has an AI bill of materials
([Supply chain](../security/supply-chain.md)).

**Export…** in the version's menu downloads the adapter only, which loads on the same base in minibrain, vLLM or
PEFT, or the merged full model, the base with the adapter folded in, as safetensors. Both carry their SHA-256.

## Train on a new base

On the model's **Settings** tab, **Base and copies › Switch base** moves it to another base. New versions are made
on it, starting with a prompt-only version scored at once; then train as above. The live version keeps serving on the
old base until a version on the new base is deployed. Versions made on the old base stay as history and cannot be
deployed. A model on a quantized base shows **Move to** its full-precision format instead, which downloads first.
