---
title: Tool calling
description: Let a model call your functions with tools and tool_choice, and send the results back.
sidebar:
  order: 5
---

`/v1/chat/completions` takes OpenAI's `tools`. The model can answer with calls to your functions instead of text;
your app runs them and sends the results back in the next request, and the model answers with them in hand.

## Models that call tools

Tools work with base models whose chat template has a tool-call format minibrain reads:

| Family | Models |
|---|---|
| Qwen and Hermes | Qwen 2.5, Qwen3, Hermes, SmolLM3 |
| Llama | Llama 3.1, 3.2 and 3.3 |
| Mistral | Mistral 7B v0.3, Nemo, Small |
| gpt-oss | gpt-oss |

The format is read from the model's own chat template, so imported and Hugging Face models of these families work
too. A model without one refuses `tools` with a 400. A free-text custom model takes tools, with its own instructions
first; a custom model that answers with labels or a JSON schema takes none (400, `param: tools`).

## Call a function

The model answers with `tool_calls` and `finish_reason: tool_calls`. Send its message back with a `tool` message per
call, each with the call's `tool_call_id`, then ask again:

```python
import json
import os

from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key=os.environ["MINIBRAIN_API_KEY"])
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_order_status",
            "description": "Look up the status of an order by its number.",
            "parameters": {
                "type": "object",
                "properties": {"order_id": {"type": "string"}},
                "required": ["order_id"],
            },
        },
    }
]


def get_order_status(order_id: str) -> dict:
    return {"order_id": order_id, "status": "shipped"}


messages = [{"role": "user", "content": "Where is order 1042?"}]
reply = client.chat.completions.create(model="qwen3-0.6b", messages=messages, tools=tools)
message = reply.choices[0].message
if message.tool_calls:
    messages.append(message.model_dump(exclude_none=True))
    for call in message.tool_calls:
        result = get_order_status(**json.loads(call.function.arguments))
        messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(result)})
    reply = client.chat.completions.create(model="qwen3-0.6b", messages=messages, tools=tools)
print(reply.choices[0].message.content)
```

The first request with curl:

```sh
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Authorization: Bearer $MINIBRAIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-0.6b",
    "messages": [{"role": "user", "content": "Where is order 1042?"}],
    "tools": [{"type": "function", "function": {
      "name": "get_order_status",
      "description": "Look up the status of an order by its number.",
      "parameters": {"type": "object", "properties": {"order_id": {"type": "string"}}, "required": ["order_id"]}
    }}]
  }'
```

Its message looks like this:

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_8f2c41d0b6a95e7310c4d2aa",
      "type": "function",
      "function": {"name": "get_order_status", "arguments": "{\"order_id\": \"1042\"}"}
    }
  ]
}
```

## Choose when it calls

| `tool_choice` | The model |
|---|---|
| `auto` (the default with tools) | Decides whether to call a function or answer in text |
| `none` | Answers in text; the tools are not shown to it |
| `required` | Calls one of the tools |
| `{"type": "function", "function": {"name": "get_order_status"}}` | Calls that function |

`parallel_tool_calls: false` keeps only the first call the model makes; by default every call is kept.

## Limits

- Up to 128 tools per request. Function names are 1 to 64 letters, digits, underscores or dashes, unique within the
  request, and `parameters` must be a valid JSON Schema object.
- `strict` on a function is accepted; the arguments are not constrained to the schema. Arguments the model writes as
  invalid JSON stay in `content`, with no `tool_calls`.
- A `tool` message needs the `tool_call_id` of the call it answers (400 otherwise).
- `functions` and `function_call`, OpenAI's old names, are a 400 that points to `tools` and `tool_choice`.

## Streaming

With `stream: true` the calls arrive as `delta.tool_calls`, each with its `index`, `id`, name and arguments. A call is
sent whole once the model has finished writing it, not argument by argument ([Streaming](streaming.md)).
