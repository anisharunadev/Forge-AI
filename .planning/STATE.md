---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: milestone
current_phase: 0
current_phase_name: Pre-Roadmap Hygiene
status: complete
stopped_at: context exhaustion at 75% (2026-07-02)
last_updated: "2026-07-02T01:53:31.974Z"
last_activity: 2026-06-29
last_activity_desc: "Step 55 underway: seed_connectors.py, LiveConnectorDataProvider merge-logic fix, missing wire fields, backend route alignment (see `docs/goals/step-55-v2.md` for the 9-zone plan)."
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 16
  completed_plans: 4
  percent: 17
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-23)

**Core value:** Every shipped capability is visible, governed, and traceable end-to-end — from requirement → ADR → task → code → test → deployment — through a unified React Flow UI, with multi-tenant isolation, auditability, and human approval gates as constitutional invariants.

**Current focus:** Phase 0.5 — UI Foundation (design tokens, shell primitives, error/loading boundaries, visualization screens) + **Step 55 — Wire Connector Center to real backend (Phase 3 of Integration Phases)**

## Current Position

Phase: 0 of 5 (Pre-Roadmap Hygiene) — **closed 4/4 plans (HYG-01..04 all done)**; Phase 1 planning next
Phase 0.5 (UI Foundation): 5 of 5 plans complete (100%)
Integration Step: **55 of 13 (Phase 3 — Connectors) — wiring in progress**
Status: Phase 0 closed; Phase 1 (Substrate Lock) planning next; Step 55 (Connector Center wiring) in flight
Last activity: 2026-06-29 — Step 55 underway: seed_connectors.py, LiveConnectorDataProvider merge-logic fix, missing wire fields, backend route alignment (see `docs/goals/step-55-v2.md` for the 9-zone plan).

Progress: [██████████] 33% overall; Phase 0 closed 4/4 (HYG-01..04); Step 55 (Connector Center → real backend) 4/9 zones done

### Step 55 — Wire Connector Center to real backend (Phase 3)

**Goal**: The Connector Center's 7 tabs (Overview, Connected, Marketplace, Credentials, Activity, Health, Webhooks) currently fall back to the `CONNECTORS` mock dataset in `apps/forge/lib/connectors/data.ts` whenever the API call is empty, errors, or hasn't loaded yet. After step-55:

1. Backend returns real rows for the `acme-corp` tenant (6 seeded connectors + `ConnectorSyncHistory` events).
2. Frontend distinguishes "API loaded but empty" (real empty state) from "API failed" (mock fallback).
3. `Marketplace` tab shows live items from `GET /api/v1/marketplace/connectors`.
4. `Activity` tab polls `GET /api/v1/connectors/activity` every 10s with filters.
5. `Credentials` tab reads `GET /api/v1/connectors/credentials` (vault list).
6. `Webhooks` tab reads `GET /api/v1/webhooks`.
7. Install / disconnect / test / rotate / reveal / sync all hit real backend endpoints.
8. Killing the dev server falls back to mocks gracefully; restarting shows real data.
9. Mock `CONNECTORS` array stays as **offline-only** fallback (kept per spec constraint).

**Why now**: Phase 1 (OIDC Auth) wired tenants end-to-end (step-52). With JWT + tenant context flowing into every backend call, the next largest UX risk is connectors — 7 tabs that look connected but ship mocks. Wire-flip the path before Phase 2 pilots begin.

**How to apply**: Run `docker compose exec backend python -m scripts.seed_connectors` once after `alembic upgrade head`, then `docker compose exec backend python -m scripts.test_connectors_api` for the 12-test smoke. Re-run after any backend route change.

**Skills honored**:

- Rule 1 (Provider Agnosticism) — `lib/connectors/api.ts` is a typed fetcher, no SDK imports.
- Rule 2 (Multi-tenancy by default) — every `Connector` row carries `tenant_id` + `project_id`; seed uses stable `ACME_TENANT_ID` from `seed_agents.py`.
- Rule 6 (Auditability) — every mutation calls `@audit(...)` server-side; lifecycle endpoints audit `connector.{install,rotate,test}`.
- Rule 12 (Cross-cutting concerns) — `<ConnectorPicker>` continues to read from `useConnectorsOptional()`; `LiveConnectorDataProvider` is enhanced, not rewritten.

**What we did NOT change**:

- Did not delete the `CONNECTORS` mock array from `data.ts` (kept for offline fallback per spec).
- Did not rewrite the legacy `ConnectorProvider` (kept its overrides-prop seam).
- Did not break `<ConnectorPicker>` (Rule 12 cross-cutting).

