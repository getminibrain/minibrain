---
title: API overview
description: Call your models from an app through minibrain's OpenAI-compatible /v1 API, with an API key and any OpenAI client.
sidebar:
  order: 1
---

minibrain serves every deployed model on an OpenAI-compatible API under `/v1`. Any OpenAI client works: point it at
your install's base URL, give it a minibrain API key, and send a model's API name as `model`.

## Base URL

The base URL is your install's address followed by `/v1`, for example `http://127.0.0.1:8000/v1` on a default install.
A model's **Use → API Connect** dialog shows it under **Base URL**, next to the model's API name. Installs with
standalone gateways serve `/v1` from those too, usually behind a load balancer
([Architecture](../reference/architecture.md)).

## Create an API key

An API key names the models it may call. Builders and Admins create them.

1. Open **API keys** in the sidebar and click **Create key**.
2. **Name** it after the app that will use it. The name shows in the key list and the request log.
3. Under **Models**, pick the models it may call. Admins also see **Scope**, where **All models** covers every model
   on the install, including models added later.
4. **Expires**: **Install default**, 30, 90 or 180 days, or 1 year. An admin can cap expiry for every new key with
   the API key expiry policy ([Policies](../security/policies.md)); with no cap, the install default never expires.
5. Click **Create key**. The key starts with `mb_` and is shown once: copy it now.

**Use → API Connect** on a model creates a key for that model alone in one click, and the model's **API keys** tab
lists the keys that can call it. **Edit scope** and **Revoke** are in each key's row menu; changes reach the gateways
within a second. Turning off an account deletes the keys it created.

Send the key as a bearer token on every request, `Authorization: Bearer mb_…`. The examples on these pages read it
from the environment:

```sh
export MINIBRAIN_API_KEY=mb_…
```

## Name the model

| `model` | Calls |
|---|---|
| `support-triage` | A custom model's live version. When you deploy another version, the same name answers with it. |
| `support-triage@2` | Version 2 of that model, whether it is deployed or not. |
| `qwen3-0.6b` | A base model deployed on its own, by its key ([Deployments](../guides/deployments.md)). |

A custom model's API name never changes and is never reused. `GET /v1/models` lists every name the key can call:

```sh
curl http://127.0.0.1:8000/v1/models -H "Authorization: Bearer $MINIBRAIN_API_KEY"
```

```json
{"object": "list", "data": [
  {"id": "support-triage", "object": "model", "created": 0, "owned_by": "minibrain"},
  {"id": "support-triage@0", "object": "model", "created": 0, "owned_by": "minibrain"},
  {"id": "support-triage@1", "object": "model", "created": 0, "owned_by": "minibrain"}
]}
```

## Use an OpenAI SDK

With the OpenAI Python SDK (`pip install openai`):

```python title="app.py"
import os

from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key=os.environ["MINIBRAIN_API_KEY"])
reply = client.chat.completions.create(
    model="support-triage",
    messages=[{"role": "user", "content": "I was charged twice for my order"}],
)
print(reply.choices[0].message.content)
```

With the OpenAI JavaScript SDK (`npm install openai`):

```js title="app.mjs"
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "http://127.0.0.1:8000/v1", apiKey: process.env.MINIBRAIN_API_KEY });
const reply = await client.chat.completions.create({
  model: "support-triage",
  messages: [{ role: "user", content: "I was charged twice for my order" }],
});
console.log(reply.choices[0].message.content);
```

With curl:

```sh
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Authorization: Bearer $MINIBRAIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "support-triage", "messages": [{"role": "user", "content": "I was charged twice for my order"}]}'
```

The SDKs also read `OPENAI_BASE_URL` and `OPENAI_API_KEY`, so tools built on them work with those two variables set.
Fields that are not in OpenAI's API, such as `top_k` or `safety`, go in `extra_body` with the Python SDK.

## Endpoints

| Endpoint | Does |
|---|---|
| `GET /v1/models` | Lists the names the key can call |
| `POST /v1/chat/completions` | Answers a conversation ([Chat completions](chat-completions.md)) |
| `POST /v1/completions` | Continues a prompt without the chat template ([Text completions](text-completions.md)) |
| `POST /v1/feedback` | Rates or corrects an answer ([Chat completions](chat-completions.md#send-feedback-on-an-answer)) |

Every field and response of these endpoints is in the [API reference](https://getminibrain.com/docs/api-reference).
The full schema, with the `/api` routes the UI calls, is in minibrain: open the account menu, then **API reference**.

## Errors

A request the gateway refuses gets an OpenAI `error` object, with the field at fault in `param`:

```json
{"error": {"message": "temperature: Input should be less than or equal to 2", "type": "invalid_request_error",
           "param": "temperature", "code": "invalid_value"}}
```

| Status | Means | Body |
|---|---|---|
| 400 | A field is invalid, out of range, or not supported by this model or its engine | `error` |
| 401 | The key is missing, unknown or expired | `detail` |
| 403 | The key does not cover this model | `detail` |
| 404 | No model has this name, or it is not deployed: the message names a version to call instead | `error`, `model_not_found` |
| 409 | The version was trained on base weights that have changed since | `detail` |
| 413 | The body is larger than 32 MiB | `error`, `body_too_large` |
| 422 | The answer does not match `response_format` or the model's JSON schema | `error` |
| 503 | The gateway is already answering as many calls as it takes at once; `Retry-After` says when to try again | `error`, `overloaded` |
| 503 | No engine can answer yet (still loading or fetching weights), or the safety model cannot check the call | `detail` |

The `detail` rows answer with a plain message, such as `{"detail": "this API key does not cover support-triage"}`.
The OpenAI SDKs raise both kinds as their usual exceptions (`openai.BadRequestError`, `openai.AuthenticationError`
and so on), with `param` and `code` set when the body has them. Keys are not rate-limited: there is no 429.

### Busy and starting models

- Each gateway answers up to 64 chat and text completions at once, streams included (`MINIBRAIN_GATEWAY_CONCURRENCY`,
  [Configuration](../install/configuration.md#environment-variables)). One more is refused at once with a 503 and
  `Retry-After: 5`, so model traffic never slows the UI, workers or jobs on main.
- A call to a model whose engine is still starting or fetching weights waits up to 5 seconds, then gets a 503 with
  `Retry-After: 10`; the engine keeps starting.
- The OpenAI SDKs retry a 503 twice by default and wait as `Retry-After` says. Raise `max_retries` for models that
  take longer than about half a minute to start.

## What differs from OpenAI

- `model` is one of your install's names, not an OpenAI model.
- A custom model answers after its own instructions and drops your system messages; one that answers with labels or
  a JSON schema keeps to them ([Chat completions](chat-completions.md#messages)).
- Messages are text only. Image, audio and file parts are a 400.
- `n` and `best_of` take only 1. `logprobs`, `logit_bias`, and the old `functions` and `function_call` are a 400.
- Extensions: `top_k`, `min_p`, `repetition_penalty` and `safety` in requests; `reasoning_content` and `safety` in
  answers. Other OpenAI fields, such as `user` or `metadata`, are accepted and ignored.
- Only the four endpoints above exist: there are no embeddings, images, audio, files or Responses API.

Every call is logged with its model, version, key, status, latency and token counts. Its content is kept only when
the model's **Keep request inputs and answers** switch, on its **Settings** tab, is on.
