# Feature Landscape — Forge AI v2.0 (Pilot-Cutover Lens)

**Domain:** Agent Operating System (web platform orchestrating agents, knowledge, governance, delivery)
**Project:** Forge AI v2.0 — pilot readiness milestone
**Researched:** 2026-06-23
**Confidence:** HIGH on constitutional features, MEDIUM on user-expectation features, HIGH on anti-features

**Scope note.** The PRD v2 (`docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md`, 86KB) already enumerates ~70 functional requirements (F-001..F-213, F-301..F-310, F-401..F-415, F-501..F-509, F-601) and ~45 NFRs. This document does **not** re-catalog that. It answers: *what is missing, what is table-stakes vs differentiated, and what must NOT be built for the single-tenant pilot cutover*.

**Pilot cutover lens.** One tenant. One full SDLC workflow (`discovery → planning → architecture → implementation → testing → security → review → deployment`). All artifacts visible. All gates visible. Approvals and audit are first-class UI surfaces, not logs a Steward has to query.

---

## Executive Summary

The PRD is feature-rich on paper but the pilot-cutover view surfaces three structural gaps that determine whether the dogfood pilot feels complete or feels like a demo:

1. **Every capability is built behind a REST router but several have no UI surface** (PILOT-10). `apps/forge/app/<feature>/page.tsx` exists for ~13 centers, but `/api/v1/*` carries 40+ sub-routers. The pilot will land on pages that link to routers with empty or stub panes; this is the single biggest "demo-ware" risk.
2. **The Constitution is invisible in the UI.** Rule 1-8 are constitutional but only show up in audit logs and code review. PILOT-09 names a Constitution-as-rulebook view with per-rule health indicators — this is a differentiator and a credibility signal for the pilot reviewer, not a nice-to-have.
3. **The Approvals Timeline and Audit Timeline are differentiators that the PRD treats as a single dashboard concern** (F-009 V1-Optional). For pilot, they are two distinct, named screens: pending decisions deserve their own view distinct from completed decisions. The pilot reviewer will ask "show me who approved what and when" — that answer must be a click, not a query.

