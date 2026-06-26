---
draft: false
title: Testing Commands
description: The 5 testing commands — plan, unit, integration, e2e, coverage.
---

The testing category has 5 commands that turn a diff into a tested change.

## Commands

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-test-plan` | user | no | Generate a test plan from the diff |
| `forge-test-unit` | user | no | Run the unit test suite |
| `forge-test-integration` | user | no | Run the integration test suite |
| `forge-test-e2e` | admin | yes | Run the end-to-end test suite |
| `forge-test-coverage` | user | no | Report coverage deltas against baseline |

## What is this category for?

Testing is the layer between development and review. Every `forge-dev-*` command's output is consumed by the testing commands; every `forge-review-*` command's input is the testing output.

## How to use

### Plan

```bash
pnpm forge:exec forge-test-plan \
  --args '{"diff_ref":"pr-123","risk_profile":"high"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

Generates a test plan from a diff. Output lists: required unit tests, required integration tests, required e2e tests, edge cases flagged by the risk profile.

### Unit

```bash
pnpm forge:exec forge-test-unit \
  --args '{"paths":["acme/orders/"],"fail_fast":true}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

Runs the unit suite. `fail_fast=true` stops on first failure (default in CI). Test results land in the audit ledger with the test name, status, and duration.

### Integration

```bash
pnpm forge:exec forge-test-integration \
  --args '{"services":["orders","billing"],"env":"staging"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

Runs the integration suite against the named services in the named environment. Default env is `staging`.

### E2E (admin, requires approval)

```bash
pnpm forge:exec forge-test-e2e \
  --args '{"suite":"checkout_flow","env":"staging","parallelism":4}' \
  --tenant-id acme-corp --project-id acme-api --user-id qa@acme.com
```

Runs the e2e suite. Admin + approval because e2e suites touch shared environments and have non-trivial cost.

### Coverage

```bash
pnpm forge:exec forge-test-coverage \
  --args '{"diff_ref":"pr-123","baseline":"main"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

Reports coverage deltas. Output includes: line coverage delta, branch coverage delta, uncovered lines in the diff. The command fails if line coverage on the diff drops below 80% (configurable).

## Output

- `forge-test-plan` → Test Plan typed artifact
- `forge-test-unit` / `-integration` / `-e2e` → Test Run report
- `forge-test-coverage` → Coverage Report

All outputs are audit-logged with timestamps, durations, and pass/fail counts.

## When to use

| Scenario | Command |
|---|---|
| Before opening a PR | `forge-test-plan` |
| Local pre-commit | `forge-test-unit` |
| Pre-merge | `forge-test-integration` |
| Pre-release | `forge-test-e2e` (admin) |
| PR review | `forge-test-coverage` |

## CI integration

The testing commands are the canonical CI surface. A typical pipeline:

```yaml
- forge-test-unit       # on every push
- forge-test-integration # on PR open/update
- forge-test-e2e         # on PR labeled ready-for-e2e (admin)
- forge-test-coverage    # on PR open/update
```

## Related

- [Development commands](/commands/development/)
- [Code Review commands](/commands/code-review/)
- [Success metrics](/operations/success-metrics/) — Coverage as a KPI
