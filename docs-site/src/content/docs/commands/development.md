---
title: Development Commands
description: The 7 development commands — scaffold, implement, refactor, format, lint, hotfix, migrate.
---

The development category has 7 commands that produce and modify code.

## Commands

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-dev-scaffold` | user | no | Scaffold code from a contract spec |
| `forge-dev-implement` | user | no | Implement a feature end-to-end |
| `forge-dev-refactor` | user | no | Refactor while preserving behavior |
| `forge-dev-format` | user | no | Format the working tree |
| `forge-dev-lint` | user | no | Run project linters |
| `forge-dev-hotfix` | admin | yes | Emergency patch path with audit |
| `forge-dev-migrate` | admin | yes | Run data or schema migrations |

## What is this category for?

Development is where typed artifacts become code. The development commands take a `Task Breakdown` from the architecture phase and produce code in a feature branch, in a sandboxed workspace, with every action audited.

## How to use

### Scaffold

```bash
pnpm forge:exec forge-dev-scaffold \
  --args '{"contract_id":"contract-001","framework":"fastapi"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

Generates a new service skeleton from a contract. The skeleton includes: project layout, CI config, Docker, OpenAPI client, smoke test. It opens a feature branch.

### Implement

```bash
pnpm forge:exec forge-dev-implement \
  --args '{"task_breakdown_id":"tb-001","branch":"feat/orders-idempotency"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

Implements a feature end-to-end against a `Task Breakdown` typed artifact. The orchestrator uses the Terminal Center to run Claude Code, Codex, or another agent CLI inside a PTY. Every byte is audited.

### Refactor

```bash
pnpm forge:exec forge-dev-refactor \
  --args '{"scope":"acme.api.orders","preserve_behavior":true,"coverage_floor":0.85}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

Refactors a code region while preserving behavior. `coverage_floor` ensures the test suite is maintained or grown; the refactor fails if coverage drops below the floor.

### Format / Lint

```bash
pnpm forge:exec forge-dev-format --args '{"paths":["acme/"]}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com

pnpm forge:exec forge-dev-lint --args '{"paths":["acme/"]}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

Format and lint are the routine hygiene commands. They run in CI on every PR but are also runnable on demand.

### Hotfix (admin, requires approval)

```bash
pnpm forge:exec forge-dev-hotfix \
  --args '{"incident_id":"inc-001","branch":"hotfix/leak-001","target_sha":"abc123"}' \
  --tenant-id acme-corp --project-id acme-api --user-id oncall@acme.com
```

Emergency patch path. Opens a hotfix branch, applies a minimal patch, runs the smoke test suite, and stages the deploy. Admin + approval because hotfixes skip the standard review chain.

### Migrate (admin, requires approval)

```bash
pnpm forge:exec forge-dev-migrate \
  --args '{"migration":"0007_add_idempotency_key","target":"orders.events","dry_run":true}' \
  --tenant-id acme-corp --project-id acme-api --user-id dba@acme.com
```

Runs a data or schema migration. `dry_run=true` is the default — it produces a plan and pauses for approval. Setting `dry_run=false` requires the approval gate to be cleared.

## Output

- `forge-dev-scaffold` / `-implement` / `-refactor` — pull request with diff
- `forge-dev-format` / `-lint` — patch
- `forge-dev-hotfix` — hotfix branch + staged deploy
- `forge-dev-migrate` — migration plan or applied migration

Every PR is linked to the originating task breakdown and ADR. The audit ledger records the model, prompt hash, tool calls, and cost.

## When to use

| Scenario | Command |
|---|---|
| Start a new service | `forge-dev-scaffold` |
| Implement a feature | `forge-dev-implement` |
| Clean up code | `forge-dev-refactor` |
| Pre-commit hygiene | `forge-dev-format` + `forge-dev-lint` |
| Patch in production | `forge-dev-hotfix` (admin) |
| Apply a schema change | `forge-dev-migrate` (admin) |

## Related

- [Testing commands](/commands/testing/)
- [Code Review commands](/commands/code-review/)
- [ADR-006: Terminal Center](/architecture/adr-006-terminal-pty/)
