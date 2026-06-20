# Plan 1 — Core UI Module Map

**Issue:** [Forge AI-393](/Forge AI/issues/Forge AI-393) — UI / Visualization Spine Plan
**Owner:** Senior Engineer (primary; Designer hire pending)
**Mode:** planning — no code, no implementation subtasks
**Reconciles with:** [Forge AI-388](/Forge AI/issues/Forge AI-388) master plan (rev `3ea71321`); Foundation ([Forge AI-389](/Forge AI/issues/Forge AI-389)); Phase 0 ([Forge AI-390](/Forge AI/issues/Forge AI-390)); Phase 2 ([Forge AI-392](/Forge AI/issues/Forge AI-392)); Connector Center ([Forge AI-398](/Forge AI/issues/Forge AI-398)); Audit Center + Governance Center ([Forge AI-399](/Forge AI/issues/Forge AI-399))
**Companion plans:** [02-react-flow-graph-spec.md](./02-react-flow-graph-spec.md) · [03-design-system-spec.md](./03-design-system-spec.md) · [04-component-library-plan.md](./04-component-library-plan.md) · [05-gsd-workbench-surface-plan.md](./05-gsd-workbench-surface-plan.md)
**Charter Principle 5:** *Everything is visualized. Forge UI is the workbench.*

---

## 1. Why a module map

Forge UI is a typed-artifact browser on top of the Master Orchestrator's Handoff Contract. Every screen the customer sees corresponds to one or more typed artifacts (Requirement, ADR, API Contract, Task, Patch, Test Report, Security Report, Deployment Plan) that the agent runtime produced and the audit log captured.

The module map below is the canonical list of Forge UI surfaces. It is the contract between the **design system** (Plan 3), the **component library** (Plan 4), and the per-spine work that downstream Implementation children will pick up.

### 1.1 What the module map is not

- It is **not a page list** for the first release. Some centers (Analytics, Governance) are v1.1 surfaces.
- It is **not a permission map**. RBAC belongs in the Governance Center plan and the Connector Center plan.
- It is **not a route table**. Routes are derived from the center list by the implementation children, not pre-pinned here.

### 1.2 Module map conventions

- Every center has a **single primary user**. Two primary users = two centers (or a tab).
- Every center surfaces a **bounded typed-artifact set**. If a center needs to surface an unbounded set of artifact types, it is doing too much and must be split.
- Every center reconciles with one or more spine issues (Forge AI-389, 390, 391, 392, 398, 399). A center with no upstream reconciliation is a v1.1 candidate.
- Every center has an **owner role** (CTO / PM / Security / DevOps / etc.) and a **secondary owner** who keeps it alive when the primary is unavailable.

---

## 2. The thirteen centers

Each row below names the center, the purpose, the primary user, and the typed artifacts the center surfaces. Full per-center detail follows in §3.

| # | Center | Primary user | Primary typed artifact(s) | Owner role |
|---|--------|--------------|----------------------------|------------|
| 1 | Dashboard | PM (default), Eng Lead, CTO | Run summary cards; no single typed artifact | CTO (PM secondary) |
| 2 | Connector Center | Eng Lead, Platform admin | MCP connector record + health snapshot | CTO (DevOps secondary) |
| 3 | Knowledge Center | Any agent or human | Project doc, Customer doc, Memory doc | CTO |
| 4 | Project Intelligence | PM | Epic, Story, Handoff Contract | PM (BA secondary) |
| 5 | Organization Knowledge | CTO, HR-style admin | Agent profile, Engagement record | CTO |
| 6 | Agent Center | Eng Lead, CTO | Agent profile, Assignment record | CTO (PM secondary) |
| 7 | Development Center | Developer | ADR, Patch, PR review record | Developer (CTO secondary) |
| 8 | Security Center | Security, CTO | Security Report, Threat Model, Finding | Security (CTO secondary) |
| 9 | Testing Center | QA | Test Report, Eval Report, Coverage Map | QA (Developer secondary) |
| 10 | Deployment Center | DevOps | Deployment Plan, Run Log, Rollback Record | DevOps (CTO secondary) |
| 11 | Governance Center | CTO, Customer CISO | Policy, Approval Request, RBAC Role | CTO (Security secondary) |
| 12 | Audit Center | Customer CISO, CTO | Audit Entry, Audit Query, Export Request | Security (CTO secondary) |
| 13 | Analytics Center | CTO, Finance | Cost Record, Eval Trend, Usage Record | CTO (DevOps secondary) |