## Performance Metrics

**Velocity:**

- Total plans completed: 5
- Average duration: <40 min
- Total execution time: <4 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 0. Pre-Roadmap Hygiene | 1 | 4 | ~50m |
| 0.5. UI Foundation | 5 | 5 | <40m |
| 1. Substrate Lock | 0 | 9 | — |
| 2. Pilot Cutover Hardening | 0 | 15 | — |
| 3. Pilot Volume Scaling | 0 | 4 | — |
| 4. Expansion (Multi-Tenant Verification) | 0 | 5 | — |

**Recent Trend:**

- Last 5 plans: Phase 0.5-02 (StatusPill + 7 badge migrations + 3 boundaries), Phase 0.5-06 (5 typed React Flow nodes + 4 graph views + virtualized audit/approval timelines + 3 AI-native panels), Phase 0.5-03 (shell: sidebar/topbar/CMD-K palette/breadcrumbs/mobile drawer/page container)
- Trend: UI Foundation on track; 2 plans remaining (0.5-04 DataTable sweep, 0.5-05/06 already done)

*Updated after each plan completion*

**Recent Trend:**

- Last 5 plans: Phase 0-01 (Tailwind 3.4.x + post-pilot deferral note in CLAUDE.md + overview.md; HYG-01 closed 2026-06-25 via close-out commit), Phase 0-02 (node-pty + terminal-server.mjs moved to packages/forge-terminal-server workspace package; HYG-02 closed), Phase 0.5-02 (StatusPill + 7 badge migrations + 3 boundaries), Phase 0.5-06 (5 typed React Flow nodes + 4 graph views + virtualized audit/approval timelines + 3 AI-native panels), Phase 0.5-03 (shell: sidebar/topbar/CMD-K palette/breadcrumbs/mobile drawer/page container)
- Trend: Phase 0 closed 4/4 (HYG-01..04); Phase 1 (Substrate Lock) planning next; Phase 5 (Custom Workflows F-018) plans already drafted (3 plans, independent workstream)

## Accumulated Context

### Roadmap Evolution

- Phase 5 added: Custom Workflows — n8n-style node editor for the Command Center (F-018). Out-of-band workstream inserted mid-milestone; depends on nothing. Plans 5-01 (Phase C: executor + sandbox), 5-02 (Phase D: editor UI), 5-03 (Phase E: verification + audit + docs) ready to execute.

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Phase 0: Tailwind 3.4.x stays; CLAUDE.md + overview.md updated to match reality (not Tailwind 4 mid-pilot).
- Phase 0: `node-pty` and `terminal-server.mjs` move into `packages/forge-terminal-server`.
- Phase 0: CI grep gate enforces Rule 1 (`import litellm` only in `litellm_client.py`) and bans UUID literals in `apps/forge/lib/`.
- Phase 1: ADR-009 (cost ledger), ADR-010 (conflict policy), ADR-011 (pilot-vs-MT KMS) accepted before any substrate code lands.
- Phase 1: Code Validator sub-graph is independent (NFR-043); no shared prompt template with `sdlc_agent.py`.
- Phase 1: Merge Gate (F-503) is rules-only — LLM is excluded from the gate decision.
- Phase 2: TS-5 Approval Timeline page (`apps/forge/app/governance-center/page.tsx`) must exist before any Phase 2 plan commits — highest-pilot-impact gap per research.
- Phase 2: Blue/green ECS Fargate via CodeDeploy with 10% canary + `BeforeAllowTraffic` Code Validator hook (OQ-P1).
- Phase 2: Cross-region read replica required for audit DB (NFR-014 RPO ≤ 24h, RTO ≤ 4h).
- Phase 4: Tenant-isolation smoke test runs *before* any second-tenant onboarding — PITFALL-4 closure.
- Phase 4: Per-tenant CMK deferred to tenant #3 or #5 (single key fine for one-tenant pilot).
- Phase 0.5-05: `PageHeader` / `EmptyState` / `SectionCard` primitives are the new standard for center-page header chrome + empty states; legacy `forge-*` literal color ramp retired across 8 center pages (PILOT-01/05/09 alignment). Governance Center (TS-5 BLOCKING) redesigned with `<Alert>` + `<StatusPill>` for board-token status; Approval Timeline now reads from semantic tokens.
- Phase 0.5-02: StatusPill is the single source of truth for state-bearing chips; 7 bespoke badges (RunStatusBadge, HealthBadge, ApprovalStatusBadge, ScoreBadge, FreshnessBadge, SeverityBadge, ConnectorStatusPill) delegate to it (PILOT-01/05/09 alignment).
- Phase 0.5-03: Shell (Sidebar/Topbar/CommandPalette/PageContainer/Breadcrumbs/MobileNav) lives in `components/shell/*`; `nav-config.ts` is the single source of truth for NAV; the CMD-K palette is owned by `<ShellProvider>` and reachable from every route; the global Cmd/Ctrl-K listener is suppressed when the user is typing in an input/textarea/contenteditable; mobile nav uses the same grouped list as desktop via a shared `NavList` primitive.
- Phase 0.5-04: DataTable (TanStack Table v8), Form (react-hook-form + zod), and Chart wrappers (Recharts) are the data primitives 0.5-05/06/07 compose against; 9 missing shadcn primitives (table/pagination/breadcrumb/avatar/accordion/form/radio-group/switch/slider) added so all later phases can compose against a stable surface. Chart series colors read from CSS variables — flipping dark/light re-skins every chart with zero JS changes (PILOT-03/04/05/10 alignment).
- Phase 0.5-06: 5 typed React Flow node components (Artifact/RepoFile/Service/AgentStep/Approval) read status from `toneClasses` + `agentStates`; 4 graph views compose them via `nodeTypes={forgeNodeTypes}`; AuditTimelineVirtualized handles >1000 records via @tanstack/react-virtual (PILOT-03/04/05/06 alignment). Verified zero direct hex literals via grep; 20/20 tests pass.
- Phase 0.5 close-out: `AuditTimelineVirtualized` is now wired into `app/audit/page.tsx` (was previously built + tested but not integrated); SUMMARY files generated for 0.5-05 + 0.5-06 so plan metadata matches disk state. UI Foundation phase is now 5/5 plans, 100% complete.

