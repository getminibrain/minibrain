---
title: Data
description: Add the rows a model learns from, shape them into a dataset and save the versions models train and are scored on.
sidebar:
  order: 1
---

A model learns from a dataset: rows of text the model reads, each with the answer it should give. You add sources
(files or tables), build a dataset from their columns and save dataset versions. Every training run and every score
uses one saved version, so results can be reproduced. All of it is under **Data** in the sidebar, which needs the
Builder role.

## What a model needs

- A column of text the model reads and a column with the answer it should give: a label such as `billing`, a short
  answer or JSON.
- Or conversations: a `messages` column of user and assistant turns that starts with the user and ends with the
  answer, as in OpenAI's chat format. System messages are skipped.
- At least 10 rows once empty and repeated inputs are removed. Under 100, scores move a lot between versions.
- For a classifier, at least two labels.

```csv title="tickets.csv"
text,label
I was charged twice for the same order,billing
The app crashes when I open settings,bug
Please send my money back,refund
```

```json title="chats.jsonl"
{"messages": [{"role": "user", "content": "Where is my refund?"}, {"role": "assistant", "content": "Refunds reach your card within 5 working days."}]}
```

## Add a source

Open **Data** and click **Add** (the + button, or press N). Each source becomes a table that datasets read.

| Source | Reads | Needs |
|---|---|---|
| Upload file | A CSV, TSV, JSON, JSON Lines or Parquet file | No setup |
| Folder on the server | Every file of one format in a folder on the minibrain server, read in place | An admin allows the folder under Settings › Security › Folder sources |
| Object storage | Parquet, CSV, TSV, JSON or JSON Lines objects under a bucket path or pattern (S3, MinIO, Ceph) | An S3 connection under Settings › Connections |
| Database | A PostgreSQL or MySQL table, or one read-only query | A database connection under Settings › Connections |
| Lakehouse table | An Iceberg table on S3, or a Delta Lake table in a server folder | An S3 connection, or an allowed folder |

- An uploaded file opens **New dataset** with the file as its source. You can also drop files on **Uploads**. A file
  is stored once; a different file with a name already taken asks whether to **Replace** it or **Keep both**.
- UTF-8, UTF-16 with a byte order mark and Windows-1252 text files are read.
- Sources read in place are read again each time a dataset version is saved. A database table tells when it changed
  through its **Updated-at column**; without one, every read counts as new data. Database reads are read-only and stop
  after 30 seconds.
- Delta Lake tables are read from folders on the server only, not from S3: mount the bucket on the server instead.
- A choice an admin has not set up yet is greyed out and says what is missing.

**Demo data** in the same menu adds a ready-made labelled file the same way: Demo travel intents (750 rows, 5 labels),
Demo Banking77 (13,083 rows, 77 labels) or Demo CLINC150 (23,850 rows, 151 labels).

## Create a dataset

**New dataset** (from **Add**, or **Create dataset** on a source) shows the query on the left and a live preview of
the rows on the right. **From sources…** in the same menu starts one from several sources at once. Datasets are
shared: several models can train on the same one. **New folder** groups them; drag a dataset onto a folder, or use
**Move to…** in its menu.

1. Under **Pick columns**, choose the **Source**. **Plus** combines more sources by column name.
2. Check **Text the model reads** and **Answer it should give**. Columns named like `text`, `input` or `question`, and
   `label`, `category`, `intent` or `answer`, are picked for you; change them in the column list under **Use as**.
3. Keep **Skip rows with no answer** on unless the empty answers mean something.
4. Optionally turn on **Clean up** steps, then check the preview's **Quality** findings.
5. Name the dataset and click **Create dataset**. This saves version 1.

| Clean-up step | What it does |
|---|---|
| Several labels | For an input that carries more than one label: keep its most common label, or drop the input |
| Cap per label | Keep at most this many rows of each label |
| Rare labels | Drop labels with fewer rows than this (10 by default) |
| Long inputs | Drop inputs over this many tokens (2,048 by default) |
| Personal data | Mask or drop rows with emails, phone numbers, card numbers and IBANs |

When you add a model, **Dataset › Upload new…** uploads a file and makes its dataset in one step, with the columns
guessed from their names or a `messages` column.

### Write SQL

For joins, filters or conversations, switch to **Write SQL**: DuckDB SQL over your sources that returns a column
named `input` and one named `label`, or a `messages` column. Each source is a table named after it, listed beside the
editor. Other columns are kept in each version. Queries are read-only and cannot reach other files or the network.
For a `tickets` source with `subject`, `body` and `category` columns:

```sql
SELECT subject || ' ' || body AS input, category AS label
FROM tickets
WHERE category IS NOT NULL
```

The preview runs as you type on sources under a million rows; on larger ones, press **Run** (Cmd/Ctrl+Enter).

## Dataset versions

A version is a saved copy of the query's rows. Models train and are scored on a version, never on the live sources.

- Saving a changed query (**Edit dataset**, then **Save**) makes the next version. When a source changes, the dataset
  page says "Sources changed since v1" and **Update** saves the next version. Until then, models keep training on the
  version they have. Identical rows are stored once.
- The version menu beside the title (`v2 · latest`) opens any version read-only: its rows, query, checks and the model
  versions that used it. **Compare versions…** shows rows added, removed and relabelled between two versions.
- **Train a model** on a dataset opens **Add model** with it picked. **Train from vN** on a version trains one of
  the models that use the dataset on that version, or starts a **New model…**.
- A dataset a training run is using cannot change or be deleted until the run ends.
- A version holds at most 200,000 rows by default. A larger query offers **Take a random sample of N rows**; the
  version records the sample and its seed, and **Save full version** in the dataset's menu saves every row once the
  limit allows. An admin changes the limit under Settings › Data › Most rows in one version.
- Versions a model version used are kept. Of the rest, the last 5 per dataset are kept and older ones are removed
  with their files (Settings › Data › Version retention).

## Splits

Each version sets rows aside once, at random with a fixed seed, so every model version made from it is scored on the
same rows:

| Split | Size | Used for |
|---|---|---|
| Test set | 10% of rows, at most 50 | A second score on every version; never trained on |
| Held-out | 15% of rows, at most 500 | The main score; never trained on |
| Few-shot | One row per label, up to 10 (3 for free text) | The examples in prompt-only versions such as v0 |
| Training | The rest | What training fits the adapter to |

[Test examples](evaluation.md#test-examples) you add to a model join the held-out rows of its next version. How the
splits are scored: [Evaluation](evaluation.md).

## Data quality

Every version runs checks, shown under **Data quality** on the dataset and in the editor's **Quality** tab:

- Stops the version: no row with both an input and an answer, or every row with the same label.
- Stops training: fewer than 10 rows (**Train a model** is greyed out and says why).
- Warns, never blocks: repeated inputs (training keeps the first), the same input with different labels, unbalanced
  labels (one label over 90% of rows, or a label under 10 rows), test or held-out inputs that also appear in training,
  empty or long inputs, and possible personal data (found by pattern; it can miss names and addresses).

A warning can be dismissed for one dataset. An admin turns checks off or changes their limits under Settings › Data.
