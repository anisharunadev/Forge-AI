# Codebase Concerns

**Analysis Date:** 2026-06-22

## Executive Summary

This audit covers the Forge AI v2.0 monorepo (`apps/forge` Next.js frontend, `backend` FastAPI Python, `mcp-servers/`, `packages/`). The codebase shows strong adherence to the eight constitutional rules declared in `.claude/CLAUDE.md` (Rule 1 — Provider Abstraction via LiteLLM Proxy, Rule 2 — multi-tenancy, Rule 3 — approval gates, Rule 4 — typed artifacts, Rule 5 — Org vs Project isolation, Rule 6 — auditability, Rule 7 — observability, Rule 8 — configurability). Audit and observability hooks are pervasive, and direct LLM SDK imports were not found in production code.

The most acute concerns are: (1) a **dev-mode auth bypass** that grants admin to unauthenticated requests (default-on in `docker-compose.yml`), (2) **soft signature verification** on the GitHub webhook (skips entirely when secret is empty), (3) Pervasive `tenant_id/project_id = None` patterns in ideation service signatures that create footguns for Rule 2 compliance, (4) Three unresolved open PRD questions (OQ-005 deployment topology, OQ-006 knowledge graph substrate, OQ-007 source-of-truth conflict policy), (5) `artifact.type` is a free-form string (only loosely constrained by the policy engine).

## Open PRD Blockers (from `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/`)

- **OQ-005 — Deployment topology:** not resolved. `infra/terraform/` is referenced as the production target, but the dev compose (`docker-compose.yml`) is the only concrete deployment artifact. The codebase assumes AWS managed services in prod (ADR-001) but no Terraform commit covers the OQ-005 decision.
- **OQ-006 — Knowledge graph substrate:** partially implemented. ADR-002 picks PostgreSQL 17 + Apache AGE + pgvector; the scripts under `scripts/postgres-init/` initialize AGE, and `backend/app/services/knowledge_graph.py` (656 lines) writes graph nodes/edges. But no decision exists on how to reconcile AGE with the property-graph model in `app/db/models/` (tables vs vertices).
- **OQ-007 — Source-of-truth conflict policy:** not resolved. `backend/app/services/merge_gate.py` (462 lines) handles merge gates but no conflict resolution policy for connector data overlaps (e.g., two connectors reporting the same Jira issue with different metadata).

## v2.0 Naming Violations

**No active `@fora/*` scope imports found in source.** The legacy `@fora/mcp-router`, `@fora/mcp-jira`, `@fora/forge-ui/typed-artifacts`, etc. references appear ONLY in:
- `packages/mcp-router/dist/**` and `packages/connector-events/dist/**` — **stale compiled artifacts** that should be rebuilt from source. These are checked in (visible in `pnpm-lock.yaml`), so a fresh `pnpm build` would overwrite them.
- `mcp-servers/*/node_modules/.package-lock.json` — third-party lockfile metadata, no impact.
- `apps/forge/__tests__/*.test.mjs` — comment-only references describing a historical Paperclip spec that the local mirror must match; non-functional.

**Pervasive comment-only FORA-NNN ticket IDs** in `apps/forge/lib/**` and `apps/forge/components/**` (FORA-484, FORA-501, FORA-514, FORA-591-593, FORA-620). These are documentation/back-references, not imports, and the comment is intentional (links to the original spec). Not a Rule violation.

## Multi-Tenancy (Rule 2) Concerns

### Optional `tenant_id` / `project_id` in service signatures

**Pattern:** Most ideation services accept `tenant_id: UUID | str | None = None` and `project_id: UUID | str | None = None`, deferring the null-check to the call site.

- `backend/app/services/ideation/idea_intake.py:198-199`
- `backend/app/services/ideation/idea_analysis.py:232, 342`
- `backend/app/services/ideation/scoring.py:173, 248`
- `backend/app/services/ideation/arch_preview.py:189, 270`
- `backend/app/services/ideation/roadmap_generator.py:369`
- `backend/app/services/ideation/realtime_workflow.py:117, 185`
- `backend/app/services/ideation/output_bundle.py:86`
- `backend/app/services/ideation/impact_graph.py:157`
- `backend/app/services/ideation/agent_selector.py:108`
- `backend/app/services/ideation/idea_enhance.py:59`
- `backend/app/services/ideation/approval_queue.py:56`
- `backend/app/services/ideation/push_to_delivery.py:73, 131, 188, 249`

