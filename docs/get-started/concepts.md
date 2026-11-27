---
title: Concepts
description: The terms minibrain uses, from base model and dataset to pool and engine, each with the page that covers it.
sidebar:
  order: 4
---

These are the things you work with in minibrain, in the order you meet them: what goes into a model, how its versions
are scored, how apps call it, and where it all runs. Each term links to the page that covers it.

## What goes into a model

| Term | Meaning |
|---|---|
| [Base model](../guides/models.md) | An open model, such as Qwen3, from the catalogue, Hugging Face, a bucket or a folder on the server. Every version builds on one |
| [Dataset](../guides/data.md) | Rows of text the model reads and the answer it should give, built from files or tables you add |
| [Dataset version](../guides/data.md#dataset-versions) | A saved copy of a dataset's rows. Each change saves a new one, and every training run and score uses one saved version, never the live sources |
| [Held-out rows](../guides/data.md#splits) | Rows of each dataset version that no version trains on. Every version is scored on them, so scores stay comparable |
| [Model](first-model.md#3-add-the-model) | What apps call, by its API name. It has one base model, one dataset and a list of versions |

## Versions and scores

| Term | Meaning |
|---|---|
| [Version](../guides/training.md#what-a-version-keeps) | One fixed result: the base model, its instructions and, once trained, an adapter and the dataset version it learned from. Versions are numbered from v0 and never change |
| [Version 0](../guides/training.md#when-to-train) | The untrained baseline, made with the model: the base model with the model's instructions and a few examples from its data. It is scored at once and can be deployed as it is |
| [Adapter](../guides/training.md#what-a-run-does) | The LoRA weights a training run fits to the dataset. A trained version is its base model plus its adapter; the base model's own weights stay as they are |
| [Grader](../guides/evaluation.md#how-a-version-is-scored) | A check that scores each answer a version gives on the held-out rows, such as Label accuracy or Exact match. A model's graders give every version its scores |
| [Deploy rule](../guides/evaluation.md#the-deploy-rule) | The checks a version's scores must pass before it can be deployed. By default it must score at least as well as the deployed version |

## Calling a model

| Term | Meaning |
|---|---|
| [Deployment](../guides/deployments.md) | A model's live version running on a pool, with a number of replicas. minibrain keeps it running |
| [API key](../api/overview.md#create-an-api-key) | A key starting with `mb_` that names the models it may call |
| [Feedback](../guides/feedback.md) | A rating or a correction of an answer, from the Playground or from an app. Once a reviewer accepts it, it joins the model's next training data |

## Where it runs

| Term | Meaning |
|---|---|
| [Job](../guides/training.md#cancel-fail-and-retry) | Any work minibrain runs for you, such as a download, a training run, scoring or a deploy, with its steps and logs on the Jobs page |
| [Pool](../install/machines.md#pools) | A named group of machines that trains and serves. `local` is the machine minibrain runs on |
| [main](../reference/architecture.md#roles) | The process that owns the database, the jobs and the settings, and serves the UI and the API. `minibrain serve` runs it and, on one machine, the gateway, a worker and the engines too |
| [Gateway](../reference/how-serving-works.md#the-request-path) | Checks the API key of each `/v1` request and routes it to an engine. It runs inside main, or on its own machines as `minibrain gateway` |
| [Worker](../install/machines.md#what-runs-on-the-machine) | Runs jobs such as training and scoring on its machine, and starts the engines for the models deployed to its pool. Other machines join a pool by running `minibrain worker` |
| [Engine](../reference/how-serving-works.md#engines) | The process that runs a model and answers its requests: one base model, with the adapters of its versions loaded on it |
