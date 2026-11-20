---
title: Audit log
description: What minibrain records, how the hash chain shows tampering, how long events are kept, and how to export them or send them to a SIEM.
sidebar:
  order: 6
---

The audit log records who changed what on the install, and when: sign-ins, accounts, policies, models, deployments,
keys, machines and encryption. Admins read it under **Settings › Audit log**. Events are append-only and
hash-chained, so an edit or a deletion shows.

## What an event holds

Each event has its time, the actor (a person, `command line`, the system or an API key), the client address when
known, the action (such as `policy.update`), the target, and a detail object that for a change carries the value
before and after. Deleting a model, for example, records who deleted what and its size. Detail values with secret
names show as `[redacted]` everywhere: in the UI, the API and every export.

Reading the audit log is recorded too (`audit.view`, at most once an hour per person), and so is every export
(`audit.export`, with its filters).

## Browse and export

Settings › Audit log has a search box and filters for area, actor and time range. Open an event to see its sequence
number and hashes. **Export** downloads the filtered events as CSV or JSONL; `GET /api/audit/export?format=jsonl`
does the same.

## The hash chain

The leader main seals new events into the chain about once a second. Each event gets the next sequence number
(`seq`), the previous event's hash (`prev_hash`) and its own `hash`, a SHA-256 over its fields and that previous hash.
The chain follows the order events were committed, and nothing is skipped.

- It shows any edit, deletion or insertion inside the retained log, and deletions at either end.
- It cannot show, on its own, someone with write access to the database rewriting every hash from the event they
  changed onwards, since the chain uses no key. A copy kept elsewhere is the witness: your SIEM's copy, or an earlier
  export, stops matching from the rewritten event on. That is a reason to turn on [SIEM export](#send-events-to-a-siem).

### Check the chain

- Automatically, on the leader: new events every hour, and the whole chain about once a day (at 3 a.m. local time
  once 12 hours have passed since the last full check, and at least every 36 hours).
- Settings › Security › **Audit integrity** shows the result; **Verify again** checks every event now.
- `GET /api/audit/chain` returns the same report.
- `minibrain audit verify` exits with code 1 on a break and prints the report as JSON with `--json`. With
  `--file export.jsonl` it checks an unfiltered JSONL export instead of the database.

A check walks the events in `seq` order and reports the first break: an event whose fields no longer match its hash,
one that does not link to the event before it, a missing `seq`, events minibrain did not seal, or a newest event that
does not match the end of the chain minibrain recorded.

### When the chain breaks

Each break found is recorded as an `audit.chain_broken` event, Home shows Audit log integrity broken, and Audit
integrity lists it under **Breaks**, where it stays for good. Compare the events with your SIEM's copy or an earlier
export to see what changed, then choose **Acknowledge…** and write what you found and did. That clears the alert,
keeps the break in the list, and records your note (`audit.chain_break_acknowledged`).

### Check events without minibrain

`hash` is the lowercase hex SHA-256 of a JSON object with these keys, serialised as ASCII with keys sorted at every
level, no whitespace, and every non-ASCII character escaped as `\uXXXX` (Python's
`json.dumps(fields, sort_keys=True, separators=(",", ":"))`):

| Key | Value |
|---|---|
| `seq` | Sequence number, from 1 |
| `prev_hash` | The previous event's `hash`; 64 zeros for `seq` 1 |
| `at` | UTC time with six fractional digits and `Z`, as `2026-11-03T12:34:56.123456Z` |
| `actor`, `ip`, `action`, `target` | As recorded; `ip` is `null` when not recorded |
| `actor_id` | The account ID of the person who acted; `null` for the system, the command line, API keys and failed sign-ins |
| `detail` | The detail object with secret values as `[redacted]`, exactly as the API and exports show it |

The row ID is not hashed, so the chain survives a copy into another database. Because the redacted detail is what is
hashed, every export and every SIEM message can be checked on its own, without the server.

## Retention

**Audit log retention (days)** under Settings › Security › Audit retention keeps every event by default. Pick a
period to delete older events for good; most standards (PCI DSS, SOC 2, ISO 27001) expect at least 365 days. Deleted
events cannot be restored, so export the log first if you need a copy.

The hourly prune keeps the chain checkable:

- It deletes sealed events up to the newest one that, with every event before it, is older than the period. It never
  deletes an unsealed event, nor, with SIEM export on, one the SIEM has not received.
- It then writes an `audit.prune` event with `cut_seq` and `cut_hash`: the last deleted event's `seq` and `hash`.
  That event is chained like any other.
- Checks then start at the oldest remaining event, which must link to the prune's `cut_hash` rather than to 64 zeros.

## Send events to a SIEM

Settings › Security › **Audit log export**: SIEM export (Off, TLS, TCP or UDP), SIEM host, SIEM port (0 uses 6514
for TLS and 514 otherwise) and SIEM CA bundle. Off by default.

```yaml title="minibrain.yaml"
policy:
  siem_protocol: tls
  siem_host: siem.corp.example
  siem_ca_bundle: /etc/minibrain/siem-ca.pem
```

With a protocol and host set, the leader sends every sealed event, in `seq` order, to that one address and nowhere
else. The network policy does not apply to it. Turning export on for the first time sends the whole retained log,
oldest first.

- Format: RFC 5424 syslog with facility 13 (log audit) and severity 5 (notice), so PRI is `<109>`; the event time as
  timestamp; this host's name; app name `minibrain`; the action as MSGID; `[origin software="minibrain" swVersion="…"]`
  as structured data; and the event as ASCII-only JSON as the message: the hashed fields plus `id` and `hash`.
- TLS (RFC 5425) and TCP use octet-counting framing (RFC 6587). TLS is 1.2 or later through OpenSSL, and checks the
  certificate and host name against the CA bundle, or the system's CAs when none is set.
- Events go in batches of up to 500, each over a fresh connection. minibrain closes its side and waits up to 2 seconds
  for the SIEM to close too, which a receiver does once it has read everything, before counting the batch as sent. A
  restart or a new leader resumes at the next event. A batch that fails midway is sent again whole, so the SIEM may
  see an event twice, with the same `seq` and `hash`, and can drop the copy.
- UDP (RFC 5426) sends one message per datagram, cannot tell whether it arrived, and has none of the checks above.
- While the SIEM is unreachable, minibrain retries every 15 seconds and events wait in the database. Audit integrity
  shows the error and how many events wait, and Home shows Audit events are not reaching the SIEM.
