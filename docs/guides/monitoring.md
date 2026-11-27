---
title: Monitoring
description: Watch a live model in the UI, from traffic, latency and errors per model and version to single requests, kept inputs and answers, and the Health panel.
sidebar:
  order: 8
---

Once a model is deployed, minibrain logs every `/v1` call and builds its monitoring pages from those logs. This page
covers what to watch in the UI. To send the same figures to your own tools, see
[Your own monitoring tools](#your-own-monitoring-tools).

| Question | Where to look |
|---|---|
| Is anything wrong right now? | **Home** › **Health** |
| How much traffic, how fast, how many errors, across models? | **Monitoring** › **Overview** |
| What happened to one call? | **Monitoring** › **Requests** |
| How does one model behave, version by version? | The model's **Monitoring** tab |

**Monitoring** is in the sidebar for every role. The pages update on their own; **Pause** in the header holds them
still and **Resume** starts them again.

## Overview

**Monitoring** › **Overview** shows traffic on the `/v1` API by model. Pick the models and the time range, from
**Last 15 minutes** to **All kept logs**; **Last 24 hours** is the default.

- The strip on top gives **Requests**, **Error rate**, **Latency p50**, **Latency p95**, **Tokens in** and
  **Tokens out** for the range.
- Four charts follow: **Requests per minute**, **Error rate** (the share of requests that ended in a 4xx or 5xx),
  **Latency** (p95 or p50, as measured by the gateway) and **Tokens** (in or out). Each draws the five busiest models
  and groups the rest as "Other models".
- **Models** lists every model that answered in the range, with its requests, error rate, latency, tokens and last
  request. A row opens that model's requests.

## Requests

**Monitoring** › **Requests** lists the calls as they arrive, newest first: time, model and version, endpoint, API
key, status, latency and tokens. The column picker adds **Finish** and **Response ID**.

- Filter by **Model**, **Version**, **API key** and **Status** (**OK**, **Client error (4xx)**,
  **Server error (5xx)**), and search by response ID: the `id` an app got back, such as `chatcmpl-…`.
- Sorting by another column pauses the live list ("Paused while sorted").
- Click a row for the call's details: the name it was requested as, the finish reason, the safety model that
  blocked it when one did, the response ID to copy, and the feedback sent for it.
- A model that was deleted keeps its requests, marked as deleted.

Request logs are deleted after **Log retention (days)**, 30 by default, under **Settings** › **Security** ›
**Request logs and API keys** ([Request logs](../security/policies.md#request-logs)).

## The model's Monitoring tab

Open a model and its **Monitoring** tab for that model alone, over 24 hours, 7 days or 30 days.

| Section | Shows |
|---|---|
| **Traffic** | Requests, latency p95 and p99, error rate and cost per 1M tokens, each with its change against the period before, then four charts: requests, p95 latency, errors and cost. A custom model's charts are drawn by version, with a mark where a version was deployed |
| **Recent requests** | The last 20 calls; **All requests** opens them under **Monitoring** › **Requests** |
| **Latency** | p50, p95 and p99 over time |
| **Errors** | The error rate against the model's usual rate, and each failing status with its count, when it was last seen and a link to those calls in the log |
| **By version** | For a custom model: requests, share, latency, error rate and cost per version, **Live** or **Pinned or earlier** |
| **Callers** | The API keys that call the model, with their requests, share and error rate |

- Cost per 1M tokens is shown as GPU time: the time spent answering, per 1M tokens.
- Calls to `name@N` reach version N whether it is deployed or not, so pinned versions show under **By version**.
- The model's **Overview** has the same four figures under **Usage**, with **Open Monitoring**.

## Kept inputs and answers

Request logs hold no content: only the time, model, version, key, status, latency, token counts, finish reason and
response ID. The request's last user message and the model's answer are kept only for models whose
**Keep request inputs and answers** switch is on. It is off by default.

- Turn it on, as a Builder, on the model's **Settings** tab under **Request content**.
- Read them by clicking a request: **Input, the last user message** and **Answer**. A request that got no answer, or
  that came before the switch was on, has none.
- Builders and Admins see them. A Viewer sees that they are kept, not what they hold.
- They are deleted with the request logs, after **Log retention (days)**.
- Base models served directly follow **Request inputs and answers** under **Settings** › **Security**, and
  **Lock for every model** there makes every model follow it.
- They are stored in the database next to the request log, and minibrain does not encrypt the database.

What they are used for, and the lock in detail: [Request logs](../security/policies.md#request-logs).

## Health

**Home** › **Health** runs a check per area each time it loads and says what it found:

| Area | Checks |
|---|---|
| **Serving** | Live models and their replicas, running or starting |
| **Machines** | Machines online and the minibrain release |
| **Memory** | Memory in use on main and what holds it, and the fullest other machine |
| **Storage** | Disk in use and free on main, and the fullest other machine |
| **Training** | Runs running, and finished in the last 24 hours |
| **Audit log** | For admins: the audit chain, and the SIEM when one is set |

A problem replaces its area's line, worst first, with a link to the page that fixes it. **Show all** lists every
problem.

| Problem | Level | Do |
|---|---|---|
| "Support triage is live but no replica is running" | Critical | Start a machine in its pool, or deploy it to another pool |
| "The engine for Qwen3-8B on gpu-01 failed" | Critical | Open the model and check its deployment and weights |
| "Audit log integrity broken at #…" | Critical, admins | [When the chain breaks](../security/audit.md#when-the-chain-breaks) |
| "Audit events are not reaching the SIEM: …" | Warning, admins | [Send events to a SIEM](../security/audit.md#send-events-to-a-siem) |
| "gpu-01 /data has only 6.2 GB free" | Warning | Under 10 GB or 10% free: free space under **Infrastructure** › **Storage** |
| "gpu-01 runs other library versions than main: …" | Warning | [Version drift](../install/machine-health.md#version-drift) |
| "Training Support triage v3 failed" | Warning | Open the run, read its logs and retry; shown for 24 hours unless a later run started |
| "gpu-01 is offline" | Warning | Check its worker; after a day admins get **Remove** |

Fixes for the machine problems: [Machine health](../install/machine-health.md#troubleshooting). A model's
**Overview** has its own **Health**, with the problems of that model only, or "All healthy".

## Your own monitoring tools

The UI shows the present and the kept logs. For alerts, dashboards and longer history, send the same figures to
your own tools:

- [Metrics](../observability/metrics.md): Prometheus metrics on `/metrics`, with a Grafana dashboard.
- [OpenTelemetry](../observability/opentelemetry.md): a span per `/v1` request and the same metrics, pushed to your
  collector.
- [Logs](../observability/logs.md): JSON lines with a request ID, and the response ID that ties a log line to a
  request in **Monitoring** › **Requests**.

None of the three carries a prompt, an answer or an API key.
