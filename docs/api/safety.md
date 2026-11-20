---
title: Safety model
description: What a call checked by a safety model returns, how to handle a refusal, and how to pick one per request.
sidebar:
  order: 8
---

A safety model is a guard model on your install that checks each request before the model answers it, and the
answer too when that is turned on. A blocked call still answers 200, with OpenAI's refusal shape, so your app handles
it like any other answer.

## Safety models

Install one like any base model ([Base models](../guides/models.md)). minibrain recognises these by name:

| Safety model | Reports |
|---|---|
| Llama Guard 3 (1B, 8B) | Its categories `S1` to `S14`, named, such as `S1: Violent crimes` |
| ShieldGemma (2B, 9B) | Which of four policies the call breaks: dangerous content, harassment, hate speech, sexually explicit content |
| Qwen3Guard Gen (0.6B, 4B, 8B) | Its own categories; a call it rates Controversial passes |
| gpt-oss-safeguard (20B, 120B) | The category of minibrain's built-in content policy that the call breaks |

## Which calls are checked

- A custom model uses its own safety model when a Builder set one for it, or none if they turned it off for that
  model.
- Otherwise the install's applies, set by an Admin; there is none by default. Base models served through `/v1`
  always follow the install's.
- Both can check answers as well as requests.

A custom model's **Overview** shows the one that applies under **Safety**. Admins and Builders set them through the
Management API (`PUT /api/settings/safety` and `PUT /api/models/{name}/safety`), listed under **API reference** in the
account menu.

## A blocked call

```json
{
  "id": "chatcmpl-2c7d9e0f1a3b4c5d6e7f8a9b0c1d2e3f",
  "object": "chat.completion",
  "created": 1763640000,
  "model": "support-triage",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "refusal": "The safety model llama-guard-3-1b blocked this request: S1: Violent crimes."
      },
      "finish_reason": "content_filter"
    }
  ],
  "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
  "safety": {"model": "llama-guard-3-1b", "stage": "prompt", "blocked": true, "categories": ["S1: Violent crimes"]}
}
```

- `message.content` is `null`, `message.refusal` names the safety model and what it found, and `finish_reason` is
  `content_filter`: check it to tell a refusal from an answer, as in the example below.
- `safety.stage` is `prompt` when the request was blocked and `answer` when the answer was. A call that passes carries
  the same object with `blocked: false`.
- Streams send the refusal as `delta.refusal`. Checking answers means the answer is generated in full before it
  streams.
- `/v1/completions` answers a blocked call with an empty `text`, `finish_reason: content_filter` and the same `safety`
  object.

## Pick a safety model per request

`safety` is a minibrain extension on both completion endpoints. It picks a safety model for a call to a model that
has none, and `answers: true` adds the answer check:

```python
import os

from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key=os.environ["MINIBRAIN_API_KEY"])
reply = client.chat.completions.create(
    model="qwen3-0.6b",
    messages=[{"role": "user", "content": "How do I reset my password?"}],
    extra_body={"safety": {"model": "llama-guard-3-1b", "answers": True}},
)
choice = reply.choices[0]
if choice.finish_reason == "content_filter":
    print("Blocked:", choice.message.refusal)
else:
    print(choice.message.content)
```

```sh
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Authorization: Bearer $MINIBRAIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-0.6b",
    "messages": [{"role": "user", "content": "How do I reset my password?"}],
    "safety": {"model": "llama-guard-3-1b", "answers": true}
  }'
```

A request can add the answer check to a configured safety model, but cannot change or turn it off: naming another
one is a 400 with `param: safety.model`. So is a name that is not a safety model on the install.

## When the safety model cannot answer

If the safety model cannot check a call, the call fails with a 503 rather than going through unchecked.

## Logs and audit

A blocked `/v1` call keeps its request log, with `finish_reason: content_filter`; **Monitoring → Requests** shows
**Blocked by** with the safety model and categories. It also writes a `safety.block` event to the audit log, with the
API key as actor, the stage, the categories and the response ID, never the content ([Audit log](../security/audit.md)).
