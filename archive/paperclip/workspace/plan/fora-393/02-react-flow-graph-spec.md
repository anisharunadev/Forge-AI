# Plan 2 — React Flow Graph Spec

**Issue:** [Forge AI-393](/Forge AI/issues/Forge AI-393) — UI / Visualization Spine Plan
**Owner:** Senior Engineer (primary; Designer hire pending)
**Mode:** planning — no code, no implementation subtasks
**Reconciles with:** Plan 1 [Core UI Module Map](./01-core-ui-module-map.md); Knowledge Graph + Architecture Graph + Dependency Graph (all under [Forge AI-390](/Forge AI/issues/Forge AI-390)); Audit Center ([Forge AI-399](/Forge AI/issues/Forge AI-399)); Design system ([03-design-system-spec.md](./03-design-system-spec.md))
**Companion plans:** [01-core-ui-module-map.md](./01-core-ui-module-map.md) · [03-design-system-spec.md](./03-design-system-spec.md) · [04-component-library-plan.md](./04-component-library-plan.md) · [05-gsd-workbench-surface-plan.md](./05-gsd-workbench-surface-plan.md)
**Charter Principle 5:** *Everything is visualized. Forge UI is the workbench.*

---

## 1. Why React Flow

React Flow is the chosen graph library because:

- It owns layout, pan/zoom, and selection — we own node + edge types.
- It is well-typed (TypeScript first-class), works with React 19 / Next.js 15 (App Router).
- It renders server-side data with arbitrary React components as nodes.
- It has accessible defaults (`role="application"`, keyboard nav).
- It scales to the shapes we need (200–2000 nodes per canvas).

We deliberately do **not** use:

