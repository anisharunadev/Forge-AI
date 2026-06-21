---
title: Rollback Procedures
description: How to roll back a Forge AI deployment — commands, decision tree, audit.
---

This page is the operational runbook for rolling back a Forge AI deployment. It covers the decision tree, the command sequence, and the audit trail.

## What is this?

A rollback is the path from "this deployment is making things worse" to "we're back on the last good state". In Forge, the canonical path is `forge-deploy-rollback` — but only after the right decision tree.

## When to roll back

Roll back if **any** of:

- Error rate > 2x baseline within 15 minutes of canary start.
- p99 latency > 2x baseline within 15 minutes.
- Cost spike > 2x envelope within 15 minutes.
- A Sev1 incident attributable to the deploy.
- Compliance signal (security scan, policy check) goes red.

Do **not** roll back for:

- A single failed transaction in a non-critical path (file an incident, monitor).
- A noisy metric without corroboration.
- Customer-specific issue that doesn't generalize (route around).

## Decision tree

```text
Canary started
    |
    | Within 15 minutes:
    | - error rate > 2x baseline?      ---+
    | - p99 latency > 2x baseline?     ---+--> PAUSE canary, check signals
    | - cost > 2x envelope?            ---+         |
    | - sev1 attributable?             ---+         v
    | - compliance signal red?         ---+    Confirm signal is real
    |                                            |
    |                                            v
    |                                       forge-deploy-rollback
    |                                            |
    |                                            v
    |                                       ROLLBACK COMPLETE
    |
    | All clear at 15 min → promote to 50%
    |
    | All clear at 30 min → promote to 100%
```

## Rollback command

The canonical rollback command is:

```bash
pnpm forge:exec forge-deploy-rollback \
  --args '{"environment":"prod","target_build_id":"<previous-good-build>","reason":"<one-line>"}' \
  --tenant-id acme-corp --project-id acme-api --user-id oncall@acme.com
```

The command:

1. Pauses at the HITL gate (system tier commands still require approval).
2. Validates the target build exists and is healthy.
3. Promotes the target build to the failed environment.
4. Emits a Rollback Event in the audit ledger.

## Post-rollback

After a rollback:

1. The on-call documents the rollback in the incident channel.
2. A post-mortem is scheduled within 24 hours.
3. The build that was rolled back is marked `rolled_back` in the milestone archive.
4. A lesson is captured via `forge-learn-capture`.
5. The pilot Owner reviews the rollout for repeat patterns.

## When rollback fails

If `forge-deploy-rollback` itself fails:

1. Check the orchestrator's status.
2. If the orchestrator is down, fall back to manual rollback via AWS console / CLI.
3. Manual rollback must be audited retroactively (insert a manual audit row).
4. The Platform Engineer opens an incident on the orchestrator.

## Multi-region rollback

In V1, Forge is single-region (per NFR-008). If the region is degraded:

1. The Platform Engineer pages AWS support.
2. If the region is irrecoverable, the tenant is informed.
3. The audit ledger in the audit account is intact; the primary data may need recovery from snapshots.

RPO is ≤ 24h, RTO is ≤ 4h per NFR-014.

## Anti-patterns

- **Don't skip the HITL gate.** Rollback is destructive. The gate ensures a human reviewed.
- **Don't roll back without a reason.** The `reason` field is required for the audit ledger.
- **Don't re-deploy immediately.** Wait for the post-mortem; otherwise you'll roll back again.
- **Don't lose the audit trail.** Even manual rollbacks need a row.

## Related

- [Oncall runbook](/operations/oncall/)
- [Incident response](/operations/incident-response/)
- [Deployment commands](/commands/deployment/)
- [ADR-001: AWS-only deployment](/architecture/adr-001-aws/)
