# Product: Glossary

> **Status:** ✅ Canonical — every term an AI agent + human contributor needs
> **Doc owner:** Product team
> **Source of truth:** This document + every feature doc
> **Last updated:** 2026-06-30

---

## Purpose

Forge is built on a specific vocabulary. When someone says "the artifact registry", "an approval gate", or "a forge command", they mean a specific thing. This glossary is the **canonical reference** for every domain term — so AI agents don't hallucinate and humans onboard faster.

---

## A

### Acceptance Criteria
A list of conditions that a phase / story / task must satisfy to be considered "done." Part of the Architecture Center output.

### Actor
A user or system performing an action. Every audit event records `actor_id` (the principal). Can be a human (via OIDC) or a system (via service account).

### Adapter
A small function that bridges backend ↔ frontend schema divergences (e.g. status name mismatch, effort bucket heuristic). Lives in `apps/forge/lib/api/transformers/`.

### ADR (Architecture Decision Record)
A typed artifact produced by the Architecture Center. Captures a decision (what), context (why), consequences (tradeoffs), and alternatives considered. Stored as `Artifact(artifact_type="adr")`.

### Agent
A registered AI worker in the Agent Center. Examples: Claude Code, Codex, Gemini CLI. Each agent has a runtime, a model, and a config.

### Agent State
One of 6 values: `idle`, `thinking`, `executing`, `reviewing`, `completed`, `failed`. Drives the visual identity of every agent surface.

### Approval Gate
A mandatory human checkpoint before crossing a boundary. Three boundaries: Architecture, Security, Deployment. Enforced via LangGraph `interrupt()` + UI decision flow.

### Architecture Center
The 9-tab Center where ADRs, contracts, risk registers, and acceptance criteria live. 42 backend routes.

### Artifact
A typed Forge document (ADR, PRD, contract, risk register, validation report, etc.). All artifacts are Pydantic models with `extra="forbid"`. Persisted via ArtifactRegistry (append-only, content-hashed).

### Artifact Registry
The append-only store for typed artifacts. Backed by `artifacts` table + SHA-256 content hash. Every artifact write creates an audit event.

### Async Iteration
LangGraph sub-graphs run asynchronously. State is checkpointed so they can resume after interruption.

### Audit Event
A row in `audit_events` representing an action taken. Immutable (DB-level `_reject_mutation` listener). Carries `previous_hash` + `current_hash` for SHA-256 chain.

### Audit Trail
The full sequence of audit events for a tenant. Queryable by `tenant_id`, `target_type`, `target_id`, `actor_id`, `action`. Used for forensic investigation + compliance.

### Auth Guard
A higher-order component that redirects unauthenticated users to `/login`. Lives in `apps/forge/components/auth/AuthGuard.tsx`.

### Authenticated Principal
The typed representation of the calling user. Carries `actor_id`, `tenant_id`, `project_id`, `scopes`, `email`. Injected via `Principal = Annotated[AuthenticatedPrincipal, Depends(get_current_principal)]`.

---

## B

### Bento Grid
The Dashboard layout. 12-column grid with KPI strip + chart widgets in rows. `max-w-[1600px]`.

### Boundary (Architecture / Security / Deployment)
The 3 mandatory approval gates per R3. AI proposes; humans approve.

### Burn Rate
LLM cost per hour. Computed via `get_burn_rate(tenant_id, since, until)` → USD/hour. Surfaces in CostTracker.

---

## C

### Center
A top-level navigation destination (Agent, Connector, Knowledge, etc.). 12 Centers.

### Command (forge-*)
A typed instruction that an agent can execute. 69 commands in `packages/forge-core/commands/forge/` + 6 in `forge-pi` + 6 in `forge-browser` = 81 total. UI surfaces them via ⌘K palette.

### Command Palette
The `⌘K` UI. Mounts globally in `ShellChrome`. Searches nav + forge commands + recent items.

### Connector
An integration with an external system (Jira, GitHub, Confluence, Figma, Slack, SonarQube, AWS). 12 ConnectorTypes. OAuth + Fernet-encrypted credentials.

### Connector Picker
A UI to select from configured connectors. Used by Co-pilot tools + workflows.

