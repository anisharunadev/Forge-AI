# Product: Golden Workflow

> **Status:** 📜 Contract — defines "done" for M15-1 (Golden Workflow MVP).
> **Doc owner:** Product + Platform team
> **Source of truth:** this file + `tests/e2e/golden_workflow.test.py`
> **Last updated:** 2026-07-07
> **Introduced by:** M15-1 (Product Hardening milestone)

---

## What this document is

The 5-step hero path that Forge customers walk to take a software idea from
requirement to production through governed AI workflows — the proof that
Forge is one product, not twelve modules.

If a step in this contract does not work end-to-end with **real data,
zero console errors, zero mock branches**, M15-1 has not shipped.

---

## The 5 hero steps

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  1. Idea │ →  │  2. PRD  │ →  │ 3. ADR   │ →  │ 4. Task  │ →  │ 5. Review│
│  capture │    │ generate │    │ generate │    │ breakdown│    │ (HITL)   │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

| # | Step | Frontend route | Primary component | Hook | Backend endpoint | Forge command | Typed artifact (R4) |
|---|---|---|---|---|---|---|---|
| 1 | Idea capture | `/ideation` (CaptureModal tab) | `components/ideation/IdeaIntakeDialog.tsx` | `useCreateIdea` (`lib/hooks/useIdeation.ts:328`) | `POST /api/v1/ideation/ideas` | `forge-ideate-refine` | `IdeaCreate` |
| 2 | PRD generate | `/ideation` (PRDs tab) | `components/ideation/IdeationPRDPanel.tsx` | `useGeneratePRD` (`lib/api/ideation-hooks.ts:224`) | `POST /api/v1/ideation/ideas/{idea_id}/prd` | *(none — bypasses registry)* | `PRDResponse` |
| 3 | ADR generate | `/architecture?tab=adrs` | `components/architecture/ADRCreateDialog.tsx` | `useCreateADR` (`lib/hooks/useArchitecture.ts:226`) | `POST /api/v1/architecture/adrs` | `forge-arch-adr` | `ADRResponse` |
| 4 | Task breakdown | `/architecture?tab=tasks` | `components/architecture/TaskBreakdownTree.tsx` | `useCreateTaskBreakdown` (`lib/hooks/useArchitecture.ts:453`) | `POST /api/v1/architecture/task-breakdowns` | *(none — bypasses registry)* | `TaskBreakdownResponse` |
| 5 | Review (HITL) | `/architecture?tab=adrs&adr=<id>` (Review sub-tab) | `components/architecture/ApprovalStatusBadge.tsx` + `components/audit/ApprovalTimeline.tsx` | `useRequestApproval` + `useDecideApproval` (`lib/hooks/useArchitecture.ts:523,539`) | `POST /api/v1/architecture/approvals` + `POST /api/v1/architecture/approvals/{id}/decide` | `forge-arch-review` | `ArchitectureApprovalResponse` |

---

## SDLC supervisor (the runtime that ties these together)

Per `docs/product/vision.md` L150–L166, the 5 steps map to the existing
LangGraph supervisor at `backend/app/agents/sdlc_agent.py`. The hero path
exercises these nodes:

```
Discovery → Planning → Architecture (steps 3–4) → Review (step 5) → HITL gate → Deployment
```

- **State schema:** `backend/app/agents/sdlc_state.py` (`SDLCState` TypedDict)
- **Run lifecycle:** `backend/app/services/sdlc_run_manager.py`
- **HITL gate:** `backend/app/agents/approval_gate.py` (`ApprovalGateNode`)
- **Phase envelope (R3):** `require_approval_phase(SDLCPhase.ARCHITECTURE)` decorator

The hero path **does not** need a new supervisor. It needs the existing
5 hero-step mutations wired to the existing supervisor's architecture-phase
nodes — that's the "thin orchestrator client" the M15-1 plan called out.

---

