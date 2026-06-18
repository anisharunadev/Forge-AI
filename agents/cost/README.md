# agents/cost — FORA-75 (0.6 Cost tracking)

Per-run, per-stage, per-tenant cost ledger derived from the Audit
system 0.5 (FORA-36), with per-tenant monthly ceiling enforcement and
a `budget.remaining(runId)` hint the Agent runtime 0.2 (FORA-30) reads
to abort runs before they exceed the cap.  The board / CEO read API
consumes the same ledger.

## Cardinal rule

**There is exactly one write path into the cost ledger, and it lives
in the audit system.** This module never appends to `audit.events`; it
only reads.  The acceptance test
`tests/test_reconciliation.py` is the property test for "cost ledger
reconciles to the audit ledger to the cent on a random-day audit."

## What this ships

| Deliverable | Where | Notes |
| --- | --- | --- |
| Read-only cost ledger | `ledger.py` | `CostLedger`; `month_cost`, `current_month_cost`, `list_month_costs`, `list_tenant_costs`, `run_cost`, `total_cents` |
| Per-tenant monthly ceiling | `policy.py` | `BudgetPolicy`; `TenantPolicyStore` (in-memory dev, Postgres + audit-account prod) |
| Ceiling meter | `ceiling.py` | `CeilingMeter`; fires `soft_threshold` / `hard_threshold` / `tenant_paused` alerts, idempotent on (tenant, month) |
| Alert log | `alerts.py` | `AlertLog` (append-only, idempotent on `alert_key`); `AlertRecord`, `AlertKind` |
| Tenant gate | `gate.py` | `TenantGate`; the orchestrator (FORA-110) calls `check(tenant_id)` before launching a run |
| Board read API | `board.py` | `BoardReader`; `monthly_burndown`, `top_spending`, `current_month`, `alert_log` |
| Runtime budget hint | `integration.py` | `RuntimeBudgetHint`; the `budget.remaining(runId)` seam for FORA-30 |
| Feature flag | `feature_flag.py` | `FORA_COST_ENABLED`; default on |

## How it fits with the rest of the platform

```
                    +-------------------+
   runtime ---->    |  CostLedger       |  (read-only; backed by audit.events)
   (FORA-30)        |                   |
                    +-------------------+
                            |
                            v
   runtime ---->   RuntimeBudgetHint.remaining(tenantId, runId)
                            |
                            v
                  +--------------------+
                  |  CeilingMeter      | -- recompute() --> AlertLog
                  +--------------------+                |
                            |                           v
                            +--->  TenantGate.check(tenantId) --> orchestrator (FORA-110)
                            |                           |
                            +--->  BoardReader (board / CEO)  |
                                                       v
                                              (soft/hard alerts)
```

## Hash-chain and audit posture

This module does not introduce a new hash chain.  The cost totals
are sums over `audit.events.cost_cents`; the integrity property is
inherited from FORA-36.  A bug in the ledger that misreports is
detectable on the reconciliation test, which sums every
`cost_cents` value in the audit store and compares to the
`month_cost` / `current_month_cost` roll-ups.

## Feature flag

`FORA_COST_ENABLED=1` (default) -- alerts fire and the gate enforces.
`FORA_COST_ENABLED=0` -- the ledger still works (it is a read), but
alerts and gate enforcement are inert.  The flag is read on every
`recompute` and `check`; flipping it does not retroactively suppress
alerts that already fired.

## Acceptance mapping

| Acceptance criterion (issue body) | Mechanism |
| --- | --- |
| After 10 sub-agent runs in one tenant, the board can pull the cost breakdown by stage and by tool. | `BoardReader.top_spending(tenant_id, by="stage"\|"tool")` + `CostSummary.by_stage` / `by_tool`; `tests/test_board.py::test_ten_runs_breakdown` |
| Soft threshold breach produces a board notification within one heartbeat; hard threshold pauses new runs. | `CeilingMeter.recompute` fires `soft_threshold` / `hard_threshold` / `tenant_paused` alerts idempotently; `TenantGate.check` denies admission when paused; `tests/test_ceiling.py` |
| Cost ledger reconciles to the Audit ledger to the cent on a random-day audit. | `CostLedger.total_cents(tenant_id)` == sum of `month_cost().total_cost_cents` across months; `tests/test_reconciliation.py` |
| Agent runtime can read `budget.remaining(runId)` and short-circuit before exceeding it. | `RuntimeBudgetHint.remaining(tenant_id, run_id)` returns `BudgetHint` with `cents`, `usd`, and `is_blocked`; `tests/test_integration.py` |

## Out of scope (deferred)

- **Production Postgres + SQS for the policy store and alert log.**
  The dev path is in-memory; the prod path is a sibling of
  `audit.events` in the audit account.  Same cross-account boundary
  as the audit store.
- **Soft-delete / admin override on alert log entries.**  Inherits
  the audit admin pattern (`AuditAdmin`); the next ticket when the
  cost-agent hire lands.
- **Multi-region cost roll-up.**  v1 is single-region; v1.1 mirrors
  the audit store's multi-region path.
- **Per-tool / per-stage budget caps.**  v1 is per-tenant + per-run
  only.  Per-tool caps are a customer request that we collect
  before designing the v1.1 surface.

## Running the tests

```
python3 -m agents.cost.tests.test_ledger
python3 -m agents.cost.tests.test_ceiling
python3 -m agents.cost.tests.test_alerts
python3 -m agents.cost.tests.test_gate
python3 -m agents.cost.tests.test_board
python3 -m agents.cost.tests.test_integration
python3 -m agents.cost.tests.test_reconciliation
```

Each test prints `OK` or `FAIL` with a list of failures.  Evidence
artefacts are written to `agents/cost/evidence/`.
