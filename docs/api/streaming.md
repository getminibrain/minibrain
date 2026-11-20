---
title: Streaming
description: Receive an answer token by token as server-sent events with stream set to true.
sidebar:
  order: 3
---

With `"stream": true`, `/v1/chat/completions` sends the answer as server-sent events while the model generates it,
the same `chat.completion.chunk` events OpenAI sends. Stream when a person watches the answer appear.

## Stream an answer

```python
import os

from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key=os.environ["MINIBRAIN_API_KEY"])
stream = client.chat.completions.create(
    model="qwen3-0.6b",
    messages=[{"role": "user", "content": "Write a haiku about the sea."}],
    stream=True,
)
for chunk in stream:
    if chunk.choices:
        print(chunk.choices[0].delta.content or "", end="", flush=True)
print()
```

```js title="stream.mjs"
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "http://127.0.0.1:8000/v1", apiKey: process.env.MINIBRAIN_API_KEY });
const stream = await client.chat.completions.create({
  model: "qwen3-0.6b",
  messages: [{ role: "user", content: "Write a haiku about the sea." }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

```sh
curl -N http://127.0.0.1:8000/v1/chat/completions \
  -H "Authorization: Bearer $MINIBRAIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen3-0.6b", "stream": true, "messages": [{"role": "user", "content": "Write a haiku about the sea."}]}'
```

## The events

Each event is a `data:` line holding one chunk. The first delta carries `role: assistant`, the last chunk carries the
`finish_reason` and the `usage`, and `data: [DONE]` ends the stream:

```text
data: {"id": "chatcmpl-9b1e…", "object": "chat.completion.chunk", "created": 1763640000, "model": "qwen3-0.6b", "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Grey"}, "finish_reason": null}]}

data: {"id": "chatcmpl-9b1e…", "object": "chat.completion.chunk", "created": 1763640000, "model": "qwen3-0.6b", "choices": [{"index": 0, "delta": {"content": " waves fold"}, "finish_reason": null}]}

data: {"id": "chatcmpl-9b1e…", "object": "chat.completion.chunk", "created": 1763640000, "model": "qwen3-0.6b", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 17, "completion_tokens": 21, "total_tokens": 38}}

data: [DONE]
```

A delta can hold:

- `content`: the next piece of the answer.
- `reasoning_content`: the next piece of the model's reasoning, kept apart from the answer ([Reasoning](reasoning.md)).
- `tool_calls`: a function call with its `index`, sent whole once the model has finished writing it
  ([Tool calling](tool-calling.md)).
- `refusal`: why a safety model blocked the call ([Safety model](safety.md)).

## Usage in its own chunk

`stream_options: {"include_usage": true}` moves the usage to an extra chunk after the `finish_reason`, with an empty
`choices` list, as OpenAI does. Skip chunks without choices when you read the content:

```python
import os

from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key=os.environ["MINIBRAIN_API_KEY"])
stream = client.chat.completions.create(
    model="qwen3-0.6b",
    messages=[{"role": "user", "content": "Write a haiku about the sea."}],
    stream=True,
    stream_options={"include_usage": True},
)
for chunk in stream:
    if chunk.choices:
        print(chunk.choices[0].delta.content or "", end="", flush=True)
    elif chunk.usage:
        print(f"\n{chunk.usage.total_tokens} tokens")
```

## Answers that arrive in one piece

Some answers have to be checked before any of them is sent, so they are generated in full, checked, then sent as one
content delta followed by the closing chunk:

- answers held to `response_format` ([Structured output](structured-output.md));
- answers from a custom model that answers with labels or its own JSON schema;
- answers a safety model checks as well as the request.

Because nothing has been sent yet, a failed check still arrives as an ordinary error status, such as a 422.

## Errors during a stream

- A failure before the first token is an ordinary error response with its status code ([Errors](overview.md#errors)).
- A failure after it sends a `data:` event holding an `error` object, then `data: [DONE]`. The OpenAI SDKs raise it as
  an error.
- If your client closes the connection early, the request log records the call with status 499.

Text completions stream the same way, as `text_completion` chunks ([Text completions](text-completions.md#stream-the-text)).