**Risk:** Each `None` is a potential Rule 2 violation if the caller forgets to pass the principal's tenant. `app/db/rls.py` raises `PermissionError` when the RLS context isn't set (`rls_required`), so the DB layer catches some cases, but writes that bypass the session's RLS context (e.g., direct ORM calls in jobs) can still leak cross-tenant.

**Files using `tenant_id=None` / `project_id=None` directly in writes:**
- `backend/app/services/workflow_budget.py:228, 229, 251, 268, 269, 472, 495` — writes audit/cost rows without tenant context (budget is run-scoped; impact: org-wide cost rows unfiltered).
- `backend/app/services/scheduler/jobs/ideation_ingest.py:152` — job write passes `project_id=None`.
- `backend/app/services/project_intelligence/repo_ingestion.py:774` — `IngestionRun` row with `project_id=None`.
- `backend/app/services/memory/persona_store.py:234` — persona memory is documented as tenant-scoped only (Rule 5: Org Knowledge shared), so this is intentional.
- `backend/app/services/terminal/broadcast.py:348` — terminal broadcast row.

### DB models missing `tenant_id` / `project_id`

- `backend/app/db/models/marketplace.py` — `MarketplaceConnector` lacks tenant scoping. **Justified:** it is a shared catalog that tenants install from.
- `backend/app/db/models/tenant.py` — defines tenants. **Justified:** tenants are the tenant.

### `DevAuth` principal carries `forge:admin` + `tenant:admin` super-user markers

**See Security Concerns section.**

## Security Concerns

### Critical: Dev-mode auth bypass is the default in dev/staging

- **Code:** `backend/app/core/security.py:78-111` — `get_current_principal()` returns a synthetic `dev@forge.local` principal with `roles=["forge:admin", "tenant:admin", "forge-admin", "ideation:enhance", "ideation:approve"]` when `settings.dev_auth_bypass` is true.
- **Default-on:** `docker-compose.yml:206` sets `DEV_AUTH_BYPASS: "1"` in the `backend` service.
- **Impact:** Any caller who can reach the backend port (8000) gets full admin powers — bypasses every RBAC check (`forge:admin` and `tenant:admin` are the super-user markers used by `app.services.rbac.has_permission`).
- **Risk:** If a developer runs `docker compose up` against a staging cluster by accident (e.g., wrong context), every endpoint is admin. CI must set `environment: production` so the literal `"1"` would still parse as truthy in pydantic — the dev bypass is **environment-agnostic** in code.
- **Mitigation that is missing:** A startup assertion that refuses to boot when `dev_auth_bypass=True AND settings.environment in {"staging", "production"}` would prevent accidental prod-exposure. Currently `Settings.environment` is loaded separately (`core/config.py:33`) and no cross-check exists.
- **Recommendation:** Add a hard fail-fast in `Settings` (`@model_validator`) that raises if `dev_auth_bypass is True` and `environment != "development"`.

### Critical: GitHub webhook signature verification is silent when secret is empty

- **Code:** `backend/app/api/v1/webhooks.py:81-91` — `_verify_github_signature` returns without raising when `settings.github_webhook_secret` is empty, only emitting a `webhooks.github_signature_disabled` warning.
- **Default:** `backend/app/core/config.py:98` — `github_webhook_secret: str = Field(default="", ...)`. If `.env` is missing the var, the secret is empty.
- **Impact:** A misconfigured deployment that forgets to set the secret allows anyone to POST forged pre-commit payloads, manipulating the merge gate (`/v1/webhooks/github/pre-commit`) decisions returned to the GitHub Actions runner.
- **Recommendation:** Raise `HTTPException(500, "webhook_secret_not_configured")` instead of returning. Refuse to boot if the secret is empty in non-development environments (mirroring the auth-bypass fix).

### JWT secret handling

