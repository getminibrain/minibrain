---
title: Quickstart
description: Install minibrain, add the demo model and get its first answer over the OpenAI-compatible API, in three steps.
sidebar:
  order: 2
---

Three steps take you from an empty machine to an answer from a model over the API, with no training. You need Linux
or a Mac with Apple silicon, and internet access for the downloads.

## 1. Install and start

Install minibrain and start it:

```sh
curl -LsSf https://raw.githubusercontent.com/getminibrain/minibrain/main/install.sh | sh
minibrain serve
```

You should see a one-time setup link in the terminal. Open it, enter an email and a password of at least 12
characters, and click **Create admin account**. You land on **Home**.

## 2. Add the demo model

Open **Models** and click **Try with demo data**.

You should see "Demo model added". minibrain adds 750 travel support messages as a dataset and a model named
**Demo travel intents** on Qwen3 0.6B, which it downloads first. Open the model: when the download ends, version 0
is scored on the held-out rows, and the score is on the **Evaluation** tab.

## 3. Deploy and call it

A model answers its API name once a version is deployed.

1. When version 0 has its score, click **Deploy** in the model's header, then **Deploy v0**. The header reads
   **Deployed · v0 on local**.
2. Click **Use** › **API Connect**, then **Create a key**. **Add it to your code** shows the call with your key
   filled in, and **Send test request** sends one from the dialog.

The same call from your own code, with your key in place of `mb_…` (Python needs `pip install openai`):

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key="mb_…")
reply = client.chat.completions.create(
    model="demo-travel-intents",
    messages=[{"role": "user", "content": "My suitcase did not arrive"}],
)
print(reply.choices[0].message.content)
```

```sh
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Authorization: Bearer mb_…" \
  -H "Content-Type: application/json" \
  -d '{"model": "demo-travel-intents", "messages": [{"role": "user", "content": "My suitcase did not arrive"}]}'
```

You should see the model's answer, in `choices[0].message.content`: an intent such as `lost_luggage`. The dialog's
**Check the connection** line turns green when the call arrives.

## Next

- [Your first model](first-model.md): the same path on your own data, with training.
- [Installation](installation.md): every way to install.
- [API overview](../api/overview.md): keys, endpoints and errors.