### Cost Attribution
Per-call cost tracking. LiteLLM writes to `litellm_call_records` + `cost_ledger`. Per-tenant, per-project, per-feature breakdown.

### Cost Tracker
A sidebar widget showing today's spend. Lives in `ShellChrome`.

### Co-pilot
The conversational AI assistant (`⌘J`). 11 V1 tools + budget enforcement + streaming responses.

### Cross-Tenant Leak
A security incident where one tenant's data is exposed to another. Returns 404 (not 403) on cross-tenant reads to prevent enumeration.

### Cursor (pagination)
An opaque string used in cursor-based pagination. Avoids issues with offset-based pagination when data changes mid-stream.

### Custom Hook
A TanStack Query hook that wraps a fetcher with caching + invalidation. Located in `apps/forge/lib/hooks/`.

---

## D

### DAG (Directed Acyclic Graph)
The structure of a workflow. Nodes connected by directed edges; no cycles.

### Decision (Approval)
A typed event: `Literal["approve", "reject"]` with `reason`, `decided_by`, `decided_at`. Captured in `approvals` table + audit.

### Demo Banner (Plan G)
A global banner that surfaces demo seed status (drift detection, applied status). Lives in `ShellChrome`.

### Demo Loader (Plan G)
A polling hook that waits for a seed to be applied. Used by onboarding flow.

### Demo Tenant
The default tenant for development: `acme-corp` slug, with demo data seeded via `backend/scripts/seed_*.py`.

### Drift
When the actual state diverges from the declared state. 4 types: `none`, `checksum`, `row_count`, `unknown`. Surfaced in Seed Management.

### Dual-Write Pattern
The pattern of writing to both ArtifactRegistry (queryability) and AuditEvent (audit trail). Used by Validator (F-502) + StandardsAttestation (F-308).

---

## E

### Edge (Workflow)
A directed connection between two nodes. Can have a condition (e.g. `if success: ...`).

### EdgeKind
A typed connection between KG nodes (knows, depends-on, calls, etc.). 6 EdgeKinds.

### Elicitation
A pattern where the orchestrator pauses and asks the human for input. Used at approval gates.

### Embargo
A period during which data is hidden (e.g. cost data delayed by 24h for privacy).

### Endpoint
A single URL in the API. ~280 endpoints documented in `/docs/reference/api-catalog.md`.

### Error Boundary
A React component that catches render errors and shows a fallback. Lives at `error.tsx` per route.

### EventBus
A Redis-backed pub/sub used for inter-service communication. Located in `app/services/event_bus.py`.

---

## F

### F-###
A feature number. References specific feature tickets (e.g. F-501 = Code Validator, F-601 = Refactor Agent, F-805 = Seed API, F-829i = Compliance feed).

### Facet
A typed filter dimension on a list (e.g. `status: "running"`).

### Faceted Search
A search UI that lets users filter on multiple facets (status, date range, owner, etc.).

### Fallback URL
The URL to redirect to after OIDC login if the original target is unsafe (cross-origin, etc.). 3 return URL shapes: `pathname`, `search`, `hash`.

### Feature (in permissions)
A scope prefix for virtual keys (`forge_validator_*`, `forge_copilot_*`). Used for cost attribution + rate limiting.

### Fernet Envelope
The encryption envelope for secrets at rest. Symmetric encryption with per-tenant key derivation from JWT_SECRET.

### ForgeBrowser
The visual automation package. Powers screenshots, a11y audits, UAT, the QA Agent, the Canary Agent.

### ForgeCommand
The 69 canonical `forge-*` commands in `packages/forge-core/commands/forge/`. Validated at import time via `^forge-[a-z][a-z0-9-]*$` regex.

### ForgeCore
The canonical skills/agents/commands package (R9). Auto-discovered by UI.

### ForgePi
The product intelligence package (R10). Codebase scanning, KG construction, idea scoring, PRD generation.

### ForgeTraceId
A trace identifier propagated across the system. Used by F-829 spec for cross-system forensic queries.

### Fragment
A pre-rendered HTML chunk sent from server to client. Used by Next.js streaming.

### Freshness Ledger
A small audit log tracking when data was last refreshed. Drives staleness indicators.

---

## G