- **Code:** `backend/app/core/security.py:39-56` — `decode_token()` uses `settings.jwt_secret` (string, may be HMAC or PEM).
- **Risk:** No key-rotation support; `jwt_secret` is a single string. Rotating requires coordinated restart. HS256 in dev (`core/config.py:73`) — symmetric; an attacker with the secret can mint tokens.

### Audit silently substitutes a sentinel for missing `project_id`

- **Code:** `backend/app/services/audit_service.py:37` — `project_id=str(project_id) if project_id else "00000000-0000-0000-0000-000000000000"`. This sentinel UUID collides with the `00000000-...-ace` dev tenant on prefix only. Rows that lacked `project_id` are silently recorded against an "all-zero" UUID; subsequent RLS / tenant filters must explicitly exclude this sentinel to avoid leaking.
- **Recommendation:** Make `project_id` required on `AuditService.record` (raise if None) so callers must commit to a value.

### Slack/Notion connectors re-use the Jira secrets bucket

- **Code:** `backend/app/services/project_intelligence/comm_ingestion.py:90` — `connector_type=ConnectorType.SLACK, # reuses secrets bucket for now`.
- **Code:** `backend/app/services/project_intelligence/doc_ingestion.py:65, 80` — Notion and Secrets share the Jira secrets bucket.
- **Impact:** Cross-connector credential leakage if the bucket key isn't scoped per connector type. Until proper per-type secrets are wired, a tenant rotating the Jira token also rotates Notion and the Secrets bucket.
- **Recommendation:** Track as tech debt for the secrets management phase; tagged with `# reuses secrets bucket for now`.

### RLS context must be set per session

- **Code:** `backend/app/db/rls.py:64-92` — `rls_required` dependency enforces `app.tenant_id` + `app.project_id` on the session; raises `PermissionError` if absent.
- **Coverage gap:** Job code (e.g., `backend/app/services/scheduler/jobs/ideation_ingest.py`, `repo_ingestion.py`) opens sessions directly via `get_session_factory()` rather than going through the RLS-required dependency. If a job forgets to set RLS context, queries can return cross-tenant rows.
- **Recommendation:** Audit each job for explicit `await session.execute(text("SET LOCAL app.tenant_id = ..."))` or equivalent.

### CORS is permissive by default

- **Code:** `backend/app/core/config.py:40` — `cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])`.
- **Code:** `backend/app/main.py:104-111` — CORS allows `allow_methods=["*"]`, `allow_headers=["*"]`, `allow_credentials=True`. Default is localhost-only but the per-method/header allow-list is wide-open.
- **Risk:** If `cors_origins` is misconfigured to a wildcard or attacker domain, credentialed cross-origin requests become possible.

## Approval Gate (Rule 3) Concerns

### Approval gate enforced in code, but config-only via phase node attributes

- **Code:** `backend/app/agents/nodes/base.py:286-288` — `check_approval_required` only triggers if `requires_approval = True`. Verified correctly set on:
  - `architecture.py:40` — `requires_approval = True`
  - `security.py:31` — `requires_approval = True`
  - `deployment.py:30` — `requires_approval = True`
- **Discovery / Planning / Testing / Implementation** correctly have `requires_approval = False` (these are not Rule 3 boundaries).
- **Risk:** A new phase node added without `requires_approval = True` would silently bypass Rule 3 for Architecture / Security / Deployment. Enforce via test or base-class check.

### Approval timeout hardcoded at 24h

- **Code:** `backend/app/agents/approval_gate.py:37` — `APPROVAL_TIMEOUT_HOURS = 24` (constant). No per-tenant / per-approval-type override. Long architecture reviews could be blocked.

### Architecture ADR/Contract generation not gated internally

- **Code:** `backend/app/services/architecture/api_contract_generator.py`, `risk_register.py`, `acceptance_criteria.py`, `standards_attestation.py` (all in `architecture/`) generate typed artifacts but do not internally check `requires_approval`.
- **Mitigation:** The architecture phase node (`architecture.py`) gates the supervisor. But internal services called outside the SDLC graph (e.g., direct API call to `/v1/architecture/api-contracts`) bypass that gate.
- **Recommendation:** Add an RBAC + approval-required check at the API layer (`api/v1/architecture/*`) that mirrors the phase gate.

