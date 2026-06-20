# Forge AI-393 — UI / Visualization Spine Plan (Index)

**Issue:** [Forge AI-393](/Forge AI/issues/Forge AI-393) — UI / Visualization Spine Plan
**Owner:** Senior Engineer (primary; Designer hire pending)
**Mode:** planning — no code, no implementation subtasks
**Master anchor:** [Forge AI-388](/Forge AI/issues/Forge AI-388) master plan (rev `3ea71321`)
**Charter Principle 5:** *Everything is visualized. Forge UI is the workbench.*

---

## 0. Quick start

This directory holds **five plan documents** for the UI / Visualization spine of Forge AI. The plans are the deliverable for [Forge AI-393](/Forge AI/issues/Forge AI-393); the work they describe is downstream — implementation children land after the board approves the plans.

Reading order:

1. **[01 — Core UI Module Map](./01-core-ui-module-map.md)** — what surfaces Forge UI ships (thirteen centers) and what typed artifacts each one surfaces.
2. **[02 — React Flow Graph Spec](./02-react-flow-graph-spec.md)** — the four React Flow canvases (Knowledge Graph, Architecture Graph, Dependency Graph, Audit Timeline Graph) and the typed graph provider that feeds them.
3. **[03 — Design System Spec](./03-design-system-spec.md)** — Shadcn UI base + KnackForge brand overlay + dark/light + WCAG 2.2 AA.
4. **[04 — Component Library Plan](./04-component-library-plan.md)** — `@fora/forge-ui` package + eight typed-artifact renderers (+ Audit + Approval) + shell + charts + trees + tables + forms.
5. **[05 — GSD Workbench Surface Plan](./05-gsd-workbench-surface-plan.md)** — how Forge UI surfaces the GSD workbench (Run mode, Goal mode, Operator mode) and how it reconciles with Phase 2 ([Forge AI-392](/Forge AI/issues/Forge AI-392)).

A reader who starts with the index and reads the five plans in order should come out with the same mental model as the board reviewer who reads them cold.

---

## 1. What this plan is

A planning artifact that produces five plan documents. The plans are:

- The **contract** between the design system (Plan 3), the component library (Plan 4), and the per-spine work the implementation children will pick up.
- The **acceptance bar** for "is this center done?" — a center is done when it satisfies the contracts in Plan 1 + Plan 2 + Plan 3 + Plan 4 + Plan 5.
- The **reconciliation point** for the parallel spines (Forge AI-389 / 390 / 391 / 392 / 398 / 399) — each plan names the upstream and downstream it reconciles with.

---

## 2. What this plan is not

- **Not an implementation plan.** No code, no test fixtures, no implementation subtasks. The implementation children (one per center in v1.0) come **after** board approval.
- **Not an ADR.** The one-way-door choices (Next.js 15 vs 14, Shadcn vs MUI, dagre vs elk, polling vs SSE in v1.0) are surfaced as board Q's inside the plans, not as standalone ADRs. The CTO will file ADRs for the chosen options after the board approves the plans.
- **Not a scope commitment.** The thirteen centers split into v1.0 / v1.1 / v1.2 release bands in Plan 1 §5. The board can pull centers between bands.

---

## 3. Reconciliation matrix

| Plan | Reconciles with | Direction |
|------|----------------|-----------|
| 01 — Core UI Module Map | Forge AI-389 Foundation; Forge AI-390 Phase 0; Forge AI-392 Phase 2; Forge AI-398 Connector Center; Forge AI-399 Audit + Governance Centers | Upstream + downstream |
| 02 — React Flow Graph Spec | Forge AI-390 (Knowledge / Architecture / Dependency Graph producers); Forge AI-399 Audit Center | Downstream consumer of Forge AI-390 producers |
| 03 — Design System Spec | tech-stack.md §11 (Shadcn + Tailwind); customer/standards.md §7 (WCAG inheritance); Forge AI-398 (status colors); Forge AI-399 (audit + governance palette) | Upstream of all four other plans |
| 04 — Component Library Plan | Forge AI-389 Foundation; Handoff Contract (memory/architecture.md §7); memory/qa.md §2 (four test tiers) | Upstream of all four other plans (consumed by) |
| 05 — GSD Workbench Surface Plan | Forge AI-392 Phase 2; memory/architecture.md §5 (seven stages); Forge AI-374 (existing operator console); memory/security.md §6 (audit trail) | Downstream of all four other plans (composes) |

---

## 4. Open questions to surface at board review (consolidated)

The board sees 25 questions across the five plans. The five **load-bearing** questions — the ones the answer changes the plan — are:

| # | Plan | Question | Why load-bearing |
|---|------|----------|------------------|
| 1 | Plan 3 §9 Q1 | Is Next.js 15 (charter) or Next.js 14 (tech-stack.md) the chosen version? | Every center depends on it. |
| 2 | Plan 1 §7 Q2 | Is the Analytics Center v1.1 or v1.2? | Cost is the wedge. |
| 3 | Plan 2 §9 Q1 | Is `dagre` good enough as the default layout? | Drives v1.0 vs v1.1 layout dep. |
| 4 | Plan 4 §11 Q4 | Are charts allowed in v1.0 centers, or strictly v1.1+? | Changes scope of v1.0. |
| 5 | Plan 5 §10 Q1 | Polling default in v1.0 — 5s, 1s, or configurable? | Drives user expectation. |

The other 20 questions are scoped to a single plan and do not require a cross-plan decision.

---

## 5. Acceptance bar (board gate)

Per the issue description, all five plans must be approved via a single `request_confirmation` interaction on Forge AI-393. The interaction's `prompt` field carries the consolidated board ask; the `idempotencyKey` follows the pattern `confirmation:{issueId}:plan:{revisionId}` per the planning directive.

When the board approves, Forge AI-393 moves to `done`. The downstream implementation children (one per v1.0 center per Plan 1 §5.1) are dispatched **after** the approval lands.

---

## 6. Related

- [Forge AI-388 master plan](/Forge AI/issues/Forge AI-388) — the parent rev (`3ea71321`).
- [Forge AI-389 Foundation](/Forge AI/issues/Forge AI-389) — the typed-artifact schemas the renderers consume.
- [Forge AI-390 Phase 0](/Forge AI/issues/Forge AI-390) — the Knowledge / Architecture / Dependency Graph producers.
- [Forge AI-392 Phase 2](/Forge AI/issues/Forge AI-392) — the customer-facing surface the Workbench reconciles with.
- [Forge AI-398 Connector Center](/Forge AI/issues/Forge AI-398) — the typed-artifact view the Connector Center center reconciles with.
- [Forge AI-399 Audit + Governance Centers](/Forge AI/issues/Forge AI-399) — the deeper audit + governance flows the centers reconcile with.
- [workspace/project/tech-stack.md §11](../../project/tech-stack.md#11-customer-facing-surface) — the stack the design system reconciles with.
- [workspace/customer/standards.md §7](../../customer/standards.md#7-accessibility) — the WCAG inheritance line.

---

## 7. Change log

| Rev | Date | Author | What changed |
|-----|------|--------|--------------|
| v0.1 | 2026-06-20 | Senior Engineer (`27431e10-…`) | Index for the five plan documents. |