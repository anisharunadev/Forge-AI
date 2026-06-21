---
title: Incident Response
description: Severity levels, response procedures, post-mortems, communications.
---

This page is the incident response procedure for the Forge AI platform. It defines severity levels, the response procedure, the communications plan, and the post-mortem template.

## What is this?

The reference for handling an incident. Pair with the [Oncall runbook](/operations/oncall/) for shift-specific guidance.

## Severity levels

| Severity | Definition | Examples |
|---|---|---|
| **Sev1** | Service down for ≥1 tenant; data loss risk; security breach | Service crash; hash chain anchor failure; leaked secret |
| **Sev2** | Service degraded; some tenants affected; no data loss | LiteLLM cost spike; connector down; latency p99 > 2x baseline |
| **Sev3** | Service operating normally; minor issue | Audit log latency; non-critical alert; noisy metric |

## Response procedure

### Sev1

1. **Acknowledge** (within 5 minutes).
2. **Convene** the incident channel: L1 + L2 + L3.
3. **Contain** (within 15 minutes).
4. **Communicate** to affected tenants within 30 minutes.
5. **Resolve** as fast as safely possible.
6. **Post-mortem** within 48 hours.

### Sev2

1. **Acknowledge** (within 15 minutes).
2. **Convene** the incident channel: L1 + L2.
3. **Contain** (within 1 hour).
4. **Communicate** to affected tenants within 2 hours.
5. **Resolve** within the work day.
6. **Post-mortem** within 1 week.

### Sev3

1. **Acknowledge** during business hours.
2. **Triage** and route to the appropriate runbook.
3. **Communicate** in the daily standup if not resolved.
4. **Resolve** within the week.
5. **No formal post-mortem** unless it becomes a Sev2.

## Communications

### Internal

| Channel | Audience | Cadence |
|---|---|---|
| Incident channel | L1, L2, L3, sponsor (Sev1) | Every 30 minutes |
| Pilot team standup | Pilot team | Daily |
| Pilot status | Pilot team + sponsor | Weekly |

### Tenant-facing

For Sev1/Sev2:

```text
Subject: Forge AI — Incident report

We are investigating an incident affecting <services>.
Started: <timestamp>
Affected: <tenants / impact>
Status: <investigating | identified | mitigated | resolved>
Next update: <timestamp>
```

Post to: tenant status page, dedicated Slack channel, or email per tenant preference.

## Post-mortem template

```markdown
# Post-mortem — <incident title>

## Summary

<one paragraph: what happened, who was affected, how long>

## Timeline (UTC)

- <timestamp>: <event>
- <timestamp>: <event>
- ...

## Root cause

<one paragraph: what actually caused it>

## Contributing factors

- <factor 1>
- <factor 2>

## What went well

- <item>

## What didn't go well

- <item>

## Action items

| Item | Owner | Severity | Due |
|---|---|---|---|
| <item> | <name> | <Sev?> | <date> |

## Lessons

Captured via `forge-learn-capture` with tags: <tags>
Promoted: yes / no (target: <org_policy | template | standard>)
```

## Severity upgrade criteria

A Sev3 becomes a Sev2 if:

- It affects > 1 tenant.
- It recurs within 7 days.
- It crosses into a Sev1 root cause (e.g., audit ledger integrity).

A Sev2 becomes a Sev1 if:

- It causes data loss.
- It causes a security breach.
- It causes tenant-visible downtime > 1 hour.

## When to halt the pilot

The pilot halts if:

- A Sev1 is attributable to the platform and not resolved within 4 hours.
- A Sev2 recurs > 3 times in a week.
- The audit ledger hash chain breaks and cannot be reconciled within 24 hours.

Halt is decided by the Pilot Owner in consultation with the Pilot Sponsor and Architect (L3).

## Anti-patterns

- **Don't hide incidents.** Every Sev2+ is recorded.
- **Don't skip the post-mortem.** Even quick ones surface patterns.
- **Don't blame individuals.** Blame the system.
- **Don't communicate via untracked channels.** Use the incident channel so the post-mortem has the full record.

## Related

- [Oncall runbook](/operations/oncall/)
- [Rollback procedures](/operations/rollback/)
- [Troubleshooting](/guides/troubleshooting/)
- [forge-learn-capture](/commands/learning/)