## Audit (Rule 6) & Observability (Rule 7) Concerns

### `BasePhaseNode` emits lifecycle events but does not call `audit_service.record`

- **Code:** `backend/app/agents/nodes/base.py:163-238` — emits `AGENT_RUN_STARTED`, `AGENT_RUN_COMPLETED`, `AGENT_RUN_FAILED` to the event bus but does not write to the `audit_events` table.
- **Impact:** `audit_events` and the event bus are two parallel audit surfaces. Audit log queries (`/v1/audit`) and event-bus subscribers may diverge.
- **Recommendation:** Decide one system-of-record and have the other mirror it, or document the split clearly.

### `gsd_wrapper` keeps audit in memory unless `audit_sink` is injected

- **Code:** `backend/app/agents/tools/gsd_wrapper.py:131` — `self.audit_log: list[AuditRecord] = []` is in-memory.
- **Risk:** Audit records vanish on restart unless something wires the sink. Default GSD wrapper construction (`build_default_wrapper()`) doesn't inject the sink.
- **Recommendation:** Default sink to `audit_service.record` so production is safe-by-default.

### Scheduler jobs write some audit events with `project_id=None`

- **Code:** `backend/app/services/scheduler/jobs/ideation_ingest.py:150-164` — writes `audit_service.record(tenant_id=tenant_id, project_id=None, actor_id=None, ...)`.
- **Impact:** Audit query filters that assume `(tenant_id, project_id)` joins will not surface these rows.

### Free-form agent output fields exist

- `backend/app/db/models/artifact.py:37` — `type` is "a free-form string but the policy engine constrains the set". If the policy engine is bypassed, the type system is moot.
- `backend/app/services/project_intelligence/comm_ingestion.py:171` — `scan a free-form message and return detections`. This is input parsing, not output — acceptable.
- `backend/app/services/ideation/idea_enhance.py:3`, `schemas/ideation.py:99` — PM-driven Enhance flow allows a 1-2000 char free-form editor note; downstream PRD generator consumes it. **Risk:** if the prompt doesn't enforce structure, the LLM may return free-form JSON that fails Pydantic validation.
- `backend/app/services/architecture/api_contract_generator.py:73` — "Generate a contract from a free-form description." Acceptable (input side).
- `backend/app/services/architecture/risk_register.py:4` — accepts "free-form idea"; risks are typed downstream. Acceptable.

### OpenTelemetry initialized but exporter disabled by default

- **Code:** `backend/app/main.py:34` — `init_telemetry()` runs unconditionally.
- **Code:** `backend/app/core/config.py:78-80` — `otlp_endpoint: str | None = None` (disabled by default), `otel_exporter_otlp_insecure: bool = True`. Local-dev means OTel spans are dropped unless an OTLP collector is configured.
- **Impact:** Observability gap unless operators configure `OTEL_EXPORTER_OTLP_ENDPOINT`. The shipping config (`docker-compose.yml`) doesn't set this for the backend service.

## Performance Bottlenecks & Scaling Concerns

### Largest backend service files (potential complexity hot spots)

| File | Lines | Concern |
|------|-------|---------|
| `backend/app/services/day_one_bootstrap.py` | 965 | Single mega-module for first-boot setup. Try splitting per-resource. |
| `backend/app/services/steering_rules.py` | 845 | Single rule-engine. Heavy regex compilation per call. |
| `backend/app/services/project_intelligence/repo_ingestion.py` | 806 | Long-running ingest; likely needs pagination/streaming. |
| `backend/app/services/ideation/realtime_workflow.py` | 660 | Real-time path; check for blocking I/O. |
| `backend/app/services/knowledge_graph.py` | 656 | Single-file AGE graph writer; refactor opportunity. |
| `backend/app/agents/tools/mcp_client.py` | 846 | MCP client transport. Single point of failure for all agent calls. |

### Largest frontend files

- `apps/forge/lib/forge-commands.ts` (692 lines) — Single registry of forge commands; near-limit for a TS module.
- `apps/forge/components/ConnectorDetailPanel.tsx` (485 lines) — UI mega-component.
- `apps/forge/lib/api.ts` (470 lines) — REST client; "Single-tenant dev" hard-coded `DEV_TENANT_UUID` (`api.ts:54`) needs tenant-from-claim migration before multi-tenant UI works.

