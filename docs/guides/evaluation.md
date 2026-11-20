---
title: Evaluation
description: How every version is scored, the rule that decides what can be deployed, and where to read and compare the results.
sidebar:
  order: 5
---

Every version of a custom model is scored on rows it never trained on, by the model's graders, before it can be
deployed. v0 is scored as soon as the model exists, and each trained version when its run ends, the same way, so
versions can be compared. Scores live on the model's **Evaluation** tab and on the **Evaluations** page.

## How a version is scored

The dataset version a model uses sets two groups of rows aside ([Splits](data.md#splits)):

- **Held-out rows**, 15% of the rows and at most 500, give the main score. Every version made from the same dataset
  version is scored on the same rows.
- The **test set**, 10% and at most 50, gives a second score, and the latency figures.

A scoring job answers both with the version's instructions and adapter on the full-precision base, decoding the way
serving does; a classifier's answers are held to its labels. The model's graders then score each answer. When the
data changes between two versions, the Evaluations page says so under **Data vs live**, with a link to compare the
data.

| Grader | Scores | For answers that are |
|---|---|---|
| Label accuracy | Share of answers that are the expected label, with macro F1, recall per label and a confusion matrix | Labels |
| Exact match | Share of answers identical to the expected one | Text, JSON or labels |
| JSON valid | Share of answers that parse and match the schema | JSON |
| JSON field match | Share of expected fields the answer gets right, per field | JSON |
| Text similarity | Word overlap with the expected answer (token F1) | Text or JSON |
| Judge model | A model on this install scores each answer against a rubric | Text or JSON |

A classifier starts with Label accuracy and a chat assistant with Text similarity. A custom model starts with Exact
match and Text similarity for text, JSON valid and JSON field match for JSON, or Label accuracy for labels.

## How it's scored

The model's **Evaluation** tab ends with **How it's scored** (Builder role):

- **Answers**: the contract, free text, one of a set of labels, or a JSON schema.
- **Graders**: tick the graders to run. The judge, when picked, gives the main score; otherwise the first grader does.
- **Judge** and **Judge rubric**: any base on this install. It defaults to the install's judge model (Settings ›
  General › Judge model) or, when none is set, the model's own base. A larger base judges better. Judging runs as
  its own job, and a score is cached per answer, so the same answer is not judged twice.
- **Deploy rule**: see below.

Changing the graders or the judge offers **Save and re-score**: every scored version answers its held-out rows again,
one job each, so versions stay comparable.

## The deploy rule

A version can be deployed only when every part of its model's deploy rule holds on its held-out rows:

- **At least as good as the deployed version on its main metric**: on by default. With nothing live yet, every
  scored version passes.
- **Add threshold**: a metric, a comparison and a value, such as Label accuracy at least 85%. There are none by
  default.

Changing the rule does not re-score. A version that was live before can always be deployed again, whatever the rule
says, so a rollback is never blocked ([Deployments](deployments.md#roll-back)). **Deploy vN** stays greyed out on a
version that fails the rule, and its tooltip names the check that failed.

## The Evaluation tab

- **Scores**: the main metric of each ready version, with the deploy rule as a line and the deployed version marked.
  A hollow dot does not meet the rule.
- **Where it fails**: pick a version, then **Wrong** (held-out rows it does not get fully right), **Changed vs vN**
  (rows whose answer changed against the deployed version) or **By label** (recall per label, worst first). Open a row
  for the whole conversation and the grader's reason.
- **What it's tested on**: how many held-out rows the latest scores used, the dataset version, newer data the next
  version will be made from, and the model's test examples.
- **How it's scored**: above.

## The Evaluations page

**Evaluations** in the sidebar has one row per model with its live version and its latest scored version: the
held-out score, the change **vs live** and whether it passes the **Deploy rule**. **Show all versions** lists every
version, one under the other. Filter by model and status; the column picker adds the kind, latency and cost.

Click a version for its details:

- A headline such as `v0 64% → v1 92%`, then Status, the held-out score, **vs live**, **Data vs live**, **Test set**,
  **Breaks the contract** (answers outside the contract), **p50** and **p95** latency, **GPU time / 1M tokens** and,
  when an admin prices the pool, **Cost / 1M tokens**.
- The score of each grader, and **Can it go live?** with each check of the deploy rule, met or not.
- For a classifier, recall and precision per label and the confusion between labels. For free text, **Answers**: each
  held-out conversation with the expected answer, this version's and the live version's, with their scores and the
  judge's reasons, and a filter for **Worse than live**.
- **Mistakes**: up to 20 held-out rows it got wrong.
- **Model details**, **Model card** and **Deploy vN**.

Latency is measured on the test set, one request at a time. GPU time per 1M tokens is measured on the held-out rows,
in batches, on the machine that scored them; an admin sets each pool's price per hour under Settings › General ›
Compute prices to turn it into a cost.

## Compare two versions

On the model's **Versions** tab, tick two versions and click **Compare vA and vB**, or use **Compare with…** in a
version's menu. The page shows both versions' scores on the held-out rows, their data, settings and recipe, the
held-out answers that differ, and the rows added, removed or relabelled between their data. **Try name@N** opens the
Playground on a version, and **Deploy vN** deploys it.

## Test examples

Test examples are inputs with the answer they should get. Add one under **What it's tested on › Add test example**
(a message and the expected answer), or with **Save as test example** on an answer in the Playground. Each joins the
held-out rows of the next version's data, so the next version is scored on it and never trains on it. The dataset's
**Used by** list shows how many each model adds.
