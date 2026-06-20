# Plan 4 — Component Library Plan

**Issue:** [Forge AI-393](/Forge AI/issues/Forge AI-393) — UI / Visualization Spine Plan
**Owner:** Senior Engineer (primary; Designer hire pending — design-system work carved out for the future hire per the issue description)
**Mode:** planning — no code, no implementation subtasks
**Reconciles with:** [Forge AI-388](/Forge AI/issues/Forge AI-388) master plan (rev `3ea71321`); Foundation ([Forge AI-389](/Forge AI/issues/Forge AI-389)); the typed-artifact definitions across `workspace/memory/` and `workspace/project/`; the Handoff Contract schema in [memory/architecture.md §7](../../memory/architecture.md#7-handoff-contract)
**Companion plans:** [01-core-ui-module-map.md](./01-core-ui-module-map.md) · [02-react-flow-graph-spec.md](./02-react-flow-graph-spec.md) · [03-design-system-spec.md](./03-design-system-spec.md) · [05-gsd-workbench-surface-plan.md](./05-gsd-workbench-surface-plan.md)
**Charter Principle 5:** *Everything is visualized. Forge UI is the workbench.*

---

## 1. Why a component library plan

Every center in Plan 1 needs to render the same typed artifacts (Requirement, ADR, API Contract, Task, Patch, Test Report, Security Report, Deployment Plan) in consistent ways. Without a shared library:

- A Patch in the Development Center looks different from a Patch mentioned in the Audit Center.
- A Test Report rendered as a card in Testing Center has different controls from the same Test Report cited in a Story view in Project Intelligence.
- Accessibility regressions get reintroduced every release because no one owns the renderer.

This plan pins the **renderer contract** and the **shared package layout** before the implementation children start building centers.

### 1.1 What the component library is not

- **Not a design system.** Visual tokens live in Plan 3; this plan consumes them.
- **Not a chart library.** Charts (Recharts) and graphs (React Flow) are separately consumed; see Plan 2 §1.
- **Not a form library.** Forms use React Hook Form + Zod; see §4 below.
- **Not a table library.** Tables use TanStack Table; see §7 below.

---

## 2. Package layout

The component library ships as `@fora/forge-ui` (a workspace package, sibling to `@fora/forge` which is the existing Forge AI-374 console). The package re-exports:

```
@fora/forge-ui
├── shell/                  # the layout shell (top bar, left rail, main, right panel)
├── tokens/                 # re-exports the brand tokens from Plan 3
├── primitives/             # shadcn-wrapped primitives (Button, Input, Select, …)
├── typed-artifacts/        # the eight typed-artifact renderers (§3)
├── graph/                  # the React Flow canvas primitives (consumed by Plan 2)
├── charts/                 # the Recharts wrappers (consumed by Analytics Center)
├── forms/                  # the React Hook Form + Zod helpers
├── lists/                  # the TanStack Table wrappers and the typed list helpers
├── tree/                   # the tree component (org chart, taxonomy)
├── a11y/                   # focus-visible, skip-link, live-region helpers
└── testing/                # test-only utilities (axe, renderWithProviders)
```

The package is **typed end-to-end** — every renderer accepts the typed-artifact shape from the Handoff Contract schema, not an `any`.

---

## 3. The eight typed-artifact renderers

Each renderer is the contract between the typed-artifact producer (the agent runtime, the analyzer, the broker) and the typed-artifact consumer (every center that needs to show it). The renderer is the single source of truth for "how an X looks in Forge UI".

### 3.1 RequirementRenderer

- **Typed artifact.** `Requirement` (covers `requirement_brief.json`, `draft_prd.md`, and `OpenQuestion`).
- **Variants.** `card` (summary), `inline` (linked citation), `panel` (full side panel).
- **What it shows.**
  - Title, source, schema version.
  - Sections: problem, target users, success metrics, out-of-scope, open questions.
  - For `OpenQuestion`: owner, blocks, due-by, and a "needs answer" badge.
- **Actions.**
  - "View source" → opens the originating file in the Knowledge Center.
  - "Mark answered" → opens the answer flow (Plan 4 §3.10).
  - "Pin" → adds to the user's pinned artifacts.
- **Used by.** Project Intelligence, Dashboard, Knowledge Center.
- **Reconciles with.** Foundation ([Forge AI-389](/Forge AI/issues/Forge AI-389)); the requirement brief schema.

### 3.2 AdrRenderer

- **Typed artifact.** `Adr` (Architecture Decision Record).
- **Variants.** `card`, `inline`, `panel`, `compact-list-row`.
- **What it shows.**
  - Number, title, status (proposed / accepted / superseded / deprecated).
  - Decision date, deciders.
  - Context, decision, consequences.
  - Supersedes / superseded-by chain.
- **Actions.**
  - "Open ADR" → opens the ADR viewer.
  - "Mark superseded" → opens the supersede flow.
  - "Show in graph" → jumps to the Architecture Graph and centers on this ADR.
- **Used by.** Development Center, Project Intelligence, Architecture Graph.
- **Reconciles with.** ADR registry ([project/adr-registry.md](../../project/adr-registry.md)).

### 3.3 ApiContractRenderer

- **Typed artifact.** `ApiContract` (covers OpenAPI 3.x, GraphQL SDL, AsyncAPI 2.x).
- **Variants.** `summary`, `detail`, `diff` (two versions side-by-side).
- **What it shows.**
  - Name, version, format (openapi / graphql / asyncapi).
  - Endpoints / queries / channels with HTTP method, path, parameters, request body, response.
  - For `diff`: added/removed/changed endpoints.
- **Actions.**
  - "Try it" → opens the request builder (when the customer's tenant is in `try-it-allowed` mode).
  - "Show in graph" → jumps to the Architecture Graph.
  - "Download spec" → exports the spec file.
- **Used by.** Project Intelligence, Development Center, Knowledge Center.
- **Reconciles with.** Foundation ([Forge AI-389](/Forge AI/issues/Forge AI-389)); the OpenAPI generator in [Forge AI-119](../../memory/project-fora-119-api-docs-generator.md).

### 3.4 TaskRenderer

- **Typed artifact.** `Task` (covers Paperclip issue + Jira issue + GitHub issue; the renderer normalizes).
- **Variants.** `compact-list-row`, `card`, `panel`, `kanban-card`.
- **What it shows.**
  - Title, status, owner, priority.
  - Blocked-by list, blocks list.
  - Stage (BMAD), run id (if in flight).
  - Last activity timestamp.
- **Actions.**
  - "Open" → opens the task in the Project Intelligence center.
  - "Reassign" → opens the reassign flow (subject to RBAC).
  - "Pause / Resume / Cancel" → calls the orchestrator (when the task is a run).
- **Used by.** Project Intelligence, Dashboard, Agent Center, GSD workbench.
- **Reconciles with.** The Paperclip issue shape ([reference-paperclip-agent-enums.md](../../memory/reference-paperclip-agent-enums.md)); the Jira + GitHub MCP shapes.

### 3.5 PatchRenderer

- **Typed artifact.** `Patch` (a code change set, produced by the Developer agent).
- **Variants.** `summary`, `diff`, `panel`, `pr-link`.
- **What it shows.**
  - Title, files-changed count, additions, deletions.
  - Diff view (side-by-side or unified) with syntax highlighting.
  - Test impact: "this patch exercises these test files."
  - Linked PR(s) + review state.
- **Actions.**
  - "Show in graph" → jumps to the Dependency Graph, centered on the affected modules.
  - "View PR" → opens the PR viewer.
  - "View tests" → opens the Test Report.
- **Used by.** Development Center, Project Intelligence, Audit Center.
- **Reconciles with.** The Developer agent ([Forge AI-70](../../memory/project-fora-70-coding-agent.md)); the Reviewer ([Forge AI-71](../../memory/project-fora-71-reviewer-shipped.md)).

### 3.6 TestReportRenderer

- **Typed artifact.** `TestReport` (per tier: Unit, Integration, Contract, E2E).
- **Variants.** `summary-card`, `detail-panel`, `coverage-map`.
- **What it shows.**
  - Tier, pass/fail/skip counts, duration.
  - Failing tests with the failure message + stack link.
  - Coverage map (linked to the Dependency Graph nodes this report covers).
  - Flake ledger entry if any.
- **Actions.**
  - "Re-run" → kicks off a re-run (when RBAC allows).
  - "Show in graph" → jumps to the Dependency Graph.
  - "File a flake" → adds a FlakeEntry.
- **Used by.** Testing Center, Project Intelligence, Development Center.
- **Reconciles with.** [memory/qa.md §2](../../memory/qa.md#2-the-four-test-tiers).

### 3.7 SecurityReportRenderer

- **Typed artifact.** `SecurityReport` (per [memory/security.md](../../memory/security.md)).
- **Variants.** `summary-card`, `detail-panel`, `finding-list`.
- **What it shows.**
  - Stage the report covers (Ideation, Architect, Dev, etc.).
  - Severity histogram (Critical / High / Medium / Low / Info).
  - Findings list with exploit path, fix recommendation, and the affected module(s).
  - Threat-model link, secrets-inventory link.
- **Actions.**
  - "File an exception" → opens the exception flow (RBAC-gated).
  - "Open fix task" → creates a Story in Project Intelligence.
  - "Show in graph" → jumps to the Dependency Graph, centered on the affected modules.
- **Used by.** Security Center, Audit Center, Project Intelligence.
- **Reconciles with.** [memory/security.md](../../memory/security.md); the secrets-mcp ([Forge AI-128](../../memory/project-fora-128-secrets-mcp-v0.md)).

### 3.8 DeploymentPlanRenderer

- **Typed artifact.** `DeploymentPlan` + `RunLog` + `RollbackRecord` (DevOps stage).
- **Variants.** `summary-card`, `detail-panel`, `run-log-table`.
- **What it shows.**
  - Target env, version, deploy strategy (blue-green / canary / rolling).
  - Approval state, deployer, time-window.
  - Run log (per-step status), canary health snapshot (per [Forge AI-194](../../memory/project-fora-194-canary-probe.md)).
  - Rollback plan and last rollback record (if any).
- **Actions.**
  - "Approve / Decline" (RBAC-gated).
  - "Rollback" → opens the rollback confirmation flow.
  - "Show in audit" → jumps to the Audit Timeline Graph filtered to this deploy.
- **Used by.** Deployment Center, Project Intelligence, Audit Center.
- **Reconciles with.** [memory/devops.md](../../memory/devops.md); the customer-cloud-broker ([Forge AI-126](../../memory/project-fora-126-ccb-v1-shipped.md)).

### 3.9 AuditEntryRenderer

- **Typed artifact.** `AuditEntry` (per [memory/security.md §6](../../memory/security.md#6-audit-log)).
- **Variants.** `row`, `panel`, `export-row`.
- **What it shows.**
  - Timestamp, actor, tenant, tool, query_hash, response_hash.
  - Latency, tokens, cost.
  - Linked typed artifact (the artifact the entry touched).
- **Actions.**
  - "View source" → opens the audit entry in full.
  - "Filter to actor" → pins the actor filter.
  - "Export" (v1.1) → adds the entry to an export bundle.
- **Used by.** Audit Center, Audit Timeline Graph, every center's "history" sidebar.
- **Reconciles with.** [Forge AI-399](/Forge AI/issues/Forge AI-399) Audit Center plan.

### 3.10 ApprovalRequestRenderer

- **Typed artifact.** `ApprovalRequest` (a Paperclip interaction).
- **Variants.** `inline-banner`, `panel`, `history-row`.
- **What it shows.**
  - Prompt, options (when `ask_user_questions`).
  - State (pending / accepted / declined / expired).
  - Decider, decision timestamp, reason (if declined).
  - Idempotency key (for board-confirmation requests).
- **Actions.**
  - "Accept" / "Decline" (RBAC-gated; the Board token is the only one that can accept `request_confirmation`).
  - "Open thread" → opens the issue thread.
- **Used by.** Governance Center, Dashboard, every center that surfaces an in-flight approval.
- **Reconciles with.** [reference-paperclip-interaction-schema.md](../../memory/reference-paperclip-interaction-schema.md).

---

## 4. Forms (React Hook Form + Zod)

Every form in Forge UI is built with React Hook Form + Zod. The library exposes:

- `useTypedForm<T>(schema, defaultValues)` — a typed wrapper around RHF that wires the Zod resolver.
- `TypedFormField` — a typed field component with built-in label, error, and help text.
- `TypedFormSection` — a typed section component for multi-section forms.

The form library owns the **submit + validation contract**: a form cannot submit until the Zod schema passes. This is the only place validation lives; ad-hoc `if (valid)` checks are forbidden in component code.

### 4.1 Accessibility

Every form field has:
- An associated `<label>` (per WCAG 3.3.2).
- Inline error messages announced via `aria-describedby`.
- A `role="alert"` region for the form-level error summary.
- Visible focus (per Plan 3 §5).

---

## 5. Charts (Recharts)

Recharts is the chart library. The component library exposes typed wrappers:

- `LineChart<T>` — for trends (cost over time, eval score over time).
- `BarChart<T>` — for comparisons (cost by agent, calls by MCP).
- `StackedAreaChart<T>` — for cumulative comparisons.
- `Heatmap<T>` — for coverage maps, eval matrices.
- `Sparkline<T>` — for inline trend previews in cards.

All charts:
- Inherit the design tokens (Plan 3).
- Are color-blind safe by default (no red/green-only distinctions).
- Have an accessible data table fallback (per WCAG 1.1.1).
- Are not interactive graphs — those are React Flow (Plan 2).

---

## 6. Trees

Org charts, taxonomy trees, and file trees use a tree component (not React Flow). The component exposes:

- `Tree<T>` — a generic tree with typed nodes.
- `OrgTree` — a typed wrapper for org charts (uses the `Person` typed artifact).
- `FileTree` — a typed wrapper for Knowledge Layer file trees.

The tree is keyboard-navigable per Plan 3 §5.

---

## 7. Tables (TanStack Table)

Every list view that grows beyond 20 rows uses TanStack Table. The component library exposes:

- `TypedTable<T>` — a typed wrapper with built-in sort, filter, and pagination.
- `TypedTableToolbar` — the filter + export bar.
- `TypedTableEmptyState` — the empty state.

A typed list view that does not use `TypedTable` is a review blocker.

---

## 8. The shell

The shell is the layout that wraps every center (Plan 3 §6). It is exported from `@fora/forge-ui/shell` and consumes:

- The persona switcher.
- The theme switcher.
- The global search.
- The notification bell.
- The budget meter.

The shell is **not a center** and is **not** part of this issue's typed-artifact taxonomy.

---

## 9. The testing harness

Per [tech-stack.md §11](../../project/tech-stack.md#11-customer-facing-surface):

- **axe-core** runs in CI on every renderer and every form (via Playwright).
- **Vitest** + **Testing Library** for unit tests of each renderer (renders with the typed artifact fixture, asserts the DOM, asserts the keyboard contract).
- **Storybook** (deferred to v1.1) — every renderer has a story with all variants.
- **Visual regression** (Chromatic or Percy, deferred to v1.1) — every renderer snapshot-tested.

The four test tiers per [memory/qa.md §2](../../memory/qa.md#2-the-four-test-tiers) apply:

- **Unit** — renderer renders the typed artifact fixture correctly.
- **Integration** — renderer renders the typed artifact inside a center's main canvas.
- **Contract** — renderer's props match the typed-artifact schema (via Zod round-trip).
- **E2E** — a real PM uses the renderer to complete a real task (per [Forge AI-374 e2e smoke](../../apps/forge/playwright.config.ts)).

---

## 10. Reconciliation notes

- **vs. Foundation ([Forge AI-389](/Forge AI/issues/Forge AI-389))**: every typed artifact here has a corresponding entry in Foundation's typed-artifact table. The renderer is the UI twin of the Foundation schema.
- **vs. Handoff Contract (memory/architecture.md §7)**: every typed artifact the renderer consumes has a defined schema in the Handoff Contract. The renderer is the typed boundary between the agent runtime's output and the customer's view.
- **vs. Plan 1 / Plan 2 / Plan 3 / Plan 5**: the renderers are the surface every center (Plan 1), every canvas (Plan 2), every token (Plan 3), and every workbench surface (Plan 5) consumes.

---

## 11. Open questions to surface at board review

| Q | Question | Owner | Blocks |
|---|----------|-------|--------|
| Q1 | Is `TypedTable` the right primitive for the typed list views, or do we want a virtualized list component as well? | Developer | List views |
| Q2 | Are the eight renderers enough? Should we add `RunLogRenderer`, `RollbackRecordRenderer`, `CostRecordRenderer` as separate typed-artifact renderers, or fold them into the existing three (DeploymentPlanRenderer, AuditEntryRenderer)? | CTO | Renderer count |
| Q3 | Does the `PatchRenderer` need a "speak to the developer" affordance (an in-context chat to the Developer agent) in v1.0, or is that v1.1? | Developer | PatchRenderer scope |
| Q4 | Are charts allowed in the v1.0 centers, or are charts strictly v1.1+ (Analytics Center is v1.2)? | CTO | v1.0 scope |
| Q5 | Should the shell accept a "non-shell" mode (full-screen canvas) for the React Flow canvases, or is the chrome always present? | CTO | Plan 2 + Plan 5 |

---

## 12. Acceptance criteria for Plan 4

- [x] `@fora/forge-ui` package layout defined.
- [x] Eight typed-artifact renderers specified (Requirement, ADR, API Contract, Task, Patch, Test Report, Security Report, Deployment Plan) plus AuditEntry + ApprovalRequest.
- [x] Each renderer names variants, what it shows, actions, used-by centers.
- [x] Forms (RHF + Zod) contract pinned.
- [x] Charts (Recharts) wrapper typed.
- [x] Trees + Tables primitives named.
- [x] Shell defined; not a center.
- [x] Testing harness (axe-core, Vitest, Playwright, four test tiers) named.
- [x] Reconciliation against Forge AI-389 / Handoff Contract / other plans concrete.
- [ ] Board approval via `request_confirmation` on Forge AI-393.

---

## 13. Related

- [01-core-ui-module-map.md](./01-core-ui-module-map.md) — the thirteen centers that consume these renderers.
- [02-react-flow-graph-spec.md](./02-react-flow-graph-spec.md) — the canvases that compose these renderers.
- [03-design-system-spec.md](./03-design-system-spec.md) — the visual tokens the renderers inherit.
- [05-gsd-workbench-surface-plan.md](./05-gsd-workbench-surface-plan.md) — the GSD workbench surfaces that compose the renderers + the shell.
- [workspace/memory/architecture.md §7](../../memory/architecture.md#7-handoff-contract) — the schema the renderers consume.
- [workspace/memory/qa.md §2](../../memory/qa.md#2-the-four-test-tiers) — the four test tiers every renderer must clear.

---

## 14. Change log

| Rev | Date | Author | What changed |
|-----|------|--------|--------------|
| v0.1 | 2026-06-20 | Senior Engineer (`27431e10-…`) | Initial component library plan — `@fora/forge-ui` package, 8 typed-artifact renderers (+ Audit + Approval), shell + charts + trees + tables, four-tier testing, board Q-list. |