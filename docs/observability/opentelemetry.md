---
title: OpenTelemetry
description: Export a trace span per API request and minibrain's metrics to your OpenTelemetry collector over OTLP.
sidebar:
  order: 2
---

minibrain can push a span for every `/v1` request, and the same metrics `/metrics` serves, to your own
OpenTelemetry collector over OTLP. It is off by default; once on, the collector you name is the only destination.

## Turn on export

In the UI: **Settings › Security › OpenTelemetry export**, as an admin. Set **OpenTelemetry export** to **OTLP over
HTTP (protobuf)** and fill in **Collector endpoint**. Changes apply within 5 seconds, without a restart, and are
audited.

The same settings in `minibrain.yaml` or the standard OpenTelemetry variables lock them in the UI:

| Setting | `minibrain.yaml` (under `policy:`) | Variable | Default |
|---|---|---|---|
| OpenTelemetry export | `otel_protocol: http/protobuf` | `OTEL_EXPORTER_OTLP_PROTOCOL` | `off` |
| Collector endpoint | `otel_endpoint: https://otel-collector.internal:4318` | `OTEL_EXPORTER_OTLP_ENDPOINT` | Empty |
| Collector headers | `otel_headers: {secret_env: COLLECTOR_HEADERS}` or `{secret_file: /run/secrets/otel-headers}` | `OTEL_EXPORTER_OTLP_HEADERS` | Empty |
| Service name | `otel_service_name: minibrain-eu` | `OTEL_SERVICE_NAME` | `minibrain` |
| Collector CA bundle | `otel_ca_bundle: /etc/minibrain/collector-ca.pem` | `OTEL_EXPORTER_OTLP_CERTIFICATE` | System CAs |

- Traces go to `<endpoint>/v1/traces` and metrics to `<endpoint>/v1/metrics`. Setting an endpoint variable turns
  export on; `OTEL_SDK_DISABLED=true` turns it off.
- Only OTLP over HTTP with protobuf is supported, not gRPC. Any other protocol leaves export off and logs why.
- Headers are `name=value` pairs separated by commas, URL-decoded as the OTLP specification asks
  (`Authorization=Bearer%20<token>`). Values are encrypted at rest and never shown again; the UI and the audit log
  show header names only.
- `minibrain.yaml` never holds header values: `otel_headers` names the variable or file that does. A value written in
  the file, or a variable or file that is missing, stops main at start with the reason.
- The exporter ignores `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` and `.netrc`, and does not follow redirects. Like the
  SIEM, the collector is reached even when the network policy is Offline. **Settings › This install** lists both URLs.
- The last batch is flushed when minibrain stops.
- A standalone gateway (`minibrain gateway`) has no database: it reads the same settings from its own `minibrain.yaml`
  and environment.

### Other variables

| Variable | Does |
|---|---|
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Replace the full URL of either signal |
| `OTEL_TRACES_EXPORTER=none`, `OTEL_METRICS_EXPORTER=none` | Drop that signal |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | Export timeout |
| `OTEL_EXPORTER_OTLP_COMPRESSION` | `gzip` |
| `OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE`, `OTEL_EXPORTER_OTLP_CLIENT_KEY` | Client certificate for mTLS |
| `OTEL_METRIC_EXPORT_INTERVAL` | Milliseconds between metric exports; 60000 by default |
| `OTEL_BSP_*` | Span batching |
| `OTEL_RESOURCE_ATTRIBUTES` | Extra resource attributes |

## Spans

One server span per `/v1` request, following the
[OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/). A W3C `traceparent`
header on the request makes the span a child of the caller's trace.

| Attribute | Value |
|---|---|
| Span name | `chat <requested model>` for chat completions, otherwise `<method> <route>` |
| `gen_ai.operation.name` | `chat` |
| `gen_ai.provider.name` | `minibrain` |
| `gen_ai.request.model` | The model as requested, such as `support-triage` or `support-triage@3` |
| `gen_ai.response.model` | The version that answered, such as `support-triage@3`, or the base model id |
| `gen_ai.response.id` | The completion id (`chatcmpl-…`), the same as in **Monitoring › Requests** and `/v1/feedback` |
| `gen_ai.request.max_tokens` | The token limit applied |
| `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` | Tokens in and out |
| `gen_ai.response.finish_reasons` | `["stop"]` or `["length"]` |
| `error.type` | The OpenAI error code (`invalid_json`, `schema_mismatch`) or the status code (`404`); the exception class when the request crashed |
| `server.address`, `server.port`, `url.scheme` | From the request's `Host` |
| `http.request.method`, `http.route`, `http.response.status_code` | The HTTP side |
| `minibrain.model.slug`, `minibrain.model.version` | The custom model and version |
| `minibrain.api_key.id` | The id of the API key used, never the key |

Spans with a 5xx status are marked as errors. Every span carries the resource attributes `service.name` (the Service
name setting), `service.version` (the minibrain version), `service.instance.id` (host name and a random suffix per
process) and anything in `OTEL_RESOURCE_ATTRIBUTES`.

## Metrics

Export carries the same metrics as [`/metrics`](metrics.md#what-is-exported), under their OpenTelemetry names:
request duration and token usage histograms, a request counter, queued jobs and workers online.

## Example collector

An [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) inside your network receives the export and
passes traces to Tempo or Jaeger and metrics to Prometheus:

```yaml title="otelcol.yaml"
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
        tls:
          cert_file: /etc/otelcol/tls.crt
          key_file: /etc/otelcol/tls.key
        auth:
          authenticator: bearertokenauth

extensions:
  bearertokenauth:
    token: ${env:MINIBRAIN_COLLECTOR_TOKEN}

processors:
  batch: {}
  memory_limiter:
    check_interval: 1s
    limit_percentage: 80

exporters:
  otlp/tempo:
    endpoint: tempo.internal:4317
  prometheusremotewrite:
    endpoint: https://prometheus.internal/api/v1/write

service:
  extensions: [bearertokenauth]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/tempo]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [prometheusremotewrite]
```

minibrain's side:

```yaml title="minibrain.yaml"
policy:
  otel_protocol: http/protobuf
  otel_endpoint: https://otel-collector.internal:4318
  otel_ca_bundle: /etc/minibrain/collector-ca.pem
```

Then pass the header in the environment, or enter it once under **Collector headers** in the UI:

```sh
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer%20<token>"
```
