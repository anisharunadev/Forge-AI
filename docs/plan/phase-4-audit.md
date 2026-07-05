# Phase 4 Multi-Tenancy Audit — Baseline

**Captured:** 2026-07-05, post PR-4.1 marker tagging.

The audit script `scripts/audit-tenancy.py` walks every model registered
on `app.db.base.Base.metadata` and reports violations of Forge AI's
multi-tenancy rules:

- **Rule 1** — every tenant-scoped table has a `tenant_id` column NOT NULL
- **Rule 2** — every project-scoped table has at least one composite
  index `Index("...", "tenant_id", "project_id", ...)`

## Marker taxonomy (introduced in PR-4.1)

| Marker | Meaning |
|---|---|
| `_audit_root: bool = True` | Tenancy root — `tenant_id` is not defined here by design (e.g. `tenants`) |
| `_audit_skip = ("tag", "reason")` | Vendor / catalog / global table (e.g. `marketplace_connectors`) |
| `_audit_scope = "tenant-only"` | Tenant-scoped but project-not-applicable (e.g. `organizations`) |
| `_audit_scope = "project-only"` | Project-scoped only; tenant implied via project (e.g. `project_members`) |
| `_audit_scope = "global"` | Truly global — not tenant-scoped (e.g. signing keys, per-user read state) |

## Pre-PR-4.1 baseline (before markers)

Without the markers, the audit incorrectly flagged:

- `tenants` (root, no tenant_id by definition)
- `marketplace_connectors` (catalog)
- `model_providers` (catalog)
- `project_invitations` (project-scoped only)
- `project_members` (project-scoped only)
- `organizations` (tenant-only, not project-scoped)

After PR-4.1, those tables are excluded and the remaining violations
all belong to one bucket:

## Post-PR-4.1 (composite-index gap — to be closed by PR-4.2)

**25 violations** — all `MISSING_COMPOSITE_INDEX` on tenant+project tables.

Captured to `phase-4-audit-baseline.json`. PR-4.2 will add the
composite indexes; the audit must exit 0 after that PR merges.

## How to run

```bash
# Local
python3 scripts/audit-tenancy.py --strict --require-composite-index

# CI (PR-4.6 wires this)
bash scripts/check-audit-tenancy.sh
```

## Acceptance

- Pre-merge of PR-4.2: exit 1 (script reports 25 violations).
- Post-merge of PR-4.2: exit 0 (no violations).