Anti-features to deliberately NOT build are dominated by **breadth** items (every Phase 2-4 accelerator, every connector in the marketplace, every persona's full surface). Pilot is *one tenant, one workflow*; depth on the chosen path beats breadth on every path.

---

## Table Stakes (Pilot Users Expect These — Missing = Failure)

Table stakes = features any pilot user (Tech Lead, Architect, Steward, Sponsor) will look for on day one. If the feature is missing or stubbed, the pilot user concludes Forge is "incomplete." Categorization: **Blocking** = pilot cannot start; **Important** = pilot degrades to demo; **Nice-to-have** = polish.

### TS-1: Tenant Onboarding Wizard (F-021)

| Attribute | Value |
|---|---|
| Why expected | Every internal pilot user starts as a new tenant. The PRD's success metric (PILOT-01) is onboarding in <30 minutes. |
| What's needed | Single-page wizard: project name, primary connector, LLM provider, sample repo URL → Keycloak realm + DB tenant + audit anchor + connector install. |
| Complexity | M |
| Pilot-readiness | **Blocking** — PILOT-01 is a hypothesis, not a feature |
| Built? | Partially. `apps/forge/app/project-onboarding/` exists; smoke-tested in P0 W2 (per `pilot-p0-pre-pilot.md`). |
| Gap | Wizard completion currently requires the steward to invoke a backend verb; UI may not walk the whole path. Verify end-to-end. |

### TS-2: Connector Marketplace (F-015, F-007)

| Attribute | Value |
|---|---|
| Why expected | Pilot scope = GitHub + Jira + Confluence (per P0 W2). Each must be installable from the UI without a restart. |
| What's needed | Browse list of 13 connectors, install/rotate/test actions, per-tenant state (PENDING/ACTIVE/STALE/FAILED) visible. |
| Complexity | M |
| Pilot-readiness | **Blocking** — PILOT-07 names this |
| Built? | Yes (`apps/forge/app/connector-center/`). |
| Gap | Add-Connector-dialog (under components/connector-center) and lifecycle-actions (ConnectorLifecycleActions.tsx) are new in git working tree — verify wire-up to `connector_manager.py` install/rotate/test verbs. |

### TS-3: Knowledge Graph Visualization (React Flow)

| Attribute | Value |
|---|---|
| Why expected | "React Flow is the default visualization framework" (CLAUDE.md). The PRD calls the unified KG "the killer feature" (F-115). |
| What's needed | React Flow canvas at `/knowledge-center` and `/project-intelligence` showing nodes per artifact, edges per relationship, color-coded by status (draft/approved/deployed). |
| Complexity | L |
| Pilot-readiness | **Blocking** — PILOT-03 names this as a hypothesis |
| Built? | Partial. React Flow is the stack; pages exist; need to verify all 6 visualization targets (Knowledge Graph, Repository Graph, Dependency Graph, Workflow Graph, Agent Execution Graph, Audit Timeline, Approval Timeline) are populated with real graph data. |
| Gap | Per CLAUDE.md, **every** of these 7 graphs must be visual: `Knowledge, Repository, Dependency, Workflow, Agent Execution, Audit, Approval`. Most are not yet built. See DIFF-3. |

### TS-4: Audit Timeline (F-005, NFR-020)

| Attribute | Value |
|---|---|
| Why expected | Rule 6 (Mandatory Auditability) is constitutional. Pilot reviewer will pull the audit log on day one to verify "is anything actually being captured." |
| What's needed | Paginated, filterable timeline of `AuditEvent` rows with `{actor, action, target, timestamp, tenant_id, before_value, after_value, rationale}`. Each row expandable to full event. |
| Complexity | M |
| Pilot-readiness | **Blocking** — PILOT-04 names this |
| Built? | Backend complete (`audit_service.py`, `audit_log` table, `@audit` decorator). UI page exists at `apps/forge/app/audit/`. |
| Gap | Confirm timeline rendering performance with >1000 events; confirm rationale capture on approval/reject events. |

### TS-5: Approval Timeline (F-006, F-305)

| Attribute | Value |
|---|---|
| Why expected | Rule 3 (Mandatory Human Approval Gates) is constitutional and named in the mission statement. Pilot user will hit a gate within the first SDLC run. |
| What's needed | Dedicated `/governance-center` or `/approval` view showing pending decisions, one-click approve/reject wired through `approval_workflow.py`. Distinct from completed-decisions view. |
| Complexity | M |
| Pilot-readiness | **Blocking** — PILOT-05 names this as a hypothesis |
| Built? | Backend complete (LangGraph `approval_gate.py`, `approval_workflow.py`). UI partial — `apps/forge/app/audit/` may show events but a dedicated Approval Center for live decisions may be missing. |
| Gap | **Likely missing page.** Verify whether `apps/forge/app/governance-center/page.tsx` exists with a pending-decisions panel. If not, this is the highest-pilot-impact gap. |

### TS-6: IDEation → Architecture → Delivery Path (F-201..F-213, F-301..F-310)

| Attribute | Value |
|---|---|
| Why expected | This is the headline SDLC flow. PILOT-02 names the full chain end-to-end. |
| What's needed | Idea intake → analysis → impact graph → approval → push to Jira → Architecture package (ADR + API contract + Task Breakdown + Risk Register) → approval → delivery system. |
| Complexity | L |
| Pilot-readiness | **Blocking** — PILOT-02 names this |
| Built? | Ideation module present (`backend/app/services/ideation/`). Architecture package generation per `apps/forge/app/architecture/`. Jira push via `push.py`. |
| Gap | Verify the **whole path** is UI-visible, not just API-callable. Pilot user must be able to start an idea intake, watch it move through gates, and see the resulting Jira ticket — without writing API calls. |

### TS-7: SDLC Supervisor End-to-End Run

| Attribute | Value |
|---|---|
| Why expected | PILOT-02 — "runs the full `discovery → planning → architecture → implementation → testing → security → review → deployment` chain on a sample project." |
| What's needed | `sdlc_agent.py` compiles; checkpointing works; HITL interrupts pause at Architecture / Security / Deployment; resumes cleanly. |
| Complexity | L |
| Pilot-readiness | **Blocking** — PILOT-02 |
| Built? | Graph compiled; nodes exist for all 8 phases. |
| Gap | End-to-end run on a real sample project has not been demonstrated. PILOT-02 hypothesis. |

### TS-8: Persona-Switchable UI

| Attribute | Value |
|---|---|
| Why expected | CLAUDE.md names 6 personas (Steward, Tech Lead, Architect, Developer, Security Engineer, Delivery Sponsor). Pilot will exercise ≥3 (Tech Lead, Architect, Steward). |
| What's needed | Persona cookie + middleware injection + per-persona navigation/permissions. Currently visible via the `/persona` page. |
| Complexity | S |
| Pilot-readiness | **Important** — without it, RBAC story is invisible to the reviewer |
| Built? | Yes (`apps/forge/middleware.ts`, `apps/forge/app/persona/`). |
| Gap | None expected. |

### TS-9: RBAC + Tenant Isolation Visible in UI

| Attribute | Value |
|---|---|
| Why expected | Rule 2 is constitutional. Pilot reviewer will attempt to cross tenants and verify refusal. |
| What's needed | Tenant-scoped data fetches return only matching rows; cross-tenant UI surfaces do not exist (or visibly fail); audit log shows tenant boundary attempts. |
| Complexity | M |
| Pilot-readiness | **Important** |
| Built? | Backend complete (PostgreSQL RLS, `forge:admin` short-circuit). |
| Gap | Verify the UI does not have a tenant-leak path (e.g., a global admin panel that bypasses RLS). |

### TS-10: Connector Health (Healthy / Stale / Quarantined)

| Attribute | Value |
|---|---|
| Why expected | NFR-015 (Brownfield graceful degradation). Pilot user must see "Jira is stale" rather than getting silent 500s. |
| What's needed | Per-connector status badge in the UI; freshness_at on KG nodes; staleness surfaced in queries that use stale data. |
| Complexity | M |
| Pilot-readiness | **Important** — NFR-015 |
| Built? | Backend state machine (`connector_states.py`) complete. UI surface partial. |
| Gap | Verify staleness appears in KG visualization (per CLAUDE.md "staleness signals explicit in UI"). |

### TS-11: Artifact Versioning + Supersession

| Attribute | Value |
|---|---|
| Why expected | PRD §5.4 commits to `approved → superseded (new approved version only)`. Pilot reviewer will ask "how do I revise an approved ADR?" |
| What's needed | Version field on every artifact; supersession creates a new version, marks old as superseded with rationale; KG edges reflect lineage. |
| Complexity | M |
| Pilot-readiness | **Important** |
| Built? | Schema (`superseded_by`, `superseded_at`, `status`) committed. UI must expose diff/rationale. |
| Gap | Confirm UI diff between two artifact versions is visible. |

### TS-12: Export Artifacts as Markdown + JSON/YAML (NFR-019)

| Attribute | Value |
|---|---|
| Why expected | Pilot reviewers will copy-paste artifacts into Jira/Confluence. Markdown export is the lowest-friction path. |
| What's needed | Per-artifact "Export" button emitting Markdown + JSON/YAML. |
| Complexity | S |
| Pilot-readiness | **Important** |
| Built? | Backend has export endpoints. UI must surface the button. |
| Gap | Verify UI. |

### TS-13: Cost Attribution per Run/Session (NFR-030)

| Attribute | Value |
|---|---|
| Why expected | NFR-030 + NFR-044. Pilot user (Steward) will ask "what did this run cost?" |
| What's needed | Per-run cost display (LiteLLM tokens × model price), per-terminal-session cost (`F-412`), per-workflow budget ceiling enforcement. |
| Complexity | M |
| Pilot-readiness | **Important** — NFR-030 |
| Built? | `cost_ledger.py` + `workflow_budget_service` + `litellm_client.py`. UI display may be partial. |
| Gap | Cost must be visible at the Approval Gate (NFR-044). Verify that view. |

### TS-14: Health-Check Endpoint (On-Call Visibility)

| Attribute | Value |
|---|---|
| Why expected | Pilot on-call (`oncall-runbook.md`) needs a single URL to curl. |
| What's needed | `/healthz` returning 200 only when DB + Redis + LiteLLM + event bus are reachable. |
| Complexity | S |
| Pilot-readiness | **Important** — P0 W2 exit gate |
| Built? | `apps/forge/app/healthz/page.tsx` exists. |
| Gap | None expected. |

### TS-15: WebSocket-Driven Real-Time Run Progress (F-210)

| Attribute | Value |
|---|---|
| Why expected | PRD §5.3: "Analyzing Repositories ████░░ 80% → Generating Epic ██████ 100%." Pilot user expects to see progress, not poll. |
| What's needed | `/ws/runs/<id>` streams phase transitions + progress; UI subscribes. |
| Complexity | M |
| Pilot-readiness | **Important** — PILOT-06 (terminal streaming) is related |
| Built? | `apps/forge/components/RealtimeTimeline.tsx` + `use-api-data` hooks + `apps/forge/lib/api.ts` WS client. |
| Gap | Verify end-to-end with a real run. |

---

## Differentiators (Forge's Unique Value)

Differentiators = features that distinguish Forge from "just another orchestration tool." These are what a pilot reviewer will demo to a Steward. Categorization: same.

### DIFF-1: Constitution-as-Rulebook (PILOT-09)

| Attribute | Value |
|---|---|
| Value proposition | Rules 1-8 are constitutional and currently invisible. A `/constitution` page rendering each rule with a green/yellow/red health indicator turns "we follow these rules" into "you can see we follow these rules right now." |
| What it needs | A UI page that lists Rules 1-8, each with a live health query (e.g., "Rule 1: no direct SDK imports" → grep audit; "Rule 2: every row has tenant_id" → query result; "Rule 3: every approval had a human decision" → audit query). |
| Complexity | M |
| Pilot-readiness | **Blocking** — PILOT-09 names this as a hypothesis |
| Anti-feature risk | Building this as a static checklist defeats the point; it must be a live query against audit / DB. |

### DIFF-2: Typed Artifacts Everywhere (F-010, Rule 4)

| Attribute | Value |
|---|---|
| Value proposition | ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan — every agent output is one of these typed artifacts. Free-form blobs are forbidden. The KG is *the* artifact store. |
| What it needs | Pydantic schemas for all 6 types + typed storage in `artifact_registry` + KG visualization showing artifact types as node types. |
| Complexity | L |
| Pilot-readiness | **Important** — the differentiator behind "Forge turns isolated model calls into typed artifacts" |
| Built? | Pydantic schemas exist. Artifact registry committed. |

### DIFF-3: Seven Mandatory Visualizations (CLAUDE.md)

| Attribute | Value |
|---|---|
| Value proposition | CLAUDE.md names 7 visualization targets: Knowledge Graph, Repository Graph, Dependency Graph, Workflow Graph, Agent Execution Graph, Audit Timeline, Approval Timeline. React Flow is the framework. |
| What it needs | Each as a separate page or panel. Nodes per entity, edges per relationship, color-coded by status. |
| Complexity | L (7 graphs) |
| Pilot-readiness | **Blocking** — without these, UI First Principle is breached |
| Gap | Audit Timeline + Approval Timeline exist as concepts. Knowledge Graph likely exists. The other 4 (Repository, Dependency, Workflow, Agent Execution) likely do **not** exist as React Flow canvases yet. Confirm. |

### DIFF-4: Approval-as-Data, Not Approval-as-Action

| Attribute | Value |
|---|---|
| Value proposition | Most tools let you approve. Forge records who approved what, when, with what rationale, and surfaces that as a first-class queryable surface. Approval is a typed artifact. |
| What it needs | Approval events written to `approval_request` table; rationale captured; `requested_at`, `decided_at`, `decided_by`, `decision` (approve/reject/request-changes) all queryable; UI Timeline + filter by approver. |
| Complexity | M |
| Pilot-readiness | **Important** — table-stakes today, differentiator once it becomes queryable |
| Built? | Backend `approval_workflow.py` complete. UI surface for live decisions may be missing. |

### DIFF-5: Audit-as-Data (Rule 6)

| Attribute | Value |
|---|---|
| Value proposition | `audit_log` is append-only, hash-chained, WORM-backed, with `{agent, model, prompt, tool, cost, artifact, timestamp, result}`. Anything that mutates state is auditable. |
| What it needs | Audit log + `@audit` decorator + tamper-evidence + UI timeline + per-artifact drill-down. |
| Complexity | L |
| Pilot-readiness | **Blocking** — Rule 6 is constitutional |
| Built? | Backend complete. UI partial (TS-4). |

### DIFF-6: Per-Stage Tool Bundle Isolation (NFR-046, F-505)

| Attribute | Value |
|---|---|
| Value proposition | An agent at workflow stage X can only invoke the curated tools for stage X. No cross-stage tool reach. Same Custom-Guardrails principle as white-labeling. |
| What it needs | Per-stage bundle config (Steward-authored) + agent-runtime enforcement + UI showing "current bundle" per run. |
| Complexity | M |
| Pilot-readiness | **Important** — NFR-046 |
| Built? | Schema committed; runtime enforcement claimed. UI for "show bundle" may be missing. |

### DIFF-7: Deterministic Merge Gate (NFR-042, F-503)

| Attribute | Value |
|---|---|
| Value proposition | Code Validator output is consumed as PASS/FAIL signal only — not LLM-negotiated. Rules either pass or they don't. No silent override. |
| What it needs | Validator sub-graph (separate prompt, context, possibly model) → typed Validation Report → deterministic gate → remediation queue on FAIL. |
| Complexity | L |
| Pilot-readiness | **Important** — NFR-042 |
| Built? | `code_validator_nodes/` present; gate logic claimed. End-to-end on a real PR unverified. |

### DIFF-8: Context-Aware Architecture Generation (F-309)

| Attribute | Value |
|---|---|
| Value proposition | ADR generation consumes requirement + project knowledge graph + standards + ideation output — NOT the requirement alone. `context_sources` field lists every graph node + standard ID that informed the decision. |
| What it needs | Generator node that queries KG + standards + ideation output bundle before drafting; result artifact carries `context_sources[]`; UI shows those sources. |
| Complexity | M |
| Pilot-readiness | **Important** — PRD calls it a "key differentiator" |
| Built? | Schema commitment. Generator behavior unverified. |

### DIFF-9: Day-One Bootstrap with Reference Standards (F-507, NFR-045)

| Attribute | Value |
|---|---|
| Value proposition | New engagement starts with KnackForge reference standards pre-loaded. Customer-specific layer is overlaid. Customer never starts from blank. Bootstrap is idempotent. |
| What it needs | F-021 wizard seeds standards/templates/policies from F-001 baseline; re-running is safe; audit log records bootstrap. |
| Complexity | M |
| Pilot-readiness | **Important** — NFR-045 |
| Built? | Spec committed; behavior unverified end-to-end. |

### DIFF-10: Steering Rules as Files (F-504)

| Attribute | Value |
|---|---|
| Value proposition | Workspace Markdown files auto-injected into agent context at relevant workflow stages. Customer-portable, not vendor-trapped. |
| What it needs | Files-as-first-class memory; auto-discovery at session start; re-injection on file change; typed per F-010 schema. |
| Complexity | M |
| Pilot-readiness | **Nice-to-have** — table-stakes only if pilot user expects it; otherwise differentiator |
| Built? | Spec committed. UI to author steering rules unverified. |

---

## Anti-Features (Deliberately NOT Building for Pilot)

Anti-features are explicit exclusions with reasons. Re-adding them risks the pilot scope. Each anti-feature here has its reason; many map to PROJECT.md "Out of Scope" but are recast as anti-features for the FEATURES lens.

### AF-1: Mobile / Native Client

| Attribute | Value |
|---|---|
| Why avoid | CLAUDE.md "UI First Principle" + PRD template `Mobile app` canonical exclusion. Web-first; mobile deferred to v3+. |
| What to do instead | Build responsive web UI meeting WCAG 2.1 AA. |
| Pilot impact | Zero. |

### AF-2: Real-Time Collaborative Editing of Artifacts (CRDT-style)

| Attribute | Value |
|---|---|
| Why avoid | Out of scope for pilot (PROJECT.md). Artifacts are versioned through the audit log. CRDT adds significant complexity for a one-tenant pilot. |
| What to do instead | Single-author-edit + supersession (TS-11). Audit log preserves the edit history. |
| Pilot impact | Zero. |

### AF-3: Public Connector Marketplace (Third-Party Submissions)

| Attribute | Value |
|---|---|
| Why avoid | PROJECT.md Out of Scope. Pilot ships 13 internal connectors + `mcp-router` for self-hosted MCP servers. Third-party marketplace is post-pilot. |
| What to do instead | Steward-curated list of 13 internal connectors, installable per tenant. |
| Pilot impact | Low — pilot user only needs GitHub + Jira + Confluence. |

### AF-4: Cross-Tenant Organization Knowledge Sharing

| Attribute | Value |
|---|---|
| Why avoid | Rule 5: Org Knowledge is shared *within* a tenant, not *across* tenants. Pilot is one tenant anyway. |
| What to do instead | Single-tenant Org Knowledge graph; Steward publishes within tenant. |
| Pilot impact | Zero. |

### AF-5: External Pilot Customer

| Attribute | Value |
|---|---|
| Why avoid | PROJECT.md Out of Scope. Internal dogfooding first; bringing in external pilot before v2.0 stabilizes risks both the pilot relationship and the platform. |
| What to do instead | Forge team dogfoods the platform against its own projects. |
| Pilot impact | This **is** the pilot — there is no external customer to onboard. |

### AF-6: Marketing / Pricing / Sales Tooling

| Attribute | Value |
|---|---|
| Why avoid | PROJECT.md Out of Scope. Internal product only. |
| What to do instead | Focus engineering capacity on pilot-readiness. |
| Pilot impact | Zero. |

### AF-7: Direct LLM Provider SDK Usage Anywhere

| Attribute | Value |
|---|---|
| Why avoid | Rule 1 is constitutional. Even test fixtures must go through the abstraction layer. |
| What to do instead | All LLM traffic through `litellm_client.py`. |
| Pilot impact | Negative — re-introducing this would force a refactor before pilot. |

### AF-8: `@fora/*` Scope in Active Code

| Attribute | Value |
|---|---|
| Why avoid | CLAUDE.md v2.0 naming convention. `forge-*` (apps) or `@forge-ai/*` (packages). `archive/paperclip/` is history only. |
| What to do instead | Archive paperclip-era code; rename or rewrite in v2.0 conventions. |
| Pilot impact | Zero — naming convention has no functional impact. |

### AF-9: Full Phase 4 (Development) / Phase 5 (Security+QA) / Phase 7 (Delivery) Accelerators

| Attribute | Value |
|---|---|
| Why avoid | PRD §5.6 places these as Out-of-V1. Pilot scope is one tenant, one workflow; depth on the chosen path beats breadth. |
| What to do instead | F-501 (Code Validator) + F-503 (Deterministic Gate) provide the security/quality surface pilot needs. Defer the full Development / Security+QA / Delivery accelerators. |
| Pilot impact | Pilot must show that Architecture → Implementation can be exercised end-to-end, but full Development Accelerator (code patches, unit-test scaffolds) is not required. |

### AF-10: Multi-Engagement / Multi-Customer Support

| Attribute | Value |
|---|---|
| Why avoid | Pilot is one tenant. Multi-tenancy is engineered but not exercised. |
| What to do instead | Single-tenant pilot. Multi-tenancy verified via RLS tests + a synthetic second-tenant query that returns zero rows. |
| Pilot impact | Zero. |

### AF-11: Self-Service "Bring Your Own Provider" Without Steward Approval

| Attribute | Value |
|---|---|
| Why avoid | Rule 1 + NFR-005 + cost governance. Adding a provider must go through LiteLLM Proxy + Steward approval + secret rotation. |
| What to do instead | Steward-curated model-provider registry; tenant admin picks from approved list. |
| Pilot impact | Low — pilot Steward pre-approves Claude + Codex + GPT-4o. |

### AF-12: Building F-009 (Governance Dashboard) as a Full F-009

| Attribute | Value |
|---|---|
| Why avoid | PRD marks F-009 V1-OPTIONAL. pilot-readiness-review §6 says the Adoption Signal Panel cannot be reported on with current PRD scope. |
| What to do instead | A minimal dashboard showing Approval cycle completion rate + Human Override Rate trend (the two feasible signals) + per-tenant cost. Skip the 4 infeasible signals. |
| Pilot impact | Low — pilot reviewers care about TTTD and counter-metrics; the full Adoption Signal Panel is post-pilot. |

### AF-13: Phase 1.5 Pillar 1 Validators in Full

| Attribute | Value |
|---|---|
| Why avoid | F-501..F-505 are valuable but a pilot cutover of *all five* is over-scope. |
| What to do instead | Pilot ships F-501 (Code Validator Agent) + F-502 (Validation Report) + F-503 (Deterministic Security Gate). F-505 (Per-Stage Tool Bundle Guardrails) is exercised through NFR-046 but its full configuration UI is post-pilot. |
| Pilot impact | Pilot reviewer must see "validator runs separately, gate is deterministic" — that's F-501 + F-503. |

### AF-14: Phase 2.0 Architecture Full Suite

| Attribute | Value |
|---|---|
| Why avoid | F-301..F-310 spans 10 features; pilot only exercises ADR + API Contract + Task Breakdown + Risk Register generation + approval. |
| What to do instead | Pilot ships: F-301 (ADR), F-302 (API Contract), F-303 (Task Breakdown), F-304 (Risk Register), F-305 (Approval), F-306 (Traceability), F-309 (Context-Aware). Defer F-307 (Versioning) and F-308 (Standards Attestation) and F-310 (Acceptance Criteria Package) to polish. |
| Pilot impact | Pilot user must see ADR + API Contract + Task Breakdown + Risk Register generation → approval. Acceptance Criteria Package is a nice-to-have. |

### AF-15: Custom Connector SDK Builder

| Attribute | Value |
|---|---|
| Why avoid | Pilot ships 13 internal connectors. Custom SDK builder is post-pilot. |
| What to do instead | `mcp-router` package + 13 internal connectors; custom integration via self-hosted MCP server (already supported). |
| Pilot impact | Zero — pilot uses only the 13 internal connectors. |

### AF-16: Adobe XD / Kiro / ClickUp Adapters in Pilot Scope

| Attribute | Value |
|---|---|
| Why avoid | F-508, F-509, F-510 are per-engagement choice. Pilot uses GitHub + Jira + Confluence (per P0 W2). |
| What to do instead | Ship the connectors, leave them disabled in the default connector catalog. |
| Pilot impact | Zero. |

### AF-17: Live Co-Browsing / Cursor Sharing

| Attribute | Value |
|---|---|
| Why avoid | Pilot reviewers are internal; they can sit in the same room. WebSocket broadcast + observer mode (F-413) covers the case. |
| What to do instead | Terminal Center observer mode (F-413) is sufficient. |
| Pilot impact | Zero. |

### AF-18: "AI Suggestion" Overlays That Pre-Fill Forms

| Attribute | Value |
|---|---|
| Why avoid | Pilot user wants to see the agent's *actual* work, not LLM-injected suggestions on top. Adds a layer of confusion. |
| What to do instead | Agent outputs are typed artifacts surfaced as KG nodes. User accepts/rejects the artifact. |
| Pilot impact | Zero. |

### AF-19: Built-In Telemetry/Product-Analytics Tracking

| Attribute | Value |
|---|---|
| Why avoid | Pilot is internal dogfooding; usage is observable directly. Adding product analytics adds privacy + scope concerns. |
| What to do instead | Audit log + OTel traces cover the measurement needs. |
| Pilot impact | Low — pilot reviewers care about TTTD / counter-metrics, which come from the audit log. |

### AF-20: Building a New IDE Plugin / VSCode Extension

| Attribute | Value |
|---|---|
| Why avoid | Terminal Center (F-401..F-415) is the IDE surface for pilot. VSCode extension is post-pilot. |
| What to do instead | Kiro MCP Adapter (F-510) is the only IDE-integration pilot ships; it's an MCP adapter, not a custom VSCode extension. |
| Pilot impact | Zero. |

---

## Feature Dependencies

```
Foundation:
  F-001 Standards ─┐
  F-002 Templates ─┤
  F-004 RBAC ──────┴─→ F-005 Audit Log ─→ F-006 Approval Engine ─→ F-007 Connectors
                                                        │
                                                        └──→ F-018 Forge Command Center
                                                              F-019 Command Map
                                                              F-020 Process Manager
                                                              F-021 Onboarding Wizard
                                                                              │
                                                                              ▼
                                                          ┌───────────────────┴───────────────────┐
                                                          │                                       │
                                                          ▼                                       ▼
                                                  Project Intelligence                Ideation → Architecture
                                                  (F-101..F-115)                      (F-201..F-213, F-301..F-310)
                                                          │                                       │
                                                          └──→ F-110 Impact Analysis ──────────────┘
                                                                              │
                                                                              ▼
                                                                  Terminal Center
                                                                  (F-401..F-415)
                                                                              │
                                                                              ▼
                                                                  Validators
                                                                  (F-501..F-505)
```

**Critical dependencies for pilot:**

- F-021 (Onboarding) depends on F-001..F-007 (foundation). Without foundation, onboarding cannot land.
- F-309 (Context-Aware Architecture Generation) depends on F-103, F-104, F-110 (Project Intelligence) + F-001 (Standards) + F-211 (Ideation Output Bundle). Building F-309 before these is a known anti-pattern from the pilot-readiness-review.
- F-503 (Deterministic Security Gate) depends on F-501 (Code Validator Agent) + F-502 (Validation Report). Building the gate without the validator reduces it to a stub.
- Approval Timeline UI (TS-5) depends on F-005 (Audit) + F-006 (Approval) + LangGraph interrupt pipeline. UI cannot exist without the interrupt.
- Constitution-as-Rulebook (DIFF-1) depends on audit log + DB queries + KG node counts. Cheap to build once the substrate exists.

---

## MVP Recommendation

**Build order (pilot-readiness cutover):**

### Phase A — Foundation Visibility (must be UI-visible)

1. **TS-5 Approval Timeline** (PILOT-05) — highest impact gap if missing
2. **TS-4 Audit Timeline** (PILOT-04)
3. **TS-1 Tenant Onboarding Wizard** end-to-end (PILOT-01)
4. **TS-2 Connector Marketplace** lifecycle actions wire-up (PILOT-07)
5. **TS-14 Health Check** confirm 200
6. **TS-12 Export** Markdown + JSON

### Phase B — Differentiation (must demonstrate value)

7. **DIFF-3 Seven Visualizations** — at minimum: Knowledge Graph, Repository Graph, Dependency Graph, Workflow Graph, Audit Timeline, Approval Timeline. Agent Execution Graph is nice-to-have.
8. **DIFF-1 Constitution-as-Rulebook** (PILOT-09) — credibility signal
9. **TS-6 Ideation → Architecture → Delivery path** end-to-end (PILOT-02)
10. **TS-7 SDLC Supervisor** end-to-end run (PILOT-02)

### Phase C — Hardening (pilot can launch without, but reviewer may push)

11. **TS-13 Cost Attribution** at the gate (NFR-044)
12. **TS-9 RBAC visible** cross-tenant refusal
13. **TS-10 Connector Staleness** in KG view (NFR-015)
14. **TS-11 Artifact Versioning** diff UI
15. **DIFF-4 Approval-as-Data** queryable
16. **DIFF-6 Per-Stage Tool Bundle** visibility (NFR-046)
17. **DIFF-7 Deterministic Merge Gate** end-to-end (NFR-042)

### Phase D — Polish (post-pilot-launch OK)

18. **TS-15 Real-time WS** run progress (F-210) — already present, polish
19. **TS-3 KG Visualization** color-coding polish (PILOT-03)
20. **DIFF-9 Day-One Bootstrap** visible audit
21. **TS-8 Persona Switching** polish

**Defer to post-pilot:**

- AF-1 Mobile, AF-2 CRDT, AF-3 Public Marketplace, AF-5 External Pilot, AF-6 Marketing, AF-9 Full Development/Security+QA/Delivery, AF-10 Multi-Engagement, AF-12 F-009 full dashboard, AF-13 Full F-505, AF-14 Full F-307/F-308/F-310, AF-15 SDK Builder, AF-20 VSCode Extension.

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Table stakes feature list | HIGH | PRD + PROJECT.md + pilot-runbooks enumerate what's expected. |
| Differentiator list | MEDIUM | Confidence on DIFF-1..DIFF-5 is HIGH (built or committed); DIFF-6..DIFF-10 are MEDIUM (committed but unverified end-to-end). |
| Anti-features | HIGH | PROJECT.md "Out of Scope" + PRD §5.6 + Constitutional Rules enumerate exclusions. |
| Dependency graph | HIGH | PRD §5 capability groups + depends-on columns are explicit. |
| Pilot-readiness impact | MEDIUM | The "Blocking" / "Important" / "Nice-to-have" labels derive from PILOT-01..10 hypotheses + NFR criticality. PILOT-02, PILOT-05, PILOT-09 are the riskiest hypotheses. |

---

## Gaps to Address

These cannot be resolved at research time and require phase-specific research or decisions:

1. **TS-5 Approval Timeline** — is the page actually built? If `apps/forge/app/governance-center/page.tsx` does not exist or has no pending-decisions panel, this is the single highest-impact pilot blocker. **Verify before Phase A.**
2. **TS-6 end-to-end path** — can a Tech Lead start an idea, watch it through gates, and see the Jira ticket without API calls? **Verify by running it.**
3. **TS-7 SDLC supervisor** — has the full graph been run on a real sample project? PILOT-02 hypothesis is the load-bearing one. **Verify in Phase 1 (PILOT-08 ADR-001..003 + M3 substrate validation).**
4. **DIFF-3 seven visualizations** — how many of the seven actually exist as React Flow canvases? Likely 2-3 of 7. **Audit gap before Phase B.**
5. **DIFF-1 Constitution rule health queries** — what is the query for each of 8 rules? E.g., Rule 1: `grep -r "from openai" backend/ apps/` should return zero non-test matches. **Define 8 health queries before building the page.**

---

## Sources

- `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md` §5 (capability groups F-001..F-601), §6 (NFRs), §7 (open questions), §8 (pilot phasing)
- `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/review-pilot-readiness.md` — pilot lens review (high confidence on gaps)
- `docs/planning-artifacts/prds/prd-forge-ai-2026-06-19/decisions/ADR-001..003` — OQ-005/006/007 resolutions
- `.planning/PROJECT.md` — Validated/Active/Out-of-Scope requirements (PILOT-01..10)
- `.planning/codebase/ARCHITECTURE.md` — components, layers, dependencies
- `.claude/CLAUDE.md` — Rules 1-8 + UI First Principle + 7 visualization targets
- `docs/operations/pilot-p0-pre-pilot.md` — P0 exit criteria, Keycloak import, sample repo selection, baseline TTTD methodology
- `docs/operations/success-metrics.md` — TTTD + counter-metrics + adoption signals
- Git working tree status (2026-06-22) — confirms in-progress UI work (ConnectorDetailPanel, AddConnectorDialog, ConnectorLifecycleActions, IdeaEnhanceDialog, IngestIndicator, PushIdeaToJiraButton, persona app, project-onboarding updates)
