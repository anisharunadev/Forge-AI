# Roadmap: Forge AI v2.0 — Pilot Readiness

## Overview

Forge v2.0 is a constitutionally-governed, multi-tenant Agent Operating System. The substrate (PostgreSQL 17 + Apache AGE + pgvector on one RDS with RLS, LangGraph supervisor with HITL interrupts, LiteLLM Proxy, Keycloak, React Flow, append-only WORM audit chain) is locked by ADR-001..008. This milestone delivers **pilot readiness** for one tenant, one full SDLC workflow, every capability visualized, every gate live.

The 5-phase cutover is driven by risk reduction: hygiene first (so plan-phase assumptions stop drifting), substrate lock next (so a misbehaving agent cannot push to a customer repo or blow the cost cap), pilot cutover hardening (so the first user's first session is operationally safe), volume scaling (tune to actual usage after 30 days), and expansion (multi-tenant verification before any second tenant logs in).

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

**Mode:** mvp (Vertical MVP — one tenant, one workflow, full visualization)

- [ ] **Phase 0: Pre-Roadmap Hygiene** - Reconcile stack drift, refactor terminal-server, enforce Rule 1 grep gate, add startup guard
- [ ] **Phase 1: Substrate Lock** - Code Validator, Merge Gate, Tool Bundles, Workflow Budget, Day-One Bootstrap, Refactor Agent, Steering Rules, ADR-009/010/011
- [ ] **Phase 2: Pilot Cutover Hardening** - Pilot UI (wizard, KG, Audit, Approval, Constitution rulebook, Connector Marketplace, Terminal), blue/green deploy, cross-region audit, circuit-breakers, RBAC
- [ ] **Phase 3: Pilot Volume Scaling** - Tune conflict budget, AGE plan observation, LiteLLM quota, audit chain anchors after 30 days of pilot traffic
- [ ] **Phase 4: Expansion (Multi-Tenant Verification)** - Tenant-isolation smoke test, required tenant_id/project_id, multi-region LiteLLM, per-tenant CMK (deferred to tenant #3/#5)
- [ ] **Phase 5: Custom Workflows (F-018)** - n8n-style node editor for the Command Center (Phase A migration + Phase B persistence already complete; this phase delivers C executor+sandbox, D editor UI, E verification+audit+docs)

## Phase Details

### Phase 0: Pre-Roadmap Hygiene

**Goal**: Eliminate known stack drifts and repo smells so plan-phase assumptions are stable for the rest of the roadmap.
**Mode**: mvp
**Depends on**: Nothing (first phase)
**Requirements**: HYG-01, HYG-02, HYG-03, HYG-04
**Success Criteria** (what must be TRUE):

  1. `CLAUDE.md` and `docs/architecture/overview.md` declare "Tailwind 3.4.x" matching the installed `apps/forge/package.json` pin (no more 3.4.14 vs 4 drift).
  2. `node-pty` and `terminal-server.mjs` live inside `packages/forge-terminal-server` and are imported from there by `apps/forge`; no direct `node-pty` import remains in `apps/forge/`.
  3. CI fails the build if any file other than `backend/app/services/litellm_client.py` contains `import litellm`, OR if `apps/forge/lib/**/*.ts` contains a UUID literal.
  4. Service refuses to start (raises on import) when `DEV_AUTH_BYPASS=1` and `settings.environment != "development"`.

**Plans**: TBD

Plans:
**Wave 1**

- [ ] 00-01: Tailwind drift reconciliation (CLAUDE.md + overview.md)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 00-02: `node-pty` refactor into `packages/forge-terminal-server`

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 00-03: CI grep gate (Rule 1 enforcement + UUID literal ban)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 00-04: Startup assertion for DEV_AUTH_BYPASS

### Phase 1: Substrate Lock

**Goal**: Make pilot traffic safe by enforcing deterministic gates, cost admission, and tool-bundle boundaries before any pilot cutover.
**Mode**: mvp
**Depends on**: Phase 0
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-07, OPS-08, OPS-09, OPS-10, OPS-11, OPS-12, OPS-13, OPS-14
**Success Criteria** (what must be TRUE):

  1. Every artifact-writing route is decorated with `@require_approval_phase(...)`; a direct API call cannot bypass Architecture/Security/Deployment gates (PITFALL-1 closed).
  2. `litellm_client.py` derives per-call projected cost from prompt estimate × model price, enforces a cumulative cap, and surfaces "Run budget: $X / Used: $Y" in the UI before a run starts (PITFALL-2 closed).
  3. `BasePhaseNode` writes mutations through `audit_service.record` by default; `OTEL_EXPORTER_OTLP_ENDPOINT` is wired in `docker-compose.yml`; `/healthz` exposes `audit_sink=` and `otel_exporter_configured=` probes (PITFALL-5 closed).
  4. `APPROVAL_EXPIRED` scheduler fires for runs past their timeout, the UI shows a "Stale approval" badge, and per-phase/per-tenant timeout is configurable (PITFALL-6 closed).
  5. Code Validator sub-graph (F-501), Merge Gate (F-503), Tool Bundles (F-505), Workflow Budget (NFR-044), Day-One Bootstrap (F-507), Refactor Agent (F-601), and Steering Rules Engine (F-504) are wired and emit typed artifacts (`ValidationReport`, `MigrationPlan`); ADR-009/010/011 schemas are accepted.

**Plans**: TBD

Plans:

- [ ] 01-01: Approval gate decorator + frozen run-state (PITFALL-1)
- [ ] 01-02: Pre-call cost admission in `litellm_client.py` (PITFALL-2)
- [ ] 01-03: Audit/OTel default sink wiring (PITFALL-5)
- [ ] 01-04: Approval timeout scheduler (PITFALL-6)
- [ ] 01-05: Code Validator sub-graph (F-501)
- [ ] 01-06: Merge Gate (F-503) + Tool Bundles (F-505)
- [ ] 01-07: Workflow Budget (NFR-044) + Day-One Bootstrap (F-507)
- [ ] 01-08: Refactor Agent (F-601) + Steering Rules (F-504)
- [ ] 01-09: ADR-009 cost ledger + ADR-010 conflict schema + ADR-011 KMS

### Phase 2: Pilot Cutover Hardening

**Goal**: Land the pilot end-to-end — one tenant completes the full SDLC workflow with every capability visualized, every gate live, and operational safety at production-grade.
**Mode**: mvp
**Depends on**: Phase 1
**Requirements**: PILOT-01, PILOT-02, PILOT-03, PILOT-04, PILOT-05, PILOT-06, PILOT-07, PILOT-09, PILOT-10, OPS-15, OPS-16, OPS-17, OPS-18, OPS-19, OPS-20, OPS-21, OPS-22
**Success Criteria** (what must be TRUE):

  1. An internal pilot user completes onboarding in under 30 minutes through a single wizard (project name, primary connector, LLM provider, sample repo URL) without code changes (PILOT-01).
  2. The SDLC supervisor runs `discovery → planning → architecture → implementation → testing → security → review → deployment` end-to-end on a sample project, with HITL interrupts only at the three constitutional gates (PILOT-02).
  3. Every artifact is visible in the React Flow Knowledge Graph with status-based coloring (draft / approved / conflicted / deployed), the Audit Timeline shows `{agent, model, prompt, tool, cost, artifact, timestamp, result}`, and the Approval Timeline shows pending decisions with one-click approve/reject (PILOT-03, PILOT-04, PILOT-05).
  4. The Constitution rulebook page renders all 8 rules with a green/yellow/red health indicator driven by live compliance queries; all 40+ `/api/v1/*` routers have a corresponding page or panel (PILOT-09, PILOT-10).
  5. Terminal Center streams live agent execution over WebSocket with replay; the Connector Marketplace lets an admin add a connector without a restart, with secrets resolved through `mcp-secrets` (PILOT-06, PILOT-07).
  6. Production deploy is blue/green via CodeDeploy with a 10% canary + `BeforeAllowTraffic` Code Validator hook; the audit database has a cross-region read replica with a tested failover runbook; LiteLLM Proxy + per-MCP-server circuit-breakers raise typed `UpstreamUnavailable`; conflict-volume guard enforces a per-tenant daily budget with auto/escalation lanes; AGE has a 30s default / 120s cap statement timeout with NetworkX offload above 10K nodes; Audit Timeline renders >1000 events smoothly with rationale capture; `architecture.section.*` events stream over WebSocket with a 24h KG pre-warm; frontend RBAC matches backend permission strings via `<RequirePermission>` (OPS-15..22).

**Plans**: TBD

Plans:

- [ ] 02-01: Pilot onboarding wizard (PILOT-01)
- [ ] 02-02: SDLC supervisor end-to-end run + gate wiring (PILOT-02)
- [ ] 02-03: Knowledge Graph visualization with status coloring (PILOT-03)
- [ ] 02-04: Audit Timeline + Approval Timeline UI (PILOT-04, PILOT-05, OPS-20)
- [ ] 02-05: Terminal Center live stream + replay (PILOT-06)
- [ ] 02-06: Connector Marketplace UI + mcp-secrets (PILOT-07)
- [ ] 02-07: Constitution rulebook with live health queries (PILOT-09)
- [ ] 02-08: UI surface coverage for /api/v1/* routers (PILOT-10)
- [ ] 02-09: Blue/green ECS Fargate deploy via CodeDeploy (OPS-15)
- [ ] 02-10: Cross-region audit read replica + failover runbook (OPS-16)
- [ ] 02-11: LiteLLM + per-MCP circuit-breakers (OPS-17)
- [ ] 02-12: Conflict-volume guard (OPS-18)
- [ ] 02-13: AGE operational ceiling + NetworkX offload (OPS-19)
- [ ] 02-14: Real-time WS run progress + KG pre-warm (OPS-21)
- [ ] 02-15: Frontend RBAC enforcement (OPS-22)

### Phase 3: Pilot Volume Scaling

**Goal**: Tune the pilot substrate to 30 days of real traffic so cost, conflict, and KG behavior hold at actual load.
**Mode**: mvp
**Depends on**: Phase 2
**Requirements**: PILOT-V1, PILOT-V2, PILOT-V3, PILOT-V4
**Success Criteria** (what must be TRUE):

  1. Per-tenant conflict budget thresholds are tuned from observed pilot data (PILOT-V1).
  2. AGE query plan review identifies and offloads any tenant exceeding 3-hop / 10K-node traversals to NetworkX (PILOT-V2).
  3. LiteLLM virtual-key quotas are tuned per tenant to match actual usage (PILOT-V3).
  4. Audit chain anchor frequency is reviewed and adjusted to keep WORM verification cost bounded (PILOT-V4).

**Plans**: TBD

Plans:

- [ ] 03-01: Conflict budget tuning from pilot data
- [ ] 03-02: AGE query plan observation + Tier-2 offload decision
- [ ] 03-03: LiteLLM virtual-key quota tuning per tenant
- [ ] 03-04: Audit chain anchor frequency review

### Phase 4: Expansion (Multi-Tenant Verification)

**Goal**: Verify multi-tenancy end-to-end before any second tenant is onboarded — Rule 2 + Rule 5 must hold under real cross-tenant queries.
**Mode**: mvp
**Depends on**: Phase 3
**Requirements**: PILOT-04-MT, PILOT-04-MT2, PILOT-04-MT3, PILOT-04-MT4, PILOT-04-MT5
**Success Criteria** (what must be TRUE):

  1. A second tenant can be provisioned and a non-admin user from tenant B sees empty (or 403) responses when listing tenant A's artifacts, audit, and cost rows — verified by an automated smoke test (PILOT-04-MT).
  2. Every ideation / cost / audit signature raises `TypeError` when `tenant_id` or `project_id` is missing — no `= None` defaults remain (PILOT-04-MT2).
  3. `IDEATION_JIRA_PROJECT_KEY` is wired from connector config, not hard-coded (PILOT-04-MT3).
  4. Multi-region active-active LiteLLM Proxy is live with per-tenant rate limits; per-tenant CMK is rolled out at tenant #3 or #5 (PILOT-04-MT4, PILOT-04-MT5).

**Plans**: TBD

Plans:

- [ ] 04-01: Tenant-isolation smoke test (PILOT-04-MT)
- [ ] 04-02: Required tenant_id/project_id on ideation/cost/audit signatures (PILOT-04-MT2)
- [ ] 04-03: IDEATION_JIRA_PROJECT_KEY from connector config (PILOT-04-MT3)
- [ ] 04-04: Multi-region LiteLLM Proxy + per-tenant rate limit (PILOT-04-MT5)
- [ ] 04-05: Per-tenant CMK rollout at tenant #3 or #5 (PILOT-04-MT4)

## Progress

**Execution Order:**
Phases execute in numeric order: 0 → 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Pre-Roadmap Hygiene | 3/4 | In progress | 2026-06-24 (00-02, 00-03, 00-04) |
| 1. Substrate Lock | 0/9 | Not started | - |
| 2. Pilot Cutover Hardening | 0/15 | Not started | - |
| 3. Pilot Volume Scaling | 0/4 | Not started | - |
| 4. Expansion (Multi-Tenant Verification) | 0/5 | Not started | - |
| 5. Custom Workflows (F-018) | 0/3 | Planned, ready to execute | - |

**UI hint**: Phase 2 is the load-bearing UI phase (PILOT-01 wizard, PILOT-03 KG, PILOT-04/05 Audit + Approval Timelines, PILOT-06 Terminal, PILOT-07 Marketplace, PILOT-09 Constitution rulebook, PILOT-10 router coverage). Phases 0/1/3/4 ship backend substrate and are not UI-driven.

### Phase 5: Custom Workflows — n8n-style node editor for the Command Center (F-018)

**Goal:** Land a tenant-scoped, n8n-style workflow editor under `/custom-workflows` so users can compose, save, and re-run their own DAGs of forge-* commands, manual approval gates, and sandboxed scripts. Phases A (React Flow v11→v12 migration) and B (backend persistence + REST API) are already complete. This phase delivers C (executor + sandbox + missing `/commands/{name}/run` route), D (frontend editor + runner UI), and E (verification + audit + docs).
**Mode:** mvp
**Depends on:** Nothing (workstream is independent of Phases 0–4 — Phase 5 was added mid-milestone to track the custom-workflows workstream)
**Requirements:** F-018, Rule 2 (multi-tenancy), Rule 3 (approval gates), Rule 4 (typed artifacts), Rule 6 (auditability)
**Success Criteria** (what must be TRUE):

  1. `WorkflowExecutor` (DAG runner) and `ScriptSandbox` (RLIMIT + seccomp + no-network) are wired into the FastAPI backend; an approval-decide call resumes a paused run with idempotency.
  2. `POST /api/v1/commands/{name}/run` is the canonical dispatch route; `useForgeCommands().run()` no longer falls back to "Backend unreachable — simulated success".
  3. SSE stream at `/api/v1/workflows/runs/{runId}/events` emits `step_started / step_succeeded / step_failed / approval_pending / run_completed` events.
  4. `/custom-workflows` route ships the editor (palette + canvas + properties panel) and run-history drawer; vitest covers editor + round-trip; no direct `reactflow@11` import remains.
  5. Every workflow step writes an `AuditRecord`; cross-tenant denial is enforced at the API layer; `/gsd-secure-phase` reports no high-severity findings on the script sandbox.

**Plans:** 3 plans (5-01: Phase C executor + sandbox, 5-02: Phase D frontend editor, 5-03: Phase E verification + audit + docs)

Plans:

- [ ] 5-01: Workflow executor (DAG runner) + script sandbox + missing `/commands/{name}/run` route + approvals-resume hook
- [ ] 5-02: Frontend custom-workflows editor (palette + canvas + properties panel) + runner UI + run-history drawer + vitest
- [ ] 5-03: Verification (e2e round-trip) + security audit (`/gsd-secure-phase`) + UI audit (`/gsd-ui-review`) + docs (`REQUIREMENTS.md`, `STATE.md`, `CLAUDE.md`)

---
*Roadmap created: 2026-06-23*
*Mode: mvp (Vertical MVP — one tenant, one workflow, full visualization)*
*Granularity: standard*
*Coverage: 35/35 v1 requirements mapped to v1 phases (PILOT-04-MT and PILOT-V tracked in v2 sections per REQUIREMENTS.md)*
