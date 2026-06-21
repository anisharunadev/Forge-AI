---
title: Deployment Commands
description: The 5 deployment commands — plan, stage, prod, rollback, status.
---

The deployment category has 5 commands that turn a merged change into a runtime action. Every command requires approval (except `status`) and produces a Deployment Plan typed artifact.

## Commands

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-deploy-plan` | admin | yes | Plan a deployment (versions, blast radius) |
| `forge-deploy-stage` | admin | yes | Promote a build to staging |
| `forge-deploy-prod` | admin | yes | Promote a build to production |
| `forge-deploy-rollback` | system | yes | Roll back the most recent prod deploy |
| `forge-deploy-status` | user | no | Show current deploy state per environment |

## What is this category for?

Deployment is one of the three **mandatory approval gates** (R3). Every production deployment pauses at the gate and lands in the audit ledger with the approver's identity, the deployment plan, and the cost of the workflow that produced it.

## How to use

### Plan (admin, requires approval)

```bash
pnpm forge:exec forge-deploy-plan \
  --args '{"build_id":"abc123","target_env":"prod","strategy":"canary"}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com
```

Produces a Deployment Plan typed artifact: versions, blast radius, canary schedule, rollback procedure, expected cost.

### Stage (admin, requires approval)

```bash
pnpm forge:exec forge-deploy-stage \
  --args '{"build_id":"abc123","environment":"staging"}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com
```

Promotes a build to staging. Runs smoke tests, then halts. The HITL gate decides whether to proceed to prod.

### Prod (admin, requires approval)

```bash
pnpm forge:exec forge-deploy-prod \
  --args '{"build_id":"abc123","environment":"prod","canary_pct":5,"canary_window":"15m"}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com
```

Promotes to prod with a canary. Default: 5% traffic for 15 minutes, then auto-promote if error budget holds.

### Rollback (system, requires approval)

```bash
pnpm forge:exec forge-deploy-rollback \
  --args '{"environment":"prod","target_build_id":"abc100","reason":"sev2 error spike"}' \
  --tenant-id acme-corp --project-id acme-api --user-id system
```

Rolls back to a previous build. System-initiated (alerting or on-call) but requires approval because it disrupts prod traffic.

### Status

```bash
pnpm forge:exec forge-deploy-status \
  --args '{"environments":["staging","prod"]}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com
```

Returns current deploy state per environment. Read-only — no approval needed.

## Output

- `forge-deploy-plan` → Deployment Plan typed artifact
- `forge-deploy-stage` / `-prod` → Deploy Event + environment state
- `forge-deploy-rollback` → Rollback Event
- `forge-deploy-status` → Snapshot (read-only)

## Canary strategy

The default canary schedule:

```text
0 min   — promote 5% of traffic
15 min  — check error rate, p99 latency, cost
          if all within budget → promote 50%
30 min  — check again
          if all within budget → promote 100%
```

If any check fails, the canary is auto-paused and `forge-deploy-rollback` is queued for on-call approval.

## When to use

| Scenario | Command |
|---|---|
| Pre-release planning | `forge-deploy-plan` (admin) |
| Staging promotion | `forge-deploy-stage` (admin) |
| Production release | `forge-deploy-prod` (admin) |
| Bad release | `forge-deploy-rollback` (system) |
| Status dashboard | `forge-deploy-status` |

## Related

- [Approval gates](/concepts/approval-gates/)
- [Milestones commands](/commands/milestones/)
- [Environment commands](/commands/environment/)
- [ADR-001: AWS-only deployment](/architecture/adr-001-aws/)
