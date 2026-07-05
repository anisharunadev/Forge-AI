# Phase 4 — Multi-Tenancy Hardening

## Checklist items owned

- #6
- #7
- #8


**Status:** PENDING
**Owner:** TBA
**Depends on:** Phase 1, Phase 2
**Blocks:** Phase 5, Phase 6

---

## Goal

Prove, by automated test, that no service can leak data across tenants or projects. Migration safety becomes a merge gate.

## Why fourth

- Rule 2 is the constitutional law of this codebase. After Phase 2 cleaned routing and Phase 1 made tests run, we can finally write the isolation tests that prove R2 holds.
- Multi-tenant data leaks are the highest-impact failure mode for this product. Phase 4 makes them impossible to ship.

## Success Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| SC-4.1 | Every model in `backend/app/db/models/` has `tenant_id` AND `project_id` columns | `scripts/audit-tenancy.py` returns zero violations |
| SC-4.2 | Every tenant-scoped table has a composite index on `(tenant_id, project_id, …)` | same script |
| SC-4.3 | For every service in `backend/app/services/`, there is a 2-tenant isolation test | `pytest tests/services -k isolation` runs ≥ N tests where N = number of services |
| SC-4.4 | Every router endpoint with `tenant_id` in scope has an isolation test | `pytest tests/api -k isolation` runs ≥ M tests where M = number of tenant-scoped endpoints |
| SC-4.5 | Migration PR template requires a checklist: composite-index added, tenant columns added, isolation test added, downgrade tested | `.github/PULL_REQUEST_TEMPLATE.md` includes checklist; CI checks the template was filled |
| SC-4.6 | Every alembic migration has a corresponding downgrade that has been executed at least once in CI | `scripts/check-migrations.sh` runs `alembic upgrade head && alembic downgrade -1 && alembic upgrade head` in CI DB |
| SC-4.7 | No SQL string concatenation in `backend/app/` that bypasses SQLAlchemy ORM (raw SQL is allowed via bound params only) | `bandit` or custom grep for `f"SELECT`, `f"INSERT`, `f"UPDATE`, `f"DELETE` returns zero hits in `app/` (excludes `migrations/`) |
| SC-4.8 | Cross-tenant test fixtures (`tenant_a`, `tenant_b`) live in `backend/tests/conftest.py` and are reused | grep finds no per-file re-creation of fixture |

## Tasks

### T4.1 — Tenancy audit script
- T4.1.1 Write `scripts/audit-tenancy.py`:
  - import every model from `backend/app/db/models/*.py` (via subprocess that imports the metadata)
  - assert `tenant_id` and `project_id` columns present and NOT NULL
  - assert composite index on `(tenant_id, project_id)` exists (either `Index("ix_..._tenant_project", "tenant_id", "project_id")` or equivalent)
  - emit JSON report; exit non-zero on any violation
- T4.1.2 For any model failing audit, the owner of that bounded context fixes it (column add or index add).
- T4.1.3 Run script; record violations in `docs/plan/phase-4-audit.md`.

### T4.2 — Composite index migration
- T4.2.1 For each model missing composite index → generate alembic migration `add_composite_index_<table>`.
- T4.2.2 Test on dev DB.
- T4.2.3 Verify query planner uses the index (`EXPLAIN ANALYZE`).

### T4.3 — Service isolation tests
- T4.3.1 Write `backend/tests/conftest.py`:
  ```python
  @pytest.fixture
  async def two_tenants(db):
      ta = await create_test_tenant(db, name="A")
      tb = await create_test_tenant(db, name="B")
      yield ta, tb
      await db.rollback()
  ```
- T4.3.2 For each service module, write `tests/services/test_<service>_isolation.py`:
  - create record in tenant A
  - attempt to read it from tenant B context → assert 404/permission denied
  - attempt to list from tenant B context → assert absent
- T4.3.3 Run full suite; aim for one passing test per service.

### T4.4 — Router isolation tests
- T4.4.1 For each router with `tenant_id` resolution, write `tests/api/test_<router>_isolation.py`:
  - request with tenant A token returns only A's data
  - request with tenant B token cannot see A's data
  - cross-tenant URL (`/tenants/{a}/projects/{b_id}/...`) is rejected
- T4.4.2 Use `httpx.AsyncClient` against the FastAPI app.