### `_DEFAULT_PROJECTED_CHAT_USD = 0.05` per admission check

- **Code:** `backend/app/services/litellm_client.py:35-36` — every admission control pre-authorizes $0.05 (chat) / $0.0001 (embed) when caller doesn't pre-compute. Bounded, but repeated calls can over-authorize vs actual cost.

## Fragile Areas & Safe Modification

### `BasePhaseNode` is the linchpin for all SDLC phases

- `backend/app/agents/nodes/base.py` (401 lines). Any change to the cost guard, duration guard, or approval gate logic affects all 6 phases. Modification must include unit tests for each phase.

### Approval gate metadata flag uses string-keyed state

- `backend/app/agents/nodes/base.py:282` — `state.metadata.get(f"approval:{self.phase_name.value}")` — stringly-typed key. A typo in a phase name breaks the gate silently. Recommend a constant.

### `_verify_github_signature` returns on empty secret

- See Security section.

### `acme-corp` hard-coded in dev bypass principal

- `backend/app/core/security.py:110` — `raw_claims={"sub": "dev", "forge.tenant": "acme-corp", "_dev_bypass": True}`. The `forge.tenant` here doesn't match the principal's `tenant_id="00000000-...-ace"` set above it. Internal inconsistency between the synthetic principal and its claim.

### Connector `ConnectorType.SLACK` shares Jira secrets

- See Security section.

### `IDEATION_JIRA_PROJECT_KEY = 'FORA'` is hard-coded

- `apps/forge/lib/hooks/usePushIdeaToJira.ts:39` — Hard-coded project key for Phase 1, marked as TODO to read from connector config.
- **Impact:** All tenants push ideation to the same Jira project key. Defeats multi-tenancy for Jira pushes.

### `apps/forge/lib/forge-commands.ts` and bin/ directory

- `apps/forge/bin/orchestrator-stub.py` was **deleted** (per git status `D apps/forge/bin/orchestrator-stub.py`). The proxy at `/api/proxy/*` referenced `.stub-port` which is still generated; ensure the proxy handles a missing port file gracefully.

## Model-Provider Agnosticism (Rule 1)

**No direct LLM SDK imports found** in `backend/app/`, `apps/forge/`, `packages/*/src/`, or `mcp-servers/*/src/`. All LLM traffic flows through `app.services.litellm_client.LiteLLMClient` (the abstraction layer). Confirmed compliance with Rule 1.

**Note:** Hard-coded model identifiers in the abstraction layer:
- `backend/app/services/terminal/cost_tracker.py:108-110` — `claude-sonnet-4-6`, `claude-opus-4-7`, `claude-haiku-4-5`. These are user-facing cost mappings, not provider imports. Acceptable but should be data-driven.
- `backend/app/services/model_provider_registry.py:3` — `gpt-4o-mini`, `claude-3-5-sonnet` in docstring. Acceptable (documentation).

## Layer Isolation (Rule 5)

### Organization Knowledge vs Project Intelligence separation

- `backend/app/services/memory/persona_store.py` — explicitly tenant-scoped only (Org layer).
- `backend/app/services/project_intelligence/` — project-scoped with explicit `project_id` on every model. Verified correct separation.
- **Risk:** The `persona_store` writes history rows with `tenant_id` only (`persona_memory_history`). The UI may eventually display this history in a project context. Ensure reads join by tenant_id only (no project filter).

## Free-Form Agent Output (Rule 4) Concerns

- Most agent outputs go through the artifact registry (`backend/app/services/artifact_registry.py`) with typed Pydantic payloads.
- `backend/app/services/ideation/idea_enhance.py` — PM free-form editor note (1-2000 chars). Downstream `idea_analysis.py` must validate LLM output.
- `backend/app/agents/nodes/planning.py:166` — Review node emits `"Review diff, risk-score, and recommend approval."` — text output. Look at how this is consumed; if it flows to a downstream typed stage, parse safely.
- `backend/app/services/architecture/api_contract_generator.py:73` — Generates OpenAPI/GraphQL/gRPC contracts from free-form descriptions. Returns parsed `APIContract` — typed at the boundary, OK.

