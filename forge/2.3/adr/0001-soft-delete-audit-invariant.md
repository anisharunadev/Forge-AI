---
version: 0.1.0
last-reviewed-by: cto
last-reviewed-at: 2026-06-17
parent-prd: workspace/project/PRD.md
parent-issue: FORA-35
sub-goal: "2.3 — Design generation (design-generator)"
epic: FORA-18 (Epic 2 — Architecture Agent)
---

# ADR-0001 — Soft-delete + audit columns on every user table

- **Status:** proposed
- **Date:** 2026-06-17
- **Deciders:** CTO (f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0); CEO informational
- **Sub-goal:** FORA-35 (2.3 — Design generation)
- **Supersedes:** none
- **Superseded by:** none
- **Parent ADR:** [`docs/architecture/adr-0009-soft-delete-runs-events.md`](../../../docs/architecture/adr-0009-soft-delete-runs-events.md) (extends the soft-delete policy from `agent_runs` / `agent_run_events` to **every** user-data table)

## Context

Architecture memory §6 mandates soft delete for user data with `deleted_at timestamptz` and a partial-index `WHERE deleted_at IS NULL` read pattern. The four existing migrations (`0001`–`0004`) already apply this to `agent_runs`, `agent_run_stages`, and `agent_run_approvals`. The 2.3 design pass needs to lock the invariant for the next 9 tables (per the ERD in `forge/2.3/erd.mmd`): `tenants`, `users`, `tenant_memberships`, `interactions`, `comments`, `agent_run_events`, `audit_log`, `object_store_objects`, `secrets_reads`.

The hard-delete path is reserved for legal-request workflows and operates out-of-band (DBA, 1Password-held credentials, audit row with `action = "hard_delete"`). The default query path never sees soft-deleted rows.

This is a one-way door per architecture memory §5: a partial-index read pattern is encoded in every default query, every lint fixture, and every migration template. Reverting requires a coordinated rewrite of every consumer.

## Decision

We adopt the following column set as the **non-negotiable floor** on every user-data table created in v1:

```sql
id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id    uuid        NOT NULL,         -- RLS column; see ADR-0003
created_at   timestamptz NOT NULL DEFAULT now(),
updated_at   timestamptz NOT NULL DEFAULT now(),  -- trigger-maintained
created_by   text,                          -- user_id, agent:id, or "system:probe"
updated_by   text,
deleted_at   timestamptz,                   -- NULL = live
deleted_by   text,
-- table-specific columns follow
```

Rules:

1. Every `CREATE TABLE` is linted by `packages/tenancy-lint` (red fixture: `red-createtable-app.sql`); CI fails the build on a violation.
2. Every read query carries `WHERE deleted_at IS NULL` by default. The lint flags a bare `SELECT` against a user table without that clause.
3. `hard_delete` is a separate code path (`packages/db-migrator/audit/0001_audit_reader_role.sql` role + DBA runbook), not a column on a regular app role.
4. Every soft-delete writes an `audit_log` row with `action = "soft_delete"`, the `actor`, and a redacted diff.
5. Retention TTLs are per-table and live in `docs/runbooks/retention.md` (forthcoming); the soft-delete itself is not a TTL.

## Consequences

**Easier:**

- Reversible deletes for the 7-day customer self-serve window.
- The audit trail survives any user-driven cleanup.
- A single partial index (`WHERE deleted_at IS NULL`) keeps the planner from picking soft-deleted rows in the hot path.

**Harder:**

- Every aggregate query needs the `IS NULL` clause. Lint helps, but reviewer discipline still matters.
- `pg_dump` size grows over time until the retention job ships. The 13-month hot + 7-year cold retention in security memory §7 covers this.

**Accepted:**

- A small subset of internal tables (`agent_run_idempotency_keys`, `agent_run_events`) opt out of `deleted_at`; they have their own retention jobs. The lint allows a comment-marked opt-out per table.

## Alternatives considered

1. **Hard delete only.** Rejected: no audit trail of who deleted what, no 7-day recovery window, GDPR right-to-erasure requires us to prove the deletion happened.
2. **Append-only tables (`valid_from` / `valid_to` temporal tables).** Rejected: doubles the read path, every query becomes a temporal join, the partial-index simplicity goes away. Temporal tables are a v2 conversation if the customer contracts demand bitemporal audit.
3. **Soft delete via `is_deleted boolean`.** Rejected: loses the `deleted_at` timestamp the audit needs to compute retention. `is_deleted` is a synonym, not an improvement.
4. **Per-table opt-in (default to hard delete).** Rejected: opt-in defaults to "someone forgets," and the audit gap is silent. A mandatory column + lint is the only way the invariant survives a 5-engineer org.
