# Reference: Seed Scripts

> **Status:** ✅ Canonical — how to seed and reset the demo tenant
> **Doc owner:** Platform team
> **Source of truth:** `~/forge-ai/backend/seeds/` + `backend/scripts/`
> **Last updated:** 2026-06-30

---

## Purpose

Seeds are **idempotent, self-describing data packages** that bootstrap a tenant into a known state. Forge ships with the **`acme-corp`** demo seed — the canonical demo tenant that powers the default developer experience.

This document explains:
- The seed framework (runner + manifest + lifecycle)
- How to apply / reset / rollback a seed
- How to write a custom seed package
- CI smoke tests that verify seed integrity

---

## Source of truth

- **This file** — `/docs/reference/seed-scripts.md`
- **Seed packages** — `backend/seeds/packages/`
- **Seed framework** — `backend/seeds/framework/`
- **Seed API** — `backend/app/api/v1/seeds.py` (8 routes, R6 audited)
- **Seed runner** — `backend/seeds/framework/seed_runner.py`
- **Seed service** — `backend/app/services/seed_service.py`
- **Per-feature doc** — [Features: Seed Management](../features/seeds-admin.md)

---

## Seed framework architecture

```
backend/seeds/
├── framework/                          # Version-agnostic runner
│   ├── seed_runner.py                  # Main runner (apply/reset/rollback/status/diff)
│   ├── apply_seed.py                   # Apply workflow
│   ├── checksum.py                     # SHA-256 manifest checksum
│   ├── exceptions.py                   # SeedNotFoundError, SeedProductionGateError, etc.
│   ├── exit_codes.py                   # CLI exit codes
│   ├── manifest_schema.json            # JSON Schema for manifest.json
│   ├── production_safety.py            # Demo-vs-production gate
│   └── upsert_helpers.py               # ON CONFLICT helpers per table
└── packages/                           # Self-describing seed packages
    ├── acme-corp/                      # The demo seed (default)
    │   ├── README.md
    │   ├── __init__.py
    │   └── data/                       # Ordered JSON data files
    │       ├── 001_tenant.json
    │       ├── 002_users.json
    │       ├── 003_roles.json
    │       ├── 004_rbac_assignments.json
    │       ├── 005_projects.json
    │       ├── 006_repos.json
    │       ├── 007_connectors.json
    │       ├── 008_architecture_adrs.json
    │       ├── 009_api_contracts.json
    │       ├── 010_risk_registers.json
    │       ├── 011_agents.json
    │       ├── 012_artifacts.json
    │       ├── 013_hooks.json
    │       ├── 014_roadmaps.json
    │       ├── 015_ideas.json
    │       ├── 016_idea_analyses.json
    │       └── 017_opportunity_scores.json
    │       └── ... (40+ files total)
    └── kn-base/                        # Reference seed (canonical standards)
```

**Framework vs data separation:** Framework code (runner, schema, helpers) is intentionally separate from data packages. A single release of the framework can host many seeds (acme-corp demo, kn-base reference, customer-specific seeds).

---

## Seed lifecycle (10 steps)

Per `seed_runner.py` docstring, the apply lifecycle is:

```
1. Locate the seed package on disk (``backend/seeds/packages/<name>``).
2. Load + validate ``manifest.json`` against the JSON Schema.
3. Production safety check.
4. Dependency check against ``seed_migrations``.
5. Schema check (``information_schema`` columns for each table).
6. Reference resolution pre-pass (``_id_ref`` pointers).
7. Transactional UPSERT per data file in ``order``.
8. Post-insert hooks.
9. Compute checksum + write ``SeedRun`` + ``SeedMigration`` rows.
10. Emit audit events.
```

The runner is the **only path** through which seed data touches the database. Every other service imports `SeedRunner` and delegates to it.

---

## The acme-corp seed (the default demo)

### What it contains

The `acme-corp` seed ships 40+ ordered JSON files that bootstrap:

| File | Tables populated |
|---|---|
| `001_tenant.json` | `tenants` (1 row: acme-corp) |
| `002_users.json` | `users` (5+ demo users) |
| `003_roles.json` | `roles` (4 personas) |
| `004_rbac_assignments.json` | `rbac_assignments` |
| `005_projects.json` | `projects` (3 demo projects) |
| `006_repos.json` | `repositories` (3 demo repos) |
| `007_connectors.json` | `connectors` (Jira + GitHub demo) |
| `008_architecture_adrs.json` | `architecture_adrs` (3 ADRs) |
| `009_api_contracts.json` | `architecture_contracts` |
| `010_risk_registers.json` | `architecture_risks` |
| `011_agents.json` | `agents` (Claude Code, Codex, Gemini CLI, etc.) |
| `012_artifacts.json` | `artifacts` (typed) |
| `013_hooks.json` | `hooks` (event-driven) |
| `014_roadmaps.json` | `ideation_roadmap` |
| `015_ideas.json` | `ideation_ideas` |
| `016_idea_analyses.json` | `ideation_scores` |
| `017_opportunity_scores.json` | `ideation_opportunity_scores` |
| ... | (40+ total) |

