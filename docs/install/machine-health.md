---
title: Machine health
description: See whether joined machines are online and current, drain and remove them, and fix what Infrastructure reports.
sidebar:
  order: 9
---

**Infrastructure › Machines** shows every machine with its status, and **Home › Needs attention** warns about the ones
that need you. Click a machine's row to open its sheet: problems with **How to fix**, hardware, what runs there, live
usage, library versions, the last heartbeat and, for admins, the actions to drain or remove it.

## Heartbeats and offline

Workers check in with main every 10 to 25 seconds and engines every 10 seconds. Each check-in carries the machine's
hardware and a usage sample. A machine that goes quiet is taken out of use in steps:

| Silent for | Effect |
|---|---|
| 30 seconds | Its engines leave gateway routing; replicas move to other online machines of the pool |
| 60 seconds | A job it runs is queued again while it has attempts left |
| 2 minutes | Offline: Status reads "Offline" and for how long, and Needs attention warns "gpu-01 is offline" |
| 24 hours | The warning offers admins **Remove** |
| 7 days | Forgotten, except machines that joined by approval: they stay listed until removed |

A drained machine raises no offline warning. When main is down, a worker logs
`main is unreachable (…); trying again in N s`, backs off to 30 seconds and carries on when main is back; it needs no
restart.

## Usage

The sheet's **Live** section shows GPU busy and memory in use over the last hour, with each GPU's memory and
utilisation, RAM and CPU. **Hardware** shows the disk under `MINIBRAIN_HOME` with its free space.

- GPU figures come from `nvidia-smi` or `rocm-smi` when either is on the machine's `PATH`.
- Apple silicon and CPU machines report no GPU entry; their model memory is host RAM.
- A value the machine cannot read shows as "Not reported" rather than a guess.
- main keeps the hour of history in memory: restarting main starts it again.

## Version drift

Each machine reports its minibrain, torch, transformers and peft versions, the engine libraries it has, and CUDA and
the NVIDIA driver, or ROCm. Its sheet lists them under **Versions** beside main's. minibrain, torch, transformers and
peft are compared with main, ignoring a build tag such as `+cu132`.

A difference does not stop the machine, but its Status reads **Version drift**, its row under **Versions** is
highlighted, and Needs attention warns "gpu-01 runs other library versions than main: torch 2.8.0 (main has 2.9.0)".

To fix it, install main's versions on the machine, then restart the worker with the command under **How to fix**. In
Docker, run main's image tag. A native install resolves torch, transformers and peft when it installs, so pin them:

```sh
uv tool install --python 3.12 minibrain==<version> \
  --with torch==<version> --with transformers==<version> --with peft==<version>
```

Upgrading main and its machines: [Upgrades](upgrades.md).

## Drain and remove a machine

Open the machine's sheet; **Actions** (admins only, audited):

| Action | Effect |
|---|---|
| **Drain** | Running jobs finish and no new job starts. Each engine serves until another machine in the pool has its model ready, then stops; a model no other machine can take keeps serving here. Status reads Draining, then Drained |
| **Undrain** | The machine takes jobs and engines again |
| **Remove from pool** | Only once the machine is drained and idle, or offline. It leaves the pool, and its worker stops at its next check-in |

A token-joined worker stops with "An admin removed gpu-01 from pool gpu-a10. Restart minibrain worker on gpu-01 to join
the pool again." To keep it out, stop the worker there, and rotate the pool's join token if it may have been copied. A
machine that joined by approval must be approved again. Main cannot be drained or removed.

## Troubleshooting

Problems show in a machine's Status and its sheet, as a badge on the pool's row, and under Needs attention:

| Problem | Shown as | Fix |
|---|---|---|
| gpu-01 is offline | Offline 3h | Check the worker runs and reaches main; **How to fix** gives the command that restarts it. After a day, **Remove** |
| gpu-01 runs other library versions than main: … | Version drift | [Version drift](#version-drift) |
| gpu-01 /data has only 6.2 GB free | Disk low | Under 10 GB or 10% free on the disk under `MINIBRAIN_HOME`. The sheet says how much minibrain keeps there; **Infrastructure › Storage** lists the disks of other machines |
| The engine for Qwen3-8B on gpu-01 failed | Engine failed | Critical. Open the model and check its deployment and weights |
| Support triage is live but no replica is running | Badge on the pool's row | Critical. The model reads "Waiting for a machine in gpu-a10" while no worker of its pool is online: start one, or deploy to another pool |

When `minibrain worker` stops, it prints why after `minibrain worker:`, with `main refused this machine:` first for a
refused credential:

| Message | Fix |
|---|---|
| `this join token was revoked` | The token was rotated: use the new one |
| `invalid worker token` | Copy the token again, or rotate it |
| `this join token joins pool gpu-a10 only, not local` | Add `--pool gpu-a10` |
| `the local pool is main's own machine; name another pool with --pool` | Name another pool |
| `an admin denied this machine`, `nobody approved this machine within an hour; …` | Run it again and approve the new code |
| `this approval is for gpu-01 only, not gpu-02` | The machine was renamed: delete `worker/approval.json` under `MINIBRAIN_HOME` and ask again |
| `5 machines from this address already wait for approval` | Approve or deny the waiting requests |
| `This machine's name gpu-01 resolves to 127.0.1.1, …` | Pass `--advertise` with an address other machines reach |
| `main is unreachable (…); trying again in N s` (it keeps running) | Check `--main` and the [network](machines.md#network) |
