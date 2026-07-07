# Forge AI — Mock Data Removal Audit

> **Purpose.** Line-accurate inventory of every mock/sample/fixture dataset still in the production frontend, its consumers, the backend equivalent (seed + API), and the exact gap that prevents real-data wiring today.
>
> **Scope.** Only files under `apps/forge/app/`, `apps/forge/components/`, `apps/forge/lib/`, and `apps/forge/hooks/`. Excludes `node_modules`, `.next`, `coverage/`, `tests/`.
>
> **Method.** `rg`/`grep` for `MOCK_|SAMPLE_|mock-data|mock-fixtures|sample-data` symbols and import paths; cross-checked against `backend/scripts/seed_*.py`, `backend/app/api/v1/`, `backend/app/db/models/`, and `backend/app/services/architecture/`.
>
> **Generated.** 2026-07-07 as Step 1 of the mock-removal plan.

---

## 1. Executive Summary

| Metric | Count |
|---|---:|
| Mock/sample/fixture files in `apps/forge/` | **8** (5 active consumers + 3 dead-code files) |
| Total mock-file LoC | **5,236** lines |
| Mock symbols exported | **37** distinct identifiers |
| Production consumers of mock files | **26** import sites across 25 files |
| Backend API endpoints that return real data already | **5 / 12** mock datasets have a working backend endpoint |
| Backend endpoints that exist but always return empty | **2 / 12** (versions, traceability) |
| Backend endpoints missing entirely | **3 / 12** (tech-radar, diagrams, decision-velocity) + tickets + specs |
| Backend seeds missing entirely | **2 / 12** (specs, decision-velocity uses aggregation) |
| Type-shape gaps between mock and API | **6 fields** (`component`, `impact`, `authorInitials`, `linkedTaskCount`, `linkedRiskCount`, `linkedApiCount` on ADR) |
| Stubs and placeholders outside mock files | **5** (governance board, persona API, workflow projectId, validator projectId, workflow `SAMPLE_*` no-op placeholders) |
| Dead-code mock files (zero importers) | **3** (`stories/mock-data.ts`, `knowledge/sample-data.ts`, `data/sample-graph.ts`) totaling **1,347 LoC** |

**Headline.** The Architecture Center god-page (`apps/forge/app/architecture/page.tsx`, 2,828 LoC) is the highest-risk mock surface — it imports **12 of the 13 `MOCK_*` arrays** and uses `computeHealth()` which derives KPI values from `MOCK_*` at module-load. The fix is bounded: every hook it calls already exists in `lib/hooks/useArchitecture.ts`; the hooks just need `project_id` (and a few need `artifact_type` + `artifact_id`) to fire.

**Net effect.** Wiring real data is mostly a frontend change. Two genuine backend gaps (versions persistence + traceability matrix population + tech-radar + diagrams + decision-velocity aggregation) need new code, but the rest of the mocks can be removed by adding one filter arg per hook call.

---

## 2. Master Table — Every Mock, Every Consumer, Every Gap

Legend — **Status**:

- `READY_TO_WIRE` — UI just needs to call an existing API that returns real data
- `NEEDS_SEED` — API exists, no rows in DB; seed script needs to be extended
- `NEEDS_ENDPOINT` — no API; backend code is required
- `NEEDS_TYPE_WORK` — API exists but response shape differs from UI shape (adapter needed)
- `NEEDS_BACKEND_IMPL` — endpoint stub exists but always returns empty (real implementation required)
- `DEAD_CODE` — exported but never imported; delete outright
- `EXPLICIT_FALLBACK` — silent offline fallback; keep but make explicit with banner

