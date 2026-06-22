# Codebase Structure

**Analysis Date:** 2026-06-22

## Directory Layout

```
forge-ai/
├── apps/
│   └── forge/                       # Next.js 15 frontend (single Forge app)
├── backend/                         # FastAPI backend (Python 3.13)
├── agents/                          # LangGraph agent definitions (alternate location)
├── packages/                        # Shared workspace packages (pnpm)
│   ├── connector-events/            # TS event bridge used by MCP servers
│   ├── gsd-core-stub/               # Internal stub for the GSD core engine
│   ├── gsd-pi-stub/                 # Internal stub for project-intelligence
│   └── mcp-router/                  # MCP-side dispatcher
├── mcp-servers/                     # One TS package per external tool
│   ├── jira/  github/  confluence/  figma/  slack/
│   ├── aws/  azure-devops/  clickup/  databricks/  kiro/
│   ├── sonarqube/  zendesk/  adobe-xd/  arch-analyzer/  secrets/
├── infra/                           # Terraform + Argo CD + Docker + Keycloak
│   ├── argocd/  charts/  conftest/  docker/
│   ├── identity-broker/  keycloak/  litellm/  object-store/  terraform/
├── tenants/                         # Per-tenant seed data and policy bundles
│   ├── _default/  acme/  demo-fora-409/  dogfood/  globex/
├── scripts/                         # Local-dev scripts (db-migrate, deploy, lint, …)
├── docs/                            # Architecture, planning artifacts, FORGE_COMMANDS
├── docs-site/                       # MkDocs site for external docs
├── steering/                        # Steering rules, policy.schema.json
├── tests/                           # Cross-cutting test fixtures (Vitest)
├── archive/                         # Paperclip-era / deprecated code (v2.0 history only)
├── .planning/                       # GSD planning artifacts (this folder)
├── .claude/                         # Claude instructions for agents
├── .github/                         # GitHub Actions workflows
├── docker-compose.yml               # Local stack: postgres, redis, litellm, keycloak, backend
├── pnpm-workspace.yaml              # pnpm workspace (packages, apps, mcp-servers)
└── package.json                     # Root scripts
```

## Directory Purposes

**`backend/`** — FastAPI service implementing the SDLC agent operating system.
- Contains: `app/` (the application), `tests/` (pytest), `Dockerfile`, `pyproject.toml`, `requirements.txt`, `alembic.ini`, `README.md`.
- Key files: `app/main.py` (entry point), `app/api/v1/router.py` (v1 aggregation), `app/agents/sdlc_agent.py` (LangGraph supervisor), `app/services/forge_commands.py` (white-label map), `app/services/event_bus.py` (typed bus), `app/services/litellm_client.py` (only LLM ingress), `app/core/config.py` (pydantic-settings), `app/core/security.py` (JWT).

**`apps/forge/`** — Next.js 15 frontend. The single Forge app.
- Contains: `app/` (App Router pages), `components/` (feature UI), `hooks/`, `lib/` (typed REST client + Zustand store), `tests/` (Vitest + Playwright), `__tests__/`, `bin/`, `public/`, `middleware.ts`, `Dockerfile`, `playwright.config.ts`, `vitest.config.ts`, `next.config.mjs`, `tailwind.config.ts`, `components.json`.
- Key files: `middleware.ts` (persona cookie → `X-Forge-Persona`), `app/layout.tsx` (root shell + sidebar nav), `app/api/proxy/[...path]/route.ts` (catch-all orchestrator proxy), `lib/api.ts` (typed client), `lib/forge-commands.ts` (white-label mirror), `lib/store.ts` (Zustand).

**`agents/`** — Top-level directory for LangGraph agent definitions that are shared between the backend and other surfaces. (See `backend/app/agents/` for the canonical SDLC supervisor; `agents/` carries alternative / higher-level graph definitions.)

**`packages/`** — Workspace packages (pnpm monorepo member).
- Contains: `connector-events/` (event envelope + families + store + emitter used by MCP servers), `gsd-core-stub/`, `gsd-pi-stub/`, `mcp-router/`.
- Key files: `packages/connector-events/src/{envelope,chain,emit,lifecycle,registry,store}.ts`.

**`mcp-servers/`** — TypeScript packages, one per external integration.
- Contains: per-vendor `bin/`, `src/`, `test/`, `docs/`, `package.json`, `README.md`.
- Vendors: `jira`, `github`, `confluence`, `figma`, `slack`, `aws`, `azure-devops`, `clickup`, `databricks`, `kiro`, `sonarqube`, `zendesk`, `adobe-xd`, `arch-analyzer`, `secrets`.

**`infra/`** — Deployment + cloud plumbing.
- Contains: `argocd/` (GitOps), `charts/` (Helm), `conftest/` (Rego policy tests), `docker/` (custom images), `identity-broker/` (OIDC bridge), `keycloak/` (realm config), `litellm/` (proxy config), `object-store/` (S3 / MinIO), `terraform/` (AWS modules).

**`tenants/`** — Per-tenant seed data and policy bundles used by day-one bootstrap.
- Contains: `_default/` (template), `acme/`, `demo-fora-409/`, `dogfood/`, `globex/`.

