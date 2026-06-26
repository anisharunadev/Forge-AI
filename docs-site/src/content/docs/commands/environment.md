---
draft: false
title: Environment Commands
description: The 4 environment commands — list, diff, sync, promote.
---

The environment category has 4 commands that manage the lifecycle of runtime environments.

## Commands

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-env-list` | user | no | List environments for the tenant |
| `forge-env-diff` | admin | yes | Diff two environments |
| `forge-env-sync` | system | yes | Sync env A to env B (destructive) |
| `forge-env-promote` | admin | yes | Promote a version between environments |

## What is this category for?

Environments are the runtime substrates where builds are deployed. The standard progression: dev → staging → prod. The environment commands manage that progression and the diff/sync operations that keep environments consistent.

## How to use

### List

```bash
pnpm forge:exec forge-env-list \
  --args '{}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

Returns: dev, staging, prod with current build versions, last deploy time, health status.

### Diff (admin, requires approval)

```bash
pnpm forge:exec forge-env-diff \
  --args '{"env_a":"staging","env_b":"prod","compare":["config","secrets_refs","feature_flags","data_migration"]}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com
```

Returns a structured diff between the two environments. Useful for verifying that prod is actually what you think it is.

### Sync (system, requires approval)

```bash
pnpm forge:exec forge-env-sync \
  --args '{"source":"staging","target":"prod","sync":["feature_flags"],"dry_run":true}' \
  --tenant-id acme-corp --project-id acme-api --user-id system
```

Syncs a subset of environment state from source to target. `dry_run=true` is the default — the command produces a plan and pauses for approval. System tier because sync is destructive.

### Promote (admin, requires approval)

```bash
pnpm forge:exec forge-env-promote \
  --args '{"artifact":"orders-api","version":"2026.06.21","source":"staging","target":"prod","strategy":"canary"}' \
  --tenant-id acme-corp --project-id acme-api --user-id releaser@acme.com
```

Promotes a specific artifact version from one environment to another. Composes with `forge-deploy-*` for the actual rollout.

## Output

- `forge-env-list` → Environment list snapshot
- `forge-env-diff` → Diff report
- `forge-env-sync` → Sync plan or applied sync
- `forge-env-promote` → Promotion event

## Environment metadata

Each environment has:

| Field | Source |
|---|---|
| `name` | Tenant-defined |
| `region` | AWS region |
| `build_version` | Last deployed |
| `feature_flags` | Flag state |
| `secrets_refs` | Secret IDs (not values) |
| `last_deploy_at` | Deploy event timestamp |
| `health` | Liveness + readiness |

## When to use

| Scenario | Command |
|---|---|
| Daily status check | `forge-env-list` |
| Pre-deploy verification | `forge-env-diff` (admin) |
| Flag sync between envs | `forge-env-sync` (system) |
| Promote a build | `forge-env-promote` (admin) |

## Related

- [Deployment commands](/commands/deployment/)
- [ADR-001: AWS-only deployment](/architecture/adr-001-aws/)
- [ADR-002: PostgreSQL + AGE + pgvector](/architecture/adr-002-postgres-age/)
