# Your first model

From an empty install to an app calling a model trained on your own data, through the OpenAI-compatible API.

This walkthrough builds a classifier that sorts support messages into labels such as `billing`, `bug` and `refund`.
The same steps make a chat assistant or a model that answers in JSON; only the Output choice in step 3 changes. Home's
**Get started** checklist follows the same steps and ticks each one off from what is on the install.

You need:

- minibrain installed and running ([Install](install.md)). The commands below use `http://127.0.0.1:8000`, the
  default address.
- A CSV with a column of text and a column of labels, at least 10 rows. Under 100 rows the scores are rough.
- A machine that can train the base model you pick: an NVIDIA, AMD or Intel GPU, Apple silicon, or a CPU for the
  smallest bases.

## 1. Create the admin

On its first start, `minibrain serve` prints a one-time setup link and opens it in the browser:

```text
  minibrain has no admin account yet. Create it with this one-time setup link:

    http://127.0.0.1:8000/setup?token=…
```

1. Open the link. The page says **Welcome to minibrain**.
2. Enter an email, then a password of at least 12 characters twice.
3. Click **Create admin account**. You are signed in and land on **Home**.

In Docker the link is in the container log: `docker logs minibrain | grep setup`. Lost it:
`minibrain admin setup-link` prints a new one. Every other way to create the first admin:
[Install → First admin](install.md#first-admin).

## 2. Add data

A model is built on a dataset: rows of text the model reads and the answer it should give. Save this as `tickets.csv`
and add more rows, or use your own file:

```csv
text,label
I was charged twice for the same order,billing
The app crashes when I open settings,bug
Please send my money back,refund
```

1. Open **Data**, click **Add** (the + button, or press N), then **Upload file**. CSV, TSV, JSON, JSON Lines and
   Parquet files work.
2. minibrain opens **New dataset** with the file as its source. Under **Pick columns**, check **Text the model reads**
   and **Answer it should give**. Columns named like `text` and `label` (or `input`, `question`, `intent`,
   `category`, `answer`) are picked for you; change them in the column list with **Text** and **Answer**.
3. Check the name, taken from the file, and click **Create dataset**. This saves version 1 of its rows.

Each dataset version sets aside held-out rows (15%, at most 500) that no version ever trains on. Every version of
the model is scored on them, so scores stay comparable.

Other ways in, from the same **Add** menu:

- **Demo data**: **Demo travel intents** is 750 travel support messages in 5 intents, enough to try every step.
- **Database**, **Object storage**, **Folder on the server** and **Lakehouse table** read rows in place, through a
  connection or an allowed folder an admin sets up under **Settings → Connections** and **Settings → Security**.

In **Add model**, **Dataset → Upload new…** uploads a file and makes the dataset in one step.

## 3. Add the model

1. Open **Models** and click **Add model**.
2. **Base**: the open model to build on. The picker puts the catalogue models that suit your machines first; its
   filters include **Fits your compute** and **Trains on your compute**. A base that is not on the install yet
   downloads in the background once you create the model ([Models → Catalogue](models.md#catalogue)).
3. **Format**: keep a full-precision format. Quantized formats serve but cannot be trained.
4. **Dataset**: the dataset from step 2.
5. **Output**: suggested from the dataset's answers. For a label column it suggests **Labels** and fills in the
   labels it found; edit the list if needed. Labels makes a classifier (the Classify preset), scored by label
   accuracy. **Free text** makes a chat assistant; **JSON** holds every answer to a schema.
6. **Name**: replace the generated name, for example `Support triage`. **API name** shows the name apps call,
   `support-triage`. It never changes and is never reused.
7. **Licence**: tick **I accept the … for this install** when the base is downloaded.
8. Click **Create model**. The model page opens.

The Docker image starts with outbound calls off ([Docker → Environment](install.md#environment)), so it cannot
download a base. Start the container with `-e MINIBRAIN_OFFLINE=0 -e HF_HUB_OFFLINE=0`, or mount the weights and import
them from **Base → Your imports → Server folder** ([Model weights](install.md#model-weights)).

## 4. Read the baseline

Creating the model makes **v0**, the untrained baseline: the base with the preset's instructions and a few examples
from the data. It is scored on the held-out rows as soon as the base is on the install.

- The model's **Evaluation** tab shows the score under **Scores** and the rows v0 gets wrong under **Where it fails**.
- **Use → Playground** in the model header lets you try it on your own text.
- v0 can be deployed as it is. If its score is already good enough, skip to step 7.

## 5. Train version 1

1. Click **Train** in the model header. The page is titled **Train version v1 of Support triage**.
2. **Method**: **Supervised fine-tuning (SFT)** trains a LoRA adapter on the base.
3. **Data** picks the dataset version, the latest by default. **Pool** picks where it trains; **Automatic** is right
   on one machine.
4. **Training** starts on **Balanced**. **Fast** and **Best** trade time for quality; **Custom** opens every
   parameter. The **Run summary** estimates the time and memory.
5. Click **Train v1**.

The version page follows the run, with the loss on training and held-out rows. When training ends, v1 is scored on
the same held-out rows as v0. **Training** in the sidebar lists every run. When **Train** is greyed out, its tooltip
says why: the base is still downloading, the dataset has too few rows, or the base is quantized.

## 6. Compare on Evaluations

Open **Evaluations** in the sidebar. Each model has one row with its latest scored version, its **Label accuracy** on
the held-out rows, the change **vs live** and whether it passes the **Deploy rule**.

1. Turn on **Show all versions** to list v0 and v1 one under the other.
2. Click v1. The headline compares it with the baseline, such as `v0 64% → v1 92%`, above its scores per grader and,
   under **Mistakes**, up to 20 held-out rows it got wrong.

Classify's deploy rule passes a version that scores at least as well as the live one on label accuracy; with nothing
live yet, every scored version passes. Change the rule under the model's **Evaluation → How it's scored**. To read
the answers that differ, tick both versions on the model's **Versions** tab and click **Compare v0 and v1**.

## 7. Deploy

1. Click **Deploy** in the model header. The dialog picks the best-scoring version; check that **Version** shows v1.
2. **Pool**: **Automatic** puts it on this machine when it fits. Leave **Replicas** at 1.
3. Click **Deploy v1**.

**Deploy v1** on the Evaluations row does the same with the automatic pool. The header says **Deploying v1** while
the model loads, then **Deployed · v1 on local**. From now on `support-triage` is answered by v1, and each version
stays callable by number, such as `support-triage@0`. Pools, replicas and moves:
[Serving → Deployments on a pool](serving.md#deployments-on-a-pool).

## 8. Create an API key

An API key names the models it may call.

1. In the model header, open **Use → API Connect**. The dialog shows the **Base URL**, `http://127.0.0.1:8000/v1`,
   and the **Model**, `support-triage`.
2. Under **Get an API key**, click **Create a key**. The key starts with `mb_` and is shown once: copy it now.
3. **Add it to your code** has ready snippets with the key filled in: curl, Python, JavaScript, LangChain and more.
4. **Check the connection** turns green when the first call arrives; **Send test request** sends one from the dialog.

For a key with its own name, several models or an expiry, use **Create key** on the model's **API keys** tab or on
the **API keys** page. The examples below read the key from the environment:

```sh
export MINIBRAIN_API_KEY=mb_…
```

## 9. Call the model

The endpoint is OpenAI's `/v1/chat/completions`: any OpenAI client works with the base URL, the key and the API name
as the model. With the OpenAI Python SDK (`pip install openai`):

```python
import os

from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key=os.environ["MINIBRAIN_API_KEY"])
reply = client.chat.completions.create(
    model="support-triage",
    messages=[{"role": "user", "content": "I was charged twice for my order"}],
)
print(reply.choices[0].message.content)
```

With curl:

```sh
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Authorization: Bearer $MINIBRAIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "support-triage",
    "messages": [{"role": "user", "content": "I was charged twice for my order"}]
  }'
```

The answer, in `choices[0].message.content`, is a single label such as `billing`. The model's instructions are applied
for you, it answers at temperature 0 unless the request sets one, and its answers are held to the label set
([Serving → Structured output](serving.md#structured-output)). `"model": "support-triage@0"` calls the baseline
instead, deployed or not. `GET /v1/models` lists every name the key can call.

| Status | Means |
|---|---|
| 401 | The key is missing, unknown or expired |
| 403 | The key does not cover this model |
| 404, `support-triage is not deployed` | Deploy it (step 7), or call a version such as `support-triage@1` |

Streaming, sampling, tool calling and reasoning work as in OpenAI's API: [Serving](serving.md).

## 10. Watch it run

**Monitoring → Requests** lists every `/v1` call, newest first, and the model's **Monitoring** tab charts its
requests, latency and errors per version. The audit log under **Settings → Audit log** records the model, the
training run, the deploy and the key. To send metrics and traces to your own tools: [Observability](observability.md).

## Next steps

- Improve it: rate or correct answers in the **Playground**, accept them under **Feedback**, then **Train** again.
  The new version takes the accepted rows, is scored on the same held-out rows and is compared with the live one
  ([Training](training.md)).
- Add GPU machines to train and serve larger models: [Joining machines](machines.md).
- Invite your team and set who may do what: [Security → Accounts and sign-in](security.md#accounts-and-sign-in).
- How the pieces fit together: [Architecture](architecture.md).