## Current state — REAL vs STUB (verified 2026-07-07)

| # | Step | Backend | Frontend read | Frontend mutate | Forge command | Audit (R6) |
|---|---|---|---|---|---|---|
| 1 | Idea capture | ✅ REAL | ✅ REAL | ✅ REAL (button wired) | ✅ REAL (5 `forge-ideate-*`) | ✅ REAL |
| 2 | PRD generate | ✅ REAL | ✅ REAL | ⚠️ **STUB** — `onGenerate` callback wired to `handleGeneratePreview` (arch-preview), not PRD; `useGeneratePRD` hook has no UI caller (`app/ideation/page.tsx:139`) | ❌ MISSING — no `forge:ideation:prd` in registry | ✅ REAL |
| 3 | ADR generate | ✅ REAL | ✅ REAL | ✅ REAL | ✅ REAL (`forge-arch-adr`) | ✅ REAL (`@audit(action="architecture.adr.*")`) |
| 4 | Task breakdown | ✅ REAL | ✅ REAL | ⚠️ **STUB** — `useTaskBreakdowns` (list) wired at `architecture/page.tsx:2041`; `useCreateTaskBreakdown` and `useUpdateTask` exist but **no UI caller invokes them** | ❌ MISSING — no `forge-arch-task-breakdown` | ✅ REAL |
| 5 | Review (HITL) | ✅ REAL | ⚠️ **STUB** — page.tsx renders mock reviewers (line 1369 hard-codes `priya.r`) and toast stubs (line 1222 `toast.info('Open review request')`); real hooks unused on architecture page | ⚠️ **STUB** — same as read | ⚠️ **PARTIAL** — `forge-arch-review` exists but no `forge-arch-approve` / `forge-arch-deny` | 🟥 **GAP** — `@audit(...)` decorator emits `structlog audit.event` but does **not** insert into `audit_events` table; `ArchitectureApprovalWorkflow` factory at `approvals.py:34` doesn't pass `audit_service`, so terminal grant/deny never land in `audit_events` |

**Three frontend stubs + one R6 audit gap.** The backend is real for all 5 steps.

---

## Gaps to close before M15-1 ships

### Gap 1 — Step 2 PRD: wire the generate button
- **File:** `apps/forge/app/ideation/page.tsx:139`
- **Fix:** replace `handleGeneratePreview` callback with `handleGeneratePRD` that invokes `useGeneratePRD` (already imported in `lib/api/ideation-hooks.ts:224`)
- **Acceptance:** clicking "Generate PRD" on a captured idea calls `POST /ideation/ideas/{id}/prd` and renders the generated PRD in `IdeationPRDPanel.tsx`
- **Lines:** ~30 (new handler + wire)

### Gap 2 — Step 4 Task Breakdown: wire the generate button
- **File:** `apps/forge/app/architecture/page.tsx` (search for `useTaskBreakdowns` at L2041; the create button is missing above the `TaskBreakdownTree`)
- **Fix:** add a "Generate breakdown from ADR" button that takes the selected ADR id and calls `useCreateTaskBreakdown({ adr_id, project_id })`
- **Acceptance:** selecting an ADR + clicking the button calls `POST /architecture/task-breakdowns` and the generated tree mounts in `TaskBreakdownTree`
- **Lines:** ~40 (button + handler)

### Gap 3 — Step 5 Review: replace mock UI with real hooks
- **Files:** `apps/forge/app/architecture/page.tsx:1222` (review buttons), `apps/forge/app/architecture/page.tsx:1369` (reviewer list)
- **Fix:** replace the hard-coded `priya.r` reviewer + `toast.info('Open review request')` stubs with calls to `useApprovals`, `useRequestApproval`, `useDecideApproval`
- **Acceptance:** opening an ADR's review tab lists real pending approvals; clicking "Approve" / "Deny" calls `POST /architecture/approvals/{id}/decide` with `decision: "approve"` or `decision: "deny"` (R15 typed)
- **Lines:** ~80 (3 component swaps)

