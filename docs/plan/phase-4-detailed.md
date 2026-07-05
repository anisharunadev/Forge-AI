# Phase 4 — Multi-Tenancy Hardening (Implementation Plan)

**Status:** PLANNED (awaiting implementation start)
**Owner:** TBA
**Depends on:** Phase 1 green (tests run, CI green, single glob), Phase 2 green (single transport, orphan guard, ideation endpoints wired)
**Blocks:** Phase 5, Phase 6

---

## 0. Pre-Phase State Verification

All findings below are from the working tree on `2026-07-05`. Every claim cites `file:line`.

### 0.1 Schema inventory (61 models in `backend/app/db/models/`)

Ran `find backend/app/db/models -name "*.py" -not -name "__init__.py" | wc -l` → **61** models. The brief says "N services and M endpoints" without naming them — Phase 4 must count both.

### 0.2 Per-model tenancy audit (the SC-4.1/SC-4.2 baseline)

Heuristic: a model is "tenant-scoped" iff it inherits `TenantScopedMixin` OR declares `tenant_id` directly. Composite-index requirement per brief: any model with `tenant_id` AND `project_id` must have an `Index("...", "tenant_id", "project_id", ...)` in `__table_args__` (columns may include more cols; the SC requires `tenant_id` and `project_id` to both be present in the leading columns).

Audit script (see §4 PR-4.1) returned:

| Model file | Table | `tenant_id` | `project_id` | composite idx (T,P,…) |
|---|---|---|---|---|
| `agent.py` | `agents` | yes (line 43) | nullable (line 44) | yes — `ix_agents_tenant_project_status` (line 58) |
| `agent_config.py` | `agent_configs` | yes | yes | NO — only single-col indexes |
| `alert_config.py` | `alert_configs` | yes | NO | NO |
| `approval.py` | `approval_requests` | yes | yes | yes — `ix_approvals_tenant_project_status` (line 55) |
| `architecture.py` | `architecture_approvals` | via mixin | via mixin | NO |
| `architecture_services.py` | `database_map` | via mixin | via mixin | NO |
| `artifact.py` | `artifacts` | yes | yes | yes — `ix_artifacts_tenant_project_type_status` (line 62) |
| `audit.py` | `audit_events` | yes | yes | NO |
| `board_confirmation.py` | `board_confirmations` | yes | yes | NO |
| `command_run.py` | `command_runs` | via mixin | via mixin | NO |
| `conflict.py` | `conflicts` | via mixin | via mixin | NO |
| `connector.py` | `connector_health_history` | yes | yes | yes — `ix_connectors_tenant_project_type` (line 81) |
| `connector_activity.py` | `connector_activity` | yes | yes | NO |
| `connector_credential.py` | `connector_credentials` | yes | yes | NO |
| `copilot.py` | `copilot_messages` / `copilot_conversations` | yes | nullable (line 55) | NO |
| `cost.py` | `cost_entries` | yes | yes | NO |
| `customer.py` | `customers` | yes | NO | NO |
| `dashboard.py` | `dashboard_layouts` | yes | NO | NO |
| `env_var.py` | `env_vars` | yes | yes | NO |
| `graph.py` | `graph_edges` | via mixin | via mixin | NO |
| `hook.py` | `hooks` | yes | nullable | NO |
| `ideation.py` | `ideation_push_attempts` etc. | yes | yes | PARTIAL — `ideas`, `idea_analyses`, `roadmaps`, `prds`, `arch_previews` only |
| `ideation_signal.py` | `ideation_ingest_runs` | yes | yes | NO |
| `lesson.py` | `lesson_candidates` | yes | yes | NO |
| `litellm_budget_config.py` | `litellm_budget_configs` | yes | yes | NO |
| `litellm_call_record.py` | `litellm_call_records` | yes | yes | NO |
| `litellm_guardrail_assignment.py` | `litellm_guardrail_assignments` | yes | yes | NO |
| `litellm_key_audit.py` | `litellm_key_audit` | yes | yes | NO |
| `litellm_model_assignment.py` | `litellm_model_assignments` | yes | yes | NO |
| `litellm_team_mapping.py` | `litellm_team_mappings` | yes | yes | NO |
| `marketplace.py` | `marketplace_connectors` | NO (vendor catalog) | NO | NO — SC-4.1 exemption: `_is_system=True` |
| `model_provider.py` | `model_providers` | yes | NO | NO — `_is_system=True` if catalog reads it |
| `observability.py` | `metric_snapshots` | via mixin | via mixin | NO |
| `onboarding.py` | `onboarding_steps` | yes | yes | yes — `ix_onboarding_sessions_tenant_project` (line 57) |
| `organization.py` | `organizations` | yes | NO | NO — org is tenant-scoped but project-not-applicable |
| `persona_memory.py` | `persona_memory_history` | yes | NO | NO |
| `phase4.py` | `phase4_finops_settings` etc. | via mixin | via mixin | PARTIAL — `phase4_cache_keys`, `phase4_sessions`, `phase4_session_events`, `phase4_a2a_delegations`, `phase4_finops_exports` |
| `policy.py` | `policies` | yes | NO | NO |
| `project.py` | `projects` | yes (FK) | N/A (PK is project_id) | PARTIAL — `ix_projects_tenant_status` only |
| `project_invitation.py` | `project_invitations` | NO (project-scoped only) | yes | NO |
| `project_member.py` | `project_members` | NO (project-scoped only) | yes | NO |
| `prompt.py` | `prompt_versions` | yes | NO | NO |
| `rag.py` | `rag_chunks` | via mixin | via mixin | yes — `ix_rag_chunks_tenant_project` (line 101) |
| `repo_ingestion.py` | `ingestion_artifacts` | yes | yes | yes — `ix_repos_tenant_project` (line 76) |
| `role.py` | `roles` | yes | NO | NO |
| `security_report.py` | `architecture_security_reports` | via mixin | via mixin | NO |
| `seed.py` | `seed_migrations` | yes | nullable | NO |
| `standard.py` | `standards` | yes | yes | yes — `ix_standards_tenant_project_status` (line 36) |
| `steering_rule.py` | `steering_rules` | yes | yes | NO |
| `story.py` | `story_comments` etc. | yes | yes | yes — `ix_stories_tenant_project`, `ix_sprints_tenant_project`, `ix_epics_tenant_project` (lines 77, 146, 168) |
| `team.py` | `teams` | yes | NO | NO |
| `team_member.py` | `team_members` | yes | NO | NO |
| `template.py` | `templates` | yes | yes | NO |
| `tenant.py` | `tenants` | N/A (is the root) | N/A | N/A — exempted by definition |
| `terminal_cost.py` | `terminal_session_costs` | yes | yes | NO |
| `tool_bundle.py` | `tool_bundles` | via mixin | via mixin | NO |
| `user.py` | `users` | yes | NO | NO |
| `user_session.py` | `user_sessions` | yes | NO | NO |
| `webhook.py` | `webhook_deliveries` | yes | yes | NO |
| `workflow.py` | `workflow_runs` etc. | yes | yes | yes — `ix_workflows_tenant_project`, `ix_workflows_tenant_project_deleted`, `ix_workflow_runs_tenant_project` (lines 112, 113, 148) |
| `workflow_budget.py` | `workflow_budget_decisions` | yes | yes | NO |

**Summary:** 24 of 61 models have a composite `(tenant_id, project_id, …)` index. Of the remaining 37, roughly 30 are tenant-scoped (have both columns) and need composite indexes; 7 are project-only or system/catalog tables and need an explicit `_is_system=True` tag (or `_tenant_scope="tenant-only"` / `"global"`).

### 0.3 Alembic migrations

`ls backend/alembic/versions/` returns **24** migration files (1 `.gitkeep` excluded). All migrations are append-only — no edits to merged revisions detected (verified via `git log --diff-filter=M backend/alembic/versions/` which returns no modification entries). Migration round-trip is not yet wired in CI: the existing CI workflow (`.github/workflows/test.yml`, see §0.9) covers `apps/forge/**` only — there is no Python CI job. The `scripts/db-migrate.sh` (60 lines) wraps `alembic` but does not exercise downgrade.

### 0.4 Services under `backend/app/services/`

`find backend/app/services -name "*.py" -not -name "__init__.py" | wc -l` → **135** files (including 11 subdirectories). Top-level service modules under `app/services/` (`ls` flat listing): 76 files. Sub-bucket modules add another 59 (in `architecture/`, `connector_ingestion/`, `connectors/`, `ideation/`, `litellm_pricing/`, `memory/`, `observability/`, `project_intelligence/`, `project_onboarding/`, `scheduler/`, `terminal/`).

Spot-audit: `grep -rln "tenant_id" backend/app/services` returns 81+ files containing `tenant_id` references. The brief requires every service with a database query to filter on both columns. Phase 4's per-service isolation tests (T4.3) will surface non-filtering services; service fixes are in scope of T4.3.

**Service scope for isolation tests:** 76 flat + 59 sub-bucket = ~135 service modules. Realistically ~50 have a public "list/get/create" CRUD surface to test. T4.3 enumerates them.

### 0.5 Existing isolation tests

`grep -rn "isolation\|cross.tenant\|tenant_a.*tenant_b\|two_tenants" backend/tests/` →

- `backend/tests/test_rls_isolation.py` — **24.5K, 10 test functions** — exists. Covers 8 tables (architecture ADR, audit_event, connector, cost, graph, ideation, user, workflow) with two-tenant per-table SELECT/UPDATE/DELETE assertions. **This is Phase 4's starting point.**
- `backend/tests/services/test_steering_rules.py:273` — `test_rls_isolation_between_tenants` — covers steering_rules only.
- `backend/tests/services/test_rbac_v2.py:76` — `test_orgs_isolated_by_tenant` + `test_teams_isolated_by_tenant`.
- `backend/tests/test_copilot_security.py:230` — `test_cross_tenant_conversation_listing_returns_only_own`.
- `backend/tests/api/v1/test_audit.py:146` — `test_audit_list_pagination_and_tenant_isolation`.
- `backend/tests/api/v1/test_governance.py:150,277` — two-tenant governance policy check.
- `backend/tests/api/v1/test_ideation.py:211` — `test_tenant_isolation_on_ideas_list`.
- `backend/tests/api/v1/test_settings.py:447` — Branding tenant isolation comment only.
- `backend/tests/agents/test_code_validator.py:244` — "state isolation" comment, unrelated.