- `d3-force` directly (we get a layout from React Flow's `dagre`/`elk` adapters or from the typed graph provider, not by hand).
- A no-graph library (Recharts is for series, not graphs — Recharts is the *Plan 4 component library's* chart renderer, used in Analytics Center).
- A custom canvas (a graph of 500+ nodes on a hand-rolled canvas is a slow death).

---

## 2. The four canonical graphs

There are exactly four React Flow canvases the Forge UI ships. Each canvas is a typed view over a typed graph provider; the provider is the source of truth, the canvas is the visualization.

| # | Canvas | Center | Graph provider | Source-of-truth store |
|---|--------|--------|----------------|-----------------------|
| 1 | Knowledge Graph | Knowledge Center | `KnowledgeGraphProvider` | Knowledge Layer files + glossary cross-refs |
| 2 | Architecture Graph | Project Intelligence | `ArchitectureGraphProvider` | ADRs + Components + Contracts |
| 3 | Dependency Graph | Development Center | `DependencyGraphProvider` | Repo modules + import edges + ownership |
| 4 | Audit Timeline Graph | Audit Center | `AuditGraphProvider` | Audit entries + actor edges + temporal index |

Everything else is either a chart (Recharts — see Plan 4 §5) or a typed list (the centers that don't earn a graph).

### 2.1 Why exactly four

- **A graph is for traversal and impact analysis.** If the user can't ask "what depends on this?" or "what does this touch?", it isn't a graph.
- **A chart is for trend + comparison.** Cost over time, eval score variance, call volume. Charts live in Analytics Center and inside other centers as side widgets.
- **A list is for search and filter.** Audit entries, run logs, finding lists. Lists live everywhere; they don't earn their own canvas.
- The four canonical graphs above each pass the traversal test. Any fifth canvas must clear that bar at design review.

---

## 3. Per-canvas spec

Each canvas spec below is the contract between the design system (Plan 3), the component library (Plan 4), and the implementation child that will build it.

### 3.1 Knowledge Graph

- **Center.** Knowledge Center (Plan 1 §3.3).
- **Purpose.** Visualize the Knowledge Layer as a typed graph so a human (or an agent on handoff) can see "this PRD references this ADR references this security finding references this run." The graph is the typed-artifact cross-reference map, not the file tree.
- **Entities (nodes).**
  - `KnowledgeFile` — label = filename; color = folder (memory=indigo, customer=amber, project=emerald)
  - `GlossaryEntry` — label = term; color = neutral; sized by usage count
  - `StageInjectionMap` — label = stage name; appears once per stage; children are the file nodes
  - `CrossReference` — appears as an edge attribute, not a node
- **Relations (edges).**
  - `references` (file → file)
  - `defines` (glossary → file or term)
  - `injects_into` (file → stage)
  - `supersedes` (file → file)
- **Interactions.**
  - Click node → side panel shows the file (Plan 4 §3.4 typed-artifact renderer) + the injection role.
  - Click edge → shows the reference (where in source, with quote + line number).
  - Filter by folder; filter by stage; filter by file type.
  - Zoom out → "federation view" collapses the 12 v1 files to a single per-folder summary.
  - Keyboard nav: arrow keys move between connected nodes; `Enter` opens the panel.
- **Reconciles with.** Foundation ([Forge AI-389](/Forge AI/issues/Forge AI-389)); Knowledge Layer §2 injection model.

### 3.2 Architecture Graph

- **Center.** Project Intelligence (Plan 1 §3.4).
- **Purpose.** Visualize the architecture the ADR set has committed to. Nodes are components and contracts; edges are "depends on", "implements", "supersedes".
- **Entities (nodes).**
  - `Component` — labeled with the component name + type (service, library, data store, queue, agent)
  - `Contract` — labeled with the contract name + version (per [memory/architecture.md §7](../../memory/architecture.md#7-handoff-contract))
  - `Adr` — labeled with ADR number + title; pinned to "decision"
  - `Stage` — labeled with stage name; appears once per stage on the BMAD workflow track
- **Relations (edges).**
  - `depends_on` (component → component)
  - `implements` (component → contract)
  - `decided_by` (component or contract → ADR)
  - `supersedes` (ADR → ADR)
  - `handoff_to` (stage → stage)
- **Interactions.**
  - Click ADR → opens the ADR reader (Plan 4 §3.2).
  - Click Contract → opens the contract viewer with version selector.
  - Click Component → opens the component detail (owners, on-call, last deploy).
  - Hover edge → shows the ADR that justifies the relation.
  - Filter by ADR status (proposed / accepted / superseded).
  - Impact analysis: select a node, run "what breaks?" → highlighted downstream nodes.
- **Reconciles with.** Phase 0 ([Forge AI-390](/Forge AI/issues/Forge AI-390)); the Handoff Contract schema in [memory/architecture.md §7](../../memory/architecture.md#7-handoff-contract).

### 3.3 Dependency Graph

- **Center.** Development Center (Plan 1 §3.7).
- **Purpose.** Visualize the repository's import graph, ownership, and test impact. The Dev stage's primary visualization surface.
- **Entities (nodes).**
  - `Module` — labeled with the module path; sized by LOC; color by owner
  - `Package` — labeled with the package name + version (external dependency)
  - `Owner` — appears once per owner (person or team); collapsed by default
  - `Cycle` — appears as a red dashed boundary when the analyzer detects one
- **Relations (edges).**
  - `imports` (module → module)
  - `imports_external` (module → package)
  - `owns` (owner → module)
  - `tested_by` (module → test report; metadata edge)
- **Interactions.**
  - Click module → file tree + test report + last commit + open findings.
  - Click owner → all modules owned, with coverage %.
  - Click cycle → opens the cycle explainer panel with the analyzer's trace.
  - Filter by owner; filter by package; filter by "no tests".
  - "Blast radius" mode: select a module, show all reachable modules (transitive `imports`).
- **Reconciles with.** Development Center; Forge AI-82 Code analyzer; the cycle detector in [forge/2.3/](../../forge/2.3/) (which produces the `cycles.json` shape).

### 3.4 Audit Timeline Graph

- **Center.** Audit Center (Plan 1 §3.12).
- **Purpose.** Visualize the audit log as a time-ordered actor→target graph. This is the customer CISO's primary surface — a SOC 2 examiner's question is "show me who did what to what," and this canvas answers it directly.
- **Entities (nodes).**
  - `AuditEntry` — labeled with `tool + query_hash`; sized by `tokens_in + tokens_out`; color by `stage`
  - `Actor` — labeled with actor id (person, agent, system:probe)
  - `Tenant` — labeled with tenant slug
  - `Time bucket` — appears once per hour by default; user can pick day / hour / 5-min
- **Relations (edges).**
  - `performed_by` (entry → actor)
  - `scoped_to` (entry → tenant)
  - `touches` (entry → typed artifact)
  - `followed_by` (entry → entry, within the same run)
- **Interactions.**
  - Click entry → full audit entry viewer (Plan 4 §3.9).
  - Click actor → that actor's audit trail (filter pinned).
  - Click tenant → that tenant's audit trail (filter pinned).
  - Time bucket click → zooms in.
  - Filter by stage, by tool, by `cost_usd > X`.
  - Export → currently disabled in v1.0; v1.1 ships the export button (per Plan 1 §5.1).
- **Reconciles with.** Audit Center ([Forge AI-399](/Forge AI/issues/Forge AI-399)); [memory/security.md §6](../../memory/security.md#6-audit-log).

---

## 4. Cross-canvas rules

All four canvases share these rules so the user learns one mental model.

### 4.1 Layout

- React Flow's `dagre` adapter is the default layout (LR for Knowledge / Architecture; TB for Dependency; LR + time x-axis for Audit).
- The user can switch to `elk` (when `elkjs` is wired) for the Dependency Graph only — the other three are too small to need it.
- The user can switch to a free-form layout for the Knowledge Graph only — knowledge maps benefit from hand placement.

### 4.2 Node style

- All nodes are typed components (Plan 4 §3) — there are no raw HTML nodes.
- All nodes carry a typed-artifact badge (top-right corner) so the user knows what they're looking at without reading the label.
- All nodes are color-coded by the typed-artifact family (Knowledge=indigo, Architecture=emerald, Dependency=slate, Audit=amber).

### 4.3 Edge style

- Solid = present-tense relation (`depends_on`, `injects_into`).
- Dashed = historical relation (`supersedes`, `followed_by`).
- Animated = "live" edge (only on Audit Timeline Graph, on the `followed_by` chain within the current run).

### 4.4 Selection

- A selection pins the side panel and emits a "what is this?" hash to the URL — so any node can be deep-linked.
- Multi-select is supported on Dependency Graph only (for "blast radius").
- The keyboard shortcut `Cmd/Ctrl+K` opens the node-typeahead picker.

### 4.5 Performance

- Each canvas virtualizes nodes beyond 200.
- Edges beyond 500 are aggregated (the system collapses `imports` edges within a package into a single `imports_external` summary edge with a count badge).
- The canvas reads from a typed graph provider, not from raw API calls — the provider owns the pagination, the cache, and the freshness contract.

---

## 5. The typed graph provider

Each canvas in §3 reads from a typed graph provider, not from raw API calls. The provider is a small interface; the implementation is per data source.

```ts
interface GraphProvider<Node, Edge> {
  getNodes(filter: GraphFilter): Promise<Node[]>;
  getEdges(filter: GraphFilter): Promise<Edge[]>;
  watch(filter: GraphFilter, onChange: (delta: GraphDelta) => void): Unsubscribe;
}
```

The provider contract is what the four canvases share. The implementations are:

| Provider | Data source | Cache | Freshness |
|----------|------------|-------|-----------|
| `KnowledgeGraphProvider` | Knowledge Layer files + cross-ref index | 5 min | Eager invalidate on file write |
| `ArchitectureGraphProvider` | ADR registry + component registry + contract registry | 1 min | Eager invalidate on ADR transition |
| `DependencyGraphProvider` | Repo analyzer output + ownership registry | 15 min | Scheduled (build completion) |
| `AuditGraphProvider` | Audit log + actor index + tenant index | Real-time | Live tail (SSE in v1.1; polling in v1.0) |

The provider is owned by **Plan 4** (component library) at the type level; the implementation lives with each canvas's owning center.

---

## 6. Accessibility

Every canvas is keyboard-accessible per WCAG 2.2 AA (Plan 3 §5):

- The canvas wrapper has `role="application"` and an accessible name.
- Arrow keys move between connected nodes (per [WAI-ARIA practices for graphs](https://www.w3.org/WAI/ARIA/apg/patterns/)).
- A "skip to node list" link is present (a screen-reader-friendly list of every node + its label + its position).
- All node colors are paired with shape or label — color is never the only signal (per WCAG 1.4.1).
- A "text equivalent" view is present (the same data as a structured list, one node per row) — it is the screen-reader default and the keyboard nav alternative.

---

## 7. What React Flow is not used for

- **Charts.** Trends, comparisons, distributions. Use Recharts. See Plan 4 §5.
- **Hierarchies** (org charts, taxonomy trees). Use a tree component (Plan 4 §6). React Flow is for graphs, not trees.
- **Forms.** Use React Hook Form (Plan 4 §4).
- **Tables.** Use TanStack Table (Plan 4 §7).

---

## 8. Reconciliation notes

- **vs. Knowledge Graph + Architecture Graph + Dependency Graph (all under Forge AI-390)**: those three issues own the *producers* (the analyzers and registries that emit the graph data). This plan owns the *consumer* — the React Flow canvas in Forge UI.
- **vs. Audit Center (Forge AI-399)**: Forge AI-399 owns the deeper audit flows (export, saved queries, alert rules). This plan owns the visualization shape.
- **vs. Plan 1 module map**: each canvas here maps to one center in Plan 1 §3. No canvas is shared between two centers.

---

## 9. Open questions to surface at board review

| Q | Question | Owner | Blocks |
|---|----------|-------|--------|
| Q1 | Is `dagre` good enough as the default layout, or do we need `elk` everywhere? `elk` is bigger and slower to ship. | Senior Engineer | v1.0 vs v1.1 layout |
| Q2 | Should the Audit Timeline Graph animate the `followed_by` chain? Animation in a compliance surface can be distracting; some CISOs will want it off. | Security | Audit Timeline Graph edge style |
| Q3 | Is the Dependency Graph read-only, or do we ship "add owner" inline? Inline editing expands the scope significantly. | Developer | Dependency Graph v1.0 scope |
| Q4 | Should the Architecture Graph show only ADRs in status `accepted`, or all including `proposed`? `Proposed` is useful for a PM but noisy for a CTO. | CTO | Architecture Graph default filter |
| Q5 | Does the Knowledge Graph need a "what does each agent see?" panel in v1.0, or is that v1.1? The injection map is a differentiator and the panel is small. | CTO | Knowledge Graph v1.0 scope |

---

## 10. Acceptance criteria for Plan 2

- [x] React Flow named as the chosen graph library; alternatives listed and rejected.
- [x] Exactly four canonical canvases named.
- [x] Each canvas names center, purpose, entities, relations, interactions.
- [x] Cross-canvas rules (layout, node style, edge style, selection, performance) defined.
- [x] Typed graph provider interface defined.
- [x] Accessibility (WCAG 2.2 AA) addressed for each canvas.
- [x] Reconciliation against Forge AI-390 / Forge AI-399 / Plan 1 / Plan 3 / Plan 4 concrete.
- [ ] Board approval via `request_confirmation` on Forge AI-393.

---

## 11. Related

- [01-core-ui-module-map.md](./01-core-ui-module-map.md) — the centers that own each canvas.
- [03-design-system-spec.md](./03-design-system-spec.md) — the color tokens, typography, and accessibility framework the canvases inherit.
- [04-component-library-plan.md](./04-component-library-plan.md) — the typed-artifact renderers every canvas uses.
- [05-gsd-workbench-surface-plan.md](./05-gsd-workbench-surface-plan.md) — where the Audit Timeline Graph lands inside the GSD workbench.
- [workspace/project/tech-stack.md](../../project/tech-stack.md) — React + React Flow as part of the web stack.
- [workspace/memory/architecture.md](../../memory/architecture.md) — the contract schema the Architecture Graph consumes.

---

## 12. Change log

| Rev | Date | Author | What changed |
|-----|------|--------|--------------|
| v0.1 | 2026-06-20 | Senior Engineer (`27431e10-…`) | Initial graph spec — four canvases, typed graph provider, accessibility, board Q-list. |