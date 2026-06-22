<!-- refreshed: 2026-06-22 -->
# Architecture

**Analysis Date:** 2026-06-22

## System Overview

```text
+---------------------------------------------------------------------------+
|                              Browser                                       |
|   Next.js 15 + React 19 + xterm.js + React Flow + Shadcn UI                |
|   apps/forge/app/**                                                        |
+---------------------------------+------------------------------------------+
                                  |
                                  | HTTPS / WebSocket (with X-Forge-Persona,
                                  | X-Forge-Tenant-Id injected by middleware
                                  | and the catch-all /api/proxy route)
                                  v
+---------------------------------------------------------------------------+
|                       FastAPI Backend  (backend/app)                       |
|                                                                            |
|   main.py  ──  CORS + OTel + lifespan (bus + scheduler + alerts)           |
|     │                                                                     |
|     ├─ api/v1/router.py          REST  /api/v1/*   (40+ sub-routers)     |
|     │     • admin, agents, agent_runtimes, approvals, artifacts, audit     |
|     │     • architecture/*, ideation/*, connectors, knowledge_graph       |
|     │     • marketplace, mcp, onboarding, projects, policies, qa, rbac    |
|     │     • runs, repos, scheduler, steering_rules, templates, validation |
|     │     • terminal_*, tool_bundles, webhooks, workflows                  |
|     │                                                                     |
|     ├─ api/ws/                   WebSocket  /ws/*                          |
|     │     • runs.py, ideation.py, terminal.py, terminal_broadcast.py      |
|     │                                                                     |
|     ├─ agents/                   LangGraph Orchestration                  |
|     │     • sdlc_agent.py (supervisor) + sdlc_state.py (Pydantic)         |
|     │     • nodes/{discovery,planning,architecture,implementation,        |
|     │               testing,security,review,deployment}.py                |
|     │     • approval_gate.py (HITL interrupts for Rule 3)                 |
|     │     • refactor_agent.py + code_validator.py (sub-graphs)            |
|     │     • tools/   gsd_wrapper, mcp_client, repomix_wrapper,             |
|     │                knowledge_graph wrapper                              |
|     │                                                                     |
|     ├─ services/                 Domain logic (≈ 30 modules)               |
|     │     • forge_commands.py    FORGE_COMMAND_MAP (60+ entries)          |
|     │     • event_bus.py         Typed Redis-Pub/Sub bus                   |
|     │     • litellm_client.py    Rule 1 — only LLM ingress                |
|     │     • connector_manager.py + connector_ingestion/                   |
|     │     • knowledge_graph.py + freshness_ledger + cost_ledger           |
|     │     • audit_service.py + rbac + policy_engine + approval_workflow  |
|     │     • ideation/, architecture/, project_intelligence/,              |
|     │       project_onboarding/, scheduler/, observability/, memory/,     |
|     │       terminal/                                                     |
|     │                                                                     |
|     ├─ db/models/                SQLAlchemy 2.0 ORM (Rule 2 — every row    |
|     │     carries tenant_id + project_id)                                 |
|     │                                                                     |
|     └─ core/   config / security / audit decorator / telemetry /         |
|                idempotency / logging                                      |
+---------------------------------+------------------------------------------+
                                  |
                                  v
+---------------------------------------------------------------------------+
|                          PostgreSQL 17 + Apache AGE + pgvector              |
|   RLS policies (tenant_id, project_id)  | Append-only audit_log + hash     |
|   Tables: tenants, projects, agents, connectors, hooks, artifacts,         |
|   approval_request, ideation*, KG nodes+edges, cost ledger, ...            |
+---------------------------------------------------------------------------+
                                  |
                                  v
+---------------------------------------------------------------------------+
|  Redis Pub/Sub    (forge:events:<type>)  +  ElastiCache cache             |
|  S3 (artifacts, exports)  |  LiteLLM Proxy (Rule 1 — no direct SDKs)       |
+---------------------------------------------------------------------------+
                                  |
                                  v
+---------------------------------------------------------------------------+
|  LLM Providers  (Anthropic | OpenAI | Bedrock | Vertex | Azure | OpenR.)  |
|  MCP Servers    (mcp-servers/{jira,github,confluence,figma,slack,...})    |
+---------------------------------------------------------------------------+
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| FastAPI app factory | CORS, lifespan (bus + scheduler + telemetry), mounts `/api/v1` and WS routers | `backend/app/main.py` |
| v1 router aggregator | Imports & mounts every feature router | `backend/app/api/v1/router.py` |
| WebSocket routers | Streaming terminal sessions, run progress, ideation real-time | `backend/app/api/ws/{terminal,runs,ideation,terminal_broadcast}.py` |
| Dependency providers | DB session, current principal, RBAC + policy guard | `backend/app/api/deps.py` |
| LangGraph supervisor | Compile SDLC StateGraph; checkpointing; HITL interrupts | `backend/app/agents/sdlc_agent.py`, `sdlc_state.py` |
| Phase nodes | Discovery, Planning, Architecture, Implementation, Testing, Security, Review, Deployment | `backend/app/agents/nodes/*.py` |
| Approval gate | LangGraph interrupt for Architecture/Security/Deployment | `backend/app/agents/approval_gate.py` |
| Agent tools | LLM wrappers, MCP client, repomix, knowledge graph | `backend/app/agents/tools/*.py` |
| Forge command map | White-label mapping `forge-*` → `gsd:<area>:<verb>` | `backend/app/services/forge_commands.py` |
| Event bus | Typed async pub/sub (Redis or in-memory) carrying `{tenant, project}` | `backend/app/services/event_bus.py` |
| LiteLLM client | Only LLM ingress; cost attribution + budget guard | `backend/app/services/litellm_client.py` |
| Connector manager | Tenant-scoped connector CRUD + sync orchestration | `backend/app/services/connector_manager.py` |
| Knowledge graph service | kg_nodes / kg_edges (Apache AGE + pgvector fallback) | `backend/app/services/knowledge_graph.py` |
| Audit service | Append-only AuditEvent rows (Rule 6) | `backend/app/services/audit_service.py`, `backend/app/core/audit.py` |
| RBAC + Policy | `forge:admin` short-circuit + JWT permission bundle + PolicyEngine | `backend/app/services/{rbac,policy_engine}.py` |
| ORM models | 30+ SQLAlchemy 2.0 models, every row tenant+project scoped | `backend/app/db/models/` |
| DB session | asyncpg engine + RLS session context | `backend/app/db/session.py` |
| Settings | pydantic-settings; refuses to start without critical env vars | `backend/app/core/config.py` |
| Auth | JWT (HS256 dev / RS256 prod via JWKS) → AuthenticatedPrincipal | `backend/app/core/security.py` |
| Idempotency | `Idempotency-Key` middleware for write paths | `backend/app/core/idempotency.py` |
| Telemetry | OpenTelemetry tracer + meter providers (Rule 7) | `backend/app/core/telemetry.py` |
| Frontend app | Next.js 15 App Router, persona middleware, Zustand store | `apps/forge/app/**`, `apps/forge/middleware.ts` |
| API proxy | Single catch-all Next.js route → orchestrator | `apps/forge/app/api/proxy/[...path]/route.ts` |
| Persona API | Read/write the `forge.persona` cookie | `apps/forge/app/api/persona/route.ts` |
| Run control API | Lifecycle verbs `start/pause/resume/cancel` | `apps/forge/app/api/runs/[id]/[verb]/route.ts` |
| Shared packages | Connector-event bridge, GSD stubs, MCP router | `packages/{connector-events,gsd-core-stub,gsd-pi-stub,mcp-router}` |
| MCP servers | One TypeScript package per external tool | `mcp-servers/{jira,github,confluence,figma,slack,aws,azure-devops,clickup,databricks,kiro,sonarqube,zendesk,adobe-xd,arch-analyzer,secrets}/` |

## Pattern Overview

**Overall:** Layered monolith with strict tenant isolation, a typed async event bus, and a LangGraph orchestrator on top. The codebase is a single FastAPI process + a single Next.js app, split internally by domain into routers / services / models. External I/O flows through three narrow chokepoints: **LiteLLM Proxy** (LLMs), **Event Bus** (cross-service messaging), and **Connector Manager → MCP Servers** (external tools).

**Key Characteristics:**

- **Constitutionally-enforced boundaries (Rules 1–8).** No service imports an LLM provider SDK; every endpoint wraps in `@audit(...)`; every event/row carries `tenant_id` + `project_id`; HITL gates sit between phases that cross Architecture/Security/Deployment boundaries.
- **Hexagonal core.** `core/` is a thin adapter layer (config, auth, logging, telemetry, audit decorator, idempotency). `services/` holds pure domain logic. `db/` and `api/` are outward-facing adapters that the core depends on.
- **White-label command surface.** `FORGE_COMMAND_MAP` (`backend/app/services/forge_commands.py`) is the single source of truth mapping every customer-visible `forge-*` verb to an opaque `gsd:<area>:<verb>` internal name — leaking "GSD" anywhere is a defect (ADR-004, DL-024).
- **Typed event bus.** Events are a closed `EventType` enum (`backend/app/services/event_bus.py`) with a single canonical shape `{event_id, event_type, occurred_at, tenant_id, project_id, actor_id, payload}`. In-memory mode is used by tests; production uses Redis Pub/Sub with one channel per event type.
- **LangGraph supervisor.** `sdlc_agent.py` declares phases as nodes and approval gates as conditional edges using `interrupt()` (ADR-007). State is a Pydantic v2 model `SDLCState` (`sdlc_state.py`) that doubles as the checkpoint payload.
- **Multi-tenant RLS.** Every row carries `tenant_id`; project-scoped rows also carry `project_id`. PostgreSQL Row-Level Security policies restrict reads/writes; session-level `app.tenant_id` / `app.project_id` are set per request (only the migrator bypasses RLS).
- **Frontend as a thin typed client.** A single catch-all Next.js route (`/api/proxy/[...path]`) forwards to the orchestrator with `X-Forge-Tenant-Id` + persona cookie. Pages consume typed helpers in `apps/forge/lib/{api,forge-api,forge-commands,mcp-registry}.ts`.

## Layers

**HTTP / WS layer (`backend/app/api/`):**
- Purpose: parse requests, run dependencies, return Pydantic-validated responses.
- Location: `backend/app/api/v1/`, `backend/app/api/ws/`
- Contains: feature routers (`admin.py`, `agents.py`, `architecture/`, `ideation/`, …), dependency providers (`deps.py`), WebSocket endpoints.
- Depends on: `schemas/`, `services/`, `core/audit`, `api/deps`.
- Used by: `main.py` (mounted at `/api/v1/*` and `/ws/*`).

**Agent orchestration layer (`backend/app/agents/`):**
- Purpose: declare the SDLC graph, attach tools, and pause for human approval.
- Location: `backend/app/agents/`
- Contains: `sdlc_agent.py` (supervisor graph), `sdlc_state.py` (Pydantic state), `nodes/*.py` (phase nodes), `code_validator_nodes/*.py`, `tools/*.py`, `prompts/*.j2`.
- Depends on: `services/`, `core/`, `agents/tools/`.
- Used by: `services/sdlc_run_manager.py`, the `runs` API router.

**Service layer (`backend/app/services/`):**
- Purpose: domain logic, framework-free; owns all writes to the DB, the bus, and the LLM proxy.
- Location: `backend/app/services/`
- Contains: 30+ modules grouped by domain (ideation/, architecture/, project_intelligence/, project_onboarding/, scheduler/, observability/, memory/, terminal/, connector_ingestion/, connectors/).
- Depends on: `db/`, `core/`, `agents/tools/` (only when calling tools from a service).
- Used by: routers, agent nodes, scripts.

**Persistence layer (`backend/app/db/`):**
- Purpose: SQLAlchemy 2.0 ORM models + session factory + RLS context.
- Location: `backend/app/db/models/`, `backend/app/db/session.py`
- Contains: 30+ ORM classes, lazy async engine + sessionmaker.
- Depends on: `core/config` only.
- Used by: services and routers.

**Schema layer (`backend/app/schemas/`):**
- Purpose: Pydantic v2 request/response shapes for the API surface.
- Location: `backend/app/schemas/`
- Contains: 25+ modules mirroring the routers (`admin`, `agents`, `architecture`, `ideation`, `marketplace`, …).
- Depends on: pydantic only.
- Used by: routers, services that accept external payloads.

**Core / cross-cutting (`backend/app/core/`):**
- Purpose: app-wide infrastructure (config, logging, telemetry, audit decorator, security, idempotency).
- Location: `backend/app/core/`
- Depends on: third-party libraries only.
- Used by: every layer above.

**Frontend (Next.js 15) — `apps/forge/`:**
- Pages: `app/<feature>/page.tsx` — one folder per Forge center (`dashboard`, `forge-command-center`, `forge-terminal`, `runs`, `agent-center`, `connector-center`, `knowledge-center`, `organization-knowledge`, `project-intelligence`, `governance-center`, `ideation`, `architecture`, `project-onboarding`, `audit`, `analytics`, `persona`, `validator`, `healthz`, `refactor`).
- Components: `apps/forge/components/<feature>/` — feature-scoped UI, plus a small set of cross-feature (`ConnectorDetailPanel`, `PersonaSwitcher`, `RealtimeRunsList`, `RealtimeTimeline`, `Timeline`, `RunActions`).
- Hooks: `apps/forge/hooks/` — `use-api-data`, `use-forge-commands`, `use-terminal`, `use-toast`.
- Library: `apps/forge/lib/` — typed REST client (`api.ts`), Forge command map (`forge-commands.ts`), MCP registry (`mcp-registry.ts`), Zustand store, realtime client.
- Middleware: `apps/forge/middleware.ts` — reads `forge.persona` cookie, forwards `X-Forge-Persona` header.

**Shared workspace packages — `packages/`:**
- `packages/connector-events/` — TypeScript event envelope, families, store, emitter (used by MCP servers).
- `packages/gsd-core-stub/` and `packages/gsd-pi-stub/` — internal stubs wrapping the `gsd-*` engine.
- `packages/mcp-router/` — MCP-side dispatcher.

**MCP servers — `mcp-servers/<vendor>/`:**
- One TypeScript package per external tool (jira, github, confluence, figma, slack, aws, azure-devops, clickup, databricks, kiro, sonarqube, zendesk, adobe-xd, arch-analyzer, secrets). Each ships `bin/`, `src/`, `test/`, `docs/`.

## Data Flow

### Primary request path (a tenant makes an authenticated API call)

1. Browser hits a Next.js page under `apps/forge/app/<feature>/page.tsx`. The page mounts `Providers` (`apps/forge/components/providers.tsx`) and uses a typed hook (e.g. `use-forge-commands.ts`).
2. The hook calls the typed REST client (`apps/forge/lib/api.ts` or `forge-commands.ts`), which routes through `process.env.NEXT_PUBLIC_FORGE_API_URL` or `/api/proxy/*`.
3. Next.js middleware (`apps/forge/middleware.ts`) has already injected `X-Forge-Persona` from the `forge.persona` cookie into the request headers.
4. `apps/forge/app/api/proxy/[...path]/route.ts` forwards the request to the FastAPI backend, injecting `x-fora-tenant-id` if missing and pass-through cookies. The proxy also reads `apps/forge/.stub-port` in dev for stub discovery.
5. FastAPI receives the request. `app.api.deps.db_session` opens an async SQLAlchemy session; `app.api.deps.get_current_principal` validates the JWT (or honours `FORA_DEV_AUTH_BYPASS`) and yields an `AuthenticatedPrincipal` with `tenant_id` + `project_id`.
6. The router (`backend/app/api/v1/<feature>.py`) applies `require_permission(...)`, runs the endpoint body wrapped in `@audit(action=..., target_type=...)`.
7. The handler delegates to a service in `backend/app/services/<feature>/`, which writes via the session and publishes typed events through `backend/app/services/event_bus.py:bus`.
8. The event bus dispatches in-process subscribers and fans out via Redis Pub/Sub (one channel per `EventType`). Subscribers (e.g. `JiraIngestionService`, `AlertManager`, scheduler hooks) react asynchronously.
9. The response is serialized through Pydantic schemas (`backend/app/schemas/`), returned to the Next.js proxy, and rendered on the page.

### SDLC run (a LangGraph orchestration)

1. A user initiates a workflow in the UI; the forge command map resolves `forge-*` to an internal command (`backend/app/services/forge_commands.py`).
2. `backend/app/services/sdlc_run_manager.py` calls `run_sdlc(...)` from `backend/app/agents/sdlc_agent.py`. A `SDLCState` is created (`backend/app/agents/sdlc_state.py`).
3. The `StateGraph` is compiled once per process. `thread_id` scopes checkpointing (production: `AsyncPostgresSaver`; tests: in-memory SQLite saver).
4. Sequential nodes run: `discovery → planning → architecture → implementation → testing → security → review → deployment`.
5. After `architecture`, `security`, `deployment` the conditional edge routes to `approval_gate`, which calls `interrupt()` and publishes `APPROVAL_REQUESTED` on the bus.
6. Approvers see the gate in the UI; their decision is written via `backend/app/api/v1/{architecture,ideation}/approvals.py`. The orchestrator resumes with `SDLCRunManager.resume_run`.
7. Every LLM call goes through `backend/app/services/litellm_client.py:litellm_client` (Rule 1). Pre-call admission is enforced by `workflow_budget_service`; post-call cost is recorded in `cost_ledger`.
8. Every event the run emits is captured by the audit decorator + `AuditService` and persists to the append-only `audit_log` table.

### WebSocket terminal session

1. The browser opens `ws://…/ws/terminal`. `backend/app/api/ws/terminal.py` accepts the connection and spawns a `pty` rooted at `terminal_workspace_root` (from `settings.terminal_workspace_root`).
2. Every byte is streamed to the browser via xterm.js and audited by the terminal-cost module (`backend/app/services/terminal/`).
3. `backend/app/api/ws/ideation.py` and `runs.py` expose similar channels for real-time ideation signals and run progress.

**State Management:**
- Frontend: Zustand store (`apps/forge/lib/store.ts`) for ephemeral UI state (terminal sessions, onboarding wizard). TanStack Query handles server cache. All persistent state lives on the backend.
- Backend: each request runs inside a single SQLAlchemy session; cross-process state flows through the Redis-backed event bus; long-running orchestration state is persisted by LangGraph checkpointer.

## Key Abstractions

**ForgeCommand (white-label verb):**
- Purpose: the only customer-visible name for an internal engine command.
- Examples: `backend/app/services/forge_commands.py` (`FORGE_COMMAND_MAP`, 60+ entries across 13 categories), mirrored on the frontend in `apps/forge/lib/forge-commands.ts`.
- Pattern: dataclass with `forge_cmd`, `internal_cmd`, `category`, `description`, `tier ∈ {user, admin, system}`, `requires_approval`.

**Event (typed bus message):**
- Purpose: canonical cross-service message (DL-027, Rule 2).
- Examples: `backend/app/services/event_bus.py` (`Event`, `EventType` enum, `EventBus`).
- Pattern: dataclass with `{event_id, event_type, occurred_at, tenant_id, project_id, actor_id, payload}`; one Redis channel per `EventType.value`.

**SDLCState (LangGraph state):**
- Purpose: the typed payload that flows through the supervisor graph.
- Examples: `backend/app/agents/sdlc_state.py`.
- Pattern: Pydantic v2 `BaseModel`; serializable for checkpointing; `phase_history` is an append-only audit trail; `pending_approval` drives conditional routing.

**AuthenticatedPrincipal (security principal):**
- Purpose: the resolved identity used by every endpoint.
- Examples: `backend/app/core/security.py`.
- Pattern: frozen dataclass with `user_id`, `email`, `tenant_id`, `project_id`, `roles`, `raw_claims`.

**Connector (tenant-scoped integration):**
- Purpose: per-tenant MCP server registration.
- Examples: `backend/app/db/models/connector.py`, `backend/app/services/connector_manager.py`, `backend/app/services/connector_states.py`.
- Pattern: state machine (`ConnectorState`) drives `PENDING → ACTIVE → STALE → FAILED`; each transition records a `ConnectorSyncHistory` row.

**KGNode / KGEdge (knowledge graph primitives):**
- Purpose: project-intelligence graph storage; backed by Apache AGE with a pgvector fallback for tests.
- Examples: `backend/app/services/knowledge_graph.py`.
- Pattern: ORM models over `kg_nodes` and `kg_edges`; every node carries `tenant_id`, `project_id`, `embedding`, `freshness_at`.

## Entry Points

**FastAPI backend:**
- Location: `backend/app/main.py`
- Triggers: `uvicorn app.main:app` (or the `backend/Dockerfile`).
- Responsibilities: lifespan wires logging + telemetry + Redis bus + scheduler + alerts + connector consumers; mounts `/api/v1/*` REST and root-level WebSocket routes.

**Next.js frontend:**
- Location: `apps/forge/app/layout.tsx` (root layout) and `apps/forge/app/page.tsx` (root redirect).
- Triggers: `pnpm dev` in `apps/forge`, or the `apps/forge/Dockerfile`.
- Responsibilities: serves every persona shell, applies the persona middleware, and proxies API calls via `/api/proxy/[...path]`.

**Persona API route:**
- Location: `apps/forge/app/api/persona/route.ts`
- Triggers: the `/persona` page (sets the cookie).
- Responsibilities: writes `forge.persona` cookie.

**Run lifecycle API route:**
- Location: `apps/forge/app/api/runs/[id]/[verb]/route.ts`
- Triggers: UI buttons for pause/resume/cancel.
- Responsibilities: forwards a run control verb to the backend.

**Catch-all proxy:**
- Location: `apps/forge/app/api/proxy/[...path]/route.ts`
- Triggers: any browser fetch to `/api/proxy/...`.
- Responsibilities: forwards to the orchestrator (dev stub or `FORA_FORGE_API_URL`), injects `X-Forge-Tenant-Id`, pass-through persona cookie.

**GSD wrapper:**
- Location: `backend/app/agents/tools/gsd_wrapper.py`
- Triggers: `forge-*` command execution.
- Responsibilities: opaque bridge to the `gsd-core` engine.

**MCP servers:**
- Location: `mcp-servers/<vendor>/bin/<vendor>-server` (one per integration).
- Triggers: Connector Center `install/rotate/test` verbs.
- Responsibilities: tool bridge to external SaaS / cloud systems.

## Architectural Constraints

- **Threading:** FastAPI runs async on a single event loop. Synchronous DB calls are wrapped via `run_in_threadpool` only when needed; long-running I/O (LLM, MCP) uses `httpx.AsyncClient` with explicit budgets. The scheduler (`backend/app/services/scheduler/`) is in-process; cron-style jobs share the event loop.
- **Global state:** Module-level singletons are intentionally narrow: `event_bus.bus` (`backend/app/services/event_bus.py`), `rbac` (`backend/app/services/rbac.py`), `policy_engine` (`backend/app/services/policy_engine.py`), `cost_ledger` (`backend/app/services/cost_ledger.py`), `freshness_ledger`, `knowledge_graph` service. The DB engine is a lazy singleton in `backend/app/db/session.py`.
- **Circular imports:** Avoided by lazy imports inside `lifespan` (Jira ingestion, Jira commenters, scheduler, alerts are imported inside try/except blocks in `main.py`). Cross-package types live in `schemas/` and `db/models/__init__.py` to keep imports flat.
- **Provider lock-in (Rule 1):** The only file allowed to talk to a model provider is `backend/app/services/litellm_client.py`. No module may `import openai`, `anthropic_sdk`, `google.generativeai`, etc.
- **Tenant scoping (Rule 2):** Every ORM model row carries `tenant_id`; project-scoped rows also carry `project_id`. Every event published on the bus carries `tenant_id`. Every audit record carries `tenant_id`. RLS is enabled at the DB level.
- **White-label surface (Rule 4 + ADR-004):** Every customer-visible command is `forge-*`. Internal names are opaque `gsd:<area>:<verb>` and must not appear in UI, logs, or API responses.
- **Audit (Rule 6):** Every API endpoint is decorated with `@audit(action=..., target_type=...)`; the `audit_log` table is append-only.
- **Observability (Rule 7):** Every layer emits OpenTelemetry traces + metrics + logs; the OTLP endpoint is configured via `settings.otlp_endpoint`.
- **No hardcoded vendor (Rule 8):** Connectors are pluggable via `ConnectorManager`; model providers are pluggable via `model_provider_registry`; integration targets are pluggable via `marketplace`.

## Anti-Patterns

### Direct LLM SDK import (FORBIDDEN)

**What happens:** Adding `import openai` or `from anthropic import Anthropic` inside a service or agent node to skip the proxy.
**Why it's wrong:** Violates Rule 1; bypasses cost attribution, audit trail, and the workflow budget guard; leaks tenant context.
**Do this instead:** Go through `backend/app/services/litellm_client.py:litellm_client`. Only that module is permitted to talk to the LiteLLM Proxy.

### Customer-visible "GSD" reference

**What happens:** Logging `gsd:phase:discovery` from an endpoint or surfacing `gsd-core` in a UI string.
**Why it's wrong:** Violates DL-024 / ADR-004 (white-label); customers must never see the engine name.
**Do this instead:** Resolve the command via `FORGE_COMMAND_MAP` (`backend/app/services/forge_commands.py`) and only use the `forge-*` name in user-facing strings, log messages, and audit records.

### Event/row without `tenant_id`

**What happens:** Defining a new event type or ORM model that omits `tenant_id` (or leaves `project_id` optional for project-scoped rows).
**Why it's wrong:** Violates Rule 2; breaks RLS; produces un-billable, un-auditable records.
**Do this instead:** Add `tenant_id` (UUID, indexed) to every model in `backend/app/db/models/`. For every new `EventType`, require `tenant_id` and `project_id` in `backend/app/services/event_bus.py:publish`.

### Auto-advance across Architecture / Security / Deployment

**What happens:** Letting a workflow mark an ADR, Security Report, or Deployment Plan final without an explicit human decision.
**Why it's wrong:** Violates Rule 3.
**Do this instead:** Place an `ApprovalGateNode` (`backend/app/agents/approval_gate.py`) after the phase and route through it before the next phase. Use `backend/app/api/v1/architecture/approvals.py` or `backend/app/api/v1/approvals.py` as the surface for the human decision.

### Free-form agent output

**What happens:** Returning a chat string from a node instead of a typed artifact.
**Why it's wrong:** Violates Rule 4 (typed artifacts: ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan).
**Do this instead:** Define a Pydantic schema in `backend/app/schemas/` and have the node return it; persist via `backend/app/services/artifact_registry.py`.

### Layer bleed (project intelligence into organization knowledge)

**What happens:** Storing a per-project service in `standards`/`templates`/`policies` tables (the Organization Knowledge surface) or vice versa.
**Why it's wrong:** Violates Rule 5.
**Do this instead:** Put shared artefacts in the `Organization Knowledge` tables; put project-scoped artefacts in the `Project Intelligence` graph (kg_nodes/kg_edges via `backend/app/services/knowledge_graph.py`).

## Error Handling

**Strategy:** Handler-level isolation plus a single audit fan-out. Errors in event handlers must not break the bus (`backend/app/services/event_bus.py:_dispatch` swallows and logs); errors in services bubble up as typed exceptions and are caught by the FastAPI exception handlers + the audit decorator.

**Patterns:**
- **Endpoint audit wrap:** `@audit(action=..., target_type=...)` (`backend/app/core/audit.py`) logs every call with outcome + duration regardless of success.
- **RBAC + policy decision:** `require_permission(...)` returns 403 with a typed reason (`backend/app/api/deps.py`, `backend/app/services/rbac.py`).
- **Pre-call budget guard:** `workflow_budget_service.evaluate(...)` raises `BudgetExceeded` before the LiteLLM proxy is invoked (`backend/app/services/litellm_client.py`).
- **Idempotency:** `backend/app/core/idempotency.py` rejects duplicate writes with the same `Idempotency-Key`.
- **Connector reachability:** `TestResult` (`backend/app/services/connector_manager.py`) records latency and detail without raising on a single failure.
- **Event handler isolation:** `EventBus._dispatch` catches and logs but never propagates handler errors.
- **Layered failures during startup:** `main.py:lifespan` wraps each subsystem init in try/except so a missing Jira connector does not prevent the FastAPI app from starting.

## Cross-Cutting Concerns

**Logging:** `backend/app/core/logging.py` configures structured JSON logging at `settings.log_level`; every service uses `get_logger(__name__)` and emits `event.key value` style fields.

**Validation:** Pydantic v2 schemas (`backend/app/schemas/`) at every API boundary; pydantic-settings for env (`backend/app/core/config.py`).

**Authentication:** Keycloak OIDC; JWT verified locally (`backend/app/core/security.py`). Dev bypass via `FORA_DEV_AUTH_BYPASS=1` returns a synthetic admin principal in the demo tenant — only acceptable for local dev.

**Authorization:** `forge:admin` / `tenant:admin` short-circuit (`backend/app/services/rbac.py`); everyone else is matched against the `forge.permissions` claim bundle.

**Multi-tenancy:** RLS at the DB level; session-level `app.tenant_id`/`app.project_id` set per request. Application code is expected to filter explicitly in addition (defence in depth).

**White-labeling:** Single source of truth: `backend/app/services/forge_commands.py` for the backend, `apps/forge/lib/forge-commands.ts` for the frontend. Internal names are opaque triples.

**Observability:** OpenTelemetry traces + metrics + logs from `backend/app/core/telemetry.py`; bus events published on every domain transition; LiteLLM virtual-key audit.

**Auditability:** Every endpoint wrapped with `@audit(...)`; every service call that mutates state calls `audit_service.record(...)`; `audit_log` is append-only.

---

*Architecture analysis: 2026-06-22*