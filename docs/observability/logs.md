---
title: Logs
description: Write minibrain's logs as one JSON object per line for your log collector.
sidebar:
  order: 3
---

minibrain logs to standard output as plain text by default. Switch to JSON lines when a log collector reads them, so
each event arrives with its fields already split out, including the request id that ties a log line to an API call.

## Turn on JSON logs

Set the format in the environment of each process:

```sh
MINIBRAIN_LOG_FORMAT=json minibrain serve
```

Or in `minibrain.yaml`:

```yaml title="minibrain.yaml"
logging:
  format: json
```

- The environment wins over the file. Values are `text` (the default) and `json`; any other value stops main at start
  with the reason.
- It applies to `minibrain serve`, `minibrain gateway`, `minibrain worker` and `minibrain engine`. Set it on every
  machine whose logs you collect.
- In Docker, pass `-e MINIBRAIN_LOG_FORMAT=json`; the lines then come out of `docker logs` and your container log
  driver.
- **Settings › This install** shows the format in use under Observability.

## Fields

Each line is one JSON object:

```json
{"time": "2026-11-03T12:34:56.789Z", "level": "info", "logger": "uvicorn.access", "message": "10.0.4.7:51022 - \"POST /v1/chat/completions HTTP/1.1\" 200", "request_id": "6f1c…", "response_id": "chatcmpl-…", "client": "10.0.4.7:51022", "method": "POST", "path": "/v1/chat/completions", "http_version": "1.1", "status": 200}
```

| Field | Value |
|---|---|
| `time` | UTC, with milliseconds |
| `level` | `debug`, `info`, `warning`, `error` or `critical` |
| `logger`, `message` | As logged |
| `request_id` | The id of the HTTP request the line belongs to |
| `response_id` | The completion id, once a `/v1/chat/completions` call has answered |
| `client`, `method`, `path`, `http_version`, `status` | On access lines (`logger` is `uvicorn.access`) |
| `exception` | The traceback, when there is one |

Logs never hold a prompt, an answer or an API key.

## Follow a request

Every response carries an `X-Request-ID` header, and every JSON line logged while handling that request carries the
same value in `request_id`.

- Send your own `X-Request-ID` to use your id instead: 1 to 128 letters, digits, `.`, `_`, `:` or `-`. Anything else is
  replaced with a new id.
- `response_id` is the completion id (`chatcmpl-…`) the API returned. It is the same id as on the request's
  OpenTelemetry span (`gen_ai.response.id`) and in **Monitoring › Requests**, so you can go from a log line to the
  trace and the request log.

Traces and metrics: [OpenTelemetry](opentelemetry.md) and [Metrics](metrics.md).