The thirteen centers are **non-overlapping** at the typed-artifact level. Two centers may surface the same artifact type in different views (e.g. an ADR is owned by the Development Center; a citation of that ADR in the Project Intelligence surface is a link, not a duplicate).

---

## 3. Per-center detail

### 3.1 Dashboard

- **Purpose.** A single landing page that lets the primary user see "what needs my attention" without navigating. Persona-aware (PM, Eng Lead, CTO, Security) per the Forge AI-374 persona dashboards; Forge AI-393 elevates that into a typed-artifact browser rather than a static summary.
- **Primary user.** PM by default; switches with persona cookie.
- **Primary typed artifacts surfaced.**
  - Run (in-flight, paused, awaiting input) — typed artifact: `Run`
  - Open question — typed artifact: `OpenQuestion` (subset of `requirement_brief.open_questions[]`)
  - Pending approval — typed artifact: `ApprovalRequest`
  - Budget alert — typed artifact: `BudgetSignal` (computed from `cost_records`)
- **Reconciles with.** Dashboard aggregates from every other center. The dashboard does not own any typed artifact; it points to centers that do.
- **Owner.** CTO; PM secondary.

### 3.2 Connector Center

- **Purpose.** Operator view of every MCP integration Forge uses (priority-1 + priority-2 sets in [tech-stack.md §10](../../project/tech-stack.md)). Shows connector status, credential rotation, scope, last-call success/failure, and the per-tenant namespace.
- **Primary user.** Eng Lead, Platform admin (the human who fixes a broken credential).
- **Primary typed artifacts surfaced.**
  - MCP connector — typed artifact: `McpConnector`
  - Credential envelope (redacted) — typed artifact: `CredentialEnvelope` (per Forge AI-128 secrets-mcp v0 contract)
  - Health snapshot — typed artifact: `ConnectorHealth` (last call, p50, p95, error rate)
  - Scope grant — typed artifact: `ConnectorScope`
- **Reconciles with.** [Forge AI-398](/Forge AI/issues/Forge AI-398) Connector Center plan; secrets-mcp ([Forge AI-128](/Forge AI/issues/Forge AI-128)) for the credential envelope shape; IAM broker ([Forge AI-125](/Forge AI/issues/Forge AI-125)) for the scope contract.
- **Owner.** CTO; DevOps secondary.

### 3.3 Knowledge Center