### Apply the acme-corp seed

```bash
# Via UI (Steward persona only)
# Navigate to /admin/seeds → click "Apply" → confirm

# Via CLI
docker compose exec backend python -m seeds.framework.apply_seed acme-corp

# Via API
curl -X POST http://localhost:8000/api/v1/seeds/acme-corp/apply \
  -H "Authorization: Bearer <steward-token>" \
  -H "Content-Type: application/json" \
  -d '{"allow_in_prod": false}'
```

### Reset the acme-corp seed

```bash
# demo_only scope (default) — deletes only demo-flagged rows
curl -X POST http://localhost:8000/api/v1/seeds/acme-corp/reset \
  -H "Authorization: Bearer <steward-token>" \
  -H "Content-Type: application/json" \
  -d '{"scope": "demo_only"}'

# all scope (Steward-only, destructive) — deletes every row this seed owns
curl -X POST http://localhost:8000/api/v1/seeds/acme-corp/reset \
  -H "Authorization: Bearer <steward-token>" \
  -H "Content-Type: application/json" \
  -d '{"scope": "all"}'
```

### Rollback the most recent apply

```bash
curl -X POST http://localhost:8000/api/v1/seeds/acme-corp/rollback \
  -H "Authorization: Bearer <steward-token>"
```

### Inspect seed state

```bash
# Status (applied? drift?)
curl http://localhost:8000/api/v1/seeds/acme-corp/status \
  -H "Authorization: Bearer <steward-token>"

# Diff (expected vs actual row counts)
curl http://localhost:8000/api/v1/seeds/acme-corp/diff \
  -H "Authorization: Bearer <steward-token>"

# Run history
curl http://localhost:8000/api/v1/seeds/acme-corp/runs \
  -H "Authorization: Bearer <steward-token>"
```

---

## Seed manifest format

`backend/seeds/packages/acme-corp/manifest.json` (or similar):

```json
{
  "name": "acme-corp",
  "version": 1,
  "tenant_type": "demo",
  "description": "Demo seed for the Forge developer experience",
  "depends_on": [],
  "data_files": [
    {"file": "data/001_tenant.json", "table": "tenants", "order": 1, "idempotency_key": ["slug"], "description": "Bootstrap the tenant"},
    {"file": "data/002_users.json", "table": "users", "order": 2, "idempotency_key": ["email"], "description": "Demo users"},
    {"file": "data/003_roles.json", "table": "roles", "order": 3, "idempotency_key": ["tenant_id", "name"], "description": "Persona roles"},
    ...
  ],
  "row_counts_expected": {
    "tenants": 1,
    "users": 5,
    "roles": 4,
    "projects": 3,
    "repositories": 3,
    ...
  },
  "production_safety": {
    "allow_in_prod": false
  }
}
```

**Validated against:** `backend/seeds/framework/manifest_schema.json` (JSON Schema 2020-12).

---

## Production safety gate

`backend/seeds/framework/production_safety.py`:

```python
def check_production_safety(manifest: SeedManifest, env: str, allow_override: bool) -> None:
    """Block demo seed application in production unless explicitly overridden.

    Raises SeedProductionGateError if env is 'production' and the seed
    has tenant_type='demo' AND the request body doesn't have
    allow_in_prod=true.
    """
    if env != "production":
        return  # OK in dev/staging

    if manifest.tenant_type != "demo":
        return  # Reference / production seeds are fine

    if allow_override:
        return  # Explicit override

    raise SeedProductionGateError(
        f"Cannot apply demo seed {manifest.name!r} in production. "
        "Set allow_in_prod=true to override."
    )
```

**The override itself is audited** — every apply with `allow_in_prod=true` writes an audit event tagged `seed.production_override`.

---

## Drift detection

After every apply, the runner computes:

1. **Manifest checksum** — SHA-256 of all data files concatenated
2. **Row count checksum** — actual counts vs `row_counts_expected`

These are stored in the `seed_runs` table. The next `GET /status` call compares:

| Drift type | Cause |
|---|---|
| `none` | Healthy: checksum match + counts match |
| `checksum` | Manifest file changed (different SHA) |
| `row_count` | Counts diverge (manual edits / extra runs) |
| `unknown` | Cannot compute (corrupt state) |

**Surfaced in:**
- `SeedStatusPanel` (color-coded banner)
- `SeedDiffView` (per-table breakdown)
- `DemoBanner` (Plan G — global)

---

## The seed-agent script (`backend/scripts/seed_agents.py`)

A supplementary script that seeds **agents + model providers** separately from the main acme-corp package:

```python
#!/usr/bin/env python3
"""Seed agents + model providers for the acme-corp tenant.

Step-54-v2 Zone 4 — inserts the six "common agent patterns" shown in the
Agent Center empty state plus four model providers (Anthropic, OpenAI,
AWS Bedrock, Google Vertex).
"""
```

