---
title: Metrics
description: Scrape minibrain's Prometheus metrics and chart them with the Grafana dashboard.
sidebar:
  order: 1
---

minibrain serves Prometheus metrics on `/metrics`: requests, errors, latency and tokens per model, queued jobs and
workers online. The endpoint stays off until you say who may scrape it.

minibrain sends nothing anywhere by default. It has three outputs for your own monitoring, each off until you turn it
on, and none of them ever carries a prompt, an answer or an API key:

- Prometheus metrics on `/metrics`, on this page.
- [OpenTelemetry export](opentelemetry.md): a span per `/v1` request and the same metrics, pushed to your collector.
- [JSON logs](logs.md) on standard output.

**Settings › This install** shows which are on, under Observability. Inside minibrain, **Monitoring › Overview** shows
the same traffic from the request logs: requests per minute, error rate, p50 and p95 latency and tokens per model.

## Turn on /metrics

Name the addresses allowed to scrape, a scrape token, or both, in `minibrain.yaml`:

```yaml title="minibrain.yaml"
metrics:
  addresses: [10.0.4.0/24, 10.0.9.15]
  token_file: /run/secrets/metrics-token
```

Or set them in the environment, which wins over the file:

| Variable | Instead of |
|---|---|
| `MINIBRAIN_METRICS_ADDRESSES` | `metrics.addresses`, comma separated addresses or networks |
| `MINIBRAIN_METRICS_TOKEN` | `metrics.token_file` |

Restart main for the change to apply. **Settings › This install** then reads Prometheus **On**.

- With neither set, `/metrics` answers 404. With both, a scrape needs the token and an allowed address.
- The scraper sends the token as `Authorization: Bearer <token>`. A wrong or missing token gets a 401; another address
  gets a 403. `/metrics` needs no user session.
- The token needs at least 16 characters. A token written in `minibrain.yaml` itself (`metrics.token`) stops main at
  start: keep it in a file or the environment.
- The address checked is the connection's, or the forwarded one when the request comes through a trusted proxy
  (`auth.proxy.addresses`).
- Standalone gateways (`minibrain gateway`) serve the same endpoint with their own `/v1` metrics.

## Scrape it with Prometheus

```yaml title="prometheus.yml"
scrape_configs:
  - job_name: minibrain
    scheme: https
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/minibrain-token
    static_configs:
      - targets: ["minibrain.internal:443"]
  - job_name: minibrain-gateways
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/minibrain-token
    static_configs:
      - targets: ["gateway-1.internal:8100", "gateway-2.internal:8100"]
```

The endpoint answers in the Prometheus text format, version 0.0.4.

## What is exported

The same metrics go out through OpenTelemetry export. On `/metrics`, dots in names and attributes become underscores:
`gen_ai.request.model` is the label `gen_ai_request_model`.

| Prometheus name | OpenTelemetry name | Type | Labels |
|---|---|---|---|
| `gen_ai_client_operation_duration_seconds` | `gen_ai.client.operation.duration` | Histogram | `gen_ai_operation_name`, `gen_ai_provider_name`, `gen_ai_request_model`, `gen_ai_response_model`, `error_type` |
| `gen_ai_client_token_usage` | `gen_ai.client.token.usage` | Histogram | As above, plus `gen_ai_token_type` (`input` or `output`); successful calls only |
| `minibrain_gateway_requests_total` | `minibrain.gateway.requests` | Counter | `http_route`, `http_response_status_code`, `gen_ai_request_model` |
| `minibrain_jobs_queued` | `minibrain.jobs.queued` | Gauge | `minibrain_job_kind`; only kinds with queued jobs |
| `minibrain_jobs_queued_oldest_age_seconds` | `minibrain.jobs.queued.oldest_age` | Gauge | None |
| `minibrain_workers_online` | `minibrain.workers.online` | Gauge | `minibrain_pool` |

- Histogram buckets follow the OpenTelemetry GenAI conventions: 0.01 to 81.92 seconds, doubling, and 1 to 67,108,864
  tokens, by powers of four.
- The requested model reads `_unknown` when the model does not exist or the key was refused, so random model names
  cannot grow the number of series.
- Each process reports its own `/v1` traffic. The job and worker gauges come from main's database; with several mains,
  each reports them, so take the `max` across instances.

## Import the Grafana dashboard

The repository ships a dashboard over these metrics:
[`docs/grafana/minibrain.json`](https://github.com/getminibrain/minibrain/blob/main/docs/grafana/minibrain.json).

1. Download the file. In Grafana, open **Dashboards › New › Import** and upload it.
2. Pick the Prometheus data source that scrapes minibrain, directly or through an
   [OpenTelemetry collector](opentelemetry.md#example-collector).

It charts requests per minute, error rate, p50 and p95 latency by model, tokens per minute, queued jobs and workers
online. Its `job` variable picks the scrape job.
