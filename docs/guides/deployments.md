---
title: Deployments
description: Put a version live on a compute pool, choose replicas, move between pools and roll back.
sidebar:
  order: 6
---

Deploying a version makes it the one apps get when they call the model's API name. A deployment is a model's live
version on one compute pool, with one or more replicas, and minibrain keeps it running. Every other version stays
callable by its number.

## Deploy a version

Deploying needs the Builder role, and a version that is ready and meets the model's
[deploy rule](evaluation.md#the-deploy-rule).

1. Click **Deploy** in the model header. The dialog picks the best-scoring version; check **Version**.
2. **Pool**: **Automatic** picks a pool where the model fits. Each pool shows its fit, such as "Runs · 2.2 of 24 GB",
   "Too small", "No machine online" or "Not used for serving".
3. **Replicas**: 1 by default.
4. Click **Deploy vN**.

**Deploy vN** on a version's page opens the same dialog for that version. **Deploy vN** on an **Evaluations** row
deploys at once: on the automatic pool for a model that is not deployed yet, otherwise where it already runs. The
header says **Deploying vN** while the model loads, or "Fetching weights" while a machine copies them, then
**Deployed · vN on local**, naming the pool. With no machine of the pool online it says "Waiting for a machine in
gpu-a10".

A base model can be deployed by itself the same way, under its own API name. In **Models**, the "…" menu on a base
format opens the same dialog; selecting several formats and clicking **Deploy** places each one that fits.

## Call a version by number

A model's API name, such as `support-triage`, is answered by its live version. `support-triage@N` calls version N,
deployed or not, so apps can pin a version and you can try one before deploying it:

```sh
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Authorization: Bearer $MINIBRAIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "support-triage@1", "messages": [{"role": "user", "content": "I was charged twice"}]}'
```

A model that is not deployed answers its plain name with a 404 that says so and names a version to call instead. Keys
and calls: [API overview](../api/overview.md).

## Roll back

Deploy an earlier version: open it on the model's **Versions** tab and click **Deploy vN**. A version that was live
before can always be deployed again, whatever the deploy rule says. The version it replaces stays callable as
`support-triage@N`.

## Pools

A pool is a named group of machines. The machine running `minibrain serve` is the `local` pool, shown as "This
machine"; other machines join a pool with `minibrain worker --pool NAME` ([Add machines](../install/machines.md)).

- **Automatic** picks this machine when the model fits, otherwise the pool with the most memory left after the
  deployments already on it, among the pools used for serving.
- On this machine, minibrain runs the model's engine itself. On another pool, a worker in that pool runs it; a
  worker started with `--no-serve` only runs jobs.
- A model stays on the same machines as long as they stay up, and moves when one goes away.

## Replicas

Replicas are bounded by the pool: one per online machine of the pool where the model fits, and one on "This
machine". The **Replicas** row says how many fit ("One per machine where it fits: gpu-a10 has room for 2"), and
asking for more is refused. To change them on a live deployment, use **Replicas** under **Deployment** on the model's **Settings** tab.
The header shows "· 2 replicas" when there are several.

## Move to another pool

Pick another pool in the **Deploy** dialog and click **Move to** that pool. The move is a rolling handover: the old
pool keeps its engines and its traffic while the new pool's engines start, and the header says "Deployed · v2 on local
· moving to gpu-a10". Once the new pool has a ready engine on every machine it was given, traffic switches to it and
the old engines stop within about 10 seconds.

- If an engine in the new pool fails to start, or no machine of it is online for 5 minutes, the move rolls back and
  the model says why: "Moving to gpu-a10 failed: its engine in pool gpu-a10 failed to start. It stays on local."
- Deploying back to the old pool before the move ends cancels it. Deploying to a third pool retargets it, and the
  first pool keeps serving meanwhile.
- A move to a pool with less room keeps as many replicas as fit. Replicas cannot change until a move ends.

## Pool use

Each pool is used for **Any** work (the default), **Serving** or **Training**. An admin sets it under
**Infrastructure › Machines**, in the pool row's menu: **Pool settings › Used for**, with an optional one-line
**Description** shown wherever the pool is picked.

| Used for | Deployments | Training and scoring jobs |
|---|---|---|
| Any | Placed here | Run here |
| Serving | Placed here | Never start here |
| Training | Never placed here | Run here |

- **Automatic** skips pools not used for serving. The Deploy dialogs and the Train page show those pools greyed out,
  with why.
- Engines already running on a pool that stops serving keep serving until the model is undeployed or moved.
- Jobs running when the use changes finish. A pool with queued training or scoring jobs held to it cannot stop taking
  training until they are cancelled or have started.
- Downloads, imports, checks, repairs and exports run on any pool.

## Routing

Gateways spread each model's requests over its replicas, with no setting to change:

| Rule | Detail |
|---|---|
| Health | Ready replicas first, then loading ones; a failed request or health check takes a replica out for 10 seconds |
| Least busy | New work goes to the replica with the fewest requests in flight |
| Sticky | By adapter, so it stays loaded; by prompt prefix for base models, so the KV cache is reused |
| Overflow | A sticky replica with 4 requests in flight hands new requests to a less busy one |
| Failover | Another replica is tried at once |

A deployed name goes only to its deployment's pool. A pinned version (`support-triage@N`) and the Playground use any
replica of the base. More on gateways and engines: [How serving works](../reference/how-serving-works.md).

## Undeploy

**Undeploy** under **Deployment** on the model's **Settings** tab takes the model off its pool. Apps calling its name
get errors at once; its versions and keys stay, and `support-triage@N` still answers.