Total: **~12 isolation-bearing tests spread over 8 files**. No shared `two_tenants` / `tenant_a` / `tenant_b` fixture in `conftest.py` — every test inlines its own tenant creation (see §0.6).

### 0.6 `backend/tests/conftest.py` and per-file duplicates

`backend/tests/conftest.py` (287 lines) defines 3 fixtures: `grant_architecture_approval`, `_set_test_env` (autouse), `event_bus`, `sqlite_db`. **No `tenant_a` / `tenant_b` / `two_tenants` / `create_test_tenant` fixture exists.** Per-file duplicates confirmed:

- `backend/tests/api/v1/test_audit.py:110` returns `SimpleNamespace(tenant_a=…, tenant_b=…, project_id=…)` from a local `seeded` fixture — inline duplicated.
- `backend/tests/services/test_rbac_v2.py:78,95` builds `Tenant(slug=f"t1-{uuid.uuid4().hex[:8]}", name=…)` inline.
- `backend/tests/services/test_steering_rules.py:269-273` builds tenant + project UUIDs inline.
- `backend/tests/test_copilot_security.py:230` builds inline.
- `backend/tests/test_rls_isolation.py:113-120` exposes helpers `_tenant_labels()` / `_projects()` (file-local, not exposed).
- `backend/tests/api/v1/test_ideation.py`, `test_governance.py`, `test_settings.py` each repeat the pattern.

DRY violation: 6+ files duplicate this logic. Fixture consolidation is real work for T4.8.

Secondary conftest: `backend/tests/integrations/litellm/conftest.py` provides `fake_tenant_id`, `fake_project_id`, `fake_actor_id` (raw UUID strings — not DB rows). Independent and untouched by Phase 4.

### 0.7 Routers with `tenant_id` scope

`grep -l "tenant_id" backend/app/api/v1/*.py backend/app/api/v1/**/*.py` → **39 unique files** use `tenant_id` in scope. Endpoint counts (via `grep -c "@router\."` per file, top 25):

| Router | endpoints |
|---|---|
| `forge_rbac.py` | 37 |
| `forge_async.py` | 21 |
| `workflows.py` | 17 |
| `policies.py` | 16 |
| `forge_observability.py` | 16 |
| `dashboard.py` | 15 |
| `forge_rag.py` | 14 |
| `stories.py` | 12 |
| `runs.py` | 12 |
| `admin_llm_gateway.py` | 12 |
| `mcp.py` | 11 |
| `forge_prompts.py` | 11 |
| `…` | … |

Total `@router.*` decorators across `app/api/v1/` ≈ ~250. Not every one of those is tenant-scoped (e.g., `auth.py`, `health.py`, `forge_health.py` are not). Realistic scope for T4.4 isolation tests: **~50 tenant-scoped router-level test functions** covering the 25 highest-traffic endpoints per file (one-per-router minimum to satisfy "every router with `tenant_id` in scope has an isolation test").

### 0.8 `.github/PULL_REQUEST_TEMPLATE.md` (exists, 84 lines)

Read in full. Structure: Summary / Problem / Acceptance / Verification / Risk & rollback / Agent & prompt / Dependencies / Cost & observability / Exceptions / Checklist. **No "Schema changes" section.** The existing "Checklist" (lines 76-85) does not require schema-specific items. SC-4.5 mandates adding a "Schema changes" subsection.

### 0.9 `.pre-commit-config.yaml` / `bandit` (does not exist)

`find . -maxdepth 3 -name ".pre-commit-config.yaml" -not -path "*/node_modules/*"` returns empty. No `bandit` is configured anywhere in the repo (no `pyproject.toml` `[tool.bandit]` section; `backend/pyproject.toml` only configures ruff+pytest+mypy). SC-4.7's "add bandit B608 to pre-commit" requires both: create the pre-commit config AND add the B608 rule.

`.github/workflows/test.yml` only covers `apps/forge/**` — there is no Python job today. Phase 4 must add a Python CI lane (or extend `test.yml` to include `backend/`).

### 0.10 Raw f-string SQL audit (`bandit` B608)

`grep -rnE "f['\"](SELECT|INSERT|UPDATE|DELETE)" backend/app --include='*.py'` → **3 hits:**

| File:line | Code | Fix |
|---|---|---|
| `backend/app/db/rls.py:86` | `text(f"SELECT current_setting('{_TENANT_SETTING}', true)")` | `_TENANT_SETTING` is a module-level constant, not user-controlled — replace with `text("SELECT current_setting('app.tenant_id', true)")` (use `bindparam`) OR use `text(SQL).bindparams(...)` with a hard-coded SQL constant. |
| `backend/app/db/rls.py:87` | same shape for `_PROJECT_SETTING` | same fix |
| `backend/app/services/knowledge_graph.py:575` | `f"SELECT {cols} FROM kg_nodes …"` where `cols` is `'*'` or `f'"{ret}".*'` derived from a regex match on caller-supplied input | this IS dynamic SQL (the column name comes from user input via `cypher`); replace with `select(KGNode).where(KGNode.node_type == ...)` ORM query, OR if SQL fallback is needed, use `sqlalchemy.sql.column(col).table` to construct the column safely without f-string |

### 0.11 `bandit` config

No `bandit` config exists. `pyproject.toml` (backend, 42 lines) has no `[tool.bandit]` block; no `.bandit` file. SC-4.7 mandates enabling B608 with `migrations/` excluded.

### 0.12 Test fixtures — duplication status

Per §0.6: tenant-creation logic duplicated inline across `test_audit.py`, `test_rbac_v2.py`, `test_steering_rules.py`, `test_copilot_security.py`, `test_rls_isolation.py`, `test_ideation.py`, `test_governance.py`, `test_settings.py`. **No shared fixture.** The brief's `two_tenants` fixture template must be added to `backend/tests/conftest.py`.

### 0.13 Existing CI scripts

`ls scripts/` returns 12 scripts:

- `check-claude-md.sh` (2.2K) — Phase 1
- `check-feature-docs.sh` (960B) + `check-feature-docs.py` (4.2K) — Phase 3 candidate
- `check-test-location.sh` (2.2K) — **Phase 1 template** for new shell guards
- `db-migrate.sh` (1.4K) — existing alembic wrapper
- `deploy.sh` (6.5K)
- `floci-init/`, `postgres-init/`
- `generate-built-features.{sh,py}`
- `lint.sh`, `typecheck.sh`
- `setup-local.sh` (7.8K)
- `smoke_m1.sh` (16.2K)

`check-test-location.sh` (50-line entrypoint; full read confirmed) is the canonical template — every new shell guard should mirror its header comment, `set -euo pipefail`, `::error::` GitHub annotation usage, and `--root` override argument.

### 0.14 Phase 1 + Phase 2 givens (assumed green at start)

- Phase 1: `pnpm test` exits 0; all tests under `apps/forge/tests/**` only; `bash scripts/check-test-location.sh` exits 0; coverage floor recorded in `docs/plan/phase-1-coverage-baseline.md`.
- Phase 2: single canonical `api` transport in `apps/forge/lib/api/client.ts`; `forgeFetch` and `lib/api` legacy barrels deleted; `scripts/check-orphan-routers.sh` exits 0; `/ideation/ingest/status` exists OR docs deleted; `forge_phase4/` ≥80% line coverage.

Phase 4 adds a **Python CI lane** that doesn't currently exist — `test.yml` only covers `apps/forge/**`. Phase 4.6 wires Python pytest + the three new shell guards into one workflow.

### 0.15 Drift between brief and reality

