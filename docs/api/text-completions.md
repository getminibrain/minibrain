---
title: Text completions
description: Continue a raw prompt without the chat template with POST /v1/completions, for code completion and base models.
sidebar:
  order: 7
---

`POST /v1/completions` is OpenAI's legacy text completion API. The prompt goes to the model as it is, without the
chat template, and the answer is the text that follows it. Use it for code completion, for base models that were not
tuned for chat, and for tools that still call the completions API.

## Continue a prompt

```python
import os

from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key=os.environ["MINIBRAIN_API_KEY"])
reply = client.completions.create(
    model="qwen3-0.6b",
    prompt="def fibonacci(n):",
    max_tokens=64,
    stop=["\n\n"],
)
print(reply.choices[0].text)
```

```sh
curl http://127.0.0.1:8000/v1/completions \
  -H "Authorization: Bearer $MINIBRAIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen3-0.6b", "prompt": "def fibonacci(n):", "max_tokens": 64, "stop": ["\n\n"]}'
```

```json
{
  "id": "cmpl-0d4e7a9c2b1f4e8d9a6c3b5e7f1a2d4c",
  "object": "text_completion",
  "created": 1763640000,
  "model": "qwen3-0.6b",
  "choices": [
    {
      "index": 0,
      "text": "\n    if n < 2:\n        return n\n    return fibonacci(n - 1) + fibonacci(n - 2)",
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {"prompt_tokens": 5, "completion_tokens": 27, "total_tokens": 32}
}
```

`finish_reason` is `stop` when the text ended or reached a `stop` text, `length` when `max_tokens` cut it, and
`content_filter` when a safety model blocked the call.

## Request fields

- `prompt`: one text, or a list holding one text. A longer list or token ids are a 400.
- `max_tokens`: 16 when unset, as in OpenAI's API. Raise it for anything longer than a line.
- Sampling: `temperature`, `top_p`, `top_k`, `min_p`, `presence_penalty`, `frequency_penalty`,
  `repetition_penalty`, `seed` and `stop`, with the same ranges as chat ([Chat completions](chat-completions.md#sampling)).
- `n` and `best_of` take only 1. `logprobs`, `echo: true`, `suffix` and `logit_bias` are a 400 with
  `code: unsupported_parameter`. `user` is accepted and ignored.

The prompt is sent with only the model's start-of-text token in front, where it has one. The answer is read as plain
text: reasoning is not split out and tool calls are not read.

## Custom models

A custom model answers with its version's trained adapter, but without its instructions, examples or contract: the
prompt is all it reads. A version that was not trained (such as v0) answers as its base model. Like chat, a custom
model answers at temperature 0 unless the request sets one.

## Stream the text

With `"stream": true` the text arrives as `text_completion` chunks, each with the next piece in `choices[0].text`. The
last chunk has an empty `text`, the `finish_reason` and the `usage`, and `data: [DONE]` ends the stream.
`stream_options: {"include_usage": true}` moves the usage to a chunk of its own, as in chat:

```python
import os

from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key=os.environ["MINIBRAIN_API_KEY"])
stream = client.completions.create(model="qwen3-0.6b", prompt="def fibonacci(n):", max_tokens=64, stream=True)
for chunk in stream:
    if chunk.choices:
        print(chunk.choices[0].text, end="", flush=True)
print()
```

Errors during a stream behave as in chat ([Streaming](streaming.md#errors-during-a-stream)).

## Logs and safety

Text completions share the chat path's keys, model names, request log and safety model. **Monitoring → Requests**
shows them as **Completion** in the **Endpoint** column. A call a safety model blocks answers 200 with an empty `text`,
`finish_reason: content_filter` and the `safety` verdict ([Safety model](safety.md)).