### Pending Todos

- **TS-5 Approval Timeline page existence** — verified resolved: `apps/forge/app/governance-center/page.tsx` exists with PageHeader + Alert + StatusPill chrome. PILOT-05 / BLOCKING per research SUMMARY closed.
- **Step 55 (Connector Center wiring)** — zones 4-9 in flight: missing backend routes, frontend wire-type fixups, install-invalidation, test-connection UX, activity feed poll, endpoint test script, full verification. Per-zone plan in `docs/goals/step-55-v2.md`.
- Pre-existing typecheck errors in `lib/hooks/use{ApprovalDecide,ConnectorLifecycle,IdeaEnhance,JiraSync,PushIdeaToJira,IdeationIngestStatus,PersonaMemory}.ts`, `lib/design-system/forge-light-theme.ts`, and `tests/intelligence/ideation-approval-decide.test.tsx` — out of scope for 0.5-05/06; will need a dedicated cleanup pass before Phase 2.

### Blockers/Concerns

- **TS-5 Approval Timeline page existence** — must verify `apps/forge/app/governance-center/page.tsx` exists with a pending-decisions panel before Phase 2 plan commits (PITFALL-1 / PILOT-05 / BLOCKING per research SUMMARY).
- **LangGraph 0.3 vs 0.4 breaking-change analysis** — short follow-up before pinning `langgraph>=0.2.0` upward in Phase 1.
- **Tailwind drift** — must land in Phase 0; downstream plans keep making the wrong assumption otherwise.
- **Codebase has 44 v1-styled checkboxes** vs REQUIREMENTS.md's stated 35 — reconciled by excluding PILOT-04-MT* and PILOT-V* (treated as v2 deferred) and noting PILOT-08 has no separate checkbox (validated via OQ-LOCKED ADRs).

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Substrate | Tailwind 4 migration | Post-pilot phase (breaking change mid-pilot) | 2026-06-23 |
| Multi-tenant | Per-tenant CMK | Tenant #3 or #5 (ADR-011) | 2026-06-23 |
| Multi-tenant | Multi-region active-active LiteLLM Proxy | Phase 4 | 2026-06-23 |
| Marketplace | Public/third-party Connector Marketplace submissions | Post-pilot | 2026-06-23 |
| Collaboration | Real-time CRDT artifact editing | Post-pilot (artifacts versioned via audit log) | 2026-06-23 |
| Client | Mobile / native client | v3+ | 2026-06-23 |

## Session Continuity

Last session: 2026-07-02T01:53:31.965Z
Stopped at: context exhaustion at 75% (2026-07-02)
Resume file: None