| # | Mock symbol | Mock file | LoC | Consumers (file:line) | Backend seed | Backend API | Type gap | Status | Effort |
|---|---|---|---:|---|---|---|---|---|---|
| 1 | `MOCK_ADRS_WITH_META` | `apps/forge/lib/architecture/mock-fixtures.ts:204` | 850 (whole file) | `apps/forge/app/architecture/page.tsx:147` | `backend/scripts/seed_architecture.py:59` (`SEED_ADRS`) ✅ | `GET /api/v1/architecture/adrs` `backend/app/api/v1/architecture/adrs.py:65` ✅ | `component`, `impact`, `authorInitials`, `linkedTaskCount`, `linkedRiskCount`, `linkedApiCount` | NEEDS_TYPE_WORK | M |
| 2 | `MOCK_CONTRACTS` | `mock-fixtures.ts:346` | (same file) | `apps/forge/app/architecture/page.tsx:147` | `seed_architecture.py:151` (`SEED_CONTRACTS`) ✅ | `GET /api/v1/architecture/contracts` `contracts.py:57` ✅ | none | READY_TO_WIRE | XS |
| 3 | `MOCK_SERVICES` | `mock-fixtures.ts:243` | (same file) | `apps/forge/app/architecture/page.tsx:147` | **None** — `ApiService` is a derived view | **None** | full shape | NEEDS_BACKEND_IMPL | L |
| 4 | `MOCK_TASK_BREAKDOWNS` | `mock-fixtures.ts:456` | (same file) | `apps/forge/app/architecture/page.tsx:147` | `seed_architecture.py:290` (`SEED_TASK_BREAKDOWNS`) ✅ | `GET /api/v1/architecture/task-breakdowns` ✅ | none | READY_TO_WIRE | XS |
| 5 | `MOCK_RISK_REGISTERS` | `mock-fixtures.ts:533` | (same file) | `apps/forge/app/architecture/page.tsx:147` | `seed_architecture.py` (one register with N risks) ✅ | `GET /api/v1/architecture/risk-registers` `risk_registers.py:77` ✅ | none | READY_TO_WIRE | XS |
| 6 | `MOCK_RISKS` | `mock-fixtures.ts:485` | (same file) | `apps/forge/app/architecture/page.tsx:338` (type-only) | (rolled into RiskRegister) ✅ | inline in `GET /risk-registers` ✅ | none | READY_TO_WIRE | XS |
| 7 | `MOCK_VERSIONS` | `mock-fixtures.ts:557` | (same file) | `apps/forge/app/architecture/page.tsx:147` | **Missing** — `seed_architecture.py` comment: "ArchitectureVersion is intentionally NOT seeded" | `GET /api/v1/architecture/versions` exists `versions.py:46` but **always returns `[]`** | `ArchitectureVersion` is a dataclass, not a DB model | NEEDS_BACKEND_IMPL | L |
| 8 | `MOCK_TRACEABILITY` | `mock-fixtures.ts:608` | (same file) | `apps/forge/app/architecture/page.tsx:147` | **Missing** | `GET /api/v1/architecture/traceability` exists but `TraceabilityService.build_matrix` returns empty | `TraceabilityGraph` shape differs from API `TraceabilityMatrix` | NEEDS_BACKEND_IMPL | L |
| 9 | `MOCK_TECH_RADAR` | `mock-fixtures.ts:668` | (same file) | `apps/forge/components/architecture/TechRadar.tsx:42` + `page.tsx:147` | **Missing** | **None** | full shape | NEEDS_ENDPOINT | M |
| 10 | `MOCK_DIAGRAMS` | `mock-fixtures.ts:720` | (same file) | `apps/forge/components/architecture/DiagramsExplorer.tsx:25` + `page.tsx:147` | **Missing** | **None** | full shape | NEEDS_ENDPOINT | L |
| 11 | `MOCK_ACTIVITY` | `mock-fixtures.ts:794` | (same file) | `apps/forge/app/architecture/page.tsx:147` | n/a — derived from audit log | `GET /api/v1/audit/events` ✅ | `ArchitectureActivity` is a derived projection | READY_TO_WIRE | S |
| 12 | `MOCK_DECISION_VELOCITY` | `mock-fixtures.ts:849` | (same file) | `apps/forge/app/architecture/page.tsx:147, 643, 647` | n/a — should be aggregation | **None** | derived from ADR `created_at` over time | NEEDS_ENDPOINT | S |
| 13 | `computeHealth` | `mock-fixtures.ts:808` | (same file) | `apps/forge/app/architecture/page.tsx:198` | n/a — derived | n/a | aggregates mock arrays at module load | NEEDS_TYPE_WORK | S |
| 14 | `SAMPLE_TICKETS` | `apps/forge/lib/command-center/sample-data.ts:50` | 490 | 7 files (forge-command-center page, CatalogMode, CommandPalette, MyWorkDrawer, TicketMode, PhaseExecutionDrawer, store, orchestration) | `seed_connectors.py` seeds Jira + GitHub connectors ✅ — no ingested tickets | **None** for general tickets; tickets live in `GET /connectors/{id}/history` | full shape | NEEDS_BACKEND_IMPL | L |
| 15 | `SAMPLE_LIVE_RUNS` | `sample-data.ts:342` | (same) | `apps/forge/app/forge-command-center/page.tsx:49` | `seed_workflows.py` (3 runs: 1 running, 1 succeeded, 1 failed) ✅ | `GET /api/v1/workflows/runs` `workflows.py:351` ✅ | minor | READY_TO_WIRE | XS |
| 16 | `SAMPLE_SPECS` | `sample-data.ts:216` | (same) | `CommandPalette.tsx:22`, `SpecMode.tsx:51`, `store.ts:23` | **Missing** | **None** | full shape | NEEDS_ENDPOINT | M |
| 17 | `SAMPLE_APPROVALS` | `sample-data.ts:395` | (same) | (no direct import found in active code beyond export) | `seed_architecture.py` ✅ | `GET /api/v1/architecture/approvals` ✅ | full shape — needs adapter | READY_TO_WIRE | S |
| 18 | `SAMPLE_RECENT_ARTIFACTS` | `sample-data.ts:422` | (same) | (no direct import) | (artifacts table exists) | (verify) | full shape | NEEDS_TYPE_WORK | S |
| 19 | `SAMPLE_AI_SUGGESTIONS` | `sample-data.ts:459` | (same) | (no direct import) | n/a | n/a | full shape | DEAD_CODE | XS |
| 20 | `mockSnapshot` | `apps/forge/components/dashboard/mock-data.ts:56` | 192 | `MissionControl.tsx:32`, `BentoCurated.tsx:59`, `BentoLive.tsx:52`, `CustomizeDrawer.tsx:67`, `GreetingBar.tsx:55`, `KPIStrip.tsx:37` | n/a — derived from many endpoints | `GET /dashboard/kpis`, `/activity`, `/insights`, `/alerts`, `/top-providers` ✅ | `DashboardSnapshot` is a UI projection | READY_TO_WIRE (banner only) | S |
| 21 | `CONNECTORS` (mock fallback) | `apps/forge/lib/connectors/data.ts:329` | 1,728 | `LiveConnectorDataProvider.tsx:39` (explicit Step 55 fallback) | n/a | `GET /api/v1/connectors` ✅ | falls back when API errors | EXPLICIT_FALLBACK | XS |
| 22 | `SAMPLE_USER_WORKFLOWS` | `apps/forge/lib/workflow/templates.ts:317` | 1 line | (placeholder kept for legacy imports) | n/a | n/a | n/a | DEAD_CODE | XS |
| 23 | `SAMPLE_RUNS` | `templates.ts:323` | 1 line | `apps/forge/components/workflow/WorkflowLeftSidebar.tsx:33` (imports but value is `[]`) | `seed_workflows.py` ✅ | `GET /api/v1/workflows/runs` ✅ | n/a | DEAD_CODE | XS |
| 24 | `SAMPLE_DRAFTS` | `templates.ts:329` | 1 line | (no importer) | n/a | n/a | n/a | DEAD_CODE | XS |
| 25 | `SAMPLE_SHARED` | `templates.ts:335` | 1 line | (no importer) | n/a | n/a | n/a | DEAD_CODE | XS |
| 26 | `MOCK_STORIES` | `apps/forge/lib/stories/mock-data.ts` | 714 | **None — zero importers** | n/a | `GET /api/v1/stories` ✅ | n/a | DEAD_CODE | XS |
| 27 | `MOCK_KNOWLEDGE_NODES` | `apps/forge/src/components/knowledge/sample-data.ts` | 360 | **None — zero importers** | `seed_knowledge_graph.py` ✅ | `GET /api/v1/knowledge-graph/*` ✅ | n/a | DEAD_CODE | XS |
| 28 | `MOCK_GRAPH_DATA` | `apps/forge/src/data/sample-graph.ts` | 273 | **None — zero importers** | (same as #27) | (same) | n/a | DEAD_CODE | XS |

### Mock files summary

| File | LoC | Active consumers | Verdict |
|---|---:|---:|---|
| `apps/forge/lib/architecture/mock-fixtures.ts` | 850 | 1 file (architecture page) | Keep API surface; replace 13 mock arrays with adapters + add 4 missing backend pieces |
| `apps/forge/lib/command-center/sample-data.ts` | 490 | 7 files (command center) | Keep API surface; replace 6 SAMPLE_* arrays with hooks + add tickets/specs endpoints |
| `apps/forge/components/dashboard/mock-data.ts` | 192 | 6 files (dashboard) | Keep `DashboardSnapshot` type; delete `mockSnapshot()` data |
| `apps/forge/lib/connectors/data.ts` | 1,728 | 1 file (explicit offline fallback) | Keep; add explicit banner in `LiveConnectorDataProvider` |
| `apps/forge/lib/workflow/templates.ts` | 334 | 1 file (`SAMPLE_RUNS` import, unused at runtime) | Delete 4 `SAMPLE_*` placeholders |
| `apps/forge/lib/stories/mock-data.ts` | 714 | 0 | **Delete** |
| `apps/forge/src/components/knowledge/sample-data.ts` | 360 | 0 | **Delete** |
| `apps/forge/src/data/sample-graph.ts` | 273 | 0 | **Delete** |

**Total deletable lines (dead code):** 1,347.
**Total refactor surface:** 3 active files (~1,500 LoC), 7 active consumer files.

---

## 3. Backend Coverage Matrix

| Center / Page | Backend seed | Backend API | Frontend hooks | Net status |
|---|---|---|---|---|
| **Architecture Center** | `seed_architecture.py` (ADRs, contracts, risks, task breakdowns, approvals, attestations) ✅ | `architecture/adrs.py`, `contracts.py`, `risk_registers.py`, `task_breakdowns.py`, `approvals.py`, `acceptance.py`, `security_reports.py`, `standards.py`, `traceability.py`, `versions.py` ✅ | `useADRs`, `useContracts`, `useRiskRegisters`, `useTaskBreakdowns`, `useArchitectureVersions`, `useTraceability`, `useArchitectureSecurity` ✅ | **Mostly READY_TO_WIRE**. Gaps: versions persistence, traceability matrix population, tech-radar endpoint, diagrams endpoint, decision-velocity aggregation. |
| **Command Center** | `seed_workflows.py` (3 runs) ✅, `seed_connectors.py` ✅, **no specs seed** | `workflows.py` ✅, `connectors.py` ✅, **`/specs` missing**, **`/tickets` missing** | `useRuns`, `useWorkflowRuns`, `useConnectors`, `useConnectorActivity` ✅, **`useTickets` missing**, **`useSpecs` missing** | **Mixed.** Runs ready; tickets + specs need backend. |
| **Mission Control Dashboard** | `seed_agents.py`, `seed_projects.py` ✅ | `dashboard/kpis`, `/activity`, `/insights`, `/alerts`, `/top-providers` ✅ | `useDashboardKPIs`, `useTeamActivity`, `useAlerts`, `useAIInsights` ✅ | **READY_TO_WIRE.** MissionControl.tsx already merges real hooks with `mockSnapshot()` fallback. Just need explicit banner. |
| **Stories** | `seed_stories.py` ✅ | `stories.py` ✅ | `useStories`, `useSprints`, `useEpics` ✅ | **READY_TO_WIRE.** No mock import in active code. |
| **Run Center** | `seed_workflows.py` (3 runs) ✅ | `workflows/runs` ✅ | `useWorkflowRunsIndex` ✅ | **READY_TO_WIRE.** |
| **Connector Center** | `seed_connectors.py` (6 connectors) ✅ | `connectors.py` ✅ | `useConnectors`, `useConnectorActivity` ✅ | **READY_TO_WIRE.** Step 55 3-state merge is canonical pattern. |
| **Knowledge Center** | `seed_knowledge_graph.py` (40+ nodes, 25+ edges) ✅ | `knowledge_graph.py` ✅ | `useKnowledgeGraph` ✅ | **READY_TO_WIRE.** |
| **Ideation Center** | `seed_ideation.py` (6 ideas, 4 analyses, 4 scores, 1 roadmap, 2 PRDs) ✅ | `ideation/*` ✅ | `useIdeasAdapter`, `useApprovalsAdapter`, `useRoadmaps`, `useArchPreviews` ✅ | **READY_TO_WIRE.** |
| **Audit** | (audit log is auto-populated) | `audit.py` ✅ | `useAudit` ✅ | **READY_TO_WIRE.** |

---

## 4. Type-Shape Gap Analysis

### 4.1 ADR (most critical — drives the architecture god-page)

| Field | `ADRWithMeta` (UI mock) `mock-fixtures.ts:195` | `ADR` (UI hook) `types.ts` | `ADRResponse` (API) `schemas/architecture.py:38` | `ADR` (DB model) `db/models/architecture.py:9` | Gap |
|---|---|---|---|---|---|
| `id`, `number`, `title`, `status`, `owner`, `updatedAt` | ✅ | ✅ | ✅ (renamed: `updated_at`) | ✅ | rename only |
| `context`, `decision`, `consequences`, `alternatives`, `related_adrs` | partial | ✅ | ✅ | ✅ | rename + flatten |
| `generated_by`, `reviewed_by`, `approved_by`, `approved_at` | ✅ | ✅ | ✅ | ✅ | none |
| `tenant_id`, `project_id`, `created_at`, `updated_at` | ✅ | ✅ | ✅ | ✅ | none |
| **`component`** | ✅ `ADRComponent['id']` | ❌ | ❌ | ❌ | **add column** |
| **`impact`** | ✅ `number` | ❌ | ❌ | ❌ | **add column** |
| **`authorInitials`** | ✅ derived | ❌ | ❌ | ❌ | **compute in adapter** |
| **`linkedTaskCount`** | ✅ | ❌ | ❌ | ❌ | **new endpoint `/adrs/{id}/links`** |
| **`linkedRiskCount`** | ✅ | ❌ | ❌ | ❌ | **new endpoint `/adrs/{id}/links`** |
| **`linkedApiCount`** | ✅ | ❌ | ❌ | ❌ | **new endpoint `/adrs/{id}/links`** |

**Recommended fix.** Add `component` and `impact` columns to `architecture_adrs` + populate in `seed_architecture.py`. Add `GET /architecture/adrs/{id}/links` endpoint. Frontend adapter derives the rest.

### 4.2 APIContract

| Field | `APIContract` (UI mock) | `APIContractResponse` (API) | Gap |
|---|---|---|---|
| `id`, `title`, `kind`, `service`, `version`, `owner`, `updatedAt`, `source`, `status` | ✅ | ✅ | none |

`READY_TO_WIRE`.

### 4.3 RiskRegister

| Field | `RiskRegister` (UI mock) | `RiskRegisterResponse` (API) | Gap |
|---|---|---|---|
| `id`, `title`, `source`, `updatedAt`, `risks[]` | ✅ | ✅ (`risks` is JSONB on table) | none |

`READY_TO_WIRE`.

### 4.4 TaskBreakdown

| Field | `TaskBreakdown` (UI mock) | `TaskBreakdownResponse` (API) | Gap |
|---|---|---|---|
| `id`, `title`, `source`, `totalEstimateHours`, `tree` | ✅ | ✅ | none |

`READY_TO_WIRE`.

### 4.5 LiveRun vs WorkflowRunRead (Command Center)

| Field | `LiveRun` (UI mock) | `WorkflowRunRead` (API) | Gap |
|---|---|---|---|
| `id`, `status`, `workflow_id`, `started_at`, `duration_seconds` | ✅ | ✅ | none |
| `progress`, `agent`, `cost_so_far` | ✅ | partial | adapter needed |
| `error` | ✅ | ✅ | none |

Mostly matches. Minor adapter work.

### 4.6 Ticket (Command Center) — no backend model

`Ticket` UI shape (`sample-data.ts:33`) has `source`, `external_id`, `title`, `description`, `priority`, `labels`, `assignee`. **No `Ticket` table exists.** Tickets are stored as `ConnectorSyncEvent` rows inside `connectors/{id}/history`. **Decision needed**: new `tickets` table (clean) vs derive from `ConnectorSyncEvent` (faster, denormalized).

---

## 5. Stubs and Placeholders

| # | Stub | Location | Fix | Effort |
|---|---|---|---|---|
| 1 | `projectId: 'placeholder'` in WorkflowProgress | `apps/forge/app/workflow/layout.tsx:20` | Replace with `useCurrentProjectId()` hook reading from auth context | S |
| 2 | `const boardTokenPresent = true;` | `apps/forge/app/governance-center/page.tsx:48` | Wire to `useTenantLLMConfig()` (`lib/hooks/useLiteLLM.ts:211` exists); move shell to client component | S |
| 3 | "stub (FORA-374 §6) does not authenticate" | `apps/forge/app/api/persona/route.ts:8` | Either implement auth or return 410 Gone with redirect to `/login` | S |
| 4 | `DEFAULT_PROJECT_ID = 'demo-project-001'` | `apps/forge/app/validator/page.tsx:21` | Read from auth context's selected project via `useCurrentProjectId()` | XS |
| 5 | `SAMPLE_USER_WORKFLOWS`, `SAMPLE_RUNS`, `SAMPLE_DRAFTS`, `SAMPLE_SHARED` (typed `never[]`) | `apps/forge/lib/workflow/templates.ts:317–335` | Delete outright; fix `WorkflowLeftSidebar.tsx:33` import | XS |

**`useCurrentProjectId()`** is a missing helper. Per the audit, the architecture page hardcodes `'22222222-2222-2222-2222-222222222222'` (line 2119). This needs to be a proper hook reading from auth context before multi-tenant support lands.

---

## 6. Missing Endpoints (NEEDS_ENDPOINT / NEEDS_BACKEND_IMPL)

| # | What it would expose | Existing handlers | Effort | Suggested location |
|---|---|---|---|---|
| 1 | `GET /api/v1/architecture/tech-radar?project_id=` | none | M | `backend/app/api/v1/architecture/tech_radar.py` (new) — `tech_radar_entries` table or reuse `Artifact(type='tech_radar')` |
| 2 | `GET /api/v1/architecture/diagrams?project_id=` | none | L | `backend/app/api/v1/architecture/diagrams.py` (new) — `diagrams` table or reuse `Artifact(type='c4_diagram')` |
| 3 | `GET /api/v1/architecture/metrics/decision-velocity?weeks=12` | none | S | `backend/app/api/v1/architecture/metrics.py` (new) — aggregation over `architecture_adrs.created_at` |
| 4 | `GET /api/v1/specs?project_id=` | none | M | `backend/app/api/v1/specs.py` (new) — reuse `Artifact(type='spec')` |
| 5 | `GET /api/v1/tickets?project_id=&source=jira` | none | L | `backend/app/api/v1/tickets.py` (new) OR derive from `ConnectorSyncEvent` |
| 6 | `GET /api/v1/architecture/adrs/{id}/links` | none | S | `backend/app/api/v1/architecture/adrs.py` (add) — aggregates linked counts |
| 7 | Persistence for `ArchitectureVersion` | `versions.py:46` always returns `[]` | L | Add `architecture_versions` table + persist in `ArchitectureVersioningService.create_version` |
| 8 | Real `TraceabilityService.build_matrix` | `traceability.py:25` stub | L | Implement matrix builder walking ADR → contract → task → risk → approval edges |

---

## 7. Order of Execution (10 working days)

| # | Day | Work | Outcome |
|---|---|---|---|
| 1 | Day 1 | Pass 1a: Add `component` + `impact` columns to `architecture_adrs`; populate in `seed_architecture.py` | DB ready for ADR enrichment |
| 2 | Day 1 | Pass 1b: Add `GET /architecture/adrs/{id}/links` + frontend hook `useADRLinks(id)` | Linked-count data available |
| 3 | Day 2 | Pass 1c: Implement `TraceabilityService.build_matrix` to walk ADR → contract → task → risk → approval edges | Trace tab gets real data |
| 4 | Day 2 | Pass 1d: Implement `ArchitectureVersioningService` to persist + list versions; seed 3 versions | Versions tab gets real data |
| 5 | Day 3 | Pass 2a: Create `apps/forge/lib/architecture/adapters.ts` with `toADRWithMeta(apiAdr, links)` | Frontend projection ready |
| 6 | Day 3 | Pass 2b: Edit `apps/forge/app/architecture/page.tsx` lines 2106–2162 — pass `{project_id: projectId}` to all hooks, remove `MOCK_*` ternaries | Architecture Center shows real data |
| 7 | Day 4 | Pass 2c: Wire `computeHealth()` to consume real arrays (or convert to `useHealthMetrics()` hook) | KPI strip shows real health |
| 8 | Day 4 | Pass 2d: Add `GET /architecture/metrics/decision-velocity` + frontend hook | Decision velocity chart real |
| 9 | Day 5 | Pass 3a: Add `tech_radar_entries` table (or reuse Artifact) + seed + endpoint + frontend hook | Tech Radar tab real |
| 10 | Day 5 | Pass 3b: Add `diagrams` table (or reuse Artifact) + seed + endpoint + frontend hook | Diagrams tab real |
| 11 | Day 6 | Pass 4a: Create `tickets` table + endpoint + frontend hook `useTickets()` | Command Center ticket mode real |
| 12 | Day 6 | Pass 4b: Create `specs` (or reuse Artifact type='spec') + endpoint + frontend hook `useSpecs()` | Command Center spec mode real |
| 13 | Day 7 | Pass 5a: Wire Command Center consumers (page.tsx, TicketMode, SpecMode, CommandPalette, MyWorkDrawer, store, orchestration) | Command Center zero mocks |
| 14 | Day 7 | Pass 5b: Wire Mission Control — remove `mockSnapshot()` data, keep `DashboardSnapshot` type, surface explicit "Backend unavailable" banner | Dashboard zero mocks |
| 15 | Day 8 | Pass 6a: Fix 5 stubs (workflow projectId, governance board, persona API, validator projectId, delete SAMPLE_* placeholders) | Stubs killed |
| 16 | Day 8 | Pass 6b: Delete 3 dead-code mock files | -1,347 LoC |
| 17 | Day 9 | Pass 7: Add `scripts/check-no-mocks.sh` + wire to CI | CI guard active |
| 18 | Day 10 | Pass 8: Run `m13-dogfood.spec.ts`; fill `M13-PILOT-SIGNOFF.md` | First pilot complete |

**Cumulative impact after Day 10:**

- 5,236 mock LoC → ~600 LoC (kept types only)
- 26 consumer files wired to real APIs
- 8 new backend endpoints/handlers
- 1 CI guard
- 0 MOCK_*, SAMPLE_*, mock-data.ts imports in production code (verified by `check-no-mocks.sh`)

---

## 8. Files That Will Be Deleted

| File | LoC | Reason |
|---|---:|---|
| `apps/forge/lib/stories/mock-data.ts` | 714 | Zero importers (dead code) |
| `apps/forge/src/components/knowledge/sample-data.ts` | 360 | Zero importers (dead code) |
| `apps/forge/src/data/sample-graph.ts` | 273 | Zero importers (dead code) |
| **Subtotal** | **1,347** | |

## 9. Files That Will Be Heavily Reduced

| File | Before | After | Reduction |
|---|---:|---:|---:|
| `apps/forge/lib/architecture/mock-fixtures.ts` | 850 | ~50 (types only) | -94% |
| `apps/forge/lib/command-center/sample-data.ts` | 490 | ~50 (types only) | -90% |
| `apps/forge/components/dashboard/mock-data.ts` | 192 | ~40 (types only) | -79% |

## 10. Files That Will Be Created

**Backend:**
- `backend/app/api/v1/architecture/tech_radar.py`
- `backend/app/api/v1/architecture/diagrams.py`
- `backend/app/api/v1/architecture/metrics.py`
- `backend/app/api/v1/specs.py`
- `backend/app/api/v1/tickets.py`
- `backend/alembic/versions/step_XX_adr_component_impact.py`
- `backend/alembic/versions/step_XX_tech_radar.py`

**Frontend:**
- `apps/forge/lib/architecture/adapters.ts` — `toADRWithMeta(apiAdr, links)`
- `apps/forge/lib/hooks/useTickets.ts`
- `apps/forge/lib/hooks/useSpecs.ts`
- `apps/forge/lib/hooks/useTechRadar.ts`
- `apps/forge/lib/hooks/useDiagrams.ts`
- `apps/forge/lib/hooks/useADRLinks.ts`
- `apps/forge/lib/hooks/useDecisionVelocity.ts`
- `apps/forge/lib/hooks/useCurrentProjectId.ts`

**CI:**
- `scripts/check-no-mocks.sh`

## 11. Risks & Mitigations

1. **`computeHealth()` is called at module-load.** If wired to live data, it must become a hook (`useHealthMetrics()`) that fetches lazily. Otherwise SSR breaks.
2. **`MOCK_SERVICES` is a derived view.** Wiring requires either a `/architecture/services` aggregation endpoint OR a `services` table. **Decision: defer — show empty state with copy.**
3. **Ticket ingest is a side-effect of connector sync** (`POST /connectors/{id}/sync` populates `ConnectorSyncEvent`). A clean `tickets` table means choosing between denormalized reads vs writing a sync-time copier.
4. **Traceability matrix requires real edges.** Verify FK relationships exist before declaring this done.
5. **Architecture Version persistence needs audit log replay.** Currently `create_version` is no-op. Stub 3 versions on seed for now.
6. **Type-drift after API changes.** Re-run `scripts/gen-api-catalog.py` and `scripts/gen-db-schema.py` after each backend PR.

---

## 12. Summary for the User

- **Total mocks removed:** 28 symbols across 8 files.
- **Total LoC eliminated:** 1,347 (dead) + ~1,400 (kept-types-only).
- **New backend endpoints:** 5 (tech-radar, diagrams, decision-velocity, specs, tickets) + 3 implementations (versions, traceability, adr-links).
- **Frontend hooks needed:** 6 new + 1 shared (`useCurrentProjectId`).
- **Effort:** 10 working days for one engineer.
- **First action:** Day 1, Hour 1 — edit `apps/forge/app/architecture/page.tsx` line 2106 to pass `{project_id: projectId}` to all 6 hooks. Verify real ADRs render. That's the proof point for the whole plan.