### Gap 4 — Step 5 R6 audit: insert into `audit_events` table
- **Files:** `backend/app/api/v1/architecture/approvals.py:34` (`_workflow()` factory) + `backend/app/services/architecture/approval_workflow.py:279-303` (`decide()` method)
- **Fix:** pass `audit_service` to `ArchitectureApprovalWorkflow` constructor at the factory; inside `decide()`, call `audit_service.record(actor=..., action="architecture.approval.grant"|"deny", artifact_id=..., tenant_id=..., project_id=...)`
- **Acceptance:** after a `decide()` call, `GET /audit?actor=...` returns the grant/deny row
- **Lines:** ~20 (factory + service method body)

### Gap 5 (optional) — Add missing forge-commands
- **Files:** `backend/app/services/forge_commands.py`
- **Add:** `("forge-prd-generate", "gsd:ideation:prd", "Generate a PRD from an idea.", "ideation", True)` and `("forge-arch-task-breakdown", "gsd:arch:task_breakdown", "Generate a task breakdown from an ADR.", "architecture", True)`
- **Acceptance:** the commands appear in `lib/forge-commands.ts` (re-generated) and Command Center ⌘K auto-discovers them (R9)
- **Lines:** ~4 (registry entries)

### Gap 6 (optional) — PRD list endpoint
- **Files:** `backend/app/api/v1/ideation/prds.py`
- **Add:** `GET /ideation/prds?project_id=...` (flat list, paginated)
- **Acceptance:** `usePRDsAdapter` no longer returns empty (`lib/hooks/useIdeationAdapters.ts:375-378`); `PRDList` renders real rows
- **Lines:** ~30 (new endpoint + service method)

---

## Acceptance for M15-1

- [ ] All 5 steps end-to-end runnable against seeded data.
- [ ] Gaps 1–4 closed (Gaps 5–6 optional, defer to next sprint).
- [ ] `tests/e2e/golden_workflow.test.py` walks the full 5-step path with real fixtures and passes.
- [ ] Frontend console: zero errors, zero `mockData` / `mockExtractFromUrl` / `mock reviewers` hits.
- [ ] `audit_events` table contains one row per step (1 idea, 1 PRD, 1 ADR, 1 breakdown, 1 approval grant).
- [ ] Loading / error / empty / permission states render real (not mock) on every hero step.
- [ ] The hero path is reachable from the welcome page (`apps/forge/app/welcome/page.tsx`) in ≤ 2 clicks.

---

## Verification

```bash
# Bring up the stack
docker compose up -d redis postgres keycloak
python -m seeds

# Run backend + UI
uvicorn app.main:app --reload --port 8000
pnpm dev

# Run the e2e
pytest tests/e2e/golden_workflow.test.py -v
```

Manual demo: create workspace → onboard → Capture idea → Generate PRD →
Generate ADR → Generate Task Breakdown → Request review → Approve →
check Audit Center for 5 rows.

---

## What M15-1 is NOT

- **Not a new LangGraph supervisor.** Reuses `backend/app/agents/sdlc_agent.py`.
- **Not new typed artifacts.** Reuses schemas in `backend/app/schemas/architecture.py`.
- **Not new centers.** Steps 1–5 are within existing Ideation + Architecture Centers.
- **Not a redesign.** Pure integration work — gap closure, button wiring, R6 fix.

If a customer asks for "the 7-step path" (HoP's stretch: + Approval gate +
PR creation), the answer is: *finish the 5-step hero first; then we
stretch.*

---

## Change process

This document is **the contract**. Changes to the 5-step path, the step
ordering, or the typed-artifact mapping require an Architecture Decision
Record (ADR) per `docs/standards/git-workflow.md`. Implementation changes
that close Gaps 1–4 do NOT require an ADR — they're tracked as PRs against
this contract.