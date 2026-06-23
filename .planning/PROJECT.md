# Forge AI v2.0

## What This Is

Forge is an **Agent Operating System** — a web platform that orchestrates AI agents, organizational knowledge, governance gates, and delivery workflows across the SDLC. It is not a single SDLC agent; it is the layer that sits between LLM providers, MCP-connected tools (Jira, GitHub, Confluence, Figma, AWS, …), and the teams that ship software. Forge turns isolated model calls into typed artifacts (ADRs, epics, stories, deployments) bounded by human approval gates and traced through an auditable knowledge graph.

The v2.0 platform is currently in build (PRD v2 implementation in flight). This milestone targets **pilot readiness**: one tenant, one end-to-end SDLC workflow, all capabilities visual.

## Core Value

Every shipped capability must be **visible, governed, and traceable** end-to-end — from requirement → ADR → task → code → test → deployment — through a unified React Flow UI, with multi-tenant isolation, auditability, and human approval gates as constitutional invariants, not retrofit features.

If everything else fails, this cannot: a Pilot user can connect one repo + one Jira + one Claude provider, kick off the SDLC supervisor, and watch every artifact land on a node graph with approvals and audit trails in the right places.

## Business Context

- **Customer**: Internal pilot (dogfooding by the Forge team itself) — first external pilot only after v2.0 ships.
- **Revenue model**: Multi-tenant SaaS platform (deferred to post-pilot); near-term is internal-platform investment.
- **Success metric**: One tenant runs one complete ingestion → ideation → architecture → implementation → testing → security → deployment cycle end-to-end with all artifacts visualized and approved at gates.
- **Strategy notes**: `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/` is the canonical PRD; pilot operations runbook lives in `docs/operations/pilot-p0-pre-pilot.md` → `pilot-p4-expansion.md`.

## Requirements

### Validated

Inferred from the live codebase (`.planning/codebase/`, `apps/`, `backend/`, `docs/`) and the locked constitutional rules in `.claude/CLAUDE.md`. Each represents a capability that is *built and demonstrable* in v2.0 code as of 2026-06-22.

