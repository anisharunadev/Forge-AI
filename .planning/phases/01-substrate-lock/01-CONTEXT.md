# Phase 1: Substrate Lock - Context

**Gathered:** 2026-07-07
**Status:** Ready for execution
**Mode:** Auto-generated (smart-discuss → infrastructure phase, no grey areas)

<domain>
## Phase Boundary

Make pilot traffic safe by enforcing deterministic gates, cost admission, and tool-bundle boundaries before any pilot cutover. This is a pure substrate phase — no user-facing UI; all work is in `backend/` and the SDLC supervisor graph. All 9 plans are already drafted (`01-01..01-09-PLAN.md`) and target the four constitutional pitfalls (PITFALL-1/2/5/6) plus the F-501/503/505/507/601/504 features and ADR-009/010/011 schemas.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure substrate phase. The 9 existing PLAN.md files are the source of truth for execution order, files modified, and acceptance criteria.

</decisions>


## Existing Code Insights

### Reusable Assets
- `backend/app/services/litellm_client.py` — Rule 1 enforcement point for cost admission (01-02)
- `backend/app/agents/sdlc_agent.py` — supervisor graph; targets BasePhaseNode (01-03)
- `backend/app/services/audit_service.py` — append-only audit chain (01-03)
- `backend/app/api/v1/_package_wiring.py` — router registration seam (01-01)
- `docker-compose.yml` — OTel exporter mount target (01-03)

### Established Patterns
- ADR-first: every new schema (cost ledger, conflict, KMS) is accepted as an ADR before any code lands (01-09).
- Approval phases: Architecture / Security / Deployment are constitutional boundaries (Rule 3); `@require_approval_phase(...)` decorator is the enforcement pattern (01-01).
- Audit default sink: `BasePhaseNode` writes through `audit_service.record` by default (Rule 6 + 01-03).

### Integration Points
- All 9 plans modify `backend/app/**`; no frontend changes.
- Plans 01-01 (approval gate) and 01-03 (audit/OTel) are wave-1 blockers — every other plan depends on them.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — substrate phase. Refer to the 9 PLAN.md files for per-plan specifics:
- 01-01: `@require_approval_phase(...)` decorator + frozen run-state (PITFALL-1)
- 01-02: pre-call cost admission in `litellm_client.py` (PITFALL-2)
- 01-03: audit/OTel default sink wiring (PITFALL-5)
- 01-04: `APPROVAL_EXPIRED` scheduler (PITFALL-6)
- 01-05: Code Validator sub-graph (F-501)
- 01-06: Merge Gate (F-503) + Tool Bundles (F-505)
- 01-07: Workflow Budget (NFR-044) + Day-One Bootstrap (F-507)
- 01-08: Refactor Agent (F-601) + Steering Rules (F-504)
- 01-09: ADR-009/010/011 schemas accepted

</specifics>

<deferred>
## Deferred Ideas

None — pure substrate phase, no scope creep candidates surfaced.

</deferred>