### T4.5 — Migration safety gate
- T4.5.1 Create `.github/PULL_REQUEST_TEMPLATE.md` with a "Schema changes" section that requires:
  - [ ] Migration adds `tenant_id`/`project_id` where missing
  - [ ] Composite index added/updated
  - [ ] Isolation test included
  - [ ] Downgrade tested locally
  - [ ] EXPLAIN ANALYZE on representative query
- T4.5.2 Write `scripts/check-pr-checklist.sh` (or a GitHub Action) that fails if PR body has unchecked items in this section.
- T4.5.3 Wire into CI.

### T4.6 — Migration round-trip test
- T4.6.1 Write `scripts/check-migrations.sh`:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  cd backend
  alembic upgrade head
  alembic downgrade base
  alembic upgrade head
  ```
- T4.6.2 Runs against a CI ephemeral Postgres.
- T4.6.3 Wire into CI workflow.

### T4.7 — Raw SQL audit
- T4.7.1 Run `grep -rn -E "f['\"](SELECT|INSERT|UPDATE|DELETE)" backend/app --include='*.py'`.
- T4.7.2 Each hit → refactor to ORM or to bound-param raw SQL (`text("... WHERE tenant_id = :tid").bindparams(tid=...)`).
- T4.7.3 Add `bandit` rule B608 (hardcoded SQL) to pre-commit; configure to ignore `migrations/`.

### T4.8 — Fixture consolidation
- T4.8.1 Audit `backend/tests/**/conftest.py` for duplicated tenant-creation logic.
- T4.8.2 Move all into `backend/tests/conftest.py`.
- T4.8.3 Delete per-file duplicates.

## Files Touched

| File | Action |
|------|--------|
| `scripts/audit-tenancy.py` | create |
| `scripts/check-migrations.sh` | create |
| `scripts/check-pr-checklist.sh` (or Action) | create |
| `backend/alembic/versions/*.py` | create (composite indexes) |
| `backend/app/db/models/*.py` | edit (column/index fixes) |
| `backend/tests/conftest.py` | create/edit |
| `backend/tests/services/test_*_isolation.py` | create (≥ N files) |
| `backend/tests/api/test_*_isolation.py` | create (≥ M files) |
| `.github/PULL_REQUEST_TEMPLATE.md` | create/edit |
| `.pre-commit-config.yaml` | edit (bandit) |
| `docs/plan/phase-4-audit.md` | create |

## Risks

| Risk | Mitigation |
|------|-----------|
| Composite index migration locks large tables | Use `CREATE INDEX CONCURRENTLY` (Postgres) — wrap in migration with manual transaction handling |
| Audit script false-positives on read-only/system tables | Tag system tables with `_is_system = True` on the model; script skips |
| Isolation tests slow CI | Use transactional rollback per test, not truncate; reuse `two_tenants` fixture |
| PR checklist bypass (developer edits template directly) | GitHub Action that reads PR body; cannot be bypassed by template edits |
| Raw-SQL refactor breaks subtle query behavior | Each refactor gets an EXPLAIN diff captured before/after |

## Out of Scope

- Postgres Row-Level Security (RLS) — defer to post-10/10 hardening (advisory only here).
- New tenant onboarding flow changes (separate from tenancy isolation).
- Encryption-at-rest of `tenant_id` columns (not required by R2; defer).

## Definition of Done

- `scripts/audit-tenancy.py` exits 0.
- ≥ 1 isolation test per service, all passing.
- Migration round-trip is green in CI.
- PR template checklist is enforced.
- No raw f-string SQL in `app/`.

## Phase Close-out (filled at the end)

```
Implementation date: 2026-07-05 (Phase 3 — Documentation as Code)
PR(s): phase-3/* (8 PRs; see docs/plan/phase-3-detailed.md)

api-catalog.md: regenerated, was 305 routes claimed, code has 635 (2.1× undercount)
db-schema.md:   regenerated, was 43 files / ~150 tables claimed, code has 61 files / 112 classes
goal docs with Status header: 78 / 78 primary
step-69.md: in-progress (4 endpoints shipped via Phase 2 PR-2.6; /ideation/ingest/status is optional per the doc itself)
lychee broken links fixed: (collected via continue-on-error in CI; not yet blocking)
Phase doc cross-links: 22/22 bidirectional
Workflow docs.yml: created, required check: pending (warn-only in PR-3.3; gate flip in PR-3.8)
Follow-up tickets opened: none
```