### Gating
The pattern where the orchestrator pauses for human approval. Enforced via LangGraph `interrupt()`.

### Gate (Approval)
A typed checkpoint at Architecture/Security/Deployment boundaries. Returns `Literal["approve", "reject"]`.

### Global Hotkey
A keyboard shortcut that works everywhere. Three: `⌘K` (Command palette), `⌘J` (Co-pilot), `⌘\` (Workspace switcher).

### Golden Path
The recommended workflow for a common task. Documented in feature README + onboarding flow.

### GSD (gsd:*)
The internal command namespace used by the underlying engine. Opaque to users per DL-024. Surface as `forge-*`.

### Guardrail
A LiteLLM-enforced policy: PII detection, prompt injection blocking, content filtering, secrets detection, cost caps. Surfaced in Compliance feed.

---

## H

### Hash Chain
A SHA-256 chain across consecutive audit events. `current_hash = sha256(id + payload + previous_hash)`. Tamper detection.

### Headless Component
A component that renders no UI itself but provides behavior (via context or hooks). Examples: `TooltipProvider`, `TooltipTrigger`.

### HITL (Human-in-the-Loop)
A pattern where the agent pauses for human input. Enforced via approval gates.

### Hook (React)
A function that uses React state. Forge heavily uses TanStack Query (`useQuery`, `useMutation`) + custom hooks (`useMigrationPlans`, `useSeedStatus`).

---

## I

### Idempotency-Key
A `crypto.randomUUID()` header on POST/PUT/PATCH that makes retries safe. Backend caches responses in Redis keyed by (tenant_id, route, key).

### IDE
Integrated Development Environment. Forge integrates with VS Code, JetBrains, and others via MCP.

### Idempotent
A property where repeated execution produces the same result. Critical for network retry safety.

### Inbox
A user's pending work (stories to review, approvals to decide, alerts to triage).

### Ingest
The process of importing external data (repos, docs, tickets) into the Knowledge Graph. Done via `forge-pi scan` command.

### Integration Test
A test that exercises a real DB + Redis (with LiteLLM stubbed). The middle layer of the test pyramid.

### Intent
A user-stated goal. Co-pilot parses intents to invoke V1 tools.

### Interceptor
Middleware that intercepts HTTP requests (e.g. for auth, persona propagation, idempotency key).

### Iteration
A single pass through the SDLC loop. One iteration = one milestone.

---

## J

### JWT (JSON Web Token)
The token format used for OIDC auth. Carries `forge.tenant`, `actor_id`, `email`, `scopes` claims.

### Jira
The most common ticketing system connected via Connector Center. Connector Type #1.

### Job (Background)
A scheduled or on-demand async task. Runs in the orchestrator's job queue.

---

## K

### Keycloak
The OIDC identity provider. Forge uses Keycloak realms for tenant separation.

### Knowledge Graph (KG)
The Apache AGE + pgvector store for Project Intelligence. 14 NodeKinds + 6 EdgeKinds.

### KPI Card
A dashboard widget showing a single number + delta + sparkline.

---

## L

### LangGraph
The orchestration framework. Each sub-graph (SDLC, Refactor, Validator) is a `StateGraph` with nodes + edges.

### Lead Time
The time from code commit to production deploy. Tracked in Analytics.

### Lifecycle (Phase)
A single phase of a workflow node (e.g. `running`, `awaiting_approval`, `in_progress`, `complete`).

### Light Mode
The companion theme (not default). Switchable via ThemeToggle in topbar.

### List Endpoint
A route that returns `Page[T]` — items + total + page + has_more.

### LiteLLM Proxy
The AI gateway that Forge proxies all LLM traffic through. Provides cost governance, audit, rate limiting, guardrails.

### Lockstep Rectangle
A diagram in each feature doc showing which files must stay in sync when that feature changes.

---

## M

### Manifest (Seed)
A YAML/JSON file declaring a seed's data files, dependencies, expected row counts, and production safety.

### MCP (Model Context Protocol)
A standard for connecting LLMs to tools. Forge ships MCP servers for major external systems.

### Migration Plan
A typed artifact produced by the Refactor Agent. Contains phased plan + risk register + effort estimate.

### Milestone
A user-facing grouping of stories. Sprint = timeboxed; Milestone = goal-bounded.

### Mirror (Frontend)
The TypeScript shape that mirrors a backend Pydantic schema. Lives in `apps/forge/lib/api.ts`. Always `readonly`.

### Mock
A test double that replaces a real dependency. LiteLLM is stubbed in all tests (no real LLM calls).

### Multi-Tenant
The property of serving many orgs from one deployment. Enforced via RLS + tenant-scoped queries.

---

## N

### Namespace
A logical grouping (e.g. `forge:litellm:usage:<tenant_id>:<since>:<until>` for Redis cache keys).

### Next.js
The React framework Forge's frontend uses (App Router, Server Components, streaming).

### NodeKind
A typed entity in the Knowledge Graph (Repository, Service, ADR, Task, etc.). 14 NodeKinds.

### Notification
A real-time alert surfaced via toast or banner. Examples: drift detected, cost cap hit, approval needed.

---

## O

### OAuth Flow
The redirect-based authorization flow used by Connector Center. 3-legged (auth → callback → token).

### Optimistic Update
A UI pattern where the local state updates immediately, then rolls back on server error. Used by Stories (canonical example).

### Orchestrator
The service that runs LangGraph workflows. Hosts the SDLC supervisor + sub-graphs.

### Org Knowledge
The curated knowledge layer (standards, templates, policies). Shared across projects within a tenant. Stored as relational tables.

### Outbox Pattern
A pattern for reliable async processing (write to DB + outbox in same transaction, separate worker drains outbox).

---

## P

### P95 / P99
The 95th / 99th percentile latency. Used for Approval Latency chart in Dashboard.

### Page (Schema)
A Pydantic envelope for paginated list responses: `items`, `total`, `page`, `page_size`, `has_more`.

### Pattern
A recurring code shape that solves a recurring problem. Documented in `/docs/standards/`.

### Persona
One of 4 user archetypes (PM, Eng Lead, Steward, CTO). Context, not auth.

### Pipeline
A series of workflow phases. Used for code review pipeline, validation pipeline, etc.

### Plan Tier
The pricing tier for a tenant. Determines features available + LLM budget.

### Playbook
A documentation artifact for executing a process. Stored in Org Knowledge.

### Polling Cadence
The interval at which the frontend re-fetches data. Matches backend cache TTL.

### PostGIS
A Postgres extension for geospatial queries. Not used by Forge currently but available.

### Pydantic
The data validation library. v2 with `extra="forbid"` is canonical for Forge.

### Push (to Jira)
The F-213 connector that creates synthetic epics + story keys from a Migration Plan.

---

## Q

### ⌘K / ⌘J / ⌘\
The three global hotkeys. Mounted in `ShellProvider`. Visible only on Mac (`navigator.platform` regex).

---

## R

### RLS (Row-Level Security)
Postgres feature that enforces row visibility per `current_setting('app.tenant_id')`. Enabled per-table with policies.

### RBAC (Role-Based Access Control)
The authorization system. `require_permission(perm)` dependency blocks routes.

### RBAC Scope
A permission string like `seeds:view`, `seeds:manage`, `seeds:reset:all`. Granular per-action.

### React Flow
The library for rendering workflow DAGs (nodes + edges). Used by Workflows feature.

### React Hook Form
The form library. Used by Settings + Onboarding.

### Recharts
The chart library. Used by Dashboard + Analytics.

### Reducer
A pure function `(state, action) → state`. Used by TanStack Query + Zustand.

### Refactor Agent (F-601)
The 5-node LangGraph sub-graph that produces typed Migration Plans.

### Refresh Token
A long-lived JWT used to obtain new access tokens. Stored in localStorage.

### Reload (HMR)
Hot Module Replacement. Vite/Next.js auto-reloads on file change.

### Repository (KG)
A NodeKind representing a source code repo. Ingested by `forge-pi scan`.

### ResolveSelected
The pattern of resolving a selected ID to a fetched entity. Used in Architecture Center (9 tabs).

### Retention
The duration data is kept before archival. Audit: 7 years. Logs: 90 days.

### Risk Register
A typed artifact listing risks + severity + mitigation + owner. Part of Architecture Center.

### Roadmap
The high-level plan of upcoming work. Surfaced in PM Dashboard.

### Route Group
A Next.js feature for organizing routes without affecting URLs. e.g. `(auth)/login`.

### Run
An execution instance of a workflow. Two-run-model: SDLC runs (legacy) + workflow runs (current).

---

## S

### SaaS
Software as a Service. Forge is multi-tenant SaaS.

### Scaffolding
Boilerplate code generated for new features (e.g. `pnpm scaffold feature <name>`).

### Scan
The process of ingesting external data into the KG. Done via `forge-pi scan`.

### Schema (Database)
The structure of a database (tables, columns, indexes, RLS policies).

### Schema (Pydantic)
A data validation model. Extends `ForgeBaseModel`. Wire JSON is snake_case.

### Schema Drift
When the actual DB schema differs from the declared schema. Caught by drift detection.

### Schema Version
A string embedded in typed artifacts (`schema_version: "1.0.0"`). Enables safe migrations.

### Scope
See **RBAC Scope**.

### SDLC Supervisor
The main LangGraph state machine. Walks an agent through Discovery → Plan → Architecture → Build → Test → Review → Deploy.

### Seed
Idempotent demo data applied to a fresh tenant. 8 backend routes + Drift Detection.

### Server Component
A Next.js component rendered on the server. Used for permission gates + SEO.

### Service Worker
A background script for offline support + push notifications.

### Settings
A 21-tab Center for tenant + project configuration. Currently 4 routes shipped + 17 planned.

### Shadow Tree
A virtual DOM used by React for reconciliation.

### Shard
A horizontal partition of a database table. Forge uses tenant-scoped RLS instead of sharding.

### Sheet
A side-drawer UI component (shadcn/ui primitive).

### Sidebar
The persistent left navigation. 256px expanded, 64px collapsed. Houses WorkspaceSwitcher + NavList + TenantStatusFooter.

### Sign Off
A typed approval event. Surfaces in Architecture Center approval flow.

### Skeleton
A loading placeholder with `.shimmer` animation. Used instead of spinners.

### SLA
Service Level Agreement. Defines uptime, latency, and support response targets.

### Slack Connector
A Connector that posts to Slack channels (notifications + bot interactions).

### Snippet
A small, reusable code fragment. Surfaced via ⌘K palette.

### Soft Delete
A delete pattern that marks rows as deleted (`deleted_at`, `deleted_by`) instead of removing them. Recoverable.

### Sonner
The toast library used for transient notifications.

### Span
A unit of work in OpenTelemetry tracing. Created via `tracer.start_as_current_span("name")`.

### Sprint
A timeboxed iteration (typically 1-2 weeks) containing a set of stories.

### SSOT (Single Source of Truth)
The principle that every fact lives in exactly one place. Examples: Pydantic schemas, design tokens, CLAUDE.md.

### Stakeholder
Anyone affected by a decision (PM, eng lead, executive, customer).

### Stale (Data)
When data hasn't been refreshed in a while. Surfaced via `.stale-pulse` animation.

### Steward
The persona responsible for Org Knowledge, standards, compliance, governance.

### Stripe
The billing provider. Stripe webhook events update tenant plan + budget.

### Story
A unit of work for an engineer. Has a status (Draft / In Progress / Review / Done).

### Sub-Graph
A LangGraph graph that runs inside a parent graph. Examples: Refactor Agent, Code Validator.

### Sweep
A cleanup job (e.g. archiving stale stories, purging soft-deleted rows).

---

## T

### Tag
A free-form label on stories, runs, or KG nodes.

### Tailwind
The CSS framework. Bound to design tokens via `tailwind.config.ts`.

### Task
The smallest unit of work (within a Story). Tracked in Kanban.

### Telemetry
OpenTelemetry tracing + metrics + logs. Mandatory per R7.

### Tenant
An organization in Forge. Identified by UUID + slug. Carries plan + settings.

### TenantScopedModel
A SQLAlchemy mixin adding `tenant_id` + `project_id`. Requires RLS policy in migration.

### TenantScopedSession
A SQLAlchemy session that sets `app.tenant_id` GUC per request, enabling RLS.

### Test Pyramid
75% unit + 20% integration + 5% E2E. See `/docs/standards/testing.md`.

### Theme
Dark (primary) or Light (companion). Stored in localStorage + CSS class on `<html>`.

### ThemeToggle
A button in the Topbar to switch dark/light.

### Tier (Plan)
The pricing tier (Free / Starter / Pro / Enterprise). Determines budget + features.

### Timeline
A visual representation of events over time (Audit Timeline, Agent Timeline).

### Token (JWT)
The bearer token used for API auth. Short-lived (15 min default). Refresh via refresh_token.

### Token (LLM)
A unit of text processed by an LLM. ~4 chars per token. Cost attributed per token.

### Tool (V1)
A function the Co-pilot can invoke. 11 V1 tools. Each has typed schema + budget.

### Topbar
The persistent top navigation. Houses breadcrumbs + persona switcher + theme toggle + cost tracker.

### Trace
A directed acyclic graph of spans. Created per request via OpenTelemetry.

### Tree (Component)
The React component tree. Renders top-down; errors propagate up to ErrorBoundary.

### Trigger (Node)
A workflow node that starts a run. 1 of 4 node types.

### TTL
Time-to-live. Cache expiration. 60s for hot data, 24h for idempotency.

### Type-Safety
The property that types catch errors at compile time. Forge uses TypeScript + Pydantic for this.

### Typed Artifact
A Pydantic model with `extra="forbid"` that's the canonical output of an LLM call (R4).

---

## U

### UI First Principle
The principle that every shipped capability must be visible in the UI. If you can't navigate to it, it doesn't exist.

### Unit Test
A test that exercises a single function in isolation. 75% of test pyramid.

### Unscoped Endpoint
A route that doesn't take `project_id` (e.g. `/api/v1/tenants/{id}/settings`). Rare.

### Update (Soft)
A change that increments `updated_at` via `onupdate=...`. Most mutations are updates, not hard deletes.

### USW
Universal Service Worker. A future Forge service for offline + push.

---

## V

### V1 Tool
A first-version tool that Co-pilot can invoke. 11 tools: query_knowledge_graph, create_story, list_workflows, etc.

### Validation
The process of running the Code Validator (4 scanners) on a codebase. Produces a `ValidationReport`.

### ValidationReport
A typed artifact with findings + summary + decision (PASS/FAIL).

### Vector Search
Semantic search via embeddings. Used by Knowledge Center for similar-node lookup.

### Versioning
SemVer (`MAJOR.MINOR.PATCH`). MAJOR = breaking, MINOR = feature, PATCH = bug fix.

### Virtual Key
A per-tenant, per-feature LiteLLM key. Fingerprint only stored (never the raw value after creation).

### Vitest
The frontend test runner. Fast + ESM-native.

---

## W

### WORM (Write Once Read Many)
A storage pattern where data is written once and read many times. Audit log uses WORM.

### WebSocket
A persistent connection for two-way streaming. Used by Terminal + Co-pilot.

### Widget
A reusable Dashboard component (KPI card, chart, table).

### Workflow
A DAG of nodes that runs as a unit. 4 node types: trigger, command, approval, script.

### WorkflowRun
A specific execution of a workflow. Has phases, events, status, cost.

---

## X / Y / Z

### X-Forge-Persona
The HTTP header propagated by the proxy to indicate the active persona. Set from `forge.persona` cookie.

### X-Forge-Tenant
The HTTP header propagated by the proxy to indicate the active tenant. Set from JWT `forge.tenant` claim.

### YAML
A configuration format. Used for seed manifests, LiteLLM config, GitHub Actions.

### Yarn
A package manager. Not used by Forge (pnpm preferred).

### Zero-Trust
The security model where no request is trusted by default. Every request carries auth + tenant + persona.

### Zustand
A lightweight state management library. Used for auth store + persona store.

---

## Where to go next

- [Vision](./vision.md) — Mission + the 18 rules
- [Personas](./personas.md) — 4 personas + permissions
- [Architecture summary](./architecture-summary.md) — High-level diagram
- [Standards](../standards/architecture-rules.md) — The 18 rules
- [Features](../features/README.md) — 26 feature docs