**`scripts/`** — Local-dev helper scripts: `db-migrate.sh`, `deploy.sh`, `lint.sh`, `setup-local.sh`, `typecheck.sh`. Plus the global `policy.schema.json`.

**`docs/`** — Architecture, ADRs, planning artifacts.
- Contains: `ARCHITECTURE.md` (single-page summary), `architecture/overview.md`, `architecture/decisions/*`, `planning-artifacts/`, `operations/`, `status/`, `testing/`, `research-forge-architecture-decisions-2026-06-20.md`, `FORGE_COMMANDS.md`, `openapi.json`, `project-context.md`.

**`docs-site/`** — MkDocs source for the external docs site.

**`steering/`** — Steering rules, `policy.schema.json`.

**`tests/`** — Cross-cutting Vitest fixtures (used by frontend; pytest lives under `backend/tests/`).

**`archive/`** — Paperclip-era code preserved for history only. v2.0 must never reference `@fora/*` scopes (see `.claude/CLAUDE.md`).

**`.planning/`** — GSD artifacts: roadmap, phases, codebase maps (this file lives here).

## Key File Locations

**Entry Points:**
- `backend/app/main.py` — FastAPI app factory + lifespan.
- `apps/forge/app/layout.tsx` — Next.js root layout + sidebar nav.
- `apps/forge/middleware.ts` — Persona middleware.
- `apps/forge/app/api/proxy/[...path]/route.ts` — Catch-all orchestrator proxy.

**Configuration:**
- `backend/app/core/config.py` — pydantic-settings (env vars).
- `apps/forge/next.config.mjs`, `apps/forge/tsconfig.json`, `apps/forge/tailwind.config.ts`, `apps/forge/components.json`, `apps/forge/playwright.config.ts`, `apps/forge/vitest.config.ts`, `apps/forge/postcss.config.mjs`.
- `backend/pyproject.toml`, `backend/alembic.ini`, `backend/requirements.txt`.
- `pnpm-workspace.yaml` — pnpm workspace.
- `docker-compose.yml` — Local stack.
- `.env`, `.env.example` — Environment variables (NEVER read secrets from these).

**Core Logic:**
- `backend/app/agents/sdlc_agent.py` + `sdlc_state.py` — LangGraph supervisor.
- `backend/app/services/forge_commands.py` — `FORGE_COMMAND_MAP`.
- `backend/app/services/event_bus.py` — Typed async pub/sub.
- `backend/app/services/litellm_client.py` — Sole LLM ingress (Rule 1).
- `backend/app/services/knowledge_graph.py` — KG (Apache AGE + pgvector).
- `backend/app/services/connector_manager.py` — Tenant-scoped connectors.
- `backend/app/services/audit_service.py` + `backend/app/core/audit.py` — Audit fan-out.
- `backend/app/services/rbac.py` + `policy_engine.py` — Authorization.
- `backend/app/api/deps.py` — DB session, principal, permission deps.

**Testing:**
- `backend/tests/` — pytest (`backend/tests/conftest.py`).
- `apps/forge/tests/` — Vitest (`apps/forge/vitest.config.ts`).
- `apps/forge/__tests__/` — additional frontend tests.
- `tests/` — workspace-level Vitest fixtures.
- `mcp-servers/<vendor>/test/` — per-vendor Vitest.

## Naming Conventions

**Files (Python — `backend/`):**
- `snake_case.py` — modules (e.g. `forge_commands.py`, `litellm_client.py`).
- Pydantic schemas: `app/schemas/<domain>.py` mirrors routers.
- Routers: `app/api/v1/<domain>.py` or `app/api/v1/<domain>/<verb>.py` for feature namespaces (e.g. `architecture/approvals.py`, `ideation/ideas.py`).
- ORM models: `app/db/models/<entity>.py`, exported through `app/db/models/__init__.py`.
- Tests: `tests/test_<module>.py` + `conftest.py`.
- Service packages: `app/services/<domain>/...` (e.g. `ideation/idea_intake.py`, `connector_ingestion/jira_consumer.py`).

**Files (TypeScript — `apps/forge/`, `packages/`, `mcp-servers/`):**
- Pages: `app/<feature>/page.tsx`. Sub-routes: `app/<feature>/<id>/page.tsx` or `app/<feature>/<id>/<verb>/page.tsx`.
- API routes: `app/api/<segment>/route.ts` for top-level segments; `app/api/<segment>/[param]/route.ts` or `app/api/<segment>/[...path]/route.ts` for catch-alls.
- Components: `components/<Feature>/<Component>.tsx` for feature-scoped; `components/<Component>.tsx` for cross-feature.
- Hooks: `hooks/use-<purpose>.ts`.
- Lib: `lib/<purpose>.ts` (e.g. `api.ts`, `forge-commands.ts`, `mcp-registry.ts`, `store.ts`).

**Directories:**
- Backend feature groups: `ideation/`, `architecture/`, `connector_ingestion/`, `project_intelligence/`, `project_onboarding/`, `scheduler/`, `observability/`, `memory/`, `terminal/`.
- Frontend feature groups: one folder per Forge center under `app/`, mirroring the constitutional layer list.