- ✓ **V2-STACK**: TypeScript 5.9 (strict + `noUncheckedIndexedAccess`) + Python 3.13 (asyncio) running on pnpm 9.15 monorepo with Next.js 15 / React 19 / TanStack Query / Zustand / React Flow / Shadcn/UI frontend and FastAPI / Pydantic v2 / SQLAlchemy 2 / LangGraph backend — `apps/forge/`, `backend/`, `packages/*`.
- ✓ **V2-LLM-ABSTRACTION**: All LLM ingress flows through `backend/app/services/litellm_client.py` (LiteLLM Proxy). No service imports OpenAI / Anthropic / Gemini SDKs directly (Rule 1).
- ✓ **V2-MULTITENANT-ORM**: Every SQLAlchemy model in `backend/app/db/models/` carries `tenant_id` + `project_id`; PostgreSQL RLS policies enforce scoping at the session layer (Rule 2).
- ✓ **V2-APPROVAL-GATES**: LangGraph HITL interrupts (`backend/app/agents/approval_gate.py`) gate every transition across Architecture / Security / Deployment boundaries (Rule 3).
- ✓ **V2-TYPED-ARTIFACTS**: Agent outputs are typed artifacts — `ADR`, `API Contract`, `Task Breakdown`, `Risk Register`, `Security Report`, `Deployment Plan` — surfaced as nodes in the knowledge graph, never free-form blobs (Rule 4).
- ✓ **V2-LAYER-ISOLATION**: Organization Knowledge (`kg_nodes` shared) is separated from Project Intelligence (`kg_nodes` project-scoped). Cross-tenant queries are rejected at the RLS layer (Rule 5).
- ✓ **V2-AUDIT-LOG**: Append-only `audit_log` table + `@audit(...)` decorator on every mutating endpoint + `audit_service.py` — captures `{agent, model, prompt, tool, cost, artifact, timestamp, result}` (Rule 6).
- ✓ **V2-OTEL**: OpenTelemetry auto-instrumentation (FastAPI, SQLAlchemy) + OTLP exporter wired through `backend/app/core/telemetry.py` (Rule 7).
- ✓ **V2-CONFIGURABLE**: Connector framework abstracts GitHub ↔ Bitbucket, Claude ↔ Codex, OpenAI ↔ Bedrock, Jira ↔ Linear via `mcp-servers/*` packages and the Forge Command Map (Rule 8).
- ✓ **V2-FORGE-COMMANDS**: White-label command mapping `forge-*` → `gsd:<area>:<verb>` in `backend/app/services/forge_commands.py` (60+ entries).
- ✓ **V2-EVENT-BUS**: Typed async event bus (`backend/app/services/event_bus.py`) on Redis Pub/Sub with `{tenant, project}` envelopes.
- ✓ **V2-MCP-ROUTER**: Shared `forge-ai/mcp-router` package (`packages/mcp-router`) with typed `McpRouter` port, discriminated `McpError`, per-server circuit breaker, tenant scope gate.
- ✓ **V2-CONNECTORS**: 13 MCP servers (jira, github, confluence, figma, slack, aws, azure-devops, clickup, databricks, kiro, sonarqube, zendesk, adobe-xd, arch-analyzer, secrets) — each via `@modelcontextprotocol/sdk ^1.0.4` over stdio.
- ✓ **V2-KG-SERVICE**: `knowledge_graph.py` writes `kg_nodes` / `kg_edges` to PostgreSQL with Apache AGE + pgvector fallback.
- ✓ **V2-RBAC-POLICY**: `forge:admin` short-circuit + JWT permission bundle + `PolicyEngine` in `backend/app/services/{rbac,policy_engine}.py`.
- ✓ **V2-IDEATION**: Ideation module (`backend/app/services/ideation/`) with ingest, idea analysis, idea intake, push-to-Jira workflows.
- ✓ **V2-TERMINAL-CENTER**: Browser-based terminal via `xterm.js` + `node-pty` (`apps/forge/app/terminal-center/`) with PTY session management.
- ✓ **V2-NEXTJS-MIDDLEWARE**: Persona + tenant injection in `apps/forge/middleware.ts`; catch-all API proxy in `apps/forge/app/api/proxy/[...path]/route.ts`.
- ✓ **V2-CI-DOCKER**: Docker Compose stack (`docker-compose.yml`) for local dev (pgvector/pg17, redis:7, keycloak:26, litellm-proxy, floci).

### Active

Hypotheses for the pilot-readiness milestone. Each must be testable end-to-end before it migrates to Validated.

- [ ] **PILOT-01**: One new tenant can be onboarded in **<30 minutes** by completing a single wizard (project name, primary connector, LLM provider, sample repo URL) without code changes.
- [ ] **PILOT-02**: The SDLC supervisor (LangGraph `sdlc_agent.py`) runs the full `discovery → planning → architecture → implementation → testing → security → review → deployment` chain on a sample project, with HITL interrupts only at the three constitutionally-required gates (Architecture, Security, Deployment).
- [ ] **PILOT-03**: Every artifact produced by an agent is queryable in the **Knowledge Graph visualization** (React Flow) — node per artifact, edge per relationship, color-coded by status (draft / approved / deployed).
- [ ] **PILOT-04**: Every artifact appears in the **Audit Timeline** with `{agent, model, prompt, tool, cost, artifact, timestamp, result}` from the `audit_log` table.
- [ ] **PILOT-05**: Approval workflow shows pending decisions on a dedicated **Approval Timeline** with one-click approve/reject from the UI, wired through `approval_workflow.py`.
- [ ] **PILOT-06**: Terminal Center streams live agent execution (logs, tool calls, file diffs) over WebSocket with replay capability.
- [ ] **PILOT-07**: Connectors can be added via the **Connector Marketplace** UI without restart; auth secrets resolved through `mcp-secrets` (AWS Secrets Manager).
- [ ] **PILOT-08**: OQ-005/006/007 are **LOCKED** via ADR-001 (AWS), ADR-002 (PostgreSQL 17 + Apache AGE + pgvector), ADR-003 (hybrid MDM + Steward priority) — accepted 2026-06-20. Pilot-cutover follow-ups (OQ-P1 deploy, OQ-P2 KG ceiling, OQ-P3 conflict volume) become **ADR-009/010/011** before Phase 2 plan commits.
- [ ] **PILOT-09**: The Constitution (`docs/architecture/CONSTITUTION.md` or similar) is rendered in the UI as a visible rulebook with a per-rule health indicator (green/yellow/red) showing real-time compliance status.
- [ ] **PILOT-10**: All 40+ REST routers under `/api/v1/*` have a corresponding **page or panel** in the UI — no backend-only capability.

