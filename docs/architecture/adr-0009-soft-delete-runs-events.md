# ADR-0009: Soft-Delete-Only for `agent_runs` and `agent_run_events`

| Field             | Value                                                                                          |
|-------------------|------------------------------------------------------------------------------------------------|
| **Status**        | **Accepted**                                                                                   |
| **Date**          | 2026-06-17                                                                                     |
| **Author**        | CTO (f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0)                                                     |
| **Reviewer**      | CTO (one-way door; per architecture.md §5) — CEO informational                                |
| **Issue**         | [FORA-50](/FORA/issues/FORA-50) Sub-goal 0.1 (Master Orchestrator)                            |
| **Sub-task**      | [FORA-134](/FORA/issues/FORA-134) (0.1.1 — Session lifecycle)                                 |
| **Parent ADR**    | [ADR-0001](./adr-0001-master-orchestrator-sdlc-architecture.md)                               |
| **Supersedes**    | none                                                                                           |
| **Superseded by** | none                                                                                           |

---

## 1. Context

The [FORA-50 spec §3](/FORA/issues/FORA-50#document-spec) data model has four tables: `agent_runs`, `agent_run_stages`, `agent_run_events`, `agent_run_approvals`. The spec is explicit:

> "A nightly job ships the rows to the audit account per the [security.md §6](../workspace/memory/security.md) cross-account pattern."

…and:

> "Soft-delete only; the row has `deleted_at` and the API filters it out."

The `agent_run_events` table is the **spine of the audit trail** consumed by [FORA-36](/FORA/issues/FORA-36) (Audit 0.5). The [FORA-36 ADR D1](/FORA/docs/adr/0001-audit-system-one-way-doors.md) makes that audit table append-only with three Postgres roles and a DB-level trigger that raises an exception on `UPDATE`/`DELETE` for any role, including the admin. That is the cross-account audit; the in-platform tables in the FORA-50 spec are a *different* set of tables (the live run state, not the audit).

This ADR decides the delete contract for the four FORA-50 tables. It is a one-way door per architecture.md §5: every consumer, every retention policy, every export pipeline pins to it.

## 2. Decision

We adopt a **soft-delete-only** policy for `agent_runs`, `agent_run_stages`, and `agent_run_approvals`. The `agent_run_events` table is **append-only** — no `DELETE` operation is exposed at all; old rows are aged out by a partition rotation, not by a delete.

### 2.1 One-line summary

> "Soft-delete via `deleted_at` on `agent_runs`, `agent_run_stages`, `agent_run_approvals`; append-only on `agent_run_events` with monthly partition rotation; a single retention policy drives all four; the API never returns a soft-deleted row."

## 3. Per-table contract

| Table                  | Soft-delete? | Hard-delete? | Retention default | Retention override | Notes |
|------------------------|--------------|---------------|--------------------|--------------------|-------|
| `agent_runs`           | yes (`deleted_at`) | no        | 90 days soft; 7 years cold (S3 archive) | per-tenant | The header is the entry point for the run; soft-deleting it hides the whole tree. |
| `agent_run_stages`     | inherits     | no            | inherits from run  | inherits from run   | A stage row is never deleted independently of its run. |
| `agent_run_events`     | **n/a — append-only** | **forbidden** | 30 days hot (Postgres); 7 years cold (audit account) | none — audit owns retention | The DB role has no `DELETE` privilege; the trigger raises on any attempt. |
| `agent_run_approvals`  | yes (`deleted_at`) | no        | 30 days soft; 7 years cold (audit account) | per-tenant | Approval rows are queryable for the run lifetime, then soft-deleted; the audit account retains them. |

## 4. Why soft-delete, not hard-delete

1. **Recoverability.** A user clicks "delete run" in the Forge console. The row is hidden, not destroyed. If the click was a mistake, the operator restores the row; the run resumes from the last persisted `agent_run_stages` row per FORA-50 spec §2.2.
2. **Audit-trail continuity.** The audit account (FORA-36) reads `agent_run_events` via the bus. If the platform's table is hard-deleted, the audit's view of history is intact (it has its own copy), but the platform's recovery path is gone. Soft-delete keeps the platform's recovery path alive while the audit retains its copy independently.
3. **GDPR / right-to-erasure is a hard-delete on a different table.** The Memory agent's `memory_fact` table (per ADR-0002 §6.3) handles PII erasure. The run-state tables carry `tenant_id` and run metadata, not PII; the PII lives in the Memory store and the audit account's payloads. Soft-delete on the run-state tables is GDPR-safe by construction.
4. **Soft-delete is reversible. Hard-delete is not.** A hard-delete is a one-way door; soft-delete is a two-way door. We pick the reversible option by default per architecture.md §5.

## 5. The schema additions

```sql
-- agent_runs: soft-delete column
ALTER TABLE agent_runs ADD COLUMN deleted_at timestamptz;
CREATE INDEX ON agent_runs (tenant_id, deleted_at) WHERE deleted_at IS NULL;

-- agent_run_stages: inherits the run's deleted_at; we do not add a per-stage column.
-- The API joins stages to runs and filters by runs.deleted_at IS NULL.

-- agent_run_events: append-only; no delete column. The trigger is the contract.
CREATE OR REPLACE FUNCTION agent_run_events_no_modify()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agent_run_events is append-only; UPDATE/DELETE forbidden';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_run_events_append_only
BEFORE UPDATE OR DELETE ON agent_run_events
FOR EACH ROW EXECUTE FUNCTION agent_run_events_no_modify();

-- agent_run_approvals: soft-delete column
ALTER TABLE agent_run_approvals ADD COLUMN deleted_at timestamptz;
CREATE INDEX ON agent_run_approvals (status, deleted_at) WHERE deleted_at IS NULL AND status = 'pending';
```

The DB role used by the Orchestrator does **not** have `DELETE` privilege on `agent_run_events`. The trigger is defence in depth.

## 6. The API contract

- **Reads.** Every read endpoint filters `deleted_at IS NULL` at the SQL layer. A `GET /v1/runs/{id}` for a soft-deleted run returns `404 not_found` (not `410 gone`; the row still exists for the audit account to read).
- **Soft-delete.** A new endpoint `POST /v1/runs/{id}/soft-delete` sets `deleted_at = now()`. The action is idempotent on the `Idempotency-Key`; re-deleting a deleted run is a no-op.
- **Restore.** A new endpoint `POST /v1/runs/{id}/restore` clears `deleted_at`. Restricted to the `cto` and `ceo` roles per the role-of-record table in ADR-0008 §3.
- **Hard-delete.** No endpoint exists. Hard-delete is a DBA operation with a 1Password-held credential, every use alerted, retention-driven only. The DBA path is for compliance, not for product.

## 7. Retention and the cold tier

| Table                  | Hot retention (Postgres) | Cold tier              | Cold retention |
|------------------------|---------------------------|------------------------|----------------|
| `agent_runs`           | 90 days after `deleted_at` (or `finished_at`, whichever is later) | S3 archive (platform account, lifecycle to Glacier) | 7 years |
| `agent_run_stages`     | 90 days, then archived with the run | S3 archive | 7 years |
| `agent_run_events`     | 30 days hot (Postgres partition rotation) | S3 archive (audit account) | 7 years (audit owns the cold tier) |
| `agent_run_approvals`  | 30 days, then archived with the run | S3 archive | 7 years |

The cold tier is read-only and is queried via the audit account, not via the platform's API. The platform's API only sees hot rows.

The retention job is a separate background worker (`agent-run-archiver`) that runs daily, copies the eligible rows to S3 as a Parquet snapshot, and updates the run's `archived_at` column. The row stays in Postgres for the hot window; after that, the row is **also** in S3, and the DBA path can hard-delete the Postgres copy if disk pressure demands it. Until then, the Postgres row is the source of truth.

## 8. Tenant override

A tenant may **extend** retention (e.g. "keep our runs for 1 year instead of 90 days"). A tenant may **not shorten** retention below the platform default — that would create audit gaps. The override lives in `tenants/{tenant_id}/policy.yaml` per ADR-0003 §5.2:

```yaml
retention:
  runs_soft_delete_days: 365   # default 90
  events_hot_days: 60          # default 30; cold tier retention is non-negotiable
```

The platform's hard delete (the DBA path) is bound to the **maximum** of the platform default and the tenant override.

## 9. Failure modes

| Failure                                  | Behavior                                                                                              |
|------------------------------------------|-------------------------------------------------------------------------------------------------------|
| Operator soft-deletes a run by mistake   | The restore endpoint (§6) clears `deleted_at`; the run resumes from the last persisted stage.        |
| Soft-delete column is missing on a row    | The query `WHERE deleted_at IS NULL` returns the row as live; the migration must be forward-only and complete. A 0-row `agent_runs` count after migration is a P1 alert. |
| DBA hard-deletes from the audit account  | The audit account's own append-only trigger (FORA-36 ADR D1) raises; the action is recorded in the admin log; SRE is paged. |
| Cold tier S3 bucket lifecycle mis-set    | Cold rows are unavailable for the audit account; a CloudWatch alarm on the bucket's lifecycle transition fires. |
| Tenant requests GDPR erasure of a run     | The Memory agent's `memory.forget` cascade (ADR-0002 §6.3) handles PII; the run-state row is soft-deleted. The audit account retains its own copy; the customer contract specifies the audit-account retention. |

## 10. Consequences

### Positive

- **Reversible by default.** Soft-delete is the default; hard-delete is a DBA action that pages.
- **Audit continuity.** The audit account reads its own copy of the events; the platform's soft-delete is invisible to the audit.
- **Compliance posture.** GDPR / right-to-erasure is a Memory-store operation; the run-state tables carry no PII.
- **Operational simplicity.** One retention job, one cold tier, one role for the DBA path.

### Negative / risks

- **Disk pressure.** Soft-deleted rows consume Postgres disk for the hot window. The retention job migrates to S3; if the job fails, disk fills. A CloudWatch alarm on `agent_runs` row count fires at 80% of the budget.
- **API discipline.** A future contributor may write a read endpoint that forgets `WHERE deleted_at IS NULL`. The data layer's standard query helper (`agent_runs.find_one(id)`) always filters; raw SQL is code-reviewed. ESLint rule flags `SELECT *` on `agent_runs` without a `deleted_at` filter.
- **Restore is a privileged action.** The `restore` endpoint is restricted to `cto` and `ceo` roles; a future ADR may add a per-tenant role.

## 11. Alternatives considered

1. **Hard-delete on `agent_runs` after a retention window.** Rejected: the audit account has its own copy, but the platform's recovery path is gone. A bad delete is unrecoverable.
2. **Cryptographic erasure (per-row key, discard the key).** Deferred: a v1.1 ADR for PII-bearing tables (Memory store); the run-state tables carry no PII, so the simpler soft-delete is correct here.
3. **Two-phase delete (tombstone, then async hard-delete).** Rejected: adds a job, adds a state. Soft-delete with a slow retention job is the same outcome with less code.
4. **Hard-delete on the audit account too.** Forbidden: the FORA-36 ADR D1 makes the audit account append-only at the trigger level. This ADR is consistent with that.

## 12. Out of scope (future ADRs / follow-ups)

- **Per-row encryption keys for PII-bearing tables** (Memory store, future customer-data tables). A v1.1 ADR.
- **Tenant-configurable hard-delete window for compliance-bound customers.** A v1.1 ADR; today, the DBA path is the only escape hatch.
- **Right-to-erasure SLA.** The Memory agent's forget cascade is async; a future ADR will commit to a wall-clock SLA.

## 13. Reviewer sign-off

This ADR is a **one-way door** (per architecture.md §5). The CTO signs every one-way-door ADR; CEO sign-off is not required for this scoped decision because it is bounded to the delete contract on the four FORA-50 tables and does not touch the cross-stage spine defined in ADR-0001.

- [x] **CTO — approved as proposed on 2026-06-17** (author: f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0)
- [ ] CEO — informational copy; this ADR does not require CEO sign-off per architecture.md §5

### Follow-up issues (opened on acceptance)

- [FORA-134](/FORA/issues/FORA-134) — Session lifecycle ships with the soft-delete column on `agent_runs`, `agent_run_stages`, `agent_run_approvals`
- A future ADR will publish the `agent-run-archiver` retention worker