**Run:**
```bash
docker compose exec backend python -m scripts.seed_agents
```

**Seeds:**
- 6 agents (Claude Code, Codex, Gemini CLI, Kimi CLI, Copilot, Cursor)
- 4 model providers (Anthropic, OpenAI, Bedrock, Vertex)

**Runtimes are NOT seeded** — they're process-local and created on demand via `POST /runtimes/start`.

---

## Writing a custom seed

### Step 1: Create the package directory

```bash
mkdir -p backend/seeds/packages/my-tenant/data
```

### Step 2: Write the manifest

```bash
cat > backend/seeds/packages/my-tenant/manifest.json << 'EOF'
{
  "name": "my-tenant",
  "version": 1,
  "tenant_type": "customer_seed",
  "description": "Customer-specific seed",
  "depends_on": ["acme-corp"],
  "data_files": [
    {"file": "data/001_tenant.json", "table": "tenants", "order": 1, "idempotency_key": ["slug"]}
  ],
  "row_counts_expected": {"tenants": 1},
  "production_safety": {"allow_in_prod": true}
}
EOF
```

### Step 3: Add ordered data files

```bash
cat > backend/seeds/packages/my-tenant/data/001_tenant.json << 'EOF'
[
  {
    "id": "00000000-0000-4000-8000-000000000fff",
    "slug": "my-tenant",
    "name": "My Customer Org",
    "status": "active",
    "settings": {}
  }
]
EOF
```

### Step 4: Validate

```bash
docker compose exec backend python -m seeds.framework.apply_seed my-tenant --dry-run
```

### Step 5: Apply

```bash
docker compose exec backend python -m seeds.framework.apply_seed my-tenant
```

### Step 6: Verify

```bash
curl http://localhost:8000/api/v1/seeds/my-tenant/status \
  -H "Authorization: Bearer <steward-token>"
```

---

## CI smoke tests

`backend/tests/seeds/test_seed_runner.py` covers:

- ✅ Manifest schema validation
- ✅ Production safety gate (demo seed in prod = blocked)
- ✅ Apply / reset / rollback lifecycle
- ✅ Drift detection (4 types)
- ✅ Idempotent re-apply (no duplicate rows)
- ✅ Audit events on every apply
- ✅ Cross-tenant isolation (seed for tenant A doesn't leak to tenant B)
- ✅ Checksum computation (SHA-256)

`backend/tests/api/v1/test_seeds.py` covers:

- ✅ All 8 routes return correct RBAC status codes
- ✅ Idempotency-Key caching
- ✅ Cross-tenant returns 404 (not 403)
- ✅ Audit decorator on every mutation

---

## CLI exit codes

`backend/seeds/framework/exit_codes.py`:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic failure |
| 2 | Manifest not found |
| 3 | Manifest schema invalid |
| 4 | Production safety gate blocked |
| 5 | Dependency missing |
| 6 | Schema mismatch (DB out of sync with manifest) |
| 7 | Apply failed (DB error) |
| 8 | Rollback failed |

Used by CI to fail fast on seed corruption.

---

## Forbidden patterns

- ❌ Hardcoded tenant IDs (use the slug + `_coerce_tenant_id`)
- ❌ Direct DB inserts (must go through `SeedRunner`)
- ❌ Production demo seed without `allow_in_prod=true` override
- ❌ Skip audit event on apply (Rule 6)
- ❌ Skip checksum write after apply (drift detection breaks)
- ❌ Apply seed as PM persona (no `seeds:manage` permission)

---

## Verification checklist (per seed)

- [ ] Manifest validates against `manifest_schema.json`
- [ ] All data files parse as valid JSON
- [ ] `row_counts_expected` matches actual after apply
- [ ] `production_safety.allow_in_prod` set correctly
- [ ] Audit event written for every apply
- [ ] Checksum stored in `seed_runs`
- [ ] Drift detection surfaces 4 types correctly
- [ ] Reset with `scope=demo_only` deletes only demo rows
- [ ] Reset with `scope=all` requires `seeds:reset:all` (Steward only)
- [ ] Rollback reverses most recent apply
- [ ] Cross-tenant access returns 404
- [ ] CI smoke tests pass

---

## Related docs

- [Features: Seed Management](../features/seeds-admin.md) — Full UI + RBAC
- [Standards: api-conventions](../standards/api-conventions.md) — 8 seed routes
- [Standards: data-model](../standards/data-model.md) — `seed_runs` model
- [Reference: api-catalog](./api-catalog.md) — 8 seed routes
- [Reference: db-schema](./db-schema.md) — `seed_packages`, `seed_runs`, `seed_data_files`
- [Reference: test-scripts](./test-scripts.md) — Backend smoke tests
- [Features: Audit](../features/audit.md) — Every seed mutation logged