---
title: Introduction
description: What minibrain is, how a model goes from your data to an API, and the few things you work with.
sidebar:
  order: 1
---

minibrain is an open-source platform to train, evaluate and serve models of any size on your own data, on your own
hardware or cloud. Apps call the models through an OpenAI-compatible API, so any OpenAI client works. It is one Python
package with the web UI built in, and one command runs it on a single machine.

## What you get

- Models of any size, from a fast task model to a private frontier endpoint, on the open base model that fits the job.
- Evaluation first: every model starts as a scored baseline, and each trained version is compared on the same
  held-out rows.
- Private by default: it runs on your infrastructure, from signed releases. It can also run fully air-gapped.
- Yours to keep: weights, data, scores and logs stay on your infrastructure, and you can export a model at any time.

## From data to an API

1. Add data. Upload a CSV or JSON Lines file, or read rows from a database. minibrain makes it a dataset and sets
   held-out rows aside for scoring.
2. Add a model. Pick a base model, the dataset and the output: labels, JSON or free text.
3. Read the baseline. Version 0, the base model with instructions, is scored on the held-out rows at once.
4. Train only when it pays. If version 0 is good enough, keep it. Otherwise train with one click: the new version is
   scored on the same rows and shown against the baseline, such as `+18 vs v0`.
5. Deploy the version that wins. Its API name, such as `support-triage`, now routes to it.
6. Call it over the API with an API key and any OpenAI client.
7. Improve it. Reviewed feedback and new data lead to the next version, which is scored and compared the same way.

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key="mb_...")
reply = client.chat.completions.create(
    model="support-triage",
    messages=[{"role": "user", "content": "I was charged twice"}],
)
print(reply.choices[0].message.content)
```

`support-triage` follows the live version; `support-triage@2` calls version 2.

## Concepts

| Term | Meaning |
|---|---|
| Base model | An open model, such as Qwen3, from the catalogue, Hugging Face, a bucket or a folder on the server. Every version builds on one |
| Model | What apps call, by its API name. It has one base model, one dataset and a list of versions |
| Version | One fixed result: the base model, its instructions and, once trained, an adapter and the dataset version it learned from. Versions are numbered from v0, the untrained baseline, and never change |
| Dataset | Rows of text the model reads and the answer it should give. Each change saves a new dataset version |
| Held-out rows | Rows of each dataset version that no version trains on. Every version is scored on them, so scores stay comparable |
| Pool | A named group of machines that trains and serves. `local` is the machine minibrain runs on |
| Deployment | A model's live version running on a pool, with a number of replicas. minibrain keeps it running |
| API key | A key starting with `mb_` that names the models it may call |
| Job | Any work minibrain runs for you, such as a download, a training run, scoring or a deploy, with its steps and logs on the Jobs page |

## Where to go next

- [Installation](installation.md): run minibrain on your machine in a few minutes.
- [Your first model](first-model.md): the steps above, click by click, ending with a call from Python.
- [Data](../guides/data.md) and [Base models](../guides/models.md): what goes into a model.
- [API overview](../api/overview.md): call your models from apps.
- [Add machines](../install/machines.md): train and serve on more GPUs.