## Test Coverage Gaps

- No tests for `backend/app/agents/refactor_agent.py` (806 lines) — F-601 Refactor Agent has zero unit tests in `backend/tests/`.
- No tests for `backend/app/services/architecture/api_contract_generator.py` — F-302 generator untested.
- No tests for `backend/app/agents/nodes/deployment.py` (only `test_sdlc_agent.py:223` exercises it via the supervisor).
- No tests for the dev-auth bypass itself (verified only by inspection of `security.py:78-117`).
- `apps/forge/__tests__/` — relies on Vitest + Playwright but coverage threshold is not declared in `apps/forge/package.json`.

## Dependencies at Risk

- `react: 19.0.0-rc-66855b96-20241106` (apps/forge/package.json:34) — RC version of React 19. Production should pin to a stable release.
- `next: 15.0.3` (apps/forge/package.json:33) — early 15.x release; later patch versions may have fixes.
- `python-jose` (used in `backend/app/core/security.py:15`) — maintainer has flagged the package for replacement by `pyjwt` or `authlib`. Watch for CVE.
- `node-pty: ^1.0.0` (apps/forge/package.json:55) — native binding; prebuilt binaries may not cover all arches.

## Missing Critical Features

- No rate limiting middleware on the FastAPI app (the MCP registry declares per-server `rate_limits` (`backend/app/services/mcp_registry.py:90`) but they are not enforced at the proxy).
- No CSRF protection for cookie-authenticated requests.
- No file-upload size limit beyond what FastAPI defaults provide.
- No per-tenant cost dashboard; cost data flows through `cost_ledger.py` but no aggregation endpoint surfaces it.
- OQ-005/006/007 unresolved (see top).

## Pending Categories from `.claude/CLAUDE.md`

The project README explicitly notes these are unfilled:
- **Language-Specific Rules** (TypeScript strict mode, Python async patterns, import conventions)
- **Framework-Specific Rules** (Next.js App Router patterns, FastAPI middleware conventions, LangGraph node contracts)
- **Testing Rules** (pytest + Vitest structure, mock conventions, coverage expectations)
- **Code Quality & Style Rules** (ESLint/Prettier/Ruff configs)
- **Development Workflow Rules** (branch naming, commit message format, PR checklist)
- **Critical Don't-Miss Rules**

These remain pending because the project is "greenfield" — they will surface once conventions stabilize. Track these as gaps that agents must surface proactively until filled.

## Recommendation Priorities

1. **P0 — Security:** Add startup assertion that fails when `dev_auth_bypass=True` outside `environment=development`. Add same for empty `github_webhook_secret`.
2. **P0 — Security:** Change `_verify_github_signature` to raise on empty secret.
3. **P1 — Multi-tenancy:** Audit all `tenant_id=None` / `project_id=None` writes in `workflow_budget.py`, `scheduler/jobs/*`, `terminal/broadcast.py` and decide whether the sentinel-or-None should be required.
4. **P1 — Approval gates:** Add API-layer approval-required checks on `/v1/architecture/*`, `/v1/security/*`, `/v1/deployment/*` so direct calls bypass the SDLC graph don't skip the gate.
5. **P1 — Audit:** Make `project_id` required on `AuditService.record` (raise if None).
6. **P2 — Refactoring:** Split `day_one_bootstrap.py` (965 lines) into per-resource modules.
7. **P2 — Refactoring:** Refactor `steering_rules.py` (845 lines) to compile regexes at module load.
8. **P2 — Observability:** Wire `OTEL_EXPORTER_OTLP_ENDPOINT` into `docker-compose.yml`.
9. **P2 — Multi-tenancy UI:** Remove hard-coded `DEV_TENANT_UUID` from `apps/forge/lib/api.ts` and `IDEATION_JIRA_PROJECT_KEY = 'FORA'` from `usePushIdeaToJira.ts`.
10. **P3 — Open questions:** Resolve OQ-005/006/007 before committing architecture decisions that depend on them.

---

*Concerns audit: 2026-06-22*