### Out of Scope

Explicit boundaries for this milestone. Each carries its reason to prevent re-adding.

- **External pilot customer** — internal dogfooding first; bringing in an external pilot before v2.0 stabilizes risks both the pilot relationship and the platform. Defer to v2.0.x post-completion.
- **Mobile / native client** — web-first per CLAUDE.md `UI First Principle`; mobile deferred to v3+. (`Mobile app` is the canonical exclusion in PRD template.)
- **Real-time collaborative editing of artifacts** — out of scope for pilot; artifacts are versioned through the audit log, not CRDT-collaborative.
- **Public Connector Marketplace (third-party submissions)** — pilot ships a fixed catalog of 13 internal connectors plus `mcp-router` for self-hosted MCP servers; third-party marketplace is post-pilot.
- **Cross-tenant Organization Knowledge sharing** — Rule 5 keeps Org Knowledge tenant-isolated; the "shared" interpretation is *within* a tenant, not *across* tenants.
- **Marketing site / pricing page / sales tooling** — internal product only.
- **Direct LLM provider SDK usage outside `litellm_client.py`** — Rule 1 constitutional; even test fixtures must go through the abstraction layer.
- **`@fora/*` scope references in active code** — v2.0 naming convention (CLAUDE.md); `archive/paperclip/` is history only.

## Context

**Technical environment:**
- Multi-package monorepo (pnpm): `apps/forge` (Next.js 15 / React 19 / TS 5.9), `backend/` (FastAPI / Python 3.13), `packages/{mcp-router,connector-events,gsd-core-stub,gsd-pi-stub}` (shared libraries), `mcp-servers/*` (13 connector packages), `infra/` (Terraform), `scripts/`, `docs-site/` (Astro Starlight), `agents/` (LangGraph agent definitions), `tenants/` (multi-tenant seed data), `tests/`.
- Database: PostgreSQL 17 + Apache AGE (graph) + pgvector (embeddings) + RLS.
- Runtime services: Redis 7 Pub/Sub + cache, Keycloak 26 (OIDC), LiteLLM Proxy (multi-provider LLM gateway), Floci (task orchestration), AWS S3 (artifacts), MCP servers over stdio.
- Observability: OpenTelemetry → OTLP exporter; structured JSON logs via structlog.

**Prior work:**
- `docs/planning-artifacts/briefs/brief-forge-ai-2026-06-18/brief.md` — original product brief (45KB).
- `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md` — PRD v2 (86KB) + reconcile, addendum, four reviews (architecture, compliance, pilot-readiness, rubric), decision log.
- `docs/architecture/` — overview, decisions/, pillar1-* (alignment, gap analysis, execution plan, PRD amendments).
- `docs/operations/` — pilot operations runbook (p0 pre-pilot through p4 expansion) + incident response + oncall + rollback + success metrics.
- `docs/testing/` — test strategy + naming conventions + integration test docs + pen test report.
- `docs/status/` — daily status reports through 2026-06-21.

**Recent activity (git):** 5 commits with message "PRD v2 implementation" on top of `main`; working tree has uncommitted changes across `apps/forge/`, `backend/`, `.claude/`, and `docker-compose.yml` indicating v2.0 features still being wired.

