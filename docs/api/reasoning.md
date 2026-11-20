---
title: Reasoning
description: Turn a model's reasoning on or off with reasoning_effort, and read it apart from the answer.
sidebar:
  order: 6
---

Some models can reason before they answer. `reasoning_effort` on `/v1/chat/completions` turns that on or off, and the
reasoning comes back in its own field, `reasoning_content`, never mixed into the answer.

## Turn reasoning on

```python
import os

from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key=os.environ["MINIBRAIN_API_KEY"])
reply = client.chat.completions.create(
    model="qwen3-0.6b",
    messages=[{"role": "user", "content": "How many times does the letter r appear in strawberry?"}],
    reasoning_effort="low",
    max_tokens=2048,
)
message = reply.choices[0].message
print("Reasoning:", getattr(message, "reasoning_content", None))
print("Answer:", message.content)
```

```sh
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Authorization: Bearer $MINIBRAIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-0.6b",
    "reasoning_effort": "low",
    "max_tokens": 2048,
    "messages": [{"role": "user", "content": "How many times does the letter r appear in strawberry?"}]
  }'
```

```json
{
  "role": "assistant",
  "content": "The letter r appears 3 times in strawberry.",
  "reasoning_content": "Spell it out: s-t-r-a-w-b-e-r-r-y. There is one r after t and two after e, so 3."
}
```

`reasoning_effort` takes `none`, `low`, `medium` or `high`. Left out, the model keeps its default.

## What each model does

Models reason in one of four ways, read from their chat template:

| Models | `none` | `low`, `medium`, `high` | Left out |
|---|---|---|---|
| Qwen3 (not the 2507 Instruct models), GLM-4.5, SmolLM3 | Reasoning off | Reasoning on, at any effort | Off for custom models and the catalogue's Qwen3 bases; otherwise the template's default |
| gpt-oss | 400 | Reasons at that effort | Reasons at its default effort |
| DeepSeek-R1 and its distills, Qwen3 Thinking 2507 | 400 | 400 | Always reasons |
| Every other model | Accepted, changes nothing | 400 | Does not reason |

A custom model that answers with labels or a JSON schema does not reason: `none` is accepted, and an effort is a 400.
Every refusal is a 400 with `param: reasoning_effort`, and its message says what the model takes.

## Read the reasoning

- Without streaming, the reasoning is in `choices[0].message.reasoning_content` and the answer in `content`.
- With `stream: true`, it arrives as `delta.reasoning_content`, before the answer's `delta.content`
  ([Streaming](streaming.md)).
- The reasoning is generated text: it counts towards `max_tokens` and `usage.completion_tokens`. Leave room for it, or
  a long reasoning can end at `finish_reason: length` before the answer starts.

Request logs, feedback and graders see only the answer. Evaluation and judge jobs drop the reasoning too, so a model
that reasons is scored on its answers. `/v1/completions` does not split reasoning out: whatever the model writes is in
`text` ([Text completions](text-completions.md)).
