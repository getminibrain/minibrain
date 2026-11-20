---
title: Chat completions
description: Send a conversation to a model with POST /v1/chat/completions, set sampling, and read the answer.
sidebar:
  order: 2
---

`POST /v1/chat/completions` answers a conversation. It takes OpenAI's request body and returns OpenAI's response, so
any OpenAI client can call it ([API overview](overview.md)).

## Send a conversation

```python
import os

from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key=os.environ["MINIBRAIN_API_KEY"])
reply = client.chat.completions.create(
    model="support-triage",
    messages=[{"role": "user", "content": "I was charged twice for my order"}],
    max_tokens=20,
)
print(reply.choices[0].message.content)
```

```sh
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Authorization: Bearer $MINIBRAIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "support-triage",
    "messages": [{"role": "user", "content": "I was charged twice for my order"}],
    "max_tokens": 20
  }'
```

```json
{
  "id": "chatcmpl-5f0c2a1e9b7d4c3a8e6f1d2b3c4a5e6f",
  "object": "chat.completion",
  "created": 1763640000,
  "model": "support-triage",
  "choices": [
    {"index": 0, "message": {"role": "assistant", "content": "billing"}, "finish_reason": "stop"}
  ],
  "usage": {"prompt_tokens": 61, "completion_tokens": 2, "total_tokens": 63}
}
```

## Messages

`messages` takes `system`, `developer` (read as `system`), `user`, `assistant` and `tool` messages. Content is a
string, or a list of `{"type": "text", "text": "…"}` parts, which are joined. Any other part, such as an image, is a
400 naming it in `param`, for example `messages[0].content[1]`.

How the model reads them depends on what it is:

- A base model reads every message as you send it, through its own chat template.
- A custom model reads its own instructions first, then, for a version that is not trained (such as v0), the
  examples it was given. Your `user`, `assistant` and `tool` messages follow; your `system` and `developer` messages
  are dropped. The last message has to be a `user` message with text or a `tool` result, otherwise the call is a 400
  with `param: messages`.

A custom model that answers with labels or a JSON schema always answers that way
([Structured output](structured-output.md#models-with-a-contract)).

## Sampling

A field you leave out is not sent, so the model's own default applies; it can differ by engine. A custom model
answers at temperature 0 unless the request sets one, the way its scores were measured.

| Parameter | Range | Default | Notes |
|---|---|---|---|
| `temperature` | 0 to 2 | The model's; 0 for custom models | 0 picks the likeliest token every time; higher is more varied |
| `top_p` | above 0, up to 1 | The model's | Samples only from the likeliest tokens whose probabilities add up to `top_p` |
| `top_k` | 1 or more | The model's | Samples only from the `k` likeliest tokens. Extension |
| `min_p` | 0 to 1 | The model's | Drops tokens less likely than `min_p` times the likeliest one. Extension |
| `presence_penalty` | -2 to 2 | The model's | Above 0 favours tokens that have not appeared yet |
| `frequency_penalty` | -2 to 2 | The model's | Above 0 lowers a token's odds the more often it has appeared |
| `repetition_penalty` | above 0, up to 2 | The model's | Above 1 discourages repeating any token seen so far. Extension |
| `seed` | any integer | None | The same seed and inputs sample the same way, as far as the engine allows |
| `max_tokens` | 1 or more | The context limit | The most tokens to answer with |
| `max_completion_tokens` | 1 or more | The context limit | The same as `max_tokens`; it wins when both are set |
| `stop` | up to 4 texts | None | Each ends the answer where it appears and is not returned; each needs one character or more |
| `n` | 1 | 1 | Only one answer per request |

The extensions are the ones vLLM and SGLang share. With the Python SDK they go in `extra_body`:

```python
import os

from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key=os.environ["MINIBRAIN_API_KEY"])
reply = client.chat.completions.create(
    model="qwen3-0.6b",
    messages=[{"role": "user", "content": "Name three rivers in Europe."}],
    temperature=0.7,
    seed=42,
    extra_body={"top_k": 20, "min_p": 0.05},
)
print(reply.choices[0].message.content)
```

A value out of range is a 400 with the field in `param`. A field the serving engine cannot honour is a 400 with
`code: unsupported_parameter`, never silently ignored; so are `logprobs` and `logit_bias`. GGUF models run with a
4,096-token context window, which the prompt and the answer share.

## Read the answer

| Field | Holds |
|---|---|
| `id` | `chatcmpl-…`, also the **Response ID** on **Monitoring → Requests**. Send it with feedback |
| `model` | The name you sent |
| `choices[0].message.content` | The answer; `null` when the model only calls tools or the call was blocked |
| `choices[0].message.reasoning_content` | The model's reasoning, when it reasons ([Reasoning](reasoning.md)) |
| `choices[0].message.tool_calls` | The functions it calls ([Tool calling](tool-calling.md)) |
| `choices[0].message.refusal` | Why a safety model blocked the call ([Safety model](safety.md)) |
| `choices[0].finish_reason` | `stop`, `length` (cut by `max_tokens`), `tool_calls` or `content_filter` |
| `usage` | `prompt_tokens` (the whole prompt the model read), `completion_tokens` and `total_tokens` |
| `safety` | The safety model's verdict, when one checked the call |

## Send feedback on an answer

`POST /v1/feedback` rates or corrects an answer from a custom model. It waits on the **Feedback** page for review;
accepted answers join the model's next training data ([Train a version](../guides/training.md)).

```sh
curl http://127.0.0.1:8000/v1/feedback \
  -H "Authorization: Bearer $MINIBRAIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "support-triage",
    "response_id": "chatcmpl-5f0c2a1e9b7d4c3a8e6f1d2b3c4a5e6f",
    "rating": "down",
    "correction": "refund",
    "input": "Please send my money back, I was charged twice"
  }'
```

It answers 201 with `{"id": 42, "object": "feedback", "status": "pending"}`.

- `rating` is `up` or `down`. A `correction`, the right answer, goes only with `down`.
- `input` is the user message the model answered. Leave it out only when the model keeps request inputs and answers;
  otherwise the call is a 422 that says so. `output` (the answer your app received) and `comment` are optional.
- Feedback for the same `response_id` replaces the one still waiting for review.
- A base model takes no feedback (422).
