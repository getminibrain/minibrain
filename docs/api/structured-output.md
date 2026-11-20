---
title: Structured output
description: Get JSON that matches a schema with response_format, and know what is checked.
sidebar:
  order: 4
---

`response_format` on `/v1/chat/completions` asks for JSON: any JSON object, or JSON that matches a schema you send.
minibrain checks every JSON answer against the schema before your app sees it.

## Ask for JSON that matches a schema

```python
import json
import os

from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key=os.environ["MINIBRAIN_API_KEY"])
schema = {
    "type": "object",
    "properties": {
        "order_id": {"type": "string"},
        "issue": {"type": "string", "enum": ["billing", "bug", "refund", "other"]},
        "urgent": {"type": "boolean"},
    },
    "required": ["order_id", "issue", "urgent"],
    "additionalProperties": False,
}
reply = client.chat.completions.create(
    model="qwen3-0.6b",
    messages=[{"role": "user", "content": "Order 1042 charged me twice, please fix it today."}],
    response_format={"type": "json_schema", "json_schema": {"name": "ticket", "schema": schema}},
)
ticket = json.loads(reply.choices[0].message.content)
print(ticket["issue"], ticket["urgent"])
```

`json_schema` takes:

- `name`: 1 to 64 letters, digits, underscores or dashes.
- `schema`: a JSON Schema object.
- `strict`: `true` or `false`, accepted and changes nothing. Every answer is constrained, checked, or both.

## Ask for any JSON object

`{"type": "json_object"}` holds the answer to a JSON object, without a schema:

```sh
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Authorization: Bearer $MINIBRAIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-0.6b",
    "messages": [{"role": "user", "content": "Give the capital and population of France as JSON."}],
    "response_format": {"type": "json_object"}
  }'
```

`{"type": "text"}` is the default and asks for nothing.

## Models with a contract

A custom model's output setting is its contract, and it holds whatever the request says:

- A model that answers with labels (the Classify preset) is held to its labels while it decodes, and answers with
  the bare label, such as `billing`.
- A model that answers with its own JSON schema answers with JSON that matches it, checked as below.
- Both refuse `json_object` and `json_schema` with a 400 (`param: response_format`, `code: unsupported_value`).
  `{"type": "text"}` is accepted and changes nothing.

A free-text custom model and a base model take any `response_format`.

## How the answer is checked

Depending on the engine serving the model, the schema either constrains decoding, so the model can only write
matching JSON, or the model writes freely and the answer is checked afterwards. Either way, every JSON answer is
checked against the schema before it is returned:

- An answer wrapped in a Markdown code fence is unwrapped.
- An answer that is not valid JSON is a 422 with `code: invalid_json`.
- An answer that does not match the schema is a 422 with `code: schema_mismatch`, and the message names the first
  problem:

```json
{
  "error": {
    "message": "The model's answer does not match response_format: $.urgent is required; only SGLang and llama.cpp engines constrain decoding, the others check the answer afterwards.",
    "type": "invalid_output_error",
    "param": "response_format",
    "code": "schema_mismatch"
  }
}
```

- An answer cut off by `max_tokens` (`finish_reason: length`) comes back as it is, unchecked. Raise `max_tokens` if
  you see one.
- An answer that calls tools is not checked against the schema.

With `stream: true` the answer is checked first, then sent, so a 422 still arrives as a status code
([Streaming](streaming.md#answers-that-arrive-in-one-piece)).

## Schema keywords

The check covers `type`, `enum`, `const`, `properties`, `required`, `additionalProperties`, `items`, `prefixItems`,
`minItems`, `maxItems`, `minLength`, `maxLength`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`,
`anyOf`, `oneOf`, `allOf`, `not` and local `$ref`.

It does not check `format`, `multipleOf` or `patternProperties`, and it does not run `pattern`, since a regular
expression from a request could stall the gateway. Some engines still apply `pattern` while decoding.

## Request errors

A malformed `response_format` is a 400 with the OpenAI `error` object and the field in `param`: an unknown `type`, a
missing `json_schema` (`code: missing_required_parameter`), a bad `name`, or a `schema` that is not valid JSON
Schema. A schema the serving engine cannot compile is a 400 too.