**Other:**
- Branches / tickets / API ids / connector ids: UUID v4 strings.
- Personas: `developer` (default) — mirrored on `Tenant.default_persona` and `FORGE_PERSONA_DEFAULT` in `apps/forge/middleware.ts`.
- Cookie: `forge.persona`.
- Header: `X-Forge-Persona` (frontend → backend) and `x-fora-tenant-id` (dev single-tenant).
- Event channels: `forge:events:<event_type>` (see `settings.redis_event_channel_prefix`).
- White-label commands: `forge-<verb>` (e.g. `forge-onboard-welcome`).
- Internal commands: `gsd:<area>:<verb>` (opaque triples, never user-visible).

## Where to Add New Code

**New backend REST endpoint:**
- Router: `backend/app/api/v1/<domain>.py` (or extend an existing domain package). Mount in `backend/app/api/v1/router.py`.
- Schemas: `backend/app/schemas/<domain>.py`.
- Service: `backend/app/services/<domain>/<verb>.py`; export the singleton at module bottom.
- ORM model (if new entity): `backend/app/db/models/<entity>.py`, then re-export from `backend/app/db/models/__init__.py`.
- Wrap the handler in `@audit(action="<domain>.<verb>", target_type="<entity>")` and gate with `require_permission("<domain>:<action>")`.

**New LangGraph node:**
- Implement `BasePhaseNode` in `backend/app/agents/nodes/<phase>.py`.
- Register the node in `backend/app/agents/sdlc_agent.py` (add the edge and, if it crosses an approval boundary, route through `approval_gate`).
- Add a Pydantic model to `backend/app/agents/sdlc_state.py` if new state fields are needed.

**New MCP server (vendor integration):**
- Create `mcp-servers/<vendor>/` with `bin/`, `src/`, `test/`, `docs/`, `package.json`, `README.md`, `tsconfig.json`.
- Wire into `backend/app/services/connector_manager.py` (ConnectorType) and `backend/app/services/connector_states.py` (state machine).
- Add an event family in `packages/connector-events/src/families/` if the integration emits Forge events.

**New shared TypeScript package:**
- Create under `packages/<name>/` with `src/`, `test/`, `package.json`, `tsconfig.json`, `vitest.config.ts`. It will be picked up by `pnpm-workspace.yaml` automatically.

**New frontend page / center:**
- Create `apps/forge/app/<center>/page.tsx`. Add an entry to the `NAV` array in `apps/forge/app/layout.tsx` under the appropriate group (`workspace`, `centers`, `lifecycle`).
- Page-level components: `apps/forge/components/<center>/<Component>.tsx`.
- Hooks for that page: `apps/forge/hooks/use-<purpose>.ts`.
- Server data: extend `apps/forge/lib/api.ts` or add a new typed client in `apps/forge/lib/`.

**New Forge command (white-label verb):**
- Add an entry to `_ENTRIES` in `backend/app/services/forge_commands.py` (`(forge_cmd, internal_cmd, description, tier, requires_approval)`).
- Mirror on the frontend in `apps/forge/lib/forge-commands.ts`.
- Add CLI exposure via `_cli_list` / `_cli_exec` if needed (and the corresponding `forge:list` / `forge:exec` script in `apps/forge/package.json`).
- Reference the command in `docs/FORGE_COMMANDS.md`.

**New typed event:**
- Add a member to `EventType` in `backend/app/services/event_bus.py`. Every published event must carry `tenant_id`; subscribers in `app.services.<domain>` register via `bus.subscribe(EventType.X, handler)`.

**New tenant:**
- Add a folder under `tenants/<name>/` with seed data, then load via `day_one_bootstrap.py` (`backend/app/services/`).

**Utilities / cross-cutting helpers:**
- Backend: `backend/app/core/<helper>.py` for app-wide (config, auth, logging, telemetry, idempotency); `backend/app/services/<domain>/_helpers.py` for domain-local.
- Frontend: `apps/forge/lib/<helper>.ts` for app-wide; `apps/forge/lib/<feature>/<helper>.ts` for feature-scoped.

## Special Directories

**`backend/.omc/`, `apps/forge/.omc/`, `mcp-servers/.omc/`:**
- Purpose: OmC (OpenAPI/model-cache) build artefacts.
- Generated: yes.
- Committed: no (typically gitignored).

**`backend/.pytest_cache/`, `apps/forge/test-results/`, `apps/forge/.next/`:**
- Purpose: pytest cache, Playwright output, Next.js build cache.
- Generated: yes.
- Committed: no.

**`archive/`:**
- Purpose: Paperclip-era / deprecated code (v2.0 history only).
- Generated: no.
- Committed: yes. New v2.0 code MUST NOT reference `@fora/*` scopes (see `.claude/CLAUDE.md`).

**`__pycache__/`, `*.pyc`:**
- Purpose: Python bytecode cache.
- Generated: yes.
- Committed: no.

**`node_modules/`:**
- Purpose: npm dependencies (one per package).
- Generated: yes.
- Committed: no.

---

*Structure analysis: 2026-06-22*