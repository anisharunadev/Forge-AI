# Plan 5 — GSD Workbench Surface Plan

**Issue:** [Forge AI-393](/Forge AI-393) — UI / Visualization Spine Plan
**Owner:** Senior Engineer (primary; Designer hire pending)
**Mode:** planning — no code, no implementation subtasks
**Reconciles with:** [Forge AI-388](/Forge AI/issues/Forge AI-388) master plan (rev `3ea71321`); Phase 2 ([Forge AI-392](/Forge AI/issues/Forge AI-392)); the seven-stage machine in [memory/architecture.md §5](../../memory/architecture.md#5-the-seven-stage-machine); the Handoff Contract in [memory/architecture.md §7](../../memory/architecture.md#7-handoff-contract); the Forge AI-374 persona dashboards (the existing operator console)
**Companion plans:** [01-core-ui-module-map.md](./01-core-ui-module-map.md) · [02-react-flow-graph-spec.md](./02-react-flow-graph-spec.md) · [03-design-system-spec.md](./03-design-system-spec.md) · [04-component-library-plan.md](./04-component-library-plan.md)
**Charter Principle 5:** *Everything is visualized. Forge UI is the workbench.*

---

## 1. What the GSD Workbench is

The GSD Workbench ("Get-Shit-Done Workbench") is the operator surface for an in-flight run. Where the thirteen centers in Plan 1 are **typed-artifact browsers** (each centered on a domain), the GSD Workbench is a **typed-artifact stream** — the chronological, stage-aware feed of every artifact a run produces as it moves through the seven stages.

The Workbench is the surface a CTO watches when they say "show me what the run is doing right now." It is also the surface a Developer watches when they say "show me what the Dev agent is doing right now." And it is the surface a PM watches when they say "show me why my Epic is still in QA."

### 1.1 Three modes

The Workbench has three modes that share the same data layer but present it differently:

| Mode | Primary user | Shape |
|------|--------------|-------|
| **Run mode** | Operator watching one run | A single run, timeline + stage panel + artifact stream |
| **Goal mode** | Operator watching one goal (epic) | Many runs for one epic, kanban by stage + the timeline of each |
| **Operator mode** | CTO / Eng Lead watching everything | A dashboard of in-flight runs, filterable by stage / agent / tenant |

A user picks a mode from the Workbench switcher in the top bar (per Plan 3 §6). The mode is part of the URL so it can be deep-linked.

### 1.2 What the Workbench is not

- **Not the Dashboard.** The Dashboard (Plan 1 §3.1) is the persona-aware landing page that points into the Workbench; the Workbench is the drill-down.
- **Not a debugger.** The Workbench surfaces typed artifacts and operator actions; the developer-level debugger (call stacks, variable inspection) is a v2 surface.
- **Not a chat surface.** The Workbench shows what the agent is doing; it does not let the user talk to the agent. The agent interaction surface is a v1.1 add (per Plan 4 Q3).
- **Not a metrics dashboard.** Cost, eval score, and usage trends live in the Analytics Center (Plan 1 §3.13, v1.2). The Workbench surfaces the live budget meter (per Plan 3 §6) but no trends.

---

## 2. The seven stages

Per [memory/architecture.md §5](../../memory/architecture.md#5-the-seven-stage-machine), a run moves through:

1. **Ideation** — BA / PM. Produces Requirement, OpenQuestion, Epic.
2. **Architect** — Architect. Produces ADR, API Contract, Component.
3. **Dev** — Developer. Produces Patch, PR review record, MigrationScope.
4. **QA** — QA. Produces TestReport, EvalReport, CoverageMap.
5. **Security** — Security. Produces SecurityReport, Finding, ThreatModel.
6. **DevOps** — DevOps. Produces DeploymentPlan, CanaryProbe, RunLog.
7. **Docs** — Documentation. Produces README, API docs, Changelog.

Each stage is a typed envelope in the Handoff Contract; the Workbench consumes the same envelopes.

---

## 3. Run mode

Run mode is the canonical Workbench surface. It has four regions:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Top bar: tenant / persona / theme / search / notif / budget]               │
├─────┬──────────────────────────────────────────────┬─────────────────────────┤
│     │                                              │                         │
│  L  │   Stage header (current stage + progress)    │   Right panel           │
│  e  │                                              │   (typed-artifact       │
│  f  │   ────────────────────────────────────────   │    side panel)          │
│  t  │   Timeline (the seven-stage ribbon)           │                         │
│     │                                              │   - Title               │
│  r  │   ────────────────────────────────────────   │   - Typed-artifact      │
│  a  │                                              │     badge               │
│  i  │   Stage panel (the current stage's detail)   │   - Body / summary      │
│  l  │                                              │   - Linked artifacts    │
│     │   ────────────────────────────────────────   │   - Actions             │
│     │                                              │                         │
│     │   Artifact stream (the live feed)            │                         │
│     │                                              │                         │
└─────┴──────────────────────────────────────────────┴─────────────────────────┘
```

### 3.1 Stage header

- The current stage name (e.g. "Dev") with the typed-artifact badge color (Plan 4 §3).
- The progress within the current stage: percent + remaining estimate.
- The actor: the agent (or human) the stage is assigned to.
- A "stage-skip note" pill when the run has skipped a stage (per [memory/architecture.md §5](../../memory/architecture.md#5-the-seven-stage-machine)).
- A "next stage" hint: where this stage will hand off to.

### 3.2 Timeline ribbon

The seven-stage ribbon shows every stage as a node. Each node has:

- The stage name + icon.
- Status: `done`, `in_progress`, `awaiting_input`, `blocked`, `skipped`.
- Duration so far.
- Click → jumps the Stage panel to that stage's history.

The ribbon is the operator's "where am I?" answer. It is always visible at the top of Run mode.

### 3.3 Stage panel

The current stage's detail. Two layers:

- **Inputs.** The Handoff Contract envelope this stage received. Shows every input typed artifact (Requirement, ADR, etc.) with a link to open the typed-artifact renderer.
- **Outputs (in flight).** The artifacts the stage has produced so far, live-streaming from the orchestrator.

The stage panel is what changes as the run moves forward; the other regions are mostly stable.

### 3.4 Artifact stream

The chronological feed of every artifact the run has produced, across every stage. Each row is a typed-artifact card (Plan 4 §3) with:

- The typed-artifact badge.
- The stage badge.
- The actor (which agent produced it).
- The timestamp.
- A "show in graph" affordance when applicable.

The artifact stream is filterable by stage, by typed-artifact, by actor, and by timestamp range. It is the operator's "what just happened?" answer.

### 3.5 Operator actions

Per Forge AI-374, the operator can pause, resume, and cancel a run. The Workbench adds:

- **Reassign stage** — move the current stage to a different agent (subject to RBAC).
- **Inject input** — push a new typed artifact into the stage's input envelope (subject to RBAC; logged in the audit trail).
- **Request approval** — surface the approval flow as a banner at the top of the run.
- **Annotate** — leave a comment on the run that becomes part of the audit trail.

Every operator action emits an `AuditEntry` (per [memory/security.md §6](../../memory/security.md#6-audit-log)).

---

## 4. Goal mode

Goal mode is Run mode for many runs that belong to one Epic. It is the surface a PM uses when the Epic has 8 stories, 3 of which are in Dev, 2 in QA, 1 blocked.

### 4.1 Shape

- A kanban with seven columns (one per stage).
- Each card is a Story or a Sub-goal (typed-artifact: `Task`).
- Each card has the typed-artifact badge + the current stage + the actor.
- Click a card → opens a mini Run mode (the in-flight run for that story) in a side panel.

### 4.2 What Goal mode surfaces

- The Epic's success metric and where it stands.
- The aggregate budget for the goal (per [Forge AI-59 §8](../../project/PRD.md#8-success-metrics)).
- The aggregate risk (the worst `Finding.severity` across all stories).
- The "ready to advance" pile — stories that have cleared QA + Security + DevOps and are awaiting Docs.

### 4.3 What Goal mode does not surface

- The cross-story graph (Architecture Graph + Dependency Graph are typed views, not Goal-mode views).
- The full audit trail — Goal mode shows the latest 10 entries per story; the rest is in the Audit Center.

---

## 5. Operator mode

Operator mode is the CTO's "all the runs" view. It is the surface a CTO uses when they have 12 in-flight runs across 4 tenants and they want to know which one needs them.

### 5.1 Shape

A dashboard of cards. Each card is one in-flight run with:

- The run id + the typed-artifact goal it belongs to.
- The current stage (color-coded).
- The actor.
- The budget used vs. the cap.
- The last activity timestamp.
- A status pill: `healthy`, `awaiting_input`, `blocked`, `budget_warning`, `budget_breached`.

The cards are sortable by any field. The default sort is "needs me" — runs where the operator is the decider of a pending approval, or where the run is blocked on something the operator can unblock.

### 5.2 Filters

- By tenant.
- By stage.
- By actor (which agent).
- By status pill.
- By `cost_usd > X`.
- By "I am the decider" (default on for CTO).

### 5.3 What Operator mode does not surface

- The full run timeline — click a card to enter Run mode.
- The cross-tenant graph — that's the Analytics Center in v1.2.

---

## 6. The shell integration

The Workbench is the default landing surface for the **Eng Lead** persona and the **CTO / VP Eng** persona. The PM persona lands on the Dashboard (per Plan 1 §3.1) and can drill into the Workbench from any Epic or Story card.

The Workbench composes the shell from Plan 3 §6 — it is not a parallel shell. The Workbench uses the same top bar (with the persona switcher, the theme switcher, the global search, the notification bell, and the budget meter).

### 6.1 The Run mode URL

Run mode is deep-linkable:

```
/workbench/runs/[runId]
/workbench/runs/[runId]?stage=dev&artifact=patch
```

A user pastes the URL into Slack and the recipient sees the same view.

### 6.2 The Goal mode URL

```
/workbench/goals/[goalId]
/workbench/goals/[goalId]?stage=qa
```

### 6.3 The Operator mode URL

```
/workbench/operator
/workbench/operator?tenant=acme&status=awaiting_input
```

---

## 7. Real-time + polling

### 7.1 v1.0 — polling

Per Forge AI-374's non-goals (the existing console does not have SSE / WebSocket). The Workbench polls the orchestrator every 5 seconds by default; the user can lower it to 1 second (debug mode) or raise it to 30 seconds (review mode).

### 7.2 v1.1 — SSE

A Server-Sent Events endpoint on the orchestrator feeds the Workbench. The Workbench keeps the polling fallback for offline mode. The SSE channel is the typed boundary between the agent runtime and the UI.

### 7.3 Freshness contract

The Workbench surfaces a freshness pill:

- `live` — SSE connected, last event < 1s ago.
- `recent` — SSE connected, last event < 30s ago.
- `stale` — SSE disconnected or last event > 30s ago; the user is looking at polling data.

This is the operator's "can I trust what I'm seeing?" answer.

---

## 8. Reconciliation with Phase 2 (Forge AI-392)

Phase 2 is the "operator-as-customer" workstream. Phase 2's deliverables include:

- The "operator dashboard" (the surface a non-engineer customer uses to watch a run).
- The "customer-facing run timeline" (the simplified version of Run mode that hides internal stage names).
- The "approval workflow" (the customer's view of `ApprovalRequest`).

The Workbench is the **internal operator** surface. Phase 2 is the **external customer** surface. Both surfaces read from the same Handoff Contract; the customer surface is a subset of the operator surface with a thinner right panel and a friendly vocabulary.

### 8.1 What the Workbench owns

- All three modes (Run, Goal, Operator).
- The full audit-trail sidebar.
- The operator actions (reassign, inject, annotate).
- The "ready to advance" pile.

### 8.2 What Phase 2 owns

- The customer-facing Run Timeline (a stripped-down Run mode with no internal stage names and no operator actions).
- The customer-facing Goal Board (a stripped-down Goal mode with no aggregate risk or budget).
- The customer Approval flow (the customer's view of the `ApprovalRequest` rendered by Plan 4 §3.10).
- The customer Dashboard (a persona-aware landing surface for the customer admin role).

### 8.3 What neither owns

- The typed-artifact renderer (Plan 4 owns).
- The shell (Plan 3 owns).
- The Handoff Contract schema (the schema is owned by the CTO; the Workbench consumes it).

---

## 9. Accessibility

Per Plan 3 §5:

- The timeline ribbon is keyboard-navigable: Tab moves between stages, Enter jumps the Stage panel.
- The artifact stream is keyboard-navigable: arrow keys move between rows, Enter opens the right panel.
- The freshness pill is announced via a polite live region when it changes.
- The Workbench respects the user's reduced-motion preference (no auto-scrolling in the artifact stream).
- The right panel is a focus trap when open and returns focus to the trigger on close.

---

## 10. Open questions to surface at board review

| Q | Question | Owner | Blocks |
|---|----------|-------|--------|
| Q1 | Polling at 5s default in v1.0 — is that fast enough for the design-partner demo? (Recommended: 1s default for the demo, 5s default for v1.0 GA.) | CTO | v1.0 default |
| Q2 | Goal mode — do we ship a "ready to advance" pile in v1.0, or is that a v1.1 add? The pile is a small affordance and a strong PM signal. | PM | Goal mode v1.0 scope |
| Q3 | Operator mode — is the default sort "needs me" too presumptuous for a CTO who has 30 direct reports? (Recommended: ship with "needs me" but make it configurable.) | CTO | Operator mode default sort |
| Q4 | The annotation affordance — is that a chat to the agent (v1.1 per Plan 4 Q3) or a side-channel comment on the run? (Recommended: side-channel comment in v1.0; chat is v1.1.) | CTO | Annotation v1.0 shape |
| Q5 | Should the Workbench be the default landing for the Eng Lead persona (replacing the Forge AI-374 PM-as-default), or is the persona default unchanged? | CTO | Persona default |

---

## 11. Acceptance criteria for Plan 5

- [x] Workbench defined as the operator surface; not the Dashboard.
- [x] Three modes (Run, Goal, Operator) defined with shapes.
- [x] Each mode names shape, what it surfaces, what it does not surface.
- [x] Seven-stage ribbon defined per [memory/architecture.md §5](../../memory/architecture.md#5-the-seven-stage-machine).
- [x] Operator actions defined (pause/resume/cancel + reassign/inject/annotate).
- [x] Polling vs SSE strategy pinned (polling in v1.0; SSE in v1.1).
- [x] Reconciliation with Forge AI-392 (operator vs customer surface) concrete.
- [x] Accessibility (WCAG 2.2 AA) addressed.
- [x] URL shape deep-linkable.
- [ ] Board approval via `request_confirmation` on Forge AI-393.

---

## 12. Related

- [01-core-ui-module-map.md](./01-core-ui-module-map.md) — Dashboard + Agent Center are the GSD Workbench shell + roster.
- [02-react-flow-graph-spec.md](./02-react-flow-graph-spec.md) — the Audit Timeline Graph that hangs off Run mode's audit sidebar.
- [03-design-system-spec.md](./03-design-system-spec.md) — the shell + tokens the Workbench inherits.
- [04-component-library-plan.md](./04-component-library-plan.md) — the typed-artifact renderers the Workbench composes.
- [workspace/memory/architecture.md §5](../../memory/architecture.md#5-the-seven-stage-machine) — the seven stages the ribbon visualizes.
- [workspace/memory/architecture.md §7](../../memory/architecture.md#7-handoff-contract) — the envelopes the Workbench consumes.
- [workspace/memory/security.md §6](../../memory/security.md#6-audit-log) — the audit trail every operator action emits.
- [Forge AI-374](../../apps/forge/README.md) — the existing operator console this plan elevates into the GSD Workbench.

---

## 13. Change log

| Rev | Date | Author | What changed |
|-----|------|--------|--------------|
| v0.1 | 2026-06-20 | Senior Engineer (`27431e10-…`) | Initial GSD Workbench surface plan — three modes, seven-stage ribbon, operator actions, polling/SSE strategy, Forge AI-392 reconciliation, board Q-list. |