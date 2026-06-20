# Plan — STORY-303

- **Plan id:** `plan-943e491fba`
- **Story shape:** `migration_only`
- **Generated at:** 2026-06-17T18:11:19Z
- **Schema version:** 0.1.0
- **Task count:** 2

## Task list

### t-001 — Apply add_created_by_updated_by_audit_columns migration

- **Type:** `migration`
- **Effort:** S
- **Depends on:** —
- **Acceptance criteria:** ac-1, ac-2
- **Files touched:** `apps/api/src/db/migrations/add_created_by_updated_by_audit_columns.sql`

Write the SQL migration that introduces the add_created_by_updated_by_audit_columns change. Include a down migration in the same file.

### t-002 — Add add_created_by_updated_by_audit_columns migration smoke test

- **Type:** `test`
- **Effort:** M
- **Depends on:** t-001
- **Acceptance criteria:** ac-1, ac-2
- **Files touched:** `apps/api/test/integration/migrations/add_created_by_updated_by_audit_columns/`

Smoke test that applies the migration on a fresh DB and rolls it back. Asserts the schema diff matches the spec.