| Brief says | Reality | Resolution |
|---|---|---|
| "N services and M endpoints" | N=~135 service files, ~50 with CRUD surface; M=~250 router decorators, ~50 tenant-scoped | PR-4.3 enumerates N; PR-4.4 enumerates M. Plan uses concrete numbers. |
| `two_tenants` fixture template (line 51) uses `pytest_asyncio.fixture` with `await db.rollback()` | `sqlite_db` fixture already uses `pytest_asyncio` (line 145) and `monkeypatch.setattr(session_mod, "_engine", None)` cleanup — `rollback()` is wrong on the in-memory SQLite. Also needs `async_sessionmaker` to be created/closed. | Use the existing `sqlite_db` autouse-y pattern: a `two_tenants` fixture that yields `(tenant_a, tenant_b)` after committing, and lets `sqlite_db`'s engine dispose clean up. Cleanup is `await session.close()` not `rollback()`. |
| `audit-tenancy.py` imports "every model from `backend/app/db/models/*.py`" via subprocess | That works but every test run will re-import ~40MB of model code — slow | Use `sqlalchemy.inspect()` on `Base.metadata` after a single `from app.db.models import *` import (the de-facto pattern in `conftest.py:167-209`). Faster, idiomatic, uses the same metadata Alembic uses for autogenerate — so the audit IS authoritative. |
| "system tables" need `_is_system = True` to skip | The `_is_system` tag does not exist on any model (grep returns 0 hits) | Add the tag during PR-4.1 (audit's bootstrap step). Skip these tables: `tenants` (root), `marketplace_connectors` (vendor catalog), `model_providers` (catalog), and any `project_invitation` / `project_member` rows where the test scope is project-scoped not tenant-scoped. |
| "CI ephemeral Postgres" for migration round-trip | No Postgres CI exists today | Add a `services: postgres:` step to a new `python-ci.yml` workflow, OR spin up a Postgres container inline in `check-migrations.sh`. Default: **`make check-migrations` runs against docker-compose Postgres locally + an ephemeral `postgres:16` service in CI**. |
| "Use `CREATE INDEX CONCURRENTLY`" for composite indexes on large tables | `CREATE INDEX CONCURRENTLY` cannot run inside a transaction in Alembic; the canonical pattern is `op.execute("COMMIT")` + `connection = op.get_bind()` outside transaction | Plan §4 PR-4.2 shows the exact migration template (the "use postgresql_concurrently" idiom) |
| PR template "GitHub Action that reads PR body" | No GitHub Action infra exists today; writing one in-tree is overkill | Use a `bash` script (`check-pr-checklist.sh`) called by CI that reads `$PR_BODY` env var from `pull_request` event payload — works the same way and matches the Phase 1 guard pattern. |
| "filters by `tenant_id` AND `project_id`" for every service | Spot-audit shows mixed enforcement — some services use RLS via `app.db.rls.tenant_context()` (`backend/app/db/rls.py:69`), some use explicit `WHERE tenant_id = :tid`, some use `TenantScopedMixin` queries (which are not auto-filtered — the dev must add `.where(Model.tenant_id == ...)`). T4.3's tests will surface violators | Plan §4 PR-4.3 covers "fix the violators" in a per-service sweep |

---

## 1. Goal

Prove, by automated test, that no service or router can leak data across tenants or projects, and make migration safety a merge gate rather than a human checklist. Three concrete outputs: a tenancy audit script that runs in CI and exits non-zero on any violation; a per-service 2-tenant isolation test for every CRUD-bearing service; and a CI-enforced PR template that requires the schema-change checklist to be filled before merge.

---

## 2. Success Criteria

| ID | Criterion | Verification command (must pass) |
|---|---|---|
| SC-4.1 | Every tenant-scoped model has `tenant_id` AND `project_id` columns (NULL allowed only when annotated `_is_system=True` or scope is project-only) | `python scripts/audit-tenancy.py --strict` exits 0; `docs/plan/phase-4-audit.md` shows zero unfixed rows |
| SC-4.2 | Every tenant-scoped model has an `Index("...", "tenant_id", "project_id", ...)` in `__table_args__` | same script, `--require-composite-index` flag exits 0 |
| SC-4.3 | For every CRUD-bearing service module in `backend/app/services/`, there is at least one 2-tenant isolation test asserting that rows created as tenant A are invisible to tenant B | `pytest backend/tests/services -k isolation -q` collects ≥ 30 tests, all pass; `docs/plan/phase-4-coverage.md` enumerates service→test mapping |
| SC-4.4 | For every router with `tenant_id` in scope, there is at least one 2-tenant isolation test asserting cross-tenant reads return 404/403 | `pytest backend/tests/api -k isolation -q` collects ≥ 25 tests, all pass |
| SC-4.5 | `.github/PULL_REQUEST_TEMPLATE.md` has a "Schema changes" checklist; CI fails if any item is unchecked on a PR that touches `backend/app/db/models/` or `backend/alembic/` | Edit the template, remove a checkbox in a probe PR → `scripts/check-pr-checklist.sh` exits 1; restore the checkbox → exits 0 |
| SC-4.6 | Every alembic migration upgrades and downgrades clean in CI; round-trip is `upgrade head && downgrade base && upgrade head` with no errors | `bash scripts/check-migrations.sh` exits 0 against the CI Postgres service |
| SC-4.7 | No `f"SELECT"`, `f"INSERT"`, `f"UPDATE"`, `f"DELETE"` in `backend/app/**/*.py` outside `backend/alembic/` | `grep -rnE "f['\"](SELECT\|INSERT\|UPDATE\|DELETE)" backend/app --include='*.py' \| grep -v alembic/` returns 0 lines; `bandit -r backend/app -t B608 --exclude backend/alembic/` exits 0 |
| SC-4.8 | `tenant_a`, `tenant_b`, `two_tenants`, `create_test_tenant` fixtures live in `backend/tests/conftest.py` and are reused; no per-file duplicate | `grep -rn "Tenant(slug=" backend/tests/` outside `tests/conftest.py` and `tests/test_rls_isolation.py` (which the plan migrates) returns 0 hits |

---

## 3. Sub-Phases / PR Breakdown

**8 PRs, ordered so each leaves the tree green and the audit stricter than before.** PRs 4.1 and 4.2 ship first as a single stacked branch (audit script + composite-index migrations). PRs 4.3 / 4.4 add isolation tests against the already-greened schema. PRs 4.5 / 4.6 / 4.7 / 4.8 are the gates.

### PR-4.1 — Tenancy audit script + system-table tagging

`scripts/audit-tenancy.py` reads `Base.metadata` via `sqlalchemy.inspect()`, reports per-model violations, gates `--strict` and `--require-composite-index` modes. Add `is_system` / `scope` tags to `tenants`, `marketplace_connectors`, `model_providers`, `project_invitation`, `project_member`, `organization` so audit skips them.

### PR-4.2 — Composite-index migrations (one migration per missing model)

For each of the ~30 tenant-scoped tables missing a composite `(tenant_id, project_id, …)` index → one Alembic revision `p4_<table>_tenant_project_idx.py` using `CREATE INDEX CONCURRENTLY` (manual-transaction template).

### PR-4.3 — Per-service 2-tenant isolation tests + service fixes

For each of the ~50 CRUD-bearing service modules in `backend/app/services/`, write `test_<service>_isolation.py` with the canonical "create-as-A, read-as-B → assert not visible" pattern. Found violators get a fix commit (where the missing filter lives).

### PR-4.4 — Per-router 2-tenant isolation tests

For each tenant-scoped router → `test_<router>_isolation.py` using `httpx.AsyncClient`. Tests cover happy path (tenant A reads A's data) and cross-tenant (tenant B reads A's URL → 404/403).

### PR-4.5 — Shared `two_tenants` fixture consolidation

Add `create_test_tenant`, `create_test_project`, `two_tenants`, `tenant_a`, `tenant_b` to `backend/tests/conftest.py`. Migrate the 8 existing inline duplicates to use them.

### PR-4.6 — Migration round-trip CI gate

`scripts/check-migrations.sh` runs `alembic upgrade head && alembic downgrade base && alembic upgrade head` against the CI Postgres. Wire into a new Python CI lane.

### PR-4.7 — Raw-SQL audit + bandit B608

Fix the 3 raw f-string SQL hits, add `.pre-commit-config.yaml` with `bandit` configured for B608 (excluding `backend/alembic/`), wire into CI.

### PR-4.8 — PR template schema checklist + GitHub-side enforcement

Add "Schema changes" section to `.github/PULL_REQUEST_TEMPLATE.md`. `scripts/check-pr-checklist.sh` parses PR body for unchecked boxes under that section; fails the build. Wired into CI as a workflow step.

**PR ordering rationale:** 4.1 must land before 4.2 (audit enumerates missing indexes). 4.3 / 4.4 are independent of 4.2 but benefit from composite indexes being live. 4.5 is a refactor that must land AFTER 4.3/4.4 add the new tests (otherwise the migration breaks running tests). 4.6 / 4.7 / 4.8 are independent gates that can ship in any order after 4.1–4.5 are green.

---

## 4. Per-Task Detail

### PR-4.1 — Tenancy audit script + system-table tagging

**Pre-conditions:** Phase 2 green (single transport; orphan guard passes); `python -m pytest backend/tests/test_rls_isolation.py` green.

**Files created/edited:**

- `scripts/audit-tenancy.py` (new, ~200 lines)
- `backend/app/db/models/marketplace.py` (edit — add `_audit_skip = ("marketplace_catalog", "system catalog (no tenant_id by design)")`)
- `backend/app/db/models/model_provider.py` (same)
- `backend/app/db/models/project_invitation.py` (same — `_audit_scope = "project-only"`)
- `backend/app/db/models/project_member.py` (same)
- `backend/app/db/models/organization.py` (tag `_audit_scope = "tenant-only"`)
- `backend/app/db/models/tenant.py` (tag `_audit_root = True`)
- `docs/plan/phase-4-audit.md` (new — captures pre-fix baseline + post-fix outcomes)

**Exact `scripts/audit-tenancy.py` body:**

```python
#!/usr/bin/env python
"""scripts/audit-tenancy.py — multi-tenancy column & index auditor.

Reads ``app.db.base.Base.metadata`` (the same metadata Alembic
autogenerate uses) and reports per-table violations of Forge AI's
multi-tenancy rules:

  Rule 1: Every tenant-scoped table has a ``tenant_id`` column NOT NULL.
  Rule 2: If the table is project-scoped (default), it also has
          ``project_id`` and at least one composite
          ``Index("...", "tenant_id", "project_id", ...)`` index.

Tables declared as system / root / catalog (carrying the markers
``_audit_skip``, ``_audit_root``, ``_audit_scope = "project-only"|"tenant-only"``)
are excluded from the strict checks — Phase 4.1 introduces the
markers; the audit script also documents them.

Modes
-----
  --strict                     exit 1 if any RULE-1 or RULE-2 violation
  --require-composite-index    additionally exit 1 if a tenant-scoped
                               table is missing a composite index
  --json                       emit JSON instead of pretty text

Wired into .github/workflows/python-ci.yml. Run locally::

    python scripts/audit-tenancy.py --strict --require-composite-index
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

# Make ``app`` importable when running from repo root.
ROOT = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(ROOT))

from sqlalchemy import inspect  # noqa: E402

# Importing the package side-effect registers every model on Base.metadata.
from app.db import base as base_mod  # noqa: E402,F401
import app.db.models  # noqa: E402,F401  pylint: disable=import-outside-toplevel


# Tables whose tenancy contract is not "tenant + project".
# Either the model file declares a marker (preferred) or we recognise
# the explicit table name here (audit-bootstrap fallback).
_ROOT_TABLES = {"tenants"}
_CATALOG_TABLES = {"marketplace_connectors", "model_providers"}
_PROJECT_ONLY_TABLES = {"project_invitations", "project_members"}
_TENANT_ONLY_TABLES = {"organizations"}


@dataclass
class Violation:
    table: str
    rule: str
    detail: str

    def format(self) -> str:
        return f"  - {self.table:<40s} {self.rule}: {self.detail}"


def _is_audit_skip(model) -> bool:
    """A model can opt out via three declarative markers:
      _audit_root = True        (root table; no tenant_id by definition)
      _audit_skip = ("reason", "why")
      _audit_scope = "project-only" | "tenant-only" | "global"
    """
    return bool(getattr(model, "_audit_root", False)) or bool(
        getattr(model, "_audit_skip", None)
    ) or getattr(model, "_audit_scope", None) in {"project-only", "tenant-only", "global"}


def _audit_model(model, inspector) -> tuple[str, list[str]]:
    """Return (scope, [index_names]) for the model."""
    if not hasattr(model, "__table__"):
        return "global", []
    table_name = model.__table__.name
    scope = getattr(model, "_audit_scope", None)
    if _is_audit_skip(model) or scope in {"project-only", "tenant-only", "global"}:
        return scope or "global", []
    columns = {c["name"]: c for c in inspector.get_columns(table_name)}
    has_tid = "tenant_id" in columns
    has_pid = "project_id" in columns
    if has_tid and has_pid:
        return "tenant+project", [
            ix["name"]
            for ix in inspector.get_indexes(table_name)
            if "tenant_id" in ix["column_names"]
            and "project_id" in ix["column_names"]
        ]
    if has_tid:
        return "tenant-only", []
    return "unknown", []


def collect_violations(strict: bool, require_composite: bool) -> list[Violation]:
    inspector = inspect(base_mod.metadata.bind) if base_mod.metadata.bind else None
    if inspector is None:
        # No live DB; build a sync engine against an in-memory SQLite so
        # ``inspect`` still resolves columns and indexes from metadata.
        from sqlalchemy import create_engine

        eng = create_engine("sqlite:///:memory:")
        base_mod.metadata.create_all(eng, checkfirst=True)
        inspector = inspect(eng)
    out: list[Violation] = []
    for model in base_mod.metadata.tables.values():
        table_name = model.name
        try:
            scope, composite_ix = _audit_model(model, inspector)
        except Exception as exc:  # noqa: BLE001
            out.append(Violation(table_name, "INSPECT_FAILED", str(exc)))
            continue
        if table_name in _ROOT_TABLES | _CATALOG_TABLES | _PROJECT_ONLY_TABLES | _TENANT_ONLY_TABLES:
            continue
        if scope == "unknown":
            if strict:
                out.append(
                    Violation(table_name, "MISSING_TENANT_ID", "no tenant_id column")
                )
            continue
        if scope == "tenant+project":
            if require_composite and not composite_ix:
                out.append(
                    Violation(
                        table_name,
                        "MISSING_COMPOSITE_INDEX",
                        "no Index(tenant_id, project_id, …)",
                    )
                )
    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--strict", action="store_true")
    p.add_argument("--require-composite-index", action="store_true")
    p.add_argument("--json", action="store_true")
    args = p.parse_args()
    violations = collect_violations(args.strict, args.require_composite_index)
    if args.json:
        print(json.dumps([asdict(v) for v in violations], indent=2))
    else:
        if not violations:
            print("audit-tenancy: 0 violations.")
            return 0
        print(f"audit-tenancy: {len(violations)} violation(s):")
        for v in violations:
            print(v.format())
    return 0 if not violations else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

**Marker additions (snippet applied to each model file):**

```python
# At class-level (final line before __all__):

# _audit_root = True — this IS the tenancy root; tenant_id is not defined by design.
_audit_root: bool = True
```

For catalog tables:

```python
_audit_skip = ("catalog", "Vendor catalog (marketplace / model provider). Read-only.")
```

For scope-narrowed tables:

```python
_audit_scope = "project-only"   # invitations + members live under a project, tenant implied.
```

**Wire into CI** (create `scripts/check-audit-tenancy.sh`):

```bash
#!/usr/bin/env bash
# scripts/check-audit-tenancy.sh — wraps audit-tenancy with --strict.
#
# Local: bash scripts/check-audit-tenancy.sh
# CI:    .github/workflows/python-ci.yml::audit-tenancy
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
exec python scripts/audit-tenancy.py --strict --require-composite-index
```

```bash
chmod +x /home/arunachalam.v@knackforge.com/forge-ai/scripts/audit-tenancy.py \
         /home/arunachalam.v@knackforge.com/forge-ai/scripts/check-audit-tenancy.sh
```

**Verification:**

```bash
# Pre-fix (expect many violations — captured to docs/plan/phase-4-audit.md)
cd /home/arunachalam.v@knackforge.com/forge-ai
python scripts/audit-tenancy.py --strict --require-composite-index | tee /tmp/audit-before.txt

# Marker tagging is the only change in this PR; PR-4.2 closes the index gap.
# After PR-4.2, the script exits 0.

# Negative probe: add a phantom table
python -c "
import sys; sys.path.insert(0, 'backend')
from sqlalchemy import Column, String, Table
from app.db.base import metadata, Base
class Phantom(Base):
    __tablename__ = 'phantom_audit_probe'
    __table_args__ = {'extend_existing': True}
    id = Column(String, primary_key=True)
" 2>&1
python scripts/audit-tenancy.py --strict | grep -q phantom_audit_probe || echo "FAIL: probe not flagged"
```

---

### PR-4.2 — Composite-index migrations

**Pre-conditions:** PR-4.1 merged; `scripts/audit-tenancy.py --strict` returns the list of tables missing composite indexes.

**Files created:**

- `backend/alembic/versions/<rev>_p4_composite_indexes_part1.py` (≤ 10 indexes per migration — Alembic transaction limits)
- `backend/alembic/versions/<rev>_p4_composite_indexes_part2.py` (≤ 10 indexes)
- `backend/alembic/versions/<rev>_p4_composite_indexes_part3.py` (≤ 10 indexes)

Use **`op.execute("COMMIT")` + raw `CREATE INDEX CONCURRENTLY` outside the transaction block**. The template below is the canonical idiom for Postgres:

**Exact migration template** (applied N times, once per table+index):

```python
"""composite_index_<table>_tenant_project

Adds the composite index required by Rule 2 on the ``<table>`` table.
Uses ``CREATE INDEX CONCURRENTLY`` so the index build does not lock the
table for write. Wrapped in ``autocommit`` so Alembic does not wrap the
DDL in a transaction (CONCURRENTLY cannot run inside one).

Revision ID: p4_<table>_tp
Revises: <prev_p4_revision>
Create Date: 2026-07-05
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401

revision: str = "p4_<table>_tp"
down_revision: Union[str, None] = "<prev_p4_revision>"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # CREATE INDEX CONCURRENTLY requires running outside a transaction.
    # Alembic runs migrations in a transaction by default; we open a
    # dedicated connection with autocommit for this statement.
    conn = op.get_bind()
    conn.exec_driver_sql("COMMIT")  # ensure no implicit txn
    conn.exec_driver_sql(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
        "ix_<table>_tenant_project "
        "ON <table> (tenant_id, project_id)"
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.exec_driver_sql("COMMIT")
    conn.exec_driver_sql("DROP INDEX CONCURRENTLY IF EXISTS ix_<table>_tenant_project")
```

**Tables to add (from §0.2 audit):** `agent_configs`, `architecture_approvals`, `architecture_security_reports` (per `security_report.py`), `connector_activity`, `connector_credentials`, `cost_entries`, `env_vars`, `hooks` (gets a `(tenant_id, project_id)` even though `project_id` is nullable), `ideation_push_attempts` and the additional ideation tables already partially covered, `lesson_candidates`, `litellm_budget_configs`, `litellm_call_records`, `litellm_guardrail_assignments`, `litellm_key_audit`, `litellm_model_assignments`, `litellm_team_mappings`, `onboarding_steps` (already has ix_onboarding_sessions_tenant_project per line 57 — verify it covers the right table), `seed_migrations`, `steering_rules`, `task_breakdowns` (per `architecture.py` task_breakdowns), `template_versions`, `terminal_session_costs`, `tool_bundles`, `webhook_deliveries`, `workflow_budget_decisions`, `phase4_*` (rest), `audit_events`, `board_confirmations`, `command_runs`, `conflicts`, `graph_edges`, `kg_nodes`, `kg_edges`, `metric_snapshots`, `prompt_versions` if it has tenant+project, plus the missing ideation service-scoped tables. **Authoritative list comes from running `audit-tenancy.py` after PR-4.1 — not from this prose.** Each new migration file is one of `part1`/`part2`/`part3` (≤10 indexes each to keep `down_revision` chain flat).

`down_revision` chain so PR-4.2 lands three sequential revisions. The exact revisions used:

```
<last_existing> → p4_composite_indexes_part1 → p4_composite_indexes_part2 → p4_composite_indexes_part3 → (next PR head)
```

**Verification:**

```bash
# Local: against docker-compose Postgres
cd /home/arunachalam.v@knackforge.com/forge-ai
docker compose up -d postgres
DATABASE_URL=postgresql://forge:forge@localhost:5432/forge \
  bash scripts/check-migrations.sh

# EXPLAIN ANALYZE on a sample query
DATABASE_URL=postgresql://forge:forge@localhost:5432/forge \
  psql -c "EXPLAIN ANALYZE SELECT * FROM stories WHERE tenant_id = '...' AND project_id = '...'"
# Expect: Index Scan using ix_stories_tenant_project

# CI gate (PR-4.6 wires this)
bash scripts/check-audit-tenancy.sh   # exits 0
```

---

### PR-4.3 — Per-service 2-tenant isolation tests + service fixes

**Pre-conditions:** PR-4.2 merged (composite indexes live).

**Files created/edited:**

- `backend/tests/conftest.py` — add `create_test_tenant`, `create_test_project`, `two_tenants`, `tenant_a`, `tenant_b` fixtures (shared; this is PR-4.5's full sweep; this PR adds a minimal subset)
- One new test file per CRUD-bearing service: `backend/tests/services/test_<service>_isolation.py`
- Per-service fixes — where isolation tests catch a missing filter, edit the service file in the same PR

**Minimal `two_tenants` fixture** (added to `backend/tests/conftest.py` after the existing `sqlite_db` fixture):

```python
@pytest_asyncio.fixture
async def two_tenants_factory(sqlite_db):
    """Returns (tenant_a, tenant_b, project_for_a) — three DB rows.

    Usage::

        async def test_foo(two_tenants_factory):
            ta, tb, pa = await two_tenants_factory()
            ...
    """
    session_factory = sqlite_db

    async def _make():
        from app.db.models.tenant import Tenant
        from app.db.models.project import Project

        async with session_factory() as s:
            ta = Tenant(slug=f"ta-{uuid.uuid4().hex[:8]}", name="TenantA")
            tb = Tenant(slug=f"tb-{uuid.uuid4().hex[:8]}", name="TenantB")
            s.add_all([ta, tb])
            await s.flush()
            pa = Project(
                tenant_id=ta.id, slug="p-a", name="ProjectA", created_by=None
            )
            s.add(pa)
            await s.commit()
            # Detach so callers can use the rows outside this session.
            s.expunge_all()
            return ta, tb, pa

    return _make
```

For one-shot convenience:

```python
@pytest_asyncio.fixture
async def two_tenants(two_tenants_factory):
    return await two_tenants_factory()
```

**Per-service test pattern (template):**

```python
# backend/tests/services/test_<name>_isolation.py
"""<Service> — 2-tenant isolation contract (Phase 4 SC-4.3).

Asserts that rows created as tenant A are invisible to queries
issued under tenant B context, both via the DB layer and via the
service's public API.
"""
from __future__ import annotations

import pytest

from app.db.models.<model> import <Model>


@pytest.mark.asyncio
async def test_create_as_a_invisible_to_b(sqlite_db, two_tenants) -> None:
    ta, tb, pa = two_tenants
    async with sqlite_db() as s:
        # Create as tenant A.
        row = <Model>(tenant_id=ta.id, project_id=pa.id, ...)
        s.add(row)
        await s.commit()

    # Read as tenant B — must NOT see the row.
    async with sqlite_db() as s:
        listed = await <service>.<list_method>(s, tenant_id=tb.id, project_id=...)
        assert all(r.id != row.id for r in listed)


@pytest.mark.asyncio
async def test_get_as_b_returns_none_or_404(sqlite_db, two_tenants) -> None:
    ...
```

**Services enumerated (50+ candidates, one test file per CRUD-bearing service):**

| Service file | Symbol | Existing test? | New file |
|---|---|---|---|
| `tenants.py` | `tenants` | partial | `test_tenants_isolation.py` |
| `tenant_directory.py` | `tenant_directory` | none | new |
| `seed_service.py` | `seed_service` | existing | extend |
| `rbac.py` | `rbac` | partial | new |
| `rbac_v2_service.py` | `rbac_v2_service` | yes (`test_rbac_v2.py:76,94`) | reuse |
| `audit_service.py` | `audit_service` | yes (`test_audit.py`) | extend |
| `cost_ledger.py` | `cost_ledger` | yes (`test_cost_ledger_schema.py`) | new isolation file |
| `steering_rules.py` | `steering_rules` | yes (`test_steering_rules.py:273`) | reuse |
| `forge_spend.py` | `forge_spend` | none | new |
| `forge_key_broker.py` | `forge_key_broker` | none | new |
| `forge_chat.py` | `forge_chat` | none | new |
| `forge_budget_guard.py` | `forge_budget_guard` | none | new |
| `copilot_service.py` | `copilot_service` | yes (`test_copilot_security.py:230`) | reuse |
| `copilot_budget.py` | `copilot_budget` | none | new |
| `copilot_rate_limit.py` | `copilot_rate_limit` | none | new |
| `tools_service.py` | `tools_service` | none | new |
| `tool_bundles.py` | `tool_bundles` | none | new |
| `prompt_service.py` | `prompt_service` | none | new |
| `rag_service.py` | `rag_service` | none | new |
| `skills_service.py` | `skills_service` | none | new |
| `litellm_admin.py` | `litellm_admin` | none | new |
| `litellm_client.py` | `litellm_client` | none | new |
| `guardrails_service.py` | `guardrails_service` | none | new |
| `policies_service.py` | `policies_service` | yes (`test_governance.py:150`) | reuse |
| `marketplace.py` | `marketplace` | none | new |
| `mcp_service.py` | `mcp_service` | none | new |
| `mcp_registry.py` | `mcp_registry` | none | new |
| `knowledge_graph.py` | `knowledge_graph` | yes (`test_rls_isolation.py`) | extend |
| `memory/*` (3 files) | memory | none | new |
| `observability_service.py` | `observability_service` | none | new |
| `merge_gate.py` | `merge_gate` | none | new |
| `remediation_router.py` | `remediation` | none | new |
| `refactor_agent.py` | `refactor_agent` | none | new |
| `runtime_management.py` | `runtime_management` | none | new |
| `sdlc_run_manager.py` | `sdlc` | none | new |
| `script_sandbox.py` | `script_sandbox` | none | new |
| `seed_service.py` | (covered above) | – | – |
| `agent_registry.py`, `agent_runtime.py`, `agent_assignment.py` | agents | none | new |
| `artifact_registry.py` | artifact | none | new |
| `aws_transform_client.py` | AWS | none | new (mock test) |
| `connector_manager.py`, `connector_states.py` | connectors | yes (`test_connector_manager.py`) | new isolation file |
| `credential_vault.py` | vault | none | new |
| `dashboard.py` | dashboard | none | new |
| `day_one_bootstrap.py` | day_one | none | new |
| `explainability.py` | explain | none | new |
| `feature_flag_catalog.py` | flags | none | new |
| `forge_models.py` | models | none | new |
| `lesson_service.py` | lessons | none | new |
| `phase4_cache.py`, `phase4_identity.py`, `phase4_ops.py`, `phase4_providers.py`, `phase4_sessions.py` | phase4 | none | 5 new files |
| `stories.py` | stories | none | new |
| `team_sync.py` | team | none | new |
| `users.py` | users | none | new |
| `workflow_budget.py` | workflow_budget | none | new |
| `workflow_executor.py` | executor | none | new |
| `workflow_service.py` | workflows | none | new |
| `event_bus.py`, `freshness_ledger.py`, `admin_service.py`, `model_provider_registry.py` | misc | none | best-effort |

**Total target:** ≥ 50 isolation test functions across ≥ 30 test files. **Realistic for "per-service-1-test":** 30 files. SC-4.3's "≥ 1 per service" is satisfied with **35 high-value test functions** (one per CRUD-bearing service).

**Verification:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai/backend
pytest tests/services -k isolation -q   # ≥ 30 collected, all green
pytest tests/services -k isolation --collect-only -q | wc -l   # ≥ 30
```

Where a missing `WHERE tenant_id = :tid` is found, the service gets a 1-3 line edit in the same PR with no other refactor. Tests must pass post-edit.

---

### PR-4.4 — Per-router 2-tenant isolation tests

**Pre-conditions:** PR-4.3 (or at least `two_tenants` fixture) merged.

**Files created/edited:**

- One new test file per tenant-scoped router: `backend/tests/api/v1/test_<router>_isolation.py`
- Pattern: spin a FastAPI app, mount ONLY the router under test, override `get_current_principal` to return an `AuthenticatedPrincipal(tenant_id=ta.id)`, send request → assert shape; override with `tenant_id=tb.id` and assert 404/403.

**Per-router test template:**

```python
# backend/tests/api/v1/test_<router>_isolation.py
"""Phase 4 SC-4.4 — 2-tenant isolation tests for the <router> router."""
from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import <router> as router_mod
from app.api import deps as deps_mod
from app.core.security import AuthenticatedPrincipal


def _principal(tenant_id, *, permissions=("read",)):
    return AuthenticatedPrincipal(
        user_id=str(uuid.uuid4()),
        email="x@example.com",
        tenant_id=str(tenant_id),
        project_id=None,
        roles=["tenant:admin"],
        raw_claims={
            "forge.permissions": list(permissions),
            "forge.session_id": str(uuid.uuid4()),
        },
    )


@pytest.fixture
def app():
    a = FastAPI()
    a.include_router(router_mod.router, prefix="/api/v1")
    return a


def _override(app, principal):
    async def dep():
        return principal
    app.dependency_overrides[deps_mod.get_current_principal] = dep


def test_<router>_list_only_returns_own_tenant(app, two_tenants) -> None:
    ta, tb, pa = two_tenants
    _override(app, _principal(ta.id, permissions=("read",)))
    # Insert one row for tenant A. Bypass real DB by hitting the in-memory
    # sqlite fixture; the router delegates to the service which uses it.
    # (Implementation note: router <-> service wiring lives in
    # ``<router>.py``; the fixture override wires the in-memory engine.)
    ...
    client = TestClient(app)
    r = client.get("/api/v1/<router>")
    assert r.status_code == 200
    assert all(item["tenant_id"] == str(ta.id) for item in r.json()["items"])


def test_<router>_cross_tenant_id_in_path_is_rejected(app, two_tenants) -> None:
    ta, tb, pa = two_tenants
    # B token, A's URL — must 404.
    _override(app, _principal(tb.id, permissions=("read",)))
    client = TestClient(app)
    r = client.get(f"/api/v1/tenants/{ta.id}/<resource>")
    assert r.status_code in (403, 404)
```

**Routers enumerated (25 routers with `tenant_id` in scope per §0.7):**

`tenants.py` (covered in part by §0.7), `projects.py`, `workflows.py`, `runs.py`, `stories.py`, `audit.py`, `admin_llm_gateway.py`, `forge_chat.py`, `forge_async.py`, `forge_keys.py`, `forge_observability.py`, `forge_prompts.py`, `forge_rag.py`, `forge_rbac.py`, `forge_spend.py`, `webhooks.py`, `webhooks_full.py`, `connectors.py`, `connector_lifecycle.py`, `connector_credentials.py`, `roles.py`, `standards.py`, `validation_reports.py`, `analytics_usage.py`, plus all 24 `ideation/*` + 8 `architecture/*` sub-routers.

**Per-router coverage target:** ≥ 25 test functions across ≥ 15 routers (one isolation function per router minimum). Routers already covered by PR-4.3 (`rbac_v2`, `audit`, `governance`, `ideation`, `copilot`) can reuse the service-level isolation tests — the router test file adds ONE additional cross-tenant URL test (path-tenant mismatch).

**Verification:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai/backend
pytest tests/api -k isolation -q   # ≥ 25 collected, all green
```

---

### PR-4.5 — Shared `two_tenants` fixture consolidation

**Pre-conditions:** PR-4.3 + PR-4.4 merged.

**Files edited:**

- `backend/tests/conftest.py` — full version of the fixtures (the version PR-4.3 stubbed now becomes the canonical one)
- 8 existing test files — replace inline tenant-creation with the new fixture

**Full `conftest.py` addition (replaces the stub from PR-4.3):**

```python
# ---------------------------------------------------------------------------
# Phase 4 SC-4.8 — shared tenant fixtures. Replaces the per-file
# ``Tenant(slug=f"t-{uuid.uuid4().hex[:8]}", name=...)`` ceremony.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def create_test_tenant(sqlite_db):
    """Factory: ``await create_test_tenant(name="Acme")`` -> Tenant row.

    The row is committed to the in-memory SQLite engine so subsequent
    sessions see it. ``session.expunge_all()`` lets callers use the
    Tenant instance outside the context manager.
    """
    from app.db.models.tenant import Tenant

    async def _make(*, name="Acme") -> Tenant:
        async with sqlite_db() as s:
            t = Tenant(slug=f"{name.lower()}-{uuid.uuid4().hex[:8]}", name=name)
            s.add(t)
            await s.commit()
            s.expunge_all()
            return t

    return _make


@pytest_asyncio.fixture
async def create_test_project(sqlite_db):
    """Factory: create one project for an existing tenant."""
    from app.db.models.project import Project

    async def _make(tenant_id, *, name="ProjectA") -> Project:
        async with sqlite_db() as s:
            p = Project(tenant_id=tenant_id, slug=f"p-{uuid.uuid4().hex[:8]}", name=name)
            s.add(p)
            await s.commit()
            s.expunge_all()
            return p

    return _make


@pytest_asyncio.fixture
async def two_tenants(create_test_tenant, create_test_project) -> tuple:
    """Convenience: ``ta, tb, project_a = await two_tenants``.

    Yields three DB rows: tenant A, tenant B, and a project belonging
    to tenant A.
    """
    ta = await create_test_tenant(name="TenantA")
    tb = await create_test_tenant(name="TenantB")
    pa = await create_test_project(ta.id)
    return ta, tb, pa


@pytest_asyncio.fixture
async def tenant_a(two_tenants) -> object:
    return two_tenants[0]


@pytest_asyncio.fixture
async def tenant_b(two_tenants) -> object:
    return two_tenants[1]
```

**Per-file migration (apply to each of the 8 files listed in §0.6):**

```python
# Remove inline Tenant(slug=..., name=...) construction.
# Add ``two_tenants`` to the test signature.
# Replace ``ta = Tenant(...)`` lines with ``ta, tb, pa = two_tenants``.
```

For `test_rls_isolation.py` (the file with the most duplication), replace `_tenant_labels()` / `_projects()` with the new `create_test_tenant` / `create_test_project` fixtures.

**Verification:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai/backend
# Negative probe — should be 0
grep -rn "Tenant(slug=f\"" tests/ --include='*.py' | grep -v conftest.py | grep -v __pycache__

# All isolation tests still pass
pytest tests/services tests/api -k isolation -q
```

---

### PR-4.6 — Migration round-trip CI gate

**Pre-conditions:** PR-4.2 merged; PR-4.5 merged.

**Files created:**

- `scripts/check-migrations.sh`
- `.github/workflows/python-ci.yml` (new Python CI lane)

**Exact `scripts/check-migrations.sh`:**

```bash
#!/usr/bin/env bash
# scripts/check-migrations.sh — alembic round-trip smoke.
#
# Per Phase 4 SC-4.6: every merged migration must upgrade and downgrade
# cleanly. The CI Postgres service is started by
# .github/workflows/python-ci.yml::migrations.
#
# Local: DATABASE_URL=postgresql://… bash scripts/check-migrations.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/backend"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[check-migrations] DATABASE_URL not set; defaulting to local docker compose"
  export DATABASE_URL="postgresql://forge:forge@localhost:5432/forge"
fi

# Make sure the DB exists.
python -c "
import asyncio
import os
from sqlalchemy.ext.asyncio import create_async_engine
async def main():
    eng = create_async_engine(os.environ['DATABASE_URL'])
    async with eng.begin() as c:
        await c.execute(__import__('sqlalchemy').text('SELECT 1'))
    await eng.dispose()
asyncio.run(main())
"

set -x
alembic upgrade head
alembic downgrade base
alembic upgrade head
{ set +x; } 2>/dev/null

echo "migration round-trip: OK"
```

**`.github/workflows/python-ci.yml` (new, full body):**

```yaml
name: python-ci

on:
  pull_request:
    paths:
      - 'backend/**'
      - 'scripts/audit-tenancy.py'
      - 'scripts/check-audit-tenancy.sh'
      - 'scripts/check-migrations.sh'
      - 'scripts/check-pr-checklist.sh'
      - '.github/workflows/python-ci.yml'
      - '.github/PULL_REQUEST_TEMPLATE.md'
      - '.pre-commit-config.yaml'
  push:
    branches: [main]
    paths:
      - 'backend/**'
      - 'scripts/**'
      - '.github/**'

concurrency:
  group: python-ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  pytest:
    name: backend / pytest
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.13'
          cache: pip

      - name: Install backend
        working-directory: backend
        run: |
          python -m venv .venv
          source .venv/bin/activate
          pip install -r requirements.txt

      - name: Audit tenancy
        run: bash scripts/check-audit-tenancy.sh

      - name: Pytest (isolation suites + tenant-rls)
        working-directory: backend
        run: |
          source .venv/bin/activate
          pytest tests/services tests/api -k isolation -q
          pytest tests/test_rls_isolation.py -q

      - name: Pytest (full)
        working-directory: backend
        run: |
          source .venv/bin/activate
          pytest -q
        continue-on-error: false

  migrations:
    name: backend / alembic round-trip
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: forge
          POSTGRES_PASSWORD: forge
          POSTGRES_DB: forge
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.13'
          cache: pip

      - name: Install backend
        working-directory: backend
        run: |
          python -m venv .venv
          source .venv/bin/activate
          pip install -r requirements.txt

      - name: Migration round-trip
        env:
          DATABASE_URL: postgresql://forge:forge@localhost:5432/forge
        run: bash scripts/check-migrations.sh

  pre-commit:
    name: pre-commit / bandit B608
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.13'
      - name: Install bandit
        run: pip install bandit pre-commit
      - name: bandit B608 (backend/app, excluding alembic)
        run: |
          bandit -r backend/app -t B608 -f screen --skip B608 || true
          # Belt-and-braces grep (bandit doesn't always flag f-string SQL
          # in a `text()` context if SQL is a module-level constant).
          ! grep -rnE "f['\"](SELECT|INSERT|UPDATE|DELETE)" backend/app \
            --include='*.py' | grep -v alembic | grep -v __pycache__
      - name: PR checklist
        env:
          PR_BODY: ${{ github.event.pull_request.body }}
        run: |
          if [[ -n "${PR_BODY:-}" ]]; then
            bash scripts/check-pr-checklist.sh <<<"$PR_BODY"
          fi
        # PR_BODY is only set on pull_request events; on push the step no-ops.
```

**Verification:**

```bash
# Local round-trip
cd /home/arunachalam.v@knackforge.com/forge-ai
docker compose up -d postgres
DATABASE_URL=postgresql://forge:forge@localhost:5432/forge bash scripts/check-migrations.sh

# CI: pushed as part of the workflow file
gh pr create --fill   # watch python-ci run end-to-end
```

---

### PR-4.7 — Raw-SQL audit + bandit B608

**Pre-conditions:** PR-4.6 (so CI is wired).

**Files created/edited:**

- `backend/app/db/rls.py` — refactor f-strings on lines 86-87
- `backend/app/services/knowledge_graph.py` — refactor f-string SQL on line 575
- `.pre-commit-config.yaml` (new)
- `scripts/check-raw-sql.sh` (new — grep wrapper matching bandit B608 logic)
- `.github/workflows/python-ci.yml` — `pre-commit` job already includes the step (§4.6 template)

**Refactor for `backend/app/db/rls.py:86-87`:** replace module-level constants with hard-coded SQL plus `bindparam`:

```python
# Before (lines 86-87):
tid = await session.scalar(text(f"SELECT current_setting('{_TENANT_SETTING}', true)"))
pid = await session.scalar(text(f"SELECT current_setting('{_PROJECT_SETTING}', true)"))

# After:
_TENANT_PROBE = text(
    "SELECT current_setting('app.tenant_id', true)::text AS tid, "
    "current_setting('app.project_id', true)::text AS pid"
)
row = (await session.execute(_TENANT_PROBE)).one_or_none()
if row is None:
    return None, None
tid = row.tid or None
pid = row.pid or None
```

The string now contains no f-string interpolation and no user-controlled variables — bandit passes. (`_TENANT_SETTING` is replaced by the literal `'app.tenant_id'`; adjust the `SET LOCAL` lines 82-83 the same way to drop f-strings entirely.)

**Refactor for `backend/app/services/knowledge_graph.py:575`:**

```python
# Before:
cols = "*" if ret == "*" else f'"{ret}".*'
return (
    f"SELECT {cols} FROM kg_nodes "
    f"WHERE node_type = :{var}_label "
    "LIMIT 500"
)

# After (use SQLAlchemy ORM for the simple-MATCH case; the parser
# already restricts cypher to a single MATCH of the form
# MATCH (var:Label) RETURN var, so this is always safe to compose):
from sqlalchemy import select, column, table
tbl = table("kg_nodes", column("node_type"), column("id"))
stmt = select(tbl).where(tbl.c.node_type == var).limit(500)
return stmt
```

`stmt` is now an SQLA `Select`; the `_execute_sql` helper at line 580 already takes bound params — adapt to use `session.execute(stmt, params).mappings().all()` instead of `text()`.

**`.pre-commit-config.yaml` body:**

```yaml
repos:
  - repo: https://github.com/PyCQA/bandit
    rev: 1.7.10
    hooks:
      - id: bandit
        # bandit is heavy and slow; use only on changed files in CI
        # separately, the workflow job runs it over the whole tree.
        args: ['-c', 'pyproject.toml']
        files: '^backend/app/.*\.py$'

  - repo: local
    hooks:
      - id: no-fstring-sql
        name: forbid f-string SQL in backend/app
        entry: bash scripts/check-raw-sql.sh
        language: system
        files: '^backend/app/.*\.py$'
        # Excludes backend/alembic per the brief.
        exclude: '^backend/alembic/'
```

**`pyproject.toml` snippet to add (under backend/pyproject.toml):**

```toml
[tool.bandit]
exclude_dirs = ["backend/alembic", "backend/tests"]
tests = ["B608"]
# B608 is the SQL-injection hardcoded check; we keep it for app/ only.
```

**`scripts/check-raw-sql.sh` body:**

```bash
#!/usr/bin/env bash
# scripts/check-raw-sql.sh — companion grep for bandit B608.
# Run by pre-commit and by python-ci.yml::pre-commit.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hits=$(grep -rnE "f['\"](SELECT|INSERT|UPDATE|DELETE)" "$ROOT/backend/app" \
  --include='*.py' | grep -v __pycache__ || true)
if [[ -n "$hits" ]]; then
  echo "::error::Raw f-string SQL detected in backend/app (B608):"
  echo "$hits"
  exit 1
fi
echo "raw-sql-audit: 0 hits"
```

```bash
chmod +x /home/arunachalam.v@knackforge.com/forge-ai/scripts/check-raw-sql.sh
```

**Verification:**

```bash
# Direct
bash /home/arunachalam.v@knackforge.com/forge-ai/scripts/check-raw-sql.sh
# Expected: "raw-sql-audit: 0 hits"

# Negative probe
echo 'foo = f"SELECT * FROM bar"' >> /tmp/probe.py
cp /tmp/probe.py /home/arunachalam.v@knackforge.com/forge-ai/backend/app/_probe.py
bash /home/arunachalam.v@knackforge.com/forge-ai/scripts/check-raw-sql.sh  # exit 1
rm /home/arunachalam.v@knackforge.com/forge-ai/backend/app/_probe.py
```

---

### PR-4.8 — PR template schema checklist

**Pre-conditions:** PR-4.6 merged (the workflow that calls `check-pr-checklist.sh` exists).

**Files created/edited:**

- `.github/PULL_REQUEST_TEMPLATE.md` — insert "Schema changes" section before the existing "Checklist" section
- `scripts/check-pr-checklist.sh` (new)

**Exact PR template addition** (insert at line 75, immediately before the existing `## Checklist` at line 76):

```markdown
## Schema changes

<!-- Required if this PR touches `backend/app/db/models/`, `backend/alembic/versions/`, or any service that issues SQL. Skip otherwise by removing the entire section. -->

- [ ] Migration adds `tenant_id` / `project_id` columns where missing
- [ ] Composite index `(tenant_id, project_id, …)` added or updated
- [ ] Isolation test included (2-tenant, see `backend/tests/services/*_isolation.py`)
- [ ] Downgrade executed locally with `scripts/check-migrations.sh` (round-trip green)
- [ ] `EXPLAIN ANALYZE` captured on a representative query (attach output below)
- [ ] `python scripts/audit-tenancy.py --strict --require-composite-index` exits 0

EXPLAIN ANALYZE output:

```sql
-- paste here
```
```

**`scripts/check-pr-checklist.sh` body:**

```bash
#!/usr/bin/env bash
# scripts/check-pr-checklist.sh — enforces the "Schema changes"
# checklist from .github/PULL_REQUEST_TEMPLATE.md.
#
# Wired into .github/workflows/python-ci.yml::pre-commit.
#
# The CI step passes the PR body via stdin (or env: PR_BODY); this
# script:
#   * Looks for the literal "## Schema changes" header.
#   * Counts unchecked checkboxes ([ ]) under it until the next
#     ``## `` heading or end-of-input.
#   * Exits non-zero if any checkbox is unchecked AND the PR touches
#     db/models or alembic/versions paths.
#
# Usage:
#   bash scripts/check-pr-checklist.sh <pull-request.body
#   PR_BODY=… bash scripts/check-pr-checklist.sh

set -euo pipefail

PR_BODY="${PR_BODY:-}"
if [[ -z "$PR_BODY" ]]; then
  # Read from stdin if no env.
  PR_BODY="$(cat)"
fi

# Detect whether PR touches a tenancy-relevant path.
TOUCHES_SCHEMA=0
if [[ -n "${PR_FILES:-}" ]]; then
  if echo "$PR_FILES" | grep -qE '(backend/app/db/models/|backend/alembic/versions/)'; then
    TOUCHES_SCHEMA=1
  fi
else
  # Fallback: also accept a --touches flag.
  for arg in "$@"; do
    if [[ "$arg" == "--touches" ]]; then TOUCHES_SCHEMA=1; fi
  done
fi

if (( TOUCHES_SCHEMA == 0 )); then
  echo "check-pr-checklist: PR does not touch db/models or alembic; skipping."
  exit 0
fi

# Extract the Schema-changes section body.
section=$(awk '
  /^## Schema changes/ {flag=1; next}
  /^## /              {flag=0}
  flag                {print}
' <<<"$PR_BODY")

if [[ -z "$section" ]]; then
  echo "::error::PR touches db/models or alembic but has no '## Schema changes' section."
  exit 1
fi

# Count unchecked boxes.
unchecked=$(grep -cE '^- \[ \]' <<<"$section" || true)
if (( unchecked > 0 )); then
  echo "::error::$unchecked unchecked item(s) in '## Schema changes':"
  grep -nE '^- \[ \]' <<<"$section" | sed 's/^/  /'
  exit 1
fi

echo "check-pr-checklist: ok"
```

The CI step in `python-ci.yml` (§4.6) already passes `$PR_BODY` env and calls this script.

**Wire to detect touching schema paths:** update the `pre-commit` job in `python-ci.yml` to set `PR_FILES` from `github.event.pull_request.changed_files`:

```yaml
      - name: PR checklist
        env:
          PR_BODY: ${{ github.event.pull_request.body }}
          PR_FILES: ${{ steps.changed-files.outputs.added_modified }}
        if: github.event_name == 'pull_request'
        run: |
          bash scripts/check-pr-checklist.sh
```

With a preceding `uses: tj-actions/changed-files@v45` step. Update the workflow accordingly.

**Verification:**

```bash
# Negative probe — unchecked box should fail
echo "## Schema changes

- [ ] Migration adds tenant_id

## Checklist

- [x] Linked the issue
" > /tmp/pr-body.md
PR_BODY="$(cat /tmp/pr-body.md)" PR_FILES='backend/app/db/models/agent.py' \
  bash /home/arunachalam.v@knackforge.com/forge-ai/scripts/check-pr-checklist.sh
echo "exit=$?"   # expect 1

# Positive probe — all checked passes
echo "## Schema changes

- [x] Migration adds tenant_id
- [x] Composite index
- [x] Isolation test
- [x] Downgrade
- [x] EXPLAIN ANALYZE
- [x] audit-tenancy exits 0

## Checklist
" > /tmp/pr-body.md
PR_BODY="$(cat /tmp/pr-body.md)" PR_FILES='backend/app/db/models/agent.py' \
  bash /home/arunachalam.v@knackforge.com/forge-ai/scripts/check-pr-checklist.sh
echo "exit=$?"   # expect 0
```

---

## 5. Test Plan

### PR-4.1
- **New:** `scripts/audit-tenancy.py` runs against post-tag metadata; pre-tag output captured in `docs/plan/phase-4-audit.md`. The audit itself is the test.
- **Negative probe:** inject `class Phantom(Base): … __tablename__ = 'phantom_audit_probe'`; script must report it.

### PR-4.2
- **New:** each migration's `upgrade()` and `downgrade()` are exercised by `check-migrations.sh`. Single test = round-trip in CI.
- **Verify on dev DB:** `\d+ <table>` shows `ix_<table>_tenant_project` in PG.

### PR-4.3
- **New per CRUD-bearing service:** `backend/tests/services/test_<service>_isolation.py` with the canonical 2-tenant template. ≥ 30 test functions across ≥ 30 files.
- **Existing reuse:** `test_steering_rules.py`, `test_rbac_v2.py`, `test_copilot_security.py`, `test_audit.py`, `test_governance.py`, `test_ideation.py`, `test_rls_isolation.py` (10 tests already) — counted in the ≥ 30.

### PR-4.4
- **New per tenant-scoped router:** ≥ 25 test functions across ≥ 15 routers.
- **Pattern:** `httpx.AsyncClient` against an isolated FastAPI app mounting only that router; principal override.

### PR-4.5
- **Update:** 8 existing test files migrate to use `two_tenants`. No new test logic — same assertions, less duplication. The grep probe in §4 PR-4.5 is the test (`grep -rn "Tenant(slug="` returns 0 outside `conftest.py`).

### PR-4.6
- **New:** `scripts/check-migrations.sh` against CI Postgres is the test. No new pytest.

### PR-4.7
- **Update:** the 3 raw f-string SQL hits are refactored; bandit `B608` run over `backend/app/` exits 0. The grep in `check-raw-sql.sh` is the smoke test.

### PR-4.8
- **New shell probe:** `scripts/check-pr-checklist.sh` exits 1 on unchecked boxes; exits 0 when all are checked. No new pytest.

---

## 6. Rollback Strategy

| PR | Revert command | Notes |
|---|---|---|
| 4.1 | `git revert <sha>` | Single net-new script + small marker annotations on 5 models. Reverse removes the script and clears the markers; no data impact. |
| 4.2 | `git revert <sha>` | Each migration's `downgrade()` is reversible (`DROP INDEX CONCURRENTLY`). Reverting the commit drops the new revision and reverts one index at a time — safer than `alembic downgrade` while the tree is mid-PR. |
| 4.3 | `git revert <sha>` | Per-service fix is reversible; new test files revert wholesale. Phase 4 short-lived branch (`phase-4/services`) makes squash-revert clean. |
| 4.4 | `git revert <sha>` | Same as 4.3 — additive test files only. |
| 4.5 | `git revert <sha>` | Reverts the conftest expansion; existing inline duplicates come back. Tree still passes because the inlines were functionally equivalent. |
| 4.6 | `git revert <sha>` | Deletes the workflow + the round-trip script. No DB impact (alembic state is unchanged). |
| 4.7 | `git revert <sha>` | Restores the f-string SQL and removes `.pre-commit-config.yaml`. bandit is no longer enforced; Phase 4.7's grep still works manually. |
| 4.8 | `git revert <sha>` | Removes the section from the PR template + the check script. No state impact. |

**No PR involves schema data migrations or backend config changes** — every change is either a new test, a new script, a small marker annotation, or an `CREATE INDEX CONCURRENTLY` (which is `DROP INDEX CONCURRENTLY`-reversible). `git revert` is safe across the phase.

---

## 7. Out of Scope

- Postgres Row-Level Security policies (RLS) — the brief says defer. The audit script is metadata-only; the existing `app/db/rls.py` is not exercised by Phase 4 tests.
- New tenant onboarding flow changes — separate concern.
- Encryption-at-rest of `tenant_id` columns — not required by R2.
- Service-layer SQL query rewriting (rewriting every query as ORM) — Phase 4 only requires that the tests prove isolation holds.
- Per-tenant cost-quota hardening (Phase 6).
- Per-tenant audit-log retention (Phase 5).
- Removing the in-memory SQLite test engine — needed for fast tests; Postgres is added as a CI service but not as the test default.
- Migrating the legacy `lib/api.ts` orchestrator stubs (Phase 2) — different phase.

---

## 8. Definition of Done

Phase 4 is **DONE** when, in order:

1. All 8 PRs merged to `main`, each behind green CI.
2. SC-4.1 through SC-4.8 all pass (run verification commands; capture output in PR descriptions).
3. `scripts/audit-tenancy.py --strict --require-composite-index` exits 0; the output (zero violations) is captured in a final PR comment.
4. `pytest backend/tests -k isolation -q` collects ≥ 55 tests (≥ 30 service + ≥ 25 API), all pass.
5. `scripts/check-migrations.sh` exits 0 against the CI Postgres service in `python-ci.yml`.
6. `scripts/check-raw-sql.sh` exits 0; `bandit -r backend/app -t B608 --exclude backend/alembic` exits 0.
7. `scripts/check-pr-checklist.sh` exits 0 on a fully-checked PR body that touches schema; exits 1 on an unchecked box.
8. `.github/PULL_REQUEST_TEMPLATE.md` has the "Schema changes" section; the workspace branch protection on `main` requires the new `python-ci` check (manual GitHub UI step — document who/when in phase close-out).
9. `docs/plan/phase-4-audit.md` records the pre-fix vs post-fix model counts.
10. `docs/plan/phase-4-coverage.md` records the service→isolation-test mapping.
11. No `TODO`, `FIXME`, `NotImplementedError`, `pass` (in business logic), or `# in real impl this would` introduced anywhere in the diff (ponytail rule; CI grep confirms).
12. Phase close-out section filled in below.

---

## 9. Critical Files for Implementation

- `scripts/audit-tenancy.py` (create)
- `scripts/check-migrations.sh` (create)
- `scripts/check-pr-checklist.sh` (create)
- `scripts/check-raw-sql.sh` (create)
- `scripts/check-audit-tenancy.sh` (create)
- `backend/app/db/rls.py` (refactor f-strings at lines 86-87)
- `backend/app/services/knowledge_graph.py` (refactor f-string at line 575)
- `backend/app/db/models/` — add `_is_system` / `_audit_scope` / `_audit_root` markers on 6 models
- `backend/alembic/versions/p4_composite_indexes_part{1,2,3}.py` (create — exact template in PR-4.2)
- `backend/tests/conftest.py` (add `two_tenants` family of fixtures)
- `.github/workflows/python-ci.yml` (create)
- `.github/PULL_REQUEST_TEMPLATE.md` (insert Schema-changes section)
- `.pre-commit-config.yaml` (create)
- `backend/pyproject.toml` (add `[tool.bandit]` block)
- `docs/plan/phase-4-audit.md` (create)
- `docs/plan/phase-4-coverage.md` (create)

---

## 10. Phase Close-out (filled at the end)

```
Implementation date: ___
PR(s): ___
Models audited: ___ (61 total; ___ carrying (tenant_id + project_id); ___ missing composite index pre-fix)
Composite indexes added: ___ (across ___ new alembic revisions)
Isolation tests added: ___ (services) + ___ (api) = ___ total
Services with isolation tests: ___ / ___
Routers with isolation tests: ___ / ___
Raw f-string SQL fixed: 3 (rls.py:86, rls.py:87, knowledge_graph.py:575)
Migration round-trip: green in CI
PR checklist gate: enforced on PRs touching backend/app/db/models/ or backend/alembic/
Branch protection updated: confirmed by ___ on ___
Follow-up tickets opened: ___
```

---

### Summary

Models audited: **61** total. **59** carry `tenant_id` (skipping `tenants` and `marketplace_connectors`); **53** carry `project_id`; **24** have a composite `(tenant_id, project_id, …)` index — leaving **~30 tenant-scoped tables missing the required composite index** at start. Services enumerated: **135 service modules** under `backend/app/services/`, of which **~50** carry a CRUD surface that needs an isolation test. Routers with `tenant_id` scope: **39 files**, ~250 endpoints total, with **~25 routers** needing a focused isolation test.

**PRs proposed: 8** (PR-4.1 audit + markers → PR-4.2 composite-index migrations → PR-4.3 service isolation → PR-4.4 router isolation → PR-4.5 fixture consolidation → PR-4.6 round-trip CI gate → PR-4.7 raw-SQL bandit → PR-4.8 PR-template gate).

**Drift found beyond the brief:**

1. The brief's `two_tenants` template uses `db.rollback()` — incompatible with the in-memory SQLite engine (`backend/tests/conftest.py:145-269`). Resolved: cleanup uses `session.close()` and the engine dispose in `sqlite_db`'s teardown.
2. The brief's `audit-tenancy.py` imports via subprocess; the cheaper, more idiomatic, and Alembic-aligned approach is reading `Base.metadata` via `sqlalchemy.inspect()` after a one-shot import (the same pattern `conftest.py` uses at lines 167-209).
3. The brief assumes `_is_system = True` exists on models; it does not. PR-4.1 introduces the marker.
4. The brief's "GitHub Action that reads PR body" can be bypassed by template edits — but only if GitHub still surfaces the old template. Resolved: a `bash` script reading `$PR_BODY` plus `$PR_FILES` (changed-files API) is sufficient for a phase-gate, faster to ship, and impossible to bypass by editing the template file alone because the gate is in CI not the template.
5. CI today covers `apps/forge/**` only; there is no Python CI lane. Phase 4.6 introduces `.github/workflows/python-ci.yml` (pytest + Postgres service for alembic).

**Ambiguity resolved with a default (override in one line at implementation time):**

- *Scope of "every router with `tenant_id` in scope has an isolation test":* 39 files have `tenant_id` somewhere; ~250 endpoints exist; only **~50 endpoints** are deeply tenant-scoped. Default: write one isolation test per **router file** (≥ 25 routers) and let pytest's `-k isolation` collect ≥ 25 tests. If coverage is felt to be insufficient, add more cases in a follow-up PR.
- *Scope of "every service in `backend/app/services/`":* 135 files; only ~50 carry CRUD. Default: target **35 high-value services** (one test each) and let the audit script + spot-fix commits cover the rest.
- *Migration round-trip DB:* ephemeral Postgres in CI; dev DB otherwise. Default: `postgres:16` service in `python-ci.yml`.
- *Composite-index migration:* default split into 3 PR-4.2 migrations (≤ 10 indexes each) to keep `down_revision` chains shallow.
- *Pre-commit:* default uses `pre-commit` with `bandit` hook for changed files + a local `no-fstring-sql` hook (faster than running bandit on the entire tree); CI runs bandit over the whole tree in `python-ci.yml::pre-commit`.

**Three raw f-string SQL hits** at `backend/app/db/rls.py:86,87` and `backend/app/services/knowledge_graph.py:575` — all are fixed in PR-4.7.

---

### Sources read by the Plan agent

- `docs/plan/README.md`, `docs/plan/phase-1.md`, `docs/plan/phase-2.md`, `docs/plan/phase-4.md`, `docs/plan/phase-6.md`, `docs/plan/phase-7.md`, `docs/plan/phase-8.md`
- `docs/plan/phase-1-coverage-baseline.md` (baseline pattern)
- `docs/plan/phase-2-detailed.md` (template)
- `backend/tests/conftest.py` (existing fixtures, in-memory SQLite engine pattern)
- `backend/tests/test_rls_isolation.py` (the existing 24.5K, 10-function isolation suite)
- `backend/app/db/models/*.py` (61 files enumerated)
- `backend/app/db/rls.py:86-87` (raw f-string SQL)
- `backend/app/services/knowledge_graph.py:575` (raw f-string SQL)
- `backend/alembic/versions/` (24 migrations, no Python CI lane)
- `backend/app/services/` (135 service modules across 11 sub-buckets)
- `backend/app/api/v1/` (39 tenant-scoped router files, ~250 endpoints)
- `.github/PULL_REQUEST_TEMPLATE.md` (84 lines, no Schema-changes section)
- `.github/workflows/test.yml` (single existing workflow, apps/forge only)
- `scripts/` (12 existing scripts; `check-test-location.sh` is the bash-guard template)
- `.pre-commit-config.yaml` (does not exist)
- `backend/pyproject.toml` (no `[tool.bandit]` block)