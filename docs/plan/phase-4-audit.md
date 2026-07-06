# Phase 4 Multi-Tenancy Audit — Baseline

**Captured:** 2026-07-05 (PR-4.1) / **Re-captured:** 2026-07-06 (post PR-4.2).

The audit script `scripts/audit-tenancy.py` walks every model registered
on `app.db.base.Base.metadata` and reports violations of Forge AI's
multi-tenancy rules:

- **Rule 1** — every tenant-scoped table has a `tenant_id` column NOT NULL
- **Rule 2** — every project-scoped table has at least one composite
  index `Index("...", "tenant_id", "project_id", ...)`

## Marker taxonomy (introduced in PR-4.1)

| Marker | Meaning | Applied to |
|---|---|---|
| `_audit_root: bool = True` | Tenancy root — `tenant_id` is not defined here by design | `tenants` |
| `_audit_skip = ("tag", "reason")` | Vendor / catalog / global table | `marketplace_connectors`, `model_providers` |
| `_audit_scope = "tenant-only"` | Tenant-scoped but project-not-applicable | `organizations` |
| `_audit_scope = "project-only"` | Project-scoped only; tenant implied via project | `project_members`, `project_invitations` |
| `_audit_scope = "global"` | Truly global — not tenant-scoped | `dashboard_insight_reads`, `phase4_jwt_signing_keys` |

## Results timeline

| Phase | Violations | Status |
|---|---|---|
| Pre-PR-4.1 (no markers) | 27 (5 false-positives for tenants/marketplace/project_*_invitations/project_*_members/organizations + 22 real gaps) | 🔴 |
| Post-PR-4.1 (markers added) | 25 (all real `MISSING_COMPOSITE_INDEX`) | 🔴 |
| Post-PR-4.2 (composite indexes added) | **0** | 🟢 |

## How to run

```bash
# Local
python3 scripts/audit-tenancy.py --strict --require-composite-index

# CI (PR-4.6 wires this in .github/workflows/python-ci.yml)
bash scripts/check-audit-tenancy.sh
```

## Composite indexes added (25 total, across 25 model files)

**PR-4.2 partitions (≤ 10 indexes each):**

- `p4_idx_001` (9): agent_configs, audit_events, connector_activity,
  connector_credentials, connector_health_history, connector_sync_history,
  cost_entries, env_vars, hooks
- `p4_idx_002` (9): ideation_approval_items, ideation_push_records,
  ingestion_artifacts, ingestion_runs, lesson_candidates,
  output_bundles, phase4_credentials, phase4_finops_settings,
  phase4_realtime_client_secrets
- `p4_idx_003` (7): phase4_vault_configs, templates,
  terminal_session_costs, webhook_deliveries, webhooks,
  workflow_budget_decisions, workflow_sessions

All use `CREATE INDEX CONCURRENTLY IF NOT EXISTS` (Postgres) wrapped in
`autocommit_block()` per Alembic guidance for non-blocking production
rollout. The composite indexes are also declared in the model
`__table_args__` so `metadata.create_all` (used in tests) emits them
on SQLite.
