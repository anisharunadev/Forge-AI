---
draft: false
title: Oncall Runbook
description: The on-call rotation, the alert sources, and the first-responder playbook.
---

This page is the on-call runbook for the Forge AI platform. It covers the rotation, the alert sources, and the first-responder playbook.

## What is this?

The reference for whoever is on-call. Keep it open during shifts.

## Rotation

| Tier | Who | Cadence |
|---|---|---|
| L1 — First responder | Platform Engineer | Weekly |
| L2 — Escalation | Architect (L3) or Dev Lead | Weekly |
| L3 — Major incident | Pilot Owner + Sponsor | As needed |

The L1 carries the pager 24/7 for one week. Handoff is Monday 10:00 local.

## Alert sources

| Source | Severity | Page? |
|---|---|---|
| Service downtime (ECS health check failing) | Sev1 | Yes |
| Audit ledger hash chain anchor failure | Sev1 | Yes |
| LiteLLM Proxy error rate > 5% | Sev2 | Yes |
| LiteLLM cost > envelope | Sev2 | Yes |
| Approval latency p90 > 24h | Sev3 | No (Slack) |
| Connector down | Sev3 | No (Slack) |
| Audit log writes > 10s latency | Sev3 | No (Slack) |

## First-responder playbook

### Step 1 — Acknowledge

```bash
# Acknowledge in PagerDuty (or equivalent)
# Open the #incident channel
```

### Step 2 — Triage (within 5 minutes)

Check the dashboard:

- Service health (ECS, RDS, Redis).
- LiteLLM Proxy health.
- Audit ledger health.
- Recent deployments.

### Step 3 — Contain (within 15 minutes)

| Symptom | Containment |
|---|---|
| Service down | Restart via ECS; check RDS |
| LiteLLM error spike | Check provider status; switch to fallback model |
| Cost overrun | Lower the tenant's budget envelope; pause workflows |
| Hash chain anchor failure | Halt anchor Lambda; check audit mirror |
| Connector down | Disable connector; route to manual ingest |

### Step 4 — Communicate

Within 30 minutes, post in the incident channel:

```text
INCIDENT — [Sev?] — [one-line description]

Started: <timestamp>
Affected: <tenants / services>
Containment: <what you did>
Next update: <time>
```

### Step 5 — Resolve

Work with L2/L3 to find the root cause. Apply the fix.

### Step 6 — Post-mortem

Within 24 hours, schedule a post-mortem. Capture a lesson via `forge-learn-capture`.

## Common alerts and fixes

### LiteLLM Proxy 503

Cause: tenant virtual key has no budget, or provider is down.

Fix:

```bash
# Check provider status
curl -s $LITELLM/health/liveliness | jq .

# Check tenant key
curl -s -H "Authorization: Bearer $MASTER_KEY" \
  $LITELLM/key/info?key=$TENANT_KEY | jq .
```

If budget is exhausted, raise the envelope (Platform Engineer action). If provider is down, switch to fallback.

### Audit hash chain anchor failure

Cause: a row was tampered with, or the anchor Lambda failed.

Fix:

1. Compare `audit_log` in primary vs audit account.
2. Identify the divergence point.
3. Treat all rows after the divergence as suspect.
4. Open an incident and engage the Security Reviewer.

### Cost > envelope

Cause: LLM usage spike, runaway workflow, or compromised virtual key.

Fix:

1. Pause workflows via `forge-flow-cancel`.
2. Lower the tenant's budget envelope.
3. Identify the runaway workflow.
4. Rotate the virtual key if compromise is suspected.

### Service downtime

Cause: ECS task crash, RDS failure, or network partition.

Fix:

1. Check ECS task status.
2. Restart via ECS console or CLI.
3. Check RDS for failover events.
4. Engage AWS support if RDS or networking is the cause.

## Escalation paths

| Severity | Escalation |
|---|---|
| Sev1 | L1 → L2 → L3 within 30 minutes |
| Sev2 | L1 → L2 within 1 hour |
| Sev3 | L1 only; weekly review |

## Hand-off

At end of shift, the outgoing L1 writes a hand-off note:

```text
HANDOFF — [date] — [name] → [name]

Active incidents: <list>
Watch items: <list>
Recent changes: <list>
Open follow-ups: <list>
```

## Related

- [Incident response](/operations/incident-response/)
- [Rollback procedures](/operations/rollback/)
- [Troubleshooting](/guides/troubleshooting/)