**Known issues:**
- `docs/architecture/pillar1-prd-amendments.md` and `pillar1-execution-plan.md` are large (~60KB) and contain unresolved references to OQ-005/006/007.
- CLAUDE.md flags **Tailwind CSS 4** as the target version, but the installed version is **3.4.14** — a known version drift in stack declarations.
- Codebase map (`CONCERNS.md`, 290 lines) flags v2.0 violations and tech debt that should be triaged during pilot readiness.

## Constraints

- **Constitutional**: The 8 rules in `.claude/CLAUDE.md` are non-negotiable. They precede framework choice, library choice, and "we'll fix it later." Any phase plan that violates Rule N is rejected before execution.
- **Naming**: No `@fora/*` scope in v2.0 active code. `forge-*` (apps) or `@forge-ai/*` (packages) only. v2.0 history preserved in `archive/paperclip/`.
- **Multi-tenant by default**: Every query, artifact, workflow, KG node, audit row carries `tenant_id` + `project_id`. Never optional, never nullable.
- **Provider-agnostic**: No service may directly depend on OpenAI / Anthropic / Gemini SDKs. LLM traffic flows through `litellm_client.py` only.
- **Visualization-first**: Every capability must have a UI surface. No "API-only" capability survives pilot review.
- **Pilot scope**: One tenant. One workflow. Polish on the chosen path is more valuable than breadth across all paths.
- **Stack drift (Tailwind 4 vs 3.4.14)**: Must be reconciled in CLAUDE.md or stack reality before the roadmap is finalized, or downstream plan-phase will keep making the wrong assumption.
- **Open PRD blockers (OQ-005/006/007)**: **LOCKED** via ADR-001/002/003 (accepted 2026-06-20). Pilot-cutover follow-ups (OQ-P1/P2/P3 — deploy strategy, KG ceiling, conflict volume) become ADR-009/010/011 before Phase 2 plan commits.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| **v2.0 done = pilot readiness**, not feature completeness | Single-tenant pilot is the only honest test of the constitutional rules before scaling | — Pending |
| **UI First is constitutional**, not aesthetic | "All capabilities must be visualized" is the only way to verify auditability + approval gates in real time | — Pending |
| **LangGraph supervisor + HITL interrupts** at Architecture / Security / Deployment | Rule 3 (no auto-cross-boundary). LangGraph interrupts are the natural enforcement point. | ✓ Good — built |
| **LiteLLM as the only LLM ingress** | Rule 1 (provider-agnostic). Cost attribution + budget guard fall out for free. | ✓ Good — built |
| **13 MCP servers + shared `mcp-router` package** | Rule 8 (configurable). One TypeScript package per tool keeps contracts isolated. | ✓ Good — built |
| **PostgreSQL + Apache AGE + pgvector** for the KG | Single datastore, RLS-enforced, graph + vector in one place. Reduces cross-system sync bugs. | ✓ Good — built, but OQ-006 wants explicit validation |
| **Multi-tenant by RLS, not by schema** | Multi-tenant by default (Rule 2) — RLS keeps ops simple, prevents app-layer bypass. | ✓ Good — built |
| **No `@fora/*` scope in v2.0** | v2.0 naming convention; clarity over historical continuity. | ✓ Good — enforced |
| **Tailwind 3.4.14 installed vs Tailwind 4 declared** | STACK research recommends staying on 3.4.x for pilot, update docs to match reality. | ⚠️ Revisit — Phase 0 fix |
| **OQ-005/006/007 LOCKED (ADR-001/002/003)** | Architecture research confirmed all three are accepted 2026-06-20, not open. Pilot-cutover follow-ups are OQ-P1/P2/P3 → ADR-009/010/011. | ✓ Good — locked |

---

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference (e.g., "✓ **PILOT-03**: Knowledge Graph visualization — Phase 3")
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state (users, feedback, metrics)

---
*Last updated: 2026-06-23 after initial brownfield bootstrap (codebase map + initial PROJECT.md synthesis)*