- **Purpose.** Read-only browser over the customer-owned Knowledge Layer ([README §1](../../README.md#1-the-layout)). Three folders, twelve v1 files, plus per-engagement extensions. Lets a human audit what every agent reads; lets a PM steer what gets injected per stage.
- **Primary user.** Any agent or human. There is no privileged read; the Knowledge Layer is the source of truth.
- **Primary typed artifacts surfaced.**
  - Knowledge file — typed artifact: `KnowledgeFile` (path, version hash, byte size, injection role)
  - Injection map — typed artifact: `StageInjectionMap` (per-stage file list, per [README §2](../../README.md#2-the-injection-model))
  - Glossary entry — typed artifact: `GlossaryEntry`
- **Reconciles with.** Foundation ([Forge AI-389](/Forge AI/issues/Forge AI-389)); the Knowledge Layer acceptance bar ([README §3](../../README.md#3-the-acceptance-bar)).
- **Owner.** CTO.

### 3.4 Project Intelligence

- **Purpose.** PM-facing view of every Epic, every Story, every active run, every open question. This is the surface a PM uses to decide "what's next" without leaving the Forge UI.
- **Primary user.** PM.
- **Primary typed artifacts surfaced.**
  - Epic — typed artifact: `Epic` (status, owner, sub-goal list, success metric)
  - Story — typed artifact: `Story` (acceptance criteria, blocked-by, risk)
  - Handoff Contract — typed artifact: `HandoffContract` (the JSON envelope between stages per [memory/architecture.md §7](../../memory/architecture.md#7-handoff-contract))
  - Requirement Brief — typed artifact: `RequirementBrief` (`schema_version: "1.0"`)
  - Draft PRD — typed artifact: `DraftPrd` (markdown, lint-passed)
- **Reconciles with.** Phase 0 ([Forge AI-390](/Forge AI/issues/Forge AI-390)); the Epic Generator ([Forge AI-225](/Forge AI/issues/Forge AI-225) → Forge AI-133 chain) for the Epic and Story shapes.
- **Owner.** PM; BA secondary.

### 3.5 Organization Knowledge

- **Purpose.** Tenant-scoped view of the org itself: who the people are, what engagements exist, what the per-tenant conventions override. This is where a CTO sees "this customer uses two-week sprints and overrides our glossary."
- **Primary user.** CTO; HR-style admin.
- **Primary typed artifacts surfaced.**
  - Engagement — typed artifact: `Engagement` (customer slug, contract, conventions overrides)
  - Person — typed artifact: `Person` (name, role, timezone)
  - Convention override — typed artifact: `ConventionOverride` (path → replacement)
- **Reconciles with.** Foundation ([Forge AI-389](/Forge AI/issues/Forge AI-389)); the Customer folder ([customer/](../../customer/)).
- **Owner.** CTO.

### 3.6 Agent Center

- **Purpose.** The roster of every agent (human + sub-agent), what role each one plays, what they are currently assigned to, and their state-of-health (token spend, last activity, blocked queue depth).
- **Primary user.** Eng Lead, CTO.
- **Primary typed artifacts surfaced.**
  - Agent profile — typed artifact: `AgentProfile` (role, icon, instructions-file path, allowed MCPs)
  - Assignment — typed artifact: `Assignment` (issue-id, run-id, state)
  - Health snapshot — typed artifact: `AgentHealth` (p50, p95, blocked count)
- **Reconciles with.** Paperclip agent API ([reference-paperclip-agent-enums.md](../../memory/reference-paperclip-agent-enums.md)); the agent-hire pipeline ([feedback-paperclip-agent-hire-payload.md](../../memory/feedback-paperclip-agent-hire-payload.md)).
- **Owner.** CTO; PM secondary.

### 3.7 Development Center

- **Purpose.** Developer-facing surface for everything in the Dev stage: the ADR list, the in-flight patches, the PR queue, the test status for each PR. This is the surface a Developer agent (or human) uses to do their job without leaving Forge.
- **Primary user.** Developer.
- **Primary typed artifacts surfaced.**
  - ADR — typed artifact: `Adr` (number, title, status, supersedes)
  - Patch — typed artifact: `Patch` (diff hash, files-changed, test impact)
  - PR review record — typed artifact: `PrReviewRecord` (verdict, blocker list, line comments)
  - Code analyzer report — typed artifact: `MigrationScope` (per [Forge AI-82](../../memory/project-fora-82-shipped.md))
- **Reconciles with.** Architecture Graph + Dependency Graph (both surfaced via Plan 2 React Flow).
- **Owner.** Developer; CTO secondary.

### 3.8 Security Center

- **Purpose.** Security stage artifacts: scan reports, threat models, open findings, secrets inventory, audit tail. This is where the Security agent (when hired) and the customer CISO live.
- **Primary user.** Security, CTO, Customer CISO.
- **Primary typed artifacts surfaced.**
  - Security Report — typed artifact: `SecurityReport` (per [Forge AI-19 §Security stage](../../memory/security.md))
  - Threat Model — typed artifact: `ThreatModel`
  - Finding — typed artifact: `Finding` (severity, exploit path, fix)
  - Secrets inventory — typed artifact: `SecretInventory` (per [Forge AI-128](../../memory/project-fora-128-secrets-mcp-v0.md))
- **Reconciles with.** Audit Center ([Forge AI-399](/Forge AI/issues/Forge AI-399)); the secrets-mcp v0 contract.
- **Owner.** Security; CTO secondary.

### 3.9 Testing Center

- **Purpose.** QA stage artifacts: test reports per tier (Unit, Integration, Contract, E2E — per [memory/qa.md §2](../../memory/qa.md)), eval results, coverage maps, flake ledger.
- **Primary user.** QA.
- **Primary typed artifacts surfaced.**
  - Test Report — typed artifact: `TestReport` (per tier, pass count, fail count, duration)
  - Eval Report — typed artifact: `EvalReport` (promptfoo result, score, variance)
  - Coverage Map — typed artifact: `CoverageMap` (per Forge AI-29 detector pattern)
  - Flake Ledger entry — typed artifact: `FlakeEntry`
- **Reconciles with.** Phase 0 ([Forge AI-390](/Forge AI/issues/Forge AI-390)); the eval harness ([memory/qa.md](../../memory/qa.md)).
- **Owner.** QA; Developer secondary.

### 3.10 Deployment Center

- **Purpose.** DevOps stage artifacts: deployment plan, deploy history, rollback history, infra drift, canary health. This is where a DevOps agent (when hired) watches production.
- **Primary user.** DevOps.
- **Primary typed artifacts surfaced.**
  - Deployment Plan — typed artifact: `DeploymentPlan` (per [Forge AI-19 §DevOps](../../memory/devops.md))
  - Run Log — typed artifact: `RunLog`
  - Rollback Record — typed artifact: `RollbackRecord`
  - Canary Probe — typed artifact: `CanaryProbe` (per [Forge AI-194](../../memory/project-fora-194-canary-probe.md))
- **Reconciles with.** DevOps spine (Forge AI-19 §DevOps); the customer-cloud-broker v1 ([Forge AI-126](../../memory/project-fora-126-ccb-v1-shipped.md)).
- **Owner.** DevOps; CTO secondary.

### 3.11 Governance Center

- **Purpose.** Policies, RBAC roles, approval workflows, board confirmations. This is where the CTO controls "who can do what" and "what needs a board sign-off."
- **Primary user.** CTO, Customer CISO.
- **Primary typed artifacts surfaced.**
  - Policy — typed artifact: `Policy` (DSL per IAM registry)
  - RBAC Role — typed artifact: `RbacRole`
  - Approval Request — typed artifact: `ApprovalRequest` (per Paperclip interaction schema)
  - Board Confirmation — typed artifact: `BoardConfirmation` (accepted / pending / declined)
- **Reconciles with.** Governance Center plan ([Forge AI-399](/Forge AI/issues/Forge AI-399)); the IAM registry ([Forge AI-125](../../memory/project-fora-125-iam-shipped.md)).
- **Owner.** CTO; Security secondary.

### 3.12 Audit Center

- **Purpose.** Audit log viewer with a query builder and export pipeline. Every Forge operation lands here. The customer CISO's primary surface.
- **Primary user.** Customer CISO, CTO, Security.
- **Primary typed artifacts surfaced.**
  - Audit Entry — typed artifact: `AuditEntry` (per [memory/security.md §6](../../memory/security.md#6-audit-log))
  - Audit Query — typed artifact: `AuditQuery` (saved query, share-link)
  - Export Request — typed artifact: `ExportRequest` (per SOC 2 control)
- **Reconciles with.** Audit Center ([Forge AI-399](/Forge AI/issues/Forge AI-399)); the Sync Plane audit forwarder.
- **Owner.** Security; CTO secondary.

### 3.13 Analytics Center

- **Purpose.** Cost-per-tenant, cost-per-goal, eval trends over time, agent utilization, MCP call volume. v1.1 in practice; spec'd here so the schema is pinned before the dashboard makes a call.
- **Primary user.** CTO, Finance.
- **Primary typed artifacts surfaced.**
  - Cost Record — typed artifact: `CostRecord` (per run, per agent, per MCP call)
  - Eval Trend — typed artifact: `EvalTrend` (rolling p50 / p95 over the eval set)
  - Usage Record — typed artifact: `UsageRecord` (per-user, per-engagement)
- **Reconciles with.** Cost cross-cutting agent (per [memory/architecture.md §4.3](../../memory/architecture.md#4-3-cross-cutting-agents)); Langfuse self-hosting ([tech-stack.md §7](../../project/tech-stack.md#7-observability)).
- **Owner.** CTO; DevOps secondary.

---

## 4. Center cross-references

The thirteen centers are linked. The matrix below names the **mandatory** links a v1 Forge UI must wire. Anything not on this list is a v1.1 candidate.

| From | To | Link shape | Why |
|------|----|-----------|-----|
| Dashboard | Project Intelligence | "Open epics" tile | A PM lands on the dashboard and drills into Project Intelligence |
| Dashboard | Audit Center | "Recent audit events" tile | A CTO lands on the dashboard and sees the last 10 audit entries |
| Project Intelligence | Development Center | "Stories in Dev" tab | Drill from a Story into its Patch + ADR |
| Project Intelligence | Testing Center | "Stories in QA" tab | Drill from a Story into its Test Report |
| Project Intelligence | Deployment Center | "Stories in DevOps" tab | Drill from a Story into its Deployment Plan |
| Connector Center | Audit Center | "Last 100 calls" inline panel | A broken connector needs the audit trail |
| Audit Center | Security Center | "Findings raised" filter | A CISO filters audit by `finding.*` |
| Knowledge Center | Agent Center | "What can this agent read?" panel | Per-agent injection map per [README §2](../../README.md#2-the-injection-model) |
| Governance Center | Audit Center | "Who approved this?" panel | Every Approval Request links back to its audit trail |
| Analytics Center | Connector Center | "Cost by connector" tile | Every MCP call is metered |

A link not on this list is allowed only with a typed-artifact justification.

---

## 5. v1 release grouping

The thirteen centers split into three release bands.

### 5.1 v1.0 (must ship before design-partner GA)

1. Dashboard (PM + Eng Lead personas only; CTO persona is v1.0 too)
2. Project Intelligence
3. Knowledge Center (read-only)
4. Development Center (read-only over the orchestrator's run output)
5. Connector Center (status + health; secret content stays in secrets-mcp)
6. Audit Center (read-only with saved queries; export is v1.1)
7. Agent Center (read-only)
8. Governance Center (Approval Requests only; full RBAC editor is v1.1)

### 5.2 v1.1 (within 90 days of v1.0)

9. Security Center
10. Testing Center
11. Deployment Center
12. Organization Knowledge

### 5.3 v1.2 (when cost is a customer concern)

13. Analytics Center

---

## 6. Reconciliation notes

- **vs. Foundation ([Forge AI-389](/Forge AI/issues/Forge AI-389))**: Knowledge Center surfaces the same files Foundation pins; the typed-artifact surface here is the typed envelope around the file.
- **vs. Phase 0 ([Forge AI-390](/Forge AI/issues/Forge AI-390))**: Project Intelligence is the typed-artifact browser for Phase 0's epic-package pipeline.
- **vs. Phase 2 ([Forge AI-392](/Forge AI/issues/Forge AI-392))**: Dashboard + Agent Center are the GSD-workbench shell (per Plan 5).
- **vs. Connector Center ([Forge AI-398](/Forge AI/issues/Forge AI-398))**: Connector Center center here is the typed-artifact view; Forge AI-398 may add operational tools (rotate-credential button, scope diff) that sit on top of this surface.
- **vs. Audit Center + Governance Center ([Forge AI-399](/Forge AI/issues/Forge AI-399))**: Audit Center here is the typed-artifact view; Governance Center here is the typed-artifact view for RBAC + approvals; Forge AI-399 owns the deeper cross-cutting flows.

---

## 7. Open questions to surface at board review

| Q | Question | Owner | Blocks |
|---|----------|-------|--------|
| Q1 | Are thirteen centers the right number? Could the Security / Testing / Development centers merge into one "Stage Output" center with tabs? | Board | none |
| Q2 | Is the Analytics Center a v1.2 surface or a v1.1 surface? Cost is the wedge; some customers will ask at v1.0 GA. | CTO | Analytics Center scope |
| Q3 | Should the Dashboard be persona-aware (today's Forge AI-374 model) or role-aware (Engineer / PM / Security / CISO)? The persona model is already shipped; the role model is the cleaner long-term answer. | CTO | Dashboard shape |
| Q4 | Is the Knowledge Center read-only in v1.0, or do we ship the "what each agent sees" injection map panel? The injection map is the differentiator. | CTO | Knowledge Center scope |
| Q5 | Should the Org Knowledge center include the customer's billing + contract, or is that a v1.1 add? | CTO | Org Knowledge scope |

---

## 8. Acceptance criteria for Plan 1

- [x] Module map covers all thirteen centers.
- [x] Each center names purpose, primary user, primary typed artifacts.
- [x] Each center names an owner role and a secondary owner.
- [x] Center cross-references are explicit, not implicit.
- [x] v1 release grouping names the eight v1.0 centers.
- [x] Reconciliation against Forge AI-389/390/391/392/398/399 is concrete.
- [ ] Board approval via `request_confirmation` on Forge AI-393.

---

## 9. Related

- [02-react-flow-graph-spec.md](./02-react-flow-graph-spec.md) — the graph surfaces that hang off the centers in §3.
- [03-design-system-spec.md](./03-design-system-spec.md) — the visual system every center inherits.
- [04-component-library-plan.md](./04-component-library-plan.md) — the typed-artifact renderers every center reuses.
- [05-gsd-workbench-surface-plan.md](./05-gsd-workbench-surface-plan.md) — how the Dashboard + Agent Center become the GSD workbench.
- [workspace/project/PRD.md](../../project/PRD.md) — the product this surface serves.
- [workspace/project/tech-stack.md](../../project/tech-stack.md) — the Next.js 14 → 15 reconciliation lives there.
- [workspace/memory/architecture.md](../../memory/architecture.md) — the Handoff Contract that pins the typed artifacts.
- [Forge AI-388 master plan](/Forge AI/issues/Forge AI-388) — the parent rev (`3ea71321`).

---

## 10. Change log

| Rev | Date | Author | What changed |
|-----|------|--------|--------------|
| v0.1 | 2026-06-20 | Senior Engineer (`27431e10-…`) | Initial module map — 13 centers, typed artifacts, v1 release grouping, board Q-list. |