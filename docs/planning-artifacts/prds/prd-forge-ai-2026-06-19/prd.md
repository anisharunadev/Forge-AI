# PRD: Forge Delivery Accelerator — v2.0

---
title: "PRD: Forge Delivery Accelerator"
status: final
version: 2.0
created: 2026-06-19
updated: 2026-06-21
project: forge-ai
north_star: "Time to Trusted Delivery (TTTD)"
strategic_positioning: >
  Agent Operating System — the governed control plane for any model, any agent,
  any connector; development execution powered by Open GSD; enterprise multi-tenant
  delivery intelligence built on PostgreSQL 17 + Apache AGE + LiteLLM.
supersedes: "v1.3 (2026-06-20)"
resolved_adrs:
  - "ADR-001: Cloud-Only AWS at V1 (resolves OQ-005)"
  - "ADR-002: PostgreSQL 17 + Apache AGE (resolves OQ-006)"
  - "ADR-003: Hybrid MDM + Steward Priority (resolves OQ-007)"
v2_changes:
  - "Added Phase 3 — Forge Terminal Center (F-401..F-415) as V1 capability"
  - "Added Foundation FRs F-018..F-021 (Command Center, GSD White-Label, Process Manager, Onboarding Wizard)"
  - "Incorporated ADR-001/002/003 decisions throughout"
  - "Fixed M1 substrate gaps from review-architecture.md"
  - "Added compliance NFRs from review-compliance.md (NFR-034, NFR-035, NFR-004a, NFR-004b, NFR-002a)"
  - "Updated milestone plan to 11-milestone alignment from Master Development Charter"
  - "Added DL-022 through DL-027 (Terminal Center, Command Center, GSD White-Label, LiteLLM, RLS, M1 Substrate)"
  - "Added §6.13 M1 Substrate Primitives"
  - "Added §8.8 Forge Terminal Center Architecture"
  - "GSD White-Label principle formalized as Pillar 5 extension"
  - "Constitutional constraint mapping added (§6.14)"
---

---

## Executive Summary

**Forge** is a delivery intelligence and acceleration platform — an **Agent Operating System** — that codifies KnackForge's engineering methodology as typed artifacts, approval gates, and a per-engagement knowledge layer, so every customer engagement inherits the same standards, architectural rigor, and delivery practices regardless of team, stack, or which AI agent is running.

**Forge is a Web Platform first.** The UI is the product, not an optional surface.

**What is new in v2.0:**

- **Forge Terminal Center** — an in-browser multi-agent terminal (xterm.js) where developers run Claude Code, Codex, Gemini CLI, Aider, Kiro, or any CLI agent in tabbed, split-pane sessions — all governed, audited, and workspace-isolated.
- **Forge Command Center** — every one of GSD's 60+ commands white-labeled as `forge-*` and accessible from the UI as clickable, audited workflow panels.
- **ADR decisions locked in**: Cloud-only AWS (ADR-001), PostgreSQL 17 + Apache AGE (ADR-002), Hybrid MDM + Steward conflict policy (ADR-003).
- **M1 substrate gaps closed** — typed event substrate, LiteLLM provider abstraction, tenant-scoped cost/freshness ledgers, and query-layer isolation are explicitly scoped to M1.
- **Compliance gaps addressed** — MFA, access-review cadence, breach-notification SLA, data minimization, pen-test cadence, and audit tombstoning are now NFR-locked.

**North Star Metric:** Time to Trusted Delivery (TTTD).

**V1 scope (five packages):**
1. Foundation (Organization Knowledge + Compliance + Agent Center + Connector Center + Command Center + Terminal Center)
2. Project Intelligence (Phase 0: F-101..F-115)
3. Ideation (Phase 1: F-201..F-213)
4. Architecture Accelerator (Phase 2: F-301..F-310)
5. Forge Terminal Center (Phase 3: F-401..F-415)

**Resolved phase-blockers:** OQ-005, OQ-006, OQ-007 closed via ADR-001/002/003.

**Remaining phase-blockers:** OQ-001 (pilot project), OQ-002 (TTTD baseline methodology), OQ-004 (commercial pricing), OQ-008 (V1 connector scope), OQ-009 (P1.5 validation rubric).

---

## 1. Vision

### 1.1 Vision Statement

**Forge is a delivery Agent Operating System.** It is the governed control plane where organizations connect any model, any agent, and any connector — and visualize the entire SDLC, knowledge graph, and running agent sessions in one place.

Forge orchestrates the agents that already exist (Claude Code, Codex, Gemini CLI, Aider, Kiro, Hermes, OpenHands, Cursor Agent, GSD Core, and custom agents) inside a substrate of typed artifacts, approval gates, audit trails, and a per-Project knowledge layer.

**Constitutional statement:** Forge is NOT an AI agent. Forge is the operating system that orchestrates agents, knowledge, governance, and delivery workflows.

### 1.2 Strategic Posture (Leadership-Facing)

Forge reduces dependence on individual experts by making delivery knowledge explicit, governed, reusable, and discoverable. It explicitly addresses: key-person dependency, inconsistent delivery, scaling teams, and knowledge loss.

### 1.3 One-Sentence Vision

> Forge enables KnackForge to scale delivery quality through systems, not individuals, by capturing, governing, propagating, and reusing delivery knowledge — and orchestrating any AI agent — across every customer engagement.

### 1.4 Five Pillars

1. **Codified Delivery Methodology** — Standards, governance, patterns, and best practices become reusable assets (F-001..F-003, F-010).
2. **Knowledge Propagation** — Delivery knowledge flows forward as typed artifacts and approvals: Requirements → Architecture → Development → Security → Deployment (F-201..F-213, F-301..F-310).
3. **Delivery Intelligence** — Every engagement contributes reusable knowledge: project intelligence, refactor intelligence, cross-project learning, knowledge graphs (F-101..F-115).
4. **Agent Orchestration** — Forge is the runtime substrate that orchestrates external agents via the Agent Center (F-011..F-014, F-016, F-017). Agents are configurable, pluggable, swappable.
5. **GSD-Powered Execution** — Forge adopts Open GSD as the default Development Execution Framework. All 60+ GSD commands are white-labeled as `forge-*` commands (F-018, F-019). Forge extends GSD with multi-tenancy, project intelligence, organization knowledge, governance, audit, visualization, and enterprise integrations — it does not reinvent development-execution primitives. **Users never see "GSD" — they see Forge Discuss Phase, Forge MVP Phase, Forge Ship.**

### 1.5 Why Now

Three layers of commoditization have created the opening:

1. **Code generation is commoditized** — Cursor, Claude Code, Copilot, Kiro all generate code competently.
2. **Coding agents are commoditized** — Claude Code, Codex, Gemini CLI, Aider, Kiro, Hermes, OpenHands all operate as agents with tool-use capabilities.
3. **The control plane is not.** Orchestrating any model, any agent, and any connector inside a governed substrate — with typed artifacts, approval gates, audit trails, knowledge graphs, multi-agent terminals, and visualization — is the missing layer.

### 1.6 Leadership Framing — What Forge Is Not

- **Forge does not replace engineers, architects, or delivery teams.** *(NFR-032 enforces)*
- **Forge does not displace Jira, GitHub, Confluence, or other systems of record.** *(§4.4)*
- **Forge does not make decisions for delivery teams.** *(F-305 + F-006)*
- **Forge is not a coding-agent bake-off.** The terminal center accommodates all agents; none is privileged.
- **Forge is not a bottleneck.** The Steward governs standards; the Architect governs approvals; the Tech Lead governs delivery; the Terminal gives developers direct agent access.
- **Forge is not an API product.** The UI is the product. API access exists for integration but is not the primary surface.

---

## 2. Decision Log (Forward-Flowing Reference)

All decisions flow into Architecture, UX, Epics, and Stories. Full audit trail lives in `.decision-log.md`.

| ID | Decision | Locked by |
|---|---|---|
| **DL-001** | Brownfield-first strategy approved. | Brief + §5 |
| **DL-002** | Human approval gates mandatory at every governance boundary. *(NFR-032)* | Steering + NFR-032 |
| **DL-003** | Project Intelligence (Phase 0) precedes SDLC acceleration. | §5 FR ordering |
| **DL-004** | Organization Knowledge Layer is shared across tenants. | NFR-006 |
| **DL-005** | Project Intelligence Layer is fully isolated per tenant. | NFR-006 + A-004 |
| **DL-006** | North Star Metric is **TTTD**. | Steering |
| **DL-007** | Tech Lead is the strategic through-line persona. | Steering |
| **DL-008** | All numeric targets `[TO BE VALIDATED DURING PILOT]`. | Steering |
| **DL-009** | V1 scope is Foundation + Phase 0 + Phase 1 + Phase 2 + Phase 3 (Terminal Center). | v2.0 |
| **DL-010** | Model Provider Independence is foundational. *(NFR-029)* | NFR-029 |
| **DL-011** | V1 is SOC2-ready (controls designed), not certified. | Steering |
| **DL-012** | **Forge is a Web Platform first.** UI is the product. | Steering |
| **DL-013** | **Domain model:** Organization → Project (= Tenant = Engagement) → Repository. | Steering |
| **DL-014** | UI-first delivery: each milestone ships a working UI surface with its backend. | Steering |
| **DL-015** | **Forge is an Agent Operating System, not an SDLC agent.** | v1.1 |
| **DL-016** | NFR-029 upgraded to **Agent Runtime Portability** (agents, not just models). | v1.1 |
| **DL-017** | **Knowledge Center is the killer feature.** Cross-source traversable graph. | v1.1 |
| **DL-018** | V1 ships as five packages (Foundation, PI, Ideation, Architecture, Terminal). | v2.0 |
| **DL-019** | **Ideation is V1 Phase 1.** AI Product Management Workspace. | v1.2 |
| **DL-020** | Phase renumbering: Ideation=1, Architecture=2, Terminal Center=3. | v1.2 + v2.0 |
| **DL-021** | Forge flow: Project Intelligence → Ideation → Architecture → Dev → Testing → Security → Deployment. | v1.2 |
| **DL-022** | *(v2.0)* **Forge Terminal Center is V1 Phase 3.** In-browser multi-agent terminal with xterm.js, PTY processes, tab/split UI. Every terminal session is governed, isolated, persisted, and fully audited. | v2.0 |
| **DL-023** | *(v2.0)* **Forge Command Center is a Foundation capability.** All 60+ GSD commands white-labeled as `forge-*` commands and accessible from the UI. Users never see "GSD". | v2.0 |
| **DL-024** | *(v2.0)* **GSD White-Label Principle.** `forge-*` is the user-facing brand; `gsd` is the execution engine. The FORGE_COMMAND_MAP is the authoritative registry. | v2.0 |
| **DL-025** | *(v2.0)* **LiteLLM Proxy** is the Forge Provider Abstraction Layer. All LLM traffic flows through LiteLLM. No service may import a provider SDK directly. *(Rule 1)* | ADR-002 + Research |
| **DL-026** | *(v2.0)* **PostgreSQL RLS** is the multi-tenancy enforcement mechanism. Every tenant-scoped table has `tenant_id` + `project_id` with RLS policy. Per-tenant CMK via AWS KMS. | ADR-001 + Research |
| **DL-027** | *(v2.0)* **M1 Substrate must include** typed event bus, LiteLLM abstraction, tenant-scoped cost/freshness ledgers, query-layer isolation primitives, append-only artifact storage with supersession, connector failure-mode primitives. These are not M3 retrofits. | review-architecture.md |
| **DL-029** | *(v2.0)* **Refactor Agent orchestrates cloud-provider modernization tooling** (AWS Transform-class on AWS; Azure equivalents on Azure). Forge does not reimplement source-to-target translation. Phased migration plans produced by the Refactor Agent land in Jira as backlog and are executed through the standard 5-stage workflow (DL-021). *(F-601, R8)* | Pillar 1 Deep-Dive §6 |
| **DL-031** | *(v2.0)* **Forge integrates with customer IDEs (Kiro, Cursor, Claude Code, Copilot) via MCP only.** No IDE fork, no IDE replacement, no IDE plugin shipped by Forge. Per-customer IDE choice drives the MCP adapter, not platform code. *(F-510, R8)* | Pillar 1 Deep-Dive §11 |

---

## 3. Success Metrics

### 3.1 North Star Metric — Time to Trusted Delivery (TTTD)

**Definition:** Elapsed time from an approved requirement entering Forge to the creation of a deployment-approved release package containing all required artifacts, approvals, security validations, quality validations, and deployment instructions.

**Baseline:** `[TO BE MEASURED — establish during pilot P0]`
**Target:** `[TO BE VALIDATED DURING PILOT]`

### 3.2 Business Outcomes

| Metric | Definition | Direction |
|---|---|---|
| Predictability | Variance of TTTD across teams, projects, time | Lower = better |
| Rework Rate | % of stories reopened / ADRs revised post-approval | Lower = better |
| Story Reopen Rate | % of accepted stories reopened within sprint | Lower = better |
| Architecture Review Time | Time from ADR request → ADR approved | Lower = better |
| Onboarding Time | Time for new engineer to ship first merged PR to a project | Lower = better |

### 3.3 Project Intelligence Outcomes

| Metric | Definition | Direction |
|---|---|---|
| Time to Project Understanding | Time from intake → architecture map + service catalog available | Lower = better |
| Architecture Discovery Coverage | % of repos/services surfaced with metadata + relations | Higher = better |
| Question Resolution Accuracy | % of PI queries answered correctly without escalation | Higher = better |
| Delivery Knowledge Reuse Rate | % of stories/ADRs referencing existing artifacts | Higher = better |
| Architecture Drift Rate | % of implemented changes diverging from approved architecture | Lower = better |

### 3.4 Terminal Center Outcomes (v2.0)

| Metric | Definition | Direction |
|---|---|---|
| Agent Sessions per Developer per Week | How many terminal sessions developers actively use | Higher = better (adoption) |
| Terminal Audit Coverage | % of terminal commands captured in audit trail | Must be 100% |
| Session Resume Rate | % of sessions that are paused and later resumed | Higher = better (utility) |
| Multi-Agent Concurrency | Peak concurrent terminal sessions across projects | Higher = better (scale) |

### 3.5 Counter-Metrics (Anti-Gaming)

| Counter-metric | What it catches |
|---|---|
| Architecture Approval Skip Rate | Teams fast-tracking by skipping ADR review |
| Security Approval Skip Rate | Blanket-waiver patterns |
| Production Incident Rate | Delivery speed at cost of stability |
| Defect Escape Rate | Velocity via insufficient QA |
| Knowledge Reuse Avoidance Rate | Teams re-inventing instead of using knowledge layer |
| Human Override Rate | % of generated artifacts rejected or heavily modified |
| Terminal Command Audit Gaps | Any terminal command not captured in audit log |

### 3.6 Pilot Framing

> Forge will not commit to target improvements until baseline measurements have been established through pilot engagements. Pilot success = baseline establishment + user adoption + statistically significant directional improvement.

---

## 4. Personas

### 4.1 V1-Active Personas

| Persona | Role | Job-to-be-done |
|---|---|---|
| **The Steward** — Engineering Excellence Lead | Owns Organization Knowledge Layer; publishes standards, templates, governance | Make KnackForge delivery standards explicit, reusable, enforceable — without becoming a bottleneck |
| **The Tech Lead** *(primary V1 — also Agent Orchestrator)* | Owns delivery outcomes; bridges PM, Architect, Developer; configures agents; monitors Realtime Agent Dashboard | Understand an existing project, identify impact of changes, orchestrate governed agents through a governed architecture process that produces reviewable, reusable artifacts without depending on tribal knowledge |
| **The Architect** *(V1 secondary)* | Owns architecture decisions; reviews ADRs; sets standards | Produce and approve ADRs/API contracts that downstream teams can execute against, without rewriting them |
| **The Developer** *(Terminal Center user)* | Implements code; runs agent sessions in the Terminal Center | Run the right agent in the right workspace with full context, without leaving the Forge platform or losing auditability |
| **The Delivery Sponsor** *(executive observer)* | Funds Forge; measures initiative success | Understand delivery health, predictability, and organizational risk |

### 4.2 Future-State Personas

Developer (extended) → QA Engineer → Security Engineer → Solution Architect → Delivery Manager → Customer Delivery Team → Commercial Buyer.

### 4.3 Out-of-Scope Personas

AI Delivery Operator · Replacement Engineer · Autonomous Release Manager.

### 4.4 Systems of Record

Forge integrates with: GitHub, Bitbucket, GitLab, Jira, Confluence, SonarQube, AWS, Figma, Slack, Zendesk, Azure DevOps, Databricks.

### 4.5 Governance Boundary (Load-Bearing Term)

A **governance boundary** is any transition in an artifact's lifecycle that changes its authoritative status (`draft → approved`, `approved → superseded`). Each boundary is gated: no background process, automation, or AI may cross it without a human approver distinct from the author. The artifact state machine in §5.3 is the canonical starting shape.

---

## 5. Capability Groups

**V1 scope:** Foundation (F-001..F-021) + Phase 0 (F-101..F-115) + Phase 1 Ideation (F-201..F-213) + Phase 2 Architecture (F-301..F-310) + Phase 3 Terminal Center (F-401..F-415).

**Acceptance criteria** are authored downstream in Epics.

---

### 5.1 Foundation — Organization Knowledge, Compliance, Agent Center, Command Center

The substrate. Shared across all phases. Must be complete before Phase 0 can run.

#### 5.1a Core Governance (F-001..F-010)

| ID | Name | Description | Personas | Depends on |
|---|---|---|---|---|
| **F-001** | Standards Library | Versioned catalog of engineering standards (architecture, security, coding, governance). Steward authors; downstream phases consume. | Steward, Tech Lead, Architect | — |
| **F-002** | Templates | Typed templates for ADR, API contract, task breakdown, risk register, security report, acceptance criteria. | Steward, Tech Lead, Architect | F-010 |
| **F-003** | Governance Policy Engine | Declarative policies defining mandatory gates at each artifact transition. Enforced by F-005 + F-006. | Steward, Tech Lead | F-004, F-005, F-006 |
| **F-004** | RBAC | Multi-tenant org/project/role model. Roles: Steward, Tech Lead, Architect, Developer, Security Engineer, Delivery Sponsor. Per-tenant RLS-backed enforcement. *(DL-026)* | Steward, all | F-007 |
| **F-005** | Audit Log | Append-only, tamper-evident log. Captures: actor, action, target, timestamp, tenant_id, before_value, after_value, rationale. WORM-backed. Hash-chained entries. Separate AWS account. *(DL-027)* | Steward, Architect, Sponsor | F-006 |
| **F-006** | Approval Engine | Request → Review → Decide (approve/reject/request-changes) → Record. Mandatory vs. advisory gates per F-003. | Tech Lead, Architect | F-004, F-005 |
| **F-007** | Connectors / MCP Registry | Pluggable connectors: GitHub, Bitbucket, GitLab, Jira, Confluence, SonarQube, AWS, Figma, Slack, Zendesk, Azure DevOps, Databricks. Uniform connector contract (auth, rate-limit, pagination, webhook, idempotent re-sync). | Steward, Tech Lead | F-004 |
| **F-508** | ClickUp MCP Adapter | ClickUp as alt to Jira for per-customer ticketing. Same ticket / epic / story contract. Same webhook + polling fallback (NFR-017). Per-engagement choice. *(NFR-016)* | Tech Lead, Steward | F-007, F-015 |
| **F-509** | Adobe XD MCP Adapter | Adobe XD as alt to Figma for design assets and component specs on Adobe-stack engagements. Per-engagement choice. *(NFR-016)* | Architect, Tech Lead | F-007, F-015 |
| **F-008** | Admin UI | Steward-facing UI: standards, templates, policies, roles, connectors, audit log review. | Steward | F-001..F-007 |
| **F-009** | Governance Dashboard | `[V1-OPTIONAL]` Delivery Sponsor views of TTTD, gate metrics, counter-metrics. | Delivery Sponsor | F-005, F-006 |
| **F-010** | Artifact Registry | Central definition of every artifact type (ADR, API Contract, Task Breakdown, Risk Register, Acceptance Criteria, Ideation Bundle, Terminal Session Log). Schema, version, required fields, relationships, lifecycle. | Steward, Tech Lead | F-002 |
| **F-504** | Steering Rules Engine | Workspace Markdown files auto-injected into agent context at relevant workflow stages. Customer-specific conventions live as plain Markdown in the workspace (customer-portable; not vendor-trapped). Auto-discovery at session start; re-injected on file change. Rules typed per F-010 schema (steering-rule catalog). Same files-as-first-class-memory pattern as F-001 (Standards Library). *(NFR-031)* | Steward, Tech Lead, Architect | F-001, F-010 |

#### 5.1b Agent Center (F-011..F-017)

| ID | Name | Description | Personas | Depends on |
|---|---|---|---|---|
| **F-011** | Agent Registry | Catalog of external agents: Claude Code, Codex, Gemini CLI, Aider, Kiro, Hermes, OpenHands, Cursor Agent, GSD Core, custom. Steward-curated; per-Project assignment. | Steward, Tech Lead, Architect | F-004 |
| **F-510** | Kiro MCP Adapter | Kiro serves dual role: (a) registered agent in F-011 (agent-execution surface), and (b) MCP integration target for real-time IDE state and agent task execution (Pillar 1 §8). Adapter exposes: open files, current selection, active task queue, agent run history. Per-engagement choice. *(NFR-016, DL-031)* | Tech Lead, Developer | F-007, F-011, F-401 |
| **F-012** | Model Provider Registry | Catalog of providers: OpenAI, Anthropic, Gemini, Bedrock, Azure OpenAI, OpenRouter, Ollama, Vertex AI. All traffic routed through LiteLLM Proxy. *(DL-025)* | Steward | F-004 |
| **F-013** | Agent Assignment | Map workflow stages to agents per project (Architecture → Claude Code, Development → Codex, Testing → Gemini, Security → Claude, Deployment → Hermes). | Tech Lead, Architect | F-011, F-012 |
| **F-014** | Agent Runtime Adapter | Pluggable adapter for each agent's tool surface and output shape. Forge speaks to all agents through a uniform contract; adapter handles per-agent quirks and cost reporting. | Steward, Tech Lead | F-011..F-013 |
| **F-015** | Connector Marketplace / Center | Marketplace-style registry expanding F-007: Engineering, Project Management, Documentation, Cloud, Communication connectors. | Steward, Tech Lead | F-007 |
| **F-016** | Agent Runtime Management | Support multiple development runtimes — Claude Code, Codex CLI, Gemini CLI, Aider, Hermes, GSD Core — without platform code changes. Each runtime has a registered adapter. | Steward, Tech Lead | F-011, F-012, F-014, F-017 |
| **F-017** | Hook Orchestration | Pre/post execution hooks for every supported runtime. Scoped at three levels: global (Steward), tenant (admin), project (lead). Canonical pipeline: User Story → pre-plan → GSD Planning → post-plan → pre-code → Runtime → post-code → Validator → Security → pre-commit → Git → pre-pr → post-pr. Visualized in Forge UI. | Steward, Tenant Admin, Tech Lead | F-016, F-014 |

#### 5.1c Command Center & GSD Integration (F-018..F-021) — v2.0

| ID | Name | Description | Personas | Depends on |
|---|---|---|---|---|
| **F-018** | Forge Command Center | UI surface exposing all white-labeled GSD commands as clickable workflow panels. Developers click "Forge Discuss Phase" or "Forge Ship" — never type `gsd` commands directly. Real-time progress, audit trail, and output artifacts for every command execution. *(DL-023)* | Tech Lead, Developer | F-019, F-020, F-005 |
| **F-019** | GSD White-Label Registry | The FORGE_COMMAND_MAP — authoritative mapping of every `forge-*` command to its underlying `gsd` command. Categories: Onboarding, Project Intelligence, Ideation, Architecture, Development, Testing, Security, Code Review, Deployment, Milestones, Learning, Workflow, Environment. Extensible without platform code changes. *(DL-024)* | Steward (admin), Tech Lead (consume) | F-020 |
| **F-020** | Process Manager | FastAPI subprocess manager that spawns and manages GSD CLI processes, intelligence tool processes (repomix, codegraph), and agent CLI processes. Captures stdout/stderr in real-time. Integrates with F-005 audit trail. Maintains process lifecycle state per project. | Steward (admin) | F-004, F-005 |
| **F-021** | Project Onboarding Wizard | Multi-repository selection UI → intelligence pipeline orchestration. Guides Tech Lead through: connect repos → select intelligence tools → trigger forge-map-codebase + forge-graphify + forge-ingest-docs → monitor ingestion progress → review knowledge graph. First touchpoint for brownfield projects. | Tech Lead | F-007, F-019, F-020, F-101..F-115 |
| **F-507** | Day-One Bootstrap with Reference Standards | Project Onboarding Wizard (F-021) seeds the engagement with KnackForge reference standards (engineering, security, architecture patterns) from F-001 baseline. Customer-specific overlay applied on top. Bootstrap is idempotent — re-running it does not duplicate references. Bootstrap state captured in F-005 audit log. *(NFR-045)* | Steward, Tech Lead | F-001, F-021 |

---

### 5.2 Phase 0 — Project Intelligence Accelerator (F-101..F-115)

Converts an unfamiliar codebase into a queryable model. Stored in Apache AGE knowledge graph with pgvector for semantic search. *(ADR-002)*

| ID | Name | Description | Personas | Depends on |
|---|---|---|---|---|
| **F-101** | Repository Ingestion | Pull repos from connected source-control systems. Idempotent re-ingest. Honors rate limits. | Tech Lead, Steward | F-007 |
| **F-102** | Repository Discovery | Detect languages, frameworks, dependencies, build systems from ingested repos. | Tech Lead | F-101, F-010 |
| **F-103** | Architecture Discovery | Infer services, modules, and architectural boundaries from repo + dependency evidence. Output reviewable and editable. Hybrid SQL+Cypher queries via AGE. *(ADR-002)* | Tech Lead, Architect | F-102, F-010 |
| **F-104** | Dependency Graph | Cross-service and cross-repo dependency graph. Captures direct + inferred dependencies. Multi-hop traversal via AGE. | Tech Lead, Architect | F-103 |
| **F-105** | API Catalog | Curated APIs (internal + external) derived from ingestion. Owner, contract reference, version, status. | Tech Lead, Architect | F-103, F-010 |
| **F-106** | Database Map | Schemas, table relationships, ownership metadata. | Tech Lead, Architect | F-103, F-010 |
| **F-107** | Service Catalog | Curated services with ownership, runtime characteristics, dependencies. | Tech Lead, Architect | F-103, F-104, F-010 |
| **F-108** | Q&A Interface | Natural-language interface over the knowledge graph. Answers from F-102..F-107 + pgvector semantic search. Escalation path when confidence is low. | Tech Lead | F-102..F-107 |
| **F-109** | Snapshot | Versioned snapshot of project intelligence at a point in time. Restore + diff between snapshots. | Tech Lead | F-105..F-107 |
| **F-110** | Impact Analysis | Given a requirement, produce affected repositories, services, APIs, and databases. Example: "Add MFA authentication" → auth-service, frontend, mobile-app, notification-service. *Most impressive demo feature.* | Tech Lead, Architect | F-103..F-107 |
| **F-111** | Incremental Sync | Event-driven update of knowledge graph on git push, PR merge, Jira update. Conflict resolution per ADR-003 (Hybrid MDM + Steward priority). Freshness_at updated at graph layer per node. *(ADR-003, DL-026)* | Tech Lead, Steward | F-101, F-007 |
| **F-112** | Documentation Ingestion | Ingest from Confluence, Notion, Google Drive, SharePoint into Knowledge Graph. | Tech Lead, Steward | F-007 (F-015) |
| **F-113** | Communication Ingestion | Ingest threads and decisions from Slack, Teams, Email, Zendesk. No message bodies unless explicitly configured. | Tech Lead, Steward | F-007 (F-015) |
| **F-114** | Asset Ingestion | Ingest PDF, Figma diagrams, AWS infrastructure metadata into Knowledge Graph as nodes linked to services/repos/ADRs. | Tech Lead, Steward | F-007 (F-015) |
| **F-115** | Unified Knowledge Graph | Single AGE graph spanning repos, documentation, communication, and assets. Cross-source traversals: ADR → service → deployment → Slack thread, all linked. *The killer feature.* *(ADR-002)* | Tech Lead, Architect | F-103, F-104, F-112..F-114 |

---

### 5.3 Phase 1 — Ideation Accelerator (F-201..F-213)

**AI Product Management Workspace.** Connected to Project Intelligence, Organization Knowledge, Customer Feedback, and Technical Debt. Approved bundles push directly to Architecture (Phase 2).

**Artifact state machine:**
```
draft → under_review → approved → pushed-to-delivery
                     ↘ rejected (rationale required)
                     ↘ changes_requested (returns to draft)
approved → superseded (new approved version only)
```

| ID | Name | Description | Personas | Depends on |
|---|---|---|---|---|
| **F-201** | Idea Intake | Free-form text + structured input ("Add MFA Authentication"). Optional intake template. | Tech Lead, Product Stakeholders | F-007 |
| **F-202** | Idea Analysis | Auto-analysis pulling from Phase 0 (F-101..F-115), Standards (F-001..F-002), Customer Feedback (F-113), Tech Debt (SonarQube). | Tech Lead, Architect | F-101..F-115, F-001..F-002 |
| **F-203** | Architecture Impact Graph | Visual mapping of idea → affected services/repos/APIs/databases. React Flow. Click any node to navigate. | Tech Lead, Architect | F-103, F-104, F-115 |
| **F-204** | Opportunity Scoring | Business Value + Complexity + Risk + Customer Demand + Tech Debt → Priority Score. Configurable weights per project. | Tech Lead, Stakeholders, Sponsor | F-202, F-203 |
| **F-205** | Roadmap Generator | Auto-group ideas → Epics → Stories → Tasks. Honors dependencies and capacity. | Tech Lead, Stakeholders | F-202, F-204 |
| **F-206** | PRD Generator | From approved idea, generate draft PRD in BMad structure (Executive Summary, Problem, Solution, Requirements, NFRs, Success Metrics, Risks, Scope). Forge becomes BMad-compatible. | Tech Lead, Stakeholders | F-001, F-202..F-204 |
| **F-207** | Architecture Preview | Pre-approval impact: Repositories Impacted, Services Impacted, APIs Impacted, DB Changes, Estimated Effort, Risks. *Most AI tools generate stories; Forge shows consequences.* | Tech Lead, Architect, Sponsor | F-203, F-204 |
| **F-208** | Ideation Knowledge Graph | React Flow node graph: Customer Request → Epic → Story → ADR → Repository → Service. Click any node to navigate. | Tech Lead, Stakeholders | F-115 |
| **F-209** | Ideation Agent Selection | Per-ideation-task agent configuration via Agent Center. First end-to-end demonstration of F-011..F-014 working. | Tech Lead, Steward | F-011..F-014 |
| **F-210** | Realtime Ideation Workflow | WebSocket-driven progress: "Analyzing Repositories ████████░░ 80% → Generating Epic ██████████ 100%." | Tech Lead | F-014 |
| **F-211** | Ideation Output Bundle | Standard package: Business Case + Epic + Stories + Architecture Impact + Risk Assessment + Effort Estimate + Affected Repos/Services/APIs + ADR Draft + PRD Draft + Roadmap Placement. | Tech Lead, Architect | F-205..F-207 |
| **F-212** | Approval Queue | Review/approve ideation output. Same governance boundary machinery (NFR-032, §4.5). | Tech Lead, Architect/Product Lead | F-006, F-003, NFR-032 |
| **F-213** | Push to Delivery Systems | On approval, push bundle to Jira (epics/stories), Confluence (PRD draft), and Architecture Accelerator (F-301..F-310). | Tech Lead, Steward | F-211, F-212 |

---

### 5.4 Phase 2 — Architecture Accelerator (F-301..F-310)

Converts an approved requirement (from Ideation F-211) into a governed architecture package.

**Artifact state machine:** Same as §5.3. `draft → approved` requires Architect approval (separate from author). `approved → superseded` requires approval. Both transitions are governance boundaries (NFR-032).

| ID | Name | Description | Personas | Depends on |
|---|---|---|---|---|
| **F-301** | ADR Generation | Generate typed Architecture Decision Record from approved requirement + knowledge graph + standards. Consumed by configured agent (F-014). | Tech Lead | F-001, F-002, F-309, F-010, F-211 |
| **F-302** | API Contract Generation | From approved ADR, generate API contract artifact. Linked to source ADR. | Tech Lead | F-301 |
| **F-303** | Task Breakdown Generation | From approved ADR, generate task breakdown consumable by Phase 3 (Development). | Tech Lead | F-301 |
| **F-304** | Risk Register Generation | From approved ADR, generate risk register. Risks linked to ADRs and project context. | Tech Lead | F-301, F-103, F-104 |
| **F-305** | Approval Workflow | Tech Lead submits → Architect reviews → approve/reject/request-changes. Governed by F-003/F-006. | Tech Lead, Architect | F-006, F-003 |
| **F-306** | Traceability | Every artifact references its sources. Every downstream artifact traces back to originating requirement. Audit via F-005. | Tech Lead, Architect, Sponsor | F-005, F-010 |
| **F-307** | Versioning & Supersession | ADRs and derived artifacts have versions. New versions supersede prior with explicit rationale. Snapshot diff via F-109. | Tech Lead, Architect | F-010, F-109 |
| **F-308** | Standards Attestation | Every generated artifact carries attestation of which standards (F-001) it complies with. Anti-Human-Override-Rate signal. | Architect, Steward | F-001, F-005 |
| **F-309** | Context-Aware Architecture Generation | **MUST** consume requirement + project knowledge graph (F-103, F-104, F-110) + applicable standards (F-001) + Ideation Output Bundle (F-211). NOT the requirement alone. *Key differentiator.* `context_sources` field lists all graph nodes and standard IDs that informed each decision. | Tech Lead, Architect | F-001, F-103, F-104, F-110, F-211 |
| **F-310** | Acceptance Criteria Package | Functional criteria, non-functional criteria, validation rules. Definition of Done for downstream phases. | Tech Lead, Architect | F-301, F-302 |

---

### 5.4a Phase 1.5 — Pillar 1 Validators (F-501..F-505)

Independence of validators from the development agent is the design choice for security and quality gates. The Code Validator runs as a separate LangGraph sub-graph with its own state, prompt template, and reasoning trace. The merge decision downstream is deterministic (NFR-042), not LLM-judged.

| ID | Name | Description | Personas | Depends on |
|---|---|---|---|---|
| **F-501** | Code Validator Agent | Independent sub-agent that scans for vulnerabilities, exposed secrets, IaC misconfigurations, and standards violations. Runs as a separate LangGraph sub-graph with its own prompt, context, and reasoning state — no shared reasoning trace with the development agent. Output is a typed Validation Report artifact (per F-010 schema). Validator may run a different model instance from the development agent (NFR-043). | Steward, Architect, Tech Lead | F-005, F-014, F-016 |
| **F-502** | Validation Report Artifact | Typed artifact (per F-010 schema) carrying the validator's findings: finding_id, severity, file_path, line, rule_id, evidence, recommended_fix, standards_ref. Consumed by F-503 (Deterministic Security Gate) and surfaced in the Audit Trail (F-005). | Steward, Architect | F-501, F-010 |
| **F-503** | Deterministic Security Gate | Rules-based gate that blocks commit until F-501 returns PASS. LLM does not negotiate the merge decision — output is consumed as PASS/FAIL signal only (NFR-042). Failures auto-route to a remediation queue with F-502 attached. Gate state persisted to F-005 audit log with: commit_sha, gate_decision, validator_run_id, failure_reasons[]. | Tech Lead, Developer, Steward | F-501, F-502, F-005, F-006 |
| **F-505** | Per-Stage Tool Bundle Guardrails | Declarative tool bundles per workflow stage, enforced at agent runtime. Each bundle is a typed artifact (per F-010 schema) listing permitted_tools[] and denied_tools[]. Curated by Steward, assigned per project by Tech Lead. Cross-bundle invocation denied at the runtime layer (NFR-046). Same Custom-Guardrails principle as the GSD White-Label surface (F-019). | Steward, Tech Lead | F-003, F-016, NFR-046 |

---

### 5.5 Phase 3 — Forge Terminal Center (F-401..F-415) — v2.0 NEW V1

**In-browser multi-agent terminal hub.** Developers run Claude Code, Codex, Gemini CLI, Aider, Kiro, Hermes, OpenHands, GSD Core, or any CLI agent in tabbed, split-pane sessions — all governed, audited, workspace-isolated, and persistable. Like tmux but web-native and enterprise-governed.

> *The Terminal Center completes the Forge vision: every touchpoint in the delivery lifecycle — from knowledge graph exploration to architecture approval to live agent coding sessions — is inside one governed platform.*

**Terminal session state machine:**
```
created → running → paused → resumed → closed
                  ↘ audit_captured (continuous, on every command)
running → closed (graceful or forced)
paused → expired (after N days without resume, session archived)
```

**Supported Agent Types:**

| Agent | Binary | Auto-Detect |
|---|---|---|
| Claude Code | `claude` | ✅ |
| Codex CLI | `codex` | ✅ |
| Gemini CLI | `gemini` | ✅ |
| Aider | `aider` | ✅ |
| Kiro | `kiro` | ✅ |
| Hermes | `hermes` | ✅ |
| OpenHands | `openhands` | ✅ |
| GSD Core | `gsd` | ✅ |
| Cursor Agent | `cursor` | ✅ |
| Custom | User-configured | User-defined |

| ID | Name | Description | Personas | Depends on |
|---|---|---|---|---|
| **F-401** | Terminal Session Manager | Backend service: spawn, manage, persist, and terminate agent CLI processes via PTY (pseudo-terminal). Session state (created/running/paused/closed) tracked per project. One session manager per Forge deployment; sessions isolated per project per developer. | Tech Lead, Developer | F-004, F-005 |
| **F-402** | Terminal WebSocket Streaming | Real-time bidirectional I/O: keyboard input from browser → PTY process; PTY stdout/stderr → browser terminal. Implemented via WebSocket + Redis Pub/Sub fanout (supports multiple observers on one session). | Tech Lead, Developer | F-401 |
| **F-403** | Terminal Tab Interface | Tabbed terminal UI (xterm.js). Each agent session has its own named tab. Add/rename/close tabs. Tab bar shows agent type, model, and session status. Multiple tabs from the same project can run concurrently. | Tech Lead, Developer | F-401, F-402 |
| **F-404** | Terminal Split Panes | Vertical and horizontal split-pane layout. View multiple agent sessions side-by-side. Drag-to-resize. Collapse/expand individual panes. | Tech Lead, Developer | F-403 |
| **F-405** | Agent Process Launcher | Launch any registered agent (F-011) in a new terminal session. Select agent type, workspace directory, and initial context. Auto-populates with project knowledge graph context where available. | Tech Lead, Developer | F-401, F-011 |
| **F-406** | Session Persistence | All terminal sessions are saved. Sessions survive browser refresh. Paused sessions can be resumed. Session history (scrollback buffer) persisted to object storage. | Tech Lead, Developer | F-401, F-005 |
| **F-407** | Terminal Audit Trail | Every command executed in every terminal session is captured in F-005 audit log with: agent type, model, command text, timestamp, project_id, tenant_id, session_id, user_id, cost_estimate. Every session is an audited artifact. | Steward, Architect, Sponsor | F-005, F-401 |
| **F-408** | Workspace Isolation | Each terminal session operates in its own scoped workspace directory. Project-scoped workspace directories enforce per-project isolation. Sessions in the same project can optionally share a workspace. No cross-project filesystem access. | Tech Lead, Developer | F-004 |
| **F-409** | Agent Detection | Terminal session auto-detects which agent is running (Claude Code, Codex, GSD, etc.) from the spawned process. Displays agent type, detected model, and session metadata in the terminal toolbar. Updates detection on agent switch. | Tech Lead, Developer | F-405 |
| **F-410** | Theme & Customization | Light/dark mode. Font size selector. Color scheme selector (Solarized, Dracula, Monokai, One Dark, etc.). Settings persist per user. Accessible (WCAG 2.1 AA). | Tech Lead, Developer | — |
| **F-411** | Terminal Command Center Integration | Forge Command Center (F-018) commands can be executed directly in a terminal session. `forge-discuss-phase`, `forge-ship`, `forge-map-codebase`, etc. are pre-populated as autocomplete suggestions. | Tech Lead, Developer | F-018, F-019, F-401 |
| **F-412** | Session Cost Tracking | Each terminal session accumulates real-time cost from LiteLLM (token usage, model spend). Cost displayed in terminal toolbar. Session cost attributed to tenant + project + developer for NFR-030 budget enforcement. | Tech Lead, Steward | F-401, NFR-030 |
| **F-413** | Session Broadcast & Observation | Authorized observers (Architect, Tech Lead) can view a live terminal session in read-only mode. Useful for pair sessions, review, or mentoring. All observers listed in audit log. | Architect, Tech Lead | F-402, F-004 |
| **F-414** | Terminal Knowledge Context | Forge can inject project knowledge graph context (services, APIs, dependencies, recent ADRs) into a terminal session as initial context for the running agent. One-click "Inject Project Context" in the toolbar. | Tech Lead, Developer | F-115, F-401 |
| **F-415** | Terminal Export | Export terminal session transcript as: full audit log (JSON/CSV), human-readable session summary (Markdown), or PR description scaffold. Supports traceability from terminal work to artifact. | Tech Lead, Architect | F-407, F-005 |

---

### 5.7 Phase 4 — Modernization / Refactor Accelerator (F-601)

The Refactor Agent operates on existing customer codebases rather than greenfield ideation-to-deploy. Orchestrates cloud-provider modernization tooling (AWS Transform for Java/.NET workloads on AWS engagements) and produces phased, cloud-native migration plans. Phased plans land in Jira as backlog (per F-213); the standard 5-stage workflow (DL-021) executes against the migration backlog.

**Artifact state machine:** Same as §5.3. Migration plan: `draft → under_review → approved → pushed-to-delivery`. Approved migration plan supersedes prior plan with explicit rationale.

| ID | Name | Description | Personas | Depends on |
|---|---|---|---|---|
| **F-601** | Refactor Agent (Modernization Path) | Orchestrates AWS Transform-class tooling on customer codebases. Produces phased, cloud-native migration plans as typed artifacts (per F-010 schema: source_inventory, target_architecture, phased_plan, risk_register, effort_estimate, dependencies). Plans land in Jira as backlog (per F-213); the standard 5-stage workflow (DL-021) executes against the migration backlog. Per-engagement target language and source (Java-on-mainframe, .NET-on-Windows-Server) driven by pilot customer priorities. *(OQ-017, DL-029)* | Architect, Tech Lead | F-101..F-115, F-213, F-301..F-310 |

---

### 5.6 Out-of-V1 Capability Phases

- **Phase 4 — Development Accelerator (GSD-Core powered):** Code patches, unit-test scaffolds, review packages. Powered by `gsd-core` (Plan/Execute/Verify/Ship) + universal hook orchestration (F-017).
- **Phase 5 — Security + QA Accelerator:** Security reports, OWASP, IaC validation, integration/E2E, release readiness.
- **Phase 7 — Delivery Orchestration Accelerator:** End-to-end workflow with audit.

Foundation + Phase 0 + Phase 1 + Phase 2 + Phase 3 constitute a fundable, demoable, pilotable V1.

---

## 6. Non-Functional Requirements

### 6.1 Security & Compliance

| ID | Requirement | Notes |
|---|---|---|
| **NFR-001** | SOC2-ready controls | Audit logging, access reviews, change management. Controls designed for certification, NOT certified at V1. |
| **NFR-002** | GDPR-ready data handling | Sub-processor posture. DPA template V1 deliverable (required before any pilot with EU personal data). Sub-processor list published. |
| **NFR-002a** | Right-to-erasure tombstoning | GDPR Article 17 via tombstoning: status → `erased`; content removed from query/display; audit row preserved (Article 17(3) exemption). `subject_id` replaced with salted hash. |
| **NFR-003** | Encryption | In transit (TLS 1.2+); at rest (AES-256); backups; logs; search index; cache layer; internal mTLS for all service-to-service traffic; AGE graph tables; per-tenant CMK (AWS KMS). Annual rotation. |
| **NFR-004** | Identity & SSO | SSO via OIDC/SAML required. SCIM V1-Optional. |
| **NFR-004a** | MFA | **Required** for all users with approval-gate or Steward privileges. SSO-only users without approval authority exempt. |
| **NFR-004b** | Access review cadence | Privileged roles (Steward, Architect, Approver) reviewed **quarterly**. Evidence retained for audit. |
| **NFR-005** | Secrets handling | No secrets in logs. Secrets in AWS Secrets Manager. Connector credential rotation enforced per connector. |
| **NFR-034** | Data minimization & retention | Ingest only data needed for the named purpose. Retain only while engagement is active plus configurable retention window (default ≤90 days post-engagement for raw ingested content). No silent re-purposing for model training. |
| **NFR-035** | Pen-testing cadence | Pre-pilot pen-test (NFR-007 baseline) + **annual** external pen-test. Findings tracked. Critical/high resolved before next pilot phase. Continuous automated multi-tenant isolation test in CI. |

### 6.2 Multi-Tenancy & Data Governance

| ID | Requirement | Notes |
|---|---|---|
| **NFR-006** | Per-tenant isolation | Organization Knowledge Layer: shared (Steward-controlled). Project Intelligence Layer: per-tenant, isolated via PostgreSQL RLS + per-tenant CMK. *(DL-026)* |
| **NFR-007** | No cross-tenant data leakage | Enforced at PostgreSQL RLS layer (storage) + query-rewriter (application). Pen-test pre-pilot. Automated CI test per release. |
| **NFR-008** | Data residency | Cloud-only AWS at V1 (`us-east-1` recommended, compliance sign-off required). SCCs + TIA required for any EU pilot. *(ADR-001)* |

### 6.3 Performance & Scale

| ID | Requirement | Notes |
|---|---|---|
| **NFR-009** | Concurrent workflows | 100+ concurrent governed workflows at V1. `[TO BE VALIDATED]` |
| **NFR-010** | PI ingestion | 10–20 repos ingested to queryable knowledge graph within 24h. `[TO BE VALIDATED]` |
| **NFR-011** | Impact analysis latency | p50/p95 `[TO BE MEASURED]`. `[TO BE VALIDATED]` |
| **NFR-036** | Terminal session latency | Keystroke-to-display latency ≤ 50ms p95 under normal network conditions. `[TO BE VALIDATED]` |
| **NFR-037** | Concurrent terminal sessions | Support 50+ concurrent terminal sessions across all projects at V1. Session spawn time ≤ 3 seconds. `[TO BE VALIDATED]` |

### 6.4 Reliability & Availability

| ID | Requirement | Notes |
|---|---|---|
| **NFR-013** | Availability | 99.9% for governed workflow path. Terminal Center sessions best-effort recovery on disconnect. `[TO BE VALIDATED]` |
| **NFR-014** | Disaster recovery | **RPO ≤ 24h; RTO ≤ 4h.** Daily backups. Quarterly DR tests. Multi-AZ within `us-east-1`. *(ADR-001)* |
| **NFR-015** | Brownfield graceful degradation | PI remains usable when some connectors are unavailable. Staleness flagged. |
| **NFR-033** | Partial Discovery Tolerance | PI remains usable when up to 30% of connected sources are unreachable. Queries with no reachable source return error, not fabricated answer. |

### 6.5 Integration & Interoperability

| ID | Requirement | Notes |
|---|---|---|
| **NFR-016** | Connector contract | Auth, rate-limit handling, pagination, event subscription, idempotent re-sync. Per-tenant OAuth/PAT/service-account credential boundary. |
| **NFR-017** | Webhook + polling fallback | Webhook-driven (preferred) with polling fallback. |
| **NFR-018** | API surface | Public versioned REST API. OpenAPI spec maintained. |
| **NFR-019** | Export | All artifacts exportable as Markdown + JSON/YAML. Terminal sessions exportable as JSON/Markdown. |
| **NFR-027** | Connector SDK target | First connector: 8–10 engineer-days (includes shared substrate). Subsequent connectors: 3–5 engineer-days. |

### 6.6 Auditability & Observability

| ID | Requirement | Notes |
|---|---|---|
| **NFR-020** | Audit immutability | Append-only. WORM storage (AWS S3 Object Lock, separate account). Hash-chained entries. External daily anchor. Tamper-detection monitor. |
| **NFR-042** | Deterministic merge gate | The merge decision is rules-based. LLM output (from F-501 Code Validator Agent) is consumed as a PASS/FAIL signal only — not as a negotiated judgment. Rules either pass or they don't. No silent override. Auto-routes to remediation queue on FAIL. *(F-503)* |
| **NFR-021** | Structured logging | Every request, gate decision, connector call, terminal command emits structured logs with trace IDs. |
| **NFR-022** | Metrics & dashboards | Per-tenant + global. TTTD, gate metrics, counter-metrics, terminal session metrics, agent cost attribution. |
| **NFR-023** | Trace propagation | OpenTelemetry distributed traces: web → orchestration → agents → connectors → terminal sessions. |

### 6.7 Maintainability & Operability

| ID | Requirement | Notes |
|---|---|---|
| **NFR-024** | Deployability | Single-command deployment. Zero-downtime deploys. AWS ECS Fargate or EKS. *(ADR-001)* |
| **NFR-025** | 12-Factor posture | Environment config in code. Declarative, disposable processes. Cloud-native. *(ADR-001)* |
| **NFR-026** | Tenant onboarding | Automated provisioning. Seed defaults from F-001/F-002. Minimal manual steps. |
| **NFR-045** | Day-one reference standards | New engagement starts with KnackForge reference standards (engineering, security, architecture patterns) pre-loaded from F-001. Customer-specific layer is overlaid; customer never starts from a blank slate. Bootstrap completes during F-021 (Project Onboarding Wizard). Bootstrap is reproducible across engagements — same baseline, customer-specific overlay only. *(F-507, F-021)* |

### 6.8 AI Governance

| ID | Requirement | Notes |
|---|---|---|
| **NFR-029** | Agent Runtime Portability | Forge portable across agents at runtime. Never hard-codes a specific agent's identity, tool surface, or output shape. Agents plug in via F-014. *(DL-016)* |
| **NFR-030** | Cost Controls | Per-tenant token usage + model spend + workflow cost + terminal session cost tracked via LiteLLM Proxy *(DL-025)*. Budget thresholds enforceable. Pre-call admission control + post-call alerting. |
| **NFR-044** | Fixed-budget workflow execution | Each workflow instance declares a cost ceiling at intake (per F-201/F-601). No stage may silently overrun. Cost telemetry surfaces at every approval gate (NFR-032). Pre-call admission control via LiteLLM virtual keys (NFR-030). Ceiling breach triggers alert + remediation path, not silent pass-through. *(NFR-030, F-503)* |
| **NFR-043** | Independent validator reasoning | The Code Validator Agent (F-501) must run with separate prompt, separate context, and (where cost-justified per pilot measurement) separate model instance from the development agent. No shared reasoning state, no shared temperature/top-p, no shared tool-bundle. Independence is the design choice — same-model-but-different-context is acceptable floor; different-model is the ceiling. *(F-501)* |
| **NFR-046** | Per-stage tool isolation | An agent at workflow stage X can invoke only the curated tool bundle for stage X (least-tool-per-task). Bundles defined in F-003 (Governance Policy Engine). Cross-stage tool reach is denied at the agent runtime layer. *(F-505)* |
| **NFR-031** | Knowledge Freshness | Graph layer owns the freshness clock. Per-node `freshness_at` + `freshness_source` updated by graph layer on every write. Staleness signals explicit in UI. Per-FR staleness thresholds defined in Architecture ADR. |
| **NFR-032** | Human Governance Enforcement | No workflow may transition across a governance boundary without required human approval. *(DL-002)* |

### 6.9 Terminal Center (v2.0)

| ID | Requirement | Notes |
|---|---|---|
| **NFR-038** | Terminal session isolation | Each session operates in a scoped workspace directory. No cross-project filesystem access. PTY process runs with project-scoped credentials. |
| **NFR-039** | Terminal audit completeness | 100% of terminal commands in every session captured in F-005 audit log. No gaps. No bypass. Audit log entry created at stdin write time, not command completion. |
| **NFR-040** | Terminal session security | Terminal sessions authenticated via Forge OIDC session. No direct PTY access without Forge auth. Session tokens rotated per session. |
| **NFR-041** | PTY resource management | Maximum concurrent PTY processes per tenant enforced at platform level. Idle sessions auto-paused after N minutes (configurable). Resource limits (CPU, memory) per PTY process enforced. |

### 6.10 Accessibility

| ID | Requirement | Notes |
|---|---|---|
| **NFR-028** | WCAG 2.1 AA | All V1 UI surfaces meet WCAG 2.1 AA, including Terminal Center. |

### 6.11 Foundational Architecture Constraints (for downstream ADRs)

These flow into Architecture ADRs as fixed decisions:

- **Shared Organization Knowledge Layer** (Steward-controlled cross-tenant publishing)
- **Per-Tenant Project Intelligence Layer** (PostgreSQL RLS + per-tenant CMK) *(DL-026)*
- **Human Approval Gates** (no autonomous cross-boundary transitions) *(DL-002)*
- **Audit Immutability** (WORM + hash-chain + external anchor) *(NFR-020)*
- **LiteLLM Proxy as Provider Abstraction Layer** *(DL-025)*
- **Apache AGE as Knowledge Graph Substrate** *(ADR-002)*
- **Hybrid MDM + Steward Priority for Conflict Resolution** *(ADR-003)*
- **Cloud-Only AWS at V1** (ECS Fargate, RDS PostgreSQL 17, ElastiCache Redis, S3, KMS) *(ADR-001)*
- **Cost Governance** (per-tenant budgets + enforcement via LiteLLM virtual keys)
- **Knowledge Freshness** (graph-layer ownership, per-node granularity)
- **SOC2-Ready Controls** (designed for certification, not certified)
- **Terminal Center Governance** (every session audited, workspace-isolated, governed)

### 6.12 Architecture Substrate Boundary

The PRD commits to *what* must be true. Architecture ADRs invent *how*:

- Knowledge graph hybrid query patterns (SQL+Cypher per F-103/F-104/F-110)
- NetworkX offload boundary for complex graph algorithms
- Connector failure-mode primitives and quarantine behavior
- LiteLLM virtual key structure per tenant/project/workflow
- Artifact supersession cascade rules
- Right-to-erasure tombstoning mechanism implementation
- Terminal PTY resource management implementation
- AGE graph partitioning strategy by `tenant_id`

### 6.13 M1 Substrate Primitives (v2.0 — Closes review-architecture.md Gap) *(DL-027)*

**The following primitives MUST be scoped to M1, not retrofitted at M3+:**

1. **Typed event bus** — events for every artifact state transition, connector sync event, agent execution event, and terminal command event. Used by F-111 (Incremental Sync), F-407 (Terminal Audit), and F-005 (Audit Log).
2. **LiteLLM Proxy integration** — the Forge Provider Abstraction Layer (F-012/F-014) wired to LiteLLM. No provider SDK may be imported in any service.
3. **Tenant-scoped cost ledger** — per-tenant/project/workflow cost rows in PostgreSQL. LiteLLM `response_cost` callback populates it.
4. **Tenant-scoped freshness ledger** — `freshness_at` + `freshness_source` on every graph node. Graph layer writes it on every upsert.
5. **Query-layer RLS isolation** — `SET LOCAL app.tenant_id` in every connection pool transaction. RLS policies on every tenant-scoped table + AGE graph tables.
6. **Append-only artifact storage with supersession** — artifact table with `version`, `status` (draft/approved/superseded/erased), `superseded_by`, `superseded_at`. No in-place updates.
7. **Connector failure-mode primitives** — connector status states: `pending/syncing/healthy/stale/quarantined/failed`. `quarantined` is first-class; quarantine triggers dependent workflow annotations.
8. **Policy evaluation engine** — F-003 policies evaluable at the database layer (not application-only). Policy schema: `{domain, gate_type, required_approver_role, conditions}`.

### 6.14 Constitutional Constraint Mapping (v2.0)

Maps the 8 Constitutional Rules from the Master Development Charter to PRD NFRs:

| Charter Rule | Constraint | PRD NFR |
|---|---|---|
| **R1** Model-provider agnostic | All LLM traffic through LiteLLM Proxy | NFR-029, DL-025 |
| **R2** Multi-tenancy by default | `tenant_id` + `project_id` on every record; RLS enforced | NFR-006, NFR-007, DL-026 |
| **R3** Human approval gates | No autonomous crossing of Architecture/Security/Deployment | NFR-032, DL-002 |
| **R4** Typed artifacts only | ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan | F-010, §5.4 |
| **R5** Layer isolation | Org Knowledge shared; Project Intelligence isolated | NFR-006, DL-004, DL-005 |
| **R6** Mandatory auditability | Agent, model, prompt, tool, cost, artifact, timestamp, result | NFR-020, F-005, F-407 |
| **R7** Mandatory observability | OpenTelemetry tracing, metrics, logs from day one | NFR-021, NFR-022, NFR-023 |
| **R8** Configurable everything | No hardcoded GitHub/Claude/OpenAI/AWS/Jira assumptions | NFR-029, F-014, F-016 |

---

## 7. Open Questions / Assumptions / Out-of-Scope

### 7.1 Resolved Phase-Blockers

| ID | Question | Resolution |
|---|---|---|
| **OQ-005** ✅ | Deployment topology | **ADR-001 (Accepted):** Cloud-Only AWS at V1. ECS Fargate, RDS PostgreSQL 17, ElastiCache Redis, S3, KMS. `us-east-1` recommended. Self-hosted deferred to Strategic Phase B. |
| **OQ-006** ✅ | Knowledge graph substrate | **ADR-002 (Accepted):** PostgreSQL 17 + Apache AGE. Co-located graph + relational + vector (pgvector). RLS applies to both. NetworkX offload for complex algorithms. Single engine satisfies A-007. |
| **OQ-007** ✅ | Source-of-truth conflict policy | **ADR-003 (Accepted):** Hybrid MDM + Steward-Editable Priority Policy. Default: code > CODEOWNERS > Jira > Confluence > AWS/SonarQube > human override. Conflicts flagged, never silently merged. Steward resolves via Governance Center. |

### 7.2 Remaining Phase-Blockers

| ID | Question | Owner | Resolution Path |
|---|---|---|---|
| **OQ-001** | Pilot project identification | Engineering Excellence | Pilot Plan document |
| **OQ-002** | TTTD baseline methodology | Eng Excellence + Pilot TL | Baseline Methodology ADR before P0 |
| **OQ-004** | Commercial pricing posture | Practice Lead | Strategic Phase B document |
| **OQ-008** | V1 connector scope | Engineering Excellence | Before Architecture Phase |
| **OQ-009** | P1.5 Architecture Validation Rubric | Pilot TL + Architect | Pilot Plan rubric before P1 |
| **OQ-010** *(v2.0)* | Terminal Center PTY resource limits | Engineering | M2 Architecture ADR |
| **OQ-011** *(v2.0)* | Terminal session retention policy | Steward + Compliance | Before M10 |
| **OQ-016** | V1 scope of 5-stage workflow | Engineering Excellence + Pillar 1 Tech Lead | Should V1 expand to cover Development + Test + Deployment stages, or stay scoped to current 3-of-5 (Ideation + Architecture + Terminal Center, per §5.6 Phase 4–7 deferral)? Recommendation: stay scoped for V1; mark Development conductor as covered by F-401..F-415 (Terminal Center); defer Test/Deployment as Phase 4 unless pilot explicitly requires. Pillar 1 Deep-Dive §2 / §7 in-scope reference. |
| **OQ-017** | Refactor Agent first-target language and source | Pillar 1 Tech Lead + Architect | Java-on-mainframe? .NET-on-Windows-Server? Driven by pilot customer engagement priorities. Resolution before F-601 implementation starts. Pillar 1 Deep-Dive §6 / §14. |
| **OQ-018** | ClickUp / Adobe XD / Kiro MCP priority | Engineering Excellence | ClickUp MCP exists in code (mcp-servers/clickup/) but is not in PRD F-007. Adobe XD and Kiro-as-MCP are absent from PRD entirely. Resolve before Architecture Phase: V1 scope (amend F-508/F-509/F-510) or deferred to V2? Pillar 1 Deep-Dive §8. |

### 7.3 Open Assumptions

| ID | Assumption | If wrong |
|---|---|---|
| **A-001** | Pilot is brownfield-first (10+ repos) | Greenfield de-scopes ingestion volumes |
| **A-004** | **Domain model: Organization → Project (= Tenant = Engagement) → Repository.** No sub-Project layer in V1. | Model extends to insert sub-Project level; cascade into domain model |
| **A-008** | Organization Knowledge curated manually in V1. Steward is the source, not AI. | Scope grows materially; Steward workflow changes |
| **A-009** *(v2.0)* | PTY-based terminal sessions are available on the AWS ECS deployment environment | Self-hosted Docker-in-Docker or rootless container required as fallback |
| **A-010** *(v2.0)* | GSD Core (`@opengsd/gsd-core`) and GSD Pi (`@opengsd/gsd-pi`) NPM packages are stable and installable in the Forge build environment | If unstable, Command Center (F-018/F-019) degrades to direct GSD subprocess invocation without white-label |

### 7.4 Out-of-Scope (V1 Explicit)

Replacing engineers · Autonomous software delivery · Replacing Jira/GitHub/Confluence · 100% automation · Production code without human review · Self-hosted deployment · BYOK encryption at V1 · Multi-region active/active · Custom customer methodologies · Multi-org federation · Autonomous repo modification · Automatic production deployment.

---

## 8. Implementation & Pilot Phasing

### 8.1 V1 Build Phasing — Five Packages, 11 Milestones

**Build principles:**
- **UI-first:** Every milestone ships a working UI surface with its backend.
- **GSD-first:** GSD Core provides the full SDLC phase loop. Forge wraps, does not reinvent.
- **Substrate-first:** M1 completes the full substrate (§6.13) before any PI or agent work.
- **ADR-decided:** Cloud (AWS ECS), PostgreSQL 17 + AGE, LiteLLM Proxy are locked.

---

#### Package 1 — Forge Foundation (M1-M2)

**M1 — Foundation Core + GSD Base + Substrate**

Delivers: F-001..F-010, GSD Core install, FORGE_COMMAND_MAP scaffold, complete M1 substrate (§6.13), Admin UI shell.

| Capability | FRs | UI Surface |
|---|---|---|
| Standards Library | F-001 | Admin UI → Standards |
| Templates | F-002 | Admin UI → Templates |
| Governance Policy Engine | F-003 | Admin UI → Policies |
| RBAC | F-004 | Admin UI → Roles |
| Audit Log (WORM, hash-chain, separate account) | F-005 | Admin UI → Audit |
| Approval Engine | F-006 | Admin UI → Approvals |
| Artifact Registry | F-010 | Admin UI → Artifact Types |
| **M1 Substrate primitives** | NFR requirements per §6.13 | — (backend only) |
| **GSD Core + GSD Pi install** | F-019 scaffold | — |

**Why this order:** Standards + RBAC + Audit + Approval + Artifact Registry are the substrate everything else lives on. The M1 substrate gap (§6.13) must be closed here, not retrofitted at M3.

**First demoable artifact:** Steward publishes a sample standard; audit row appears; WORM lock confirmed.

---

**M2 — Connectors + Agent Center + Command Center + Terminal Center Base**

Delivers: F-007, F-008, F-011..F-021, Terminal Center backend (F-401..F-409), Organization Knowledge UI, Agent Center UI, Connector Center UI, Command Center UI shell, Terminal Center UI shell.

| Capability | FRs | UI Surface |
|---|---|---|
| Connectors / MCP Registry | F-007 | Connector Center |
| Admin UI complete | F-008 | Admin → full |
| Agent Registry + Provider Registry + Assignment + Adapter | F-011..F-014 | Agent Center |
| Agent Runtime Management + Hooks | F-016, F-017 | Agent Center → Runtimes |
| Connector Marketplace | F-015 | Connector Center → Marketplace |
| **GSD White-Label Registry (FORGE_COMMAND_MAP)** | F-019 | Command Center (shell) |
| **Process Manager** | F-020 | — (backend) |
| **Forge Command Center UI shell** | F-018 | Command Center → All Phases |
| **Project Onboarding Wizard** | F-021 | Onboarding → Multi-Repo |
| **Terminal Session Manager + WebSocket** | F-401, F-402 | Terminal Center (shell) |
| **Terminal Tab + Split + Agent Launcher** | F-403, F-404, F-405 | Terminal Center → UI |
| **Terminal Audit Trail** | F-407 | Terminal Center → Session Log |
| **Terminal Workspace Isolation** | F-408 | — (backend) |
| **Terminal Agent Detection + Theme** | F-409, F-410 | Terminal Center → Toolbar |

**Why this order:** Steward wires connectors, registers agents and model providers, configures assignments, and opens the Command Center + Terminal Center. Every downstream package uses these surfaces.

**First demoable artifact:** GitHub connected; Claude Code + Codex in Agent Center; Tech Lead assigns Architecture → Claude Code; Command Center shows `forge-discuss-phase` button; Terminal Center opens a Claude Code session.

---

#### Package 2 — Project Intelligence + Knowledge Center (M3-M5)

**M3 — Project Intelligence Core**

Delivers: F-101..F-104. Project Intelligence UI (Repositories, APIs, Databases, Services, Knowledge Graph — React Flow).

**First demoable artifact:** Architecture Discovery + Dependency Graph for one reference project rendered as clickable, navigable React Flow knowledge graph. **First Aha Time validated here.**

---

**M4 — Catalogs + Q&A + Impact Analysis**

Delivers: F-105..F-108, F-110. Service Catalog + API Catalog + DB Map + Q&A + Impact Analysis view.

**First demoable artifact:** Q&A answers a Tech Lead question; Impact Analysis surfaces affected services visually ("Add MFA" → auth-service, frontend, mobile-app, notification-service).

---

**M5 — Operations + Knowledge Center + Conflict Resolution**

Delivers: F-109, F-111..F-115. Knowledge Center UI (Documentation, Communication, Asset sources unified). Incremental Sync via ADR-003 conflict resolution.

**First demoable artifact:** Click *Auth Service* → see User Service, Login API, Database, ADR-120, Jira-456, Repo, Deployment — all linked. Freshness indicators visible. Conflict flagged between Jira (Cognito) and code (Keycloak) — Steward resolves in Governance Center. **The killer feature.**

---

#### Package 3 — Ideation (M6-M8)

**M6 — Ideation Core**

Delivers: F-201..F-204, F-208. Ideation Center UI (Ideas, Opportunities, Customer Feedback, Tech Debt, Architecture Impact).

---

**M7 — Ideation Generation + Realtime Workflow**

Delivers: F-205..F-211. Roadmap Generator, PRD Generator, Architecture Preview, Realtime Ideation Workflow, Ideation Agent Selection, Output Bundle.

**First demoable artifact:** Tech Lead types "Add MFA Authentication"; Realtime Workflow shows live progress; PRD Generator produces BMad-structured PRD; Architecture Preview shows consequences.

---

**M8 — Ideation Approval + Push to Delivery**

Delivers: F-212, F-213. Approval Queue + push to Jira/Confluence/Architecture Accelerator.

**First demoable artifact:** Approved Ideation Output Bundle pushes to Jira + Confluence + Architecture Accelerator (F-301 ADR Generation runs against the bundle).

---

#### Package 4 — Architecture Accelerator (M9-M10)

**M9 — Architecture Generation Core**

Delivers: F-301..F-304. Architecture UI (ADRs, API Contracts, Risk Register). Agent Center assignment is live — Architecture runs Claude Code per F-013.

**First demoable artifact:** Complete architecture package (ADR + API contract + task breakdown + risk register) produced by the assigned agent, viewable in Architecture UI.

---

**M10 — Governance + Traceability + Agent Workflow Visualization**

Delivers: F-305..F-310. Approval workflow UI + Audit Trail UI + Agent Workflow Visualization (React Flow — Ideation Bundle → Architecture Agent → ADR → Dev Agent → PR → Security Agent → Approval, live animated).

**First demoable artifact:** Architect approves Phase 2 package end-to-end; Agent Workflow Visualization animates multi-agent orchestration; Audit Trail shows every transition.

---

#### Package 5 — Terminal Center Full + Governance Dashboard (M11)

**M11 — Terminal Center Full + V1-Optional**

Delivers: F-411..F-415 (Terminal Command Center Integration, Cost Tracking, Broadcast, Knowledge Context, Export) + `[V1-OPTIONAL]` F-009 (Governance Dashboard) + Realtime Agent Dashboard.

**First demoable artifact:** Developer launches Claude Code in Terminal, injects project knowledge graph context, runs `forge-execute-phase`, sees live cost attribution; Delivery Sponsor views TTTD, gate metrics, counter-metrics; Realtime Agent Dashboard shows concurrent agent progress.

---

### 8.2 Pilot Phasing

| Phase | Duration | Goal | Exit Criteria |
|---|---|---|---|
| **P0 — Pre-pilot** | 4 weeks | Establish baselines without Forge (or observe-only) | Baselines recorded; pilot scope confirmed; Baseline Methodology ADR shipped; Pilot TL named |
| **P1 — Pilot kickoff** | 1 week | Enable Forge; instrument metrics; train Steward/Tech Lead/Architect | First artifact created in Forge |
| **P1.5 — Architecture Validation Gate** | 1-2 weeks | Validate Knowledge Graph + Impact Analysis + ADR Generation vs. senior engineers | **≥80% of generated outputs accepted without major correction** per pre-published 3-bucket rubric (Accept/Minor/Major) across ≥15 artifacts |
| **P2 — Pilot execution** | 8-12 weeks | Run V1 in production. Capture TTTD improvement. Monitor counter-metrics. | Directional improvement shown; counter-metrics stable; no governance regression; ≥12 completed TTTD cycles |
| **P3 — Pilot evaluation** | 2 weeks | Statistical review. Decide expand/iterate/hold. | Decision recorded by Delivery Sponsor; metric targets formalized |
| **P4 — Pilot expansion** *(conditional)* | TBD | Expand to additional engagements. P3 green required. | Two or more engagements on V1 concurrently |

### 8.3 Rollout

```
Single Pilot (P0-P3)
        ↓ (P3 green)
Multi-Engagement Rollout (P4)
        ↓
Practice Standard  ←  "We use it ourselves"
        ↓
Strategic Phase B — Customer-Facing (Commercial evaluation)
        ↓
V2 Capability Expansion (Phases 4-7)
```

### 8.4 What Gets Validated When

| Target | Validated at |
|---|---|
| First Aha Time (brownfield → queryable in minutes) | End of M3 |
| Project Intelligence Accuracy (Discovery Coverage, Q&A Accuracy, Impact Analysis) | End of M5 |
| Ideation Center Accuracy (PRD quality, Opportunity Scoring calibration) | End of M7 |
| Terminal Center Audit Coverage (100% command capture) | End of M11 |
| TTTD baseline | End of P0 |
| P1.5 Architecture Validation (≥80% acceptance) | End of P1.5 |
| TTTD directional improvement | End of P2 |
| NFR-037 (concurrent terminal sessions) | End of M11 demo |
| Counter-metric thresholds | Continuous P1-P3 |
| Pilot → multi-engagement decision | End of P3 |

### 8.5 Adoption Signals

- **Active Tech Leads per week** (login + artifact action)
- **Approval cycle completion rate** (% reaching decision within SLA)
- **Knowledge Reuse Rate** (% of new ADRs citing existing standard or template — V1 proxy)
- **Human Override Rate trend** (early warning of output quality regression)
- **Artifact Consumption Rate** (generated artifacts used downstream)
- **Self-Reported Time Saved** (post-approval survey 0-25%/25-50%/50-75%/75%+)
- **First Aha Time** (validated at M3 — "the platform understood our project in minutes")
- **Terminal Sessions per Developer per Week** (Terminal Center adoption)

### 8.6 Demo Path — Forge Demo Script v2.0

Target runtime: 30-40 minutes. Canonical sequence covering all V1 packages.

1. **Open Agent Center** — show Forge as control plane (not agent). Development Agents: Claude Code, Codex, Gemini CLI, GSD Core, Custom. Model Providers: OpenAI, Anthropic, Gemini, Bedrock. Agent Assignment: Architecture → Claude Code, Development → Codex, Testing → Gemini.
2. **Open Connector Center** — wire GitHub + Jira + Confluence + Slack. Show Connector Marketplace.
3. **Open Command Center** — show all `forge-*` commands (Discuss Phase, Plan Phase, Execute Phase, Ship, etc.) as clickable panels. "Users never type `gsd`."
4. **Open Terminal Center** — launch Claude Code in Tab 1; open Codex in Tab 2; split pane. Show concurrent agent sessions. Inject project knowledge context into Claude Code session.
5. **Run Project Onboarding Wizard** — select CMC repositories → trigger `forge-map-codebase` + `forge-graphify` → watch knowledge graph build in React Flow.
6. **Open Knowledge Center** — click *Auth Service* → see User Service, Login API, Database, ADR-120, Jira-456, Repository, Deployment — all linked cross-source.
7. **Ask Impact Question** — "Which repositories are affected by adding MFA authentication?" Q&A answers from knowledge graph.
8. **Open Ideation Center** — type "Add MFA Authentication". Realtime Workflow shows live progress. PRD Generator produces BMad-structured PRD. Architecture Preview shows consequences.
9. **Approve Ideation Bundle** — push to Jira + Confluence + Architecture Accelerator.
10. **Architecture Agent runs** (Claude Code, per M9). ADR + API Contract + Task Breakdown + Risk Register generated. Agent Workflow Visualization animates.
11. **Architect approves** — governance boundary crossed. Audit trail shows every transition, actor, rationale.
12. **Back to Terminal Center** — developer opens Codex session for implementation, injects approved architecture context. Show `forge-execute-phase` in Command Center. Show terminal audit log.
13. **Show Realtime Agent Dashboard** (V1-Optional) — concurrent agent progress, multi-agent cost attribution.
14. **Show Audit Trail + Counter-Metrics** — gate-pass rate, Human Override Rate, Knowledge Reuse Rate.

*The Terminal Center + Command Center demo steps are what distinguishes v2.0 from v1.3: developers never leave Forge, whether in the visualization layer, the approval layer, or the live coding layer.*

### 8.7 Platform Surfaces (UI-first Architecture)

**Navigation Structure (v2.0 canonical):**

```
Forge
├── Home
├── Project Intelligence       ← M3-M5, first demo
│   ├── Repositories
│   ├── APIs
│   ├── Databases
│   ├── Services
│   └── Knowledge Graph
├── Knowledge Center           ← M5, killer feature
│   ├── Documentation
│   ├── Communication
│   ├── Assets
│   ├── Unified Knowledge Graph
│   └── Freshness Indicators
├── Agent Center               ← M2
│   ├── Development Agents
│   ├── Model Providers
│   ├── Agent Assignment
│   └── Runtime Status
├── Connector Center           ← M2
│   ├── Engineering
│   ├── Project Management
│   ├── Documentation
│   ├── Cloud
│   └── Communication
├── Forge Command Center       ← M2 (NEW v2.0)
│   ├── Onboarding (forge-new-project, forge-onboard-codebase)
│   ├── Project Intelligence (forge-map-codebase, forge-graphify, forge-ingest-docs)
│   ├── Ideation (forge-ns-ideate, forge-ns-workflow, forge-inbox)
│   ├── Architecture (forge-spec-phase, forge-discuss-phase, forge-plan-phase)
│   ├── Development (forge-execute-phase, forge-mvp-phase, forge-quick)
│   ├── Testing (forge-verify-work, forge-add-tests, forge-eval-review)
│   ├── Security (forge-secure-phase, forge-audit-fix)
│   ├── Code Review (forge-code-review, forge-review)
│   ├── Deployment (forge-ship, forge-pr-branch, forge-cleanup)
│   ├── Milestones (forge-new-milestone, forge-complete-milestone, forge-progress)
│   ├── Learning (forge-extract-learnings, forge-mempalace-capture)
│   ├── Workflow (forge-workstreams, forge-pause-work, forge-resume-work)
│   └── Environment (forge-workspace, forge-config, forge-settings)
├── Forge Terminal Center      ← M2 base, M11 full (NEW v2.0)
│   ├── [Tab: Claude Code #1]
│   ├── [Tab: Codex #1]
│   ├── [Tab: Gemini CLI #1]
│   ├── [+ New Session]
│   ├── Split Pane View
│   └── Session History
├── Organization Knowledge     ← M2, "KnackForge DNA"
│   ├── Coding Standards
│   ├── Security Standards
│   ├── ADR Templates
│   ├── Review Checklists
│   └── Governance Rules
├── Ideation                   ← M6-M8
│   ├── Ideas
│   ├── Opportunities
│   ├── Architecture Impact
│   ├── Roadmap
│   └── Approval Queue
├── Architecture               ← M9-M10
│   ├── ADRs
│   ├── API Contracts
│   └── Risk Register
├── Development Center         *(Phase 4, OOV, GSD-powered)*
├── Security Center            *(Phase 5, OOV)*
├── Testing Center             *(Phase 5, OOV)*
├── Deployment Center          *(Phase 6/7, OOV)*
├── Governance Center          ← M11 (V1-Optional + Conflict Resolution)
├── Audit Center               ← M10
└── Analytics Center           ← M10-M11
```

### 8.8 Forge Terminal Center Architecture (v2.0)

```
┌─────────────────────────────────────────────────────────┐
│                Forge UI (Browser)                       │
│                                                         │
│  ┌────────────────────────────────────────────────────┐ │
│  │   Forge Terminal Center                            │ │
│  ├──────────┬──────────┬──────────┬───────────────────┤ │
│  │Claude    │Codex     │Gemini    │ + New Session      │ │
│  │Code #1   │#1        │CLI #1    │                    │ │
│  ├──────────┴──────────┼──────────┴───────────────────┤ │
│  │                     │                               │ │
│  │  xterm.js           │  xterm.js                     │ │
│  │  Agent: Claude Code │  Agent: Codex                 │ │
│  │  $ forge-spec-phase │  $ forge-execute-phase        │ │
│  │                     │                               │ │
│  └─────────────────────┴───────────────────────────────┘ │
│                                                         │
│  [Split] [New Tab] [Close] [Agent: ▼] [Context] [Theme] │
└─────────────────────────────────────────────────────────┘
         ▲ WebSocket (stdin/stdout)     ▲ WebSocket
         ▼                              ▼
┌──────────────────────┐   ┌──────────────────────┐
│ Claude Code          │   │ Codex                │
│ (PTY Process #1)     │   │ (PTY Process #2)     │
│ Workspace: /proj/cmc │   │ Workspace: /proj/cmc │
└──────────────────────┘   └──────────────────────┘
         ▲                              ▲
         └──────────────┬───────────────┘
                        ▼
         ┌──────────────────────────────┐
         │  FastAPI Process Manager     │
         │  terminal/session_manager.py │
         │                              │
         │  - Spawn PTY per session     │
         │  - Stream I/O via WebSocket  │
         │  - Session persistence       │
         │  - F-005 Audit every command │
         │  - LiteLLM cost per session  │
         └──────────────────────────────┘
                        │
         ┌──────────────┴───────────────┐
         ▼                              ▼
  ┌─────────────┐               ┌─────────────┐
  │ PostgreSQL  │               │    Redis     │
  │ (Sessions + │               │ (Pub/Sub for │
  │  Audit Log) │               │  WS fanout)  │
  └─────────────┘               └─────────────┘
```

### 8.9 Master Charter UI Module Alignment

| Master Charter Module | PRD v2.0 Surface | V1 Status |
|---|---|---|
| Dashboard | Home | V1 |
| Connector Center | Connector Center (F-015) | V1 M2 |
| Knowledge Center | Knowledge Center (F-112..F-115) | V1 M5 |
| Project Intelligence | Project Intelligence (F-101..F-111) | V1 M3-M4 |
| Organization Knowledge | Org Knowledge UI (F-001..F-003) | V1 M2 |
| Agent Center | Agent Center (F-011..F-014) | V1 M2 |
| **Forge Command Center** | Command Center (F-018..F-020) | **V1 M2 (NEW v2.0)** |
| **Forge Terminal Center** | Terminal Center (F-401..F-415) | **V1 M2-M11 (NEW v2.0)** |
| Development Center | Development (Phase 4, GSD-powered) | OOV |
| Security Center | Security (Phase 5, OOV) | OOV |
| Testing Center | Testing (Phase 5, OOV) | OOV |
| Deployment Center | Deployment (Phase 6/7, OOV) | OOV |
| Governance Center | Governance Dashboard (F-009, V1-Optional) | V1-Optional M11 |
| Audit Center | Audit (F-005) | V1 M10 |
| Analytics Center | Metrics / Analytics (NFR-022) | V1 M10-M11 |

---

## Appendix A — Domain Model (v2.0)

```
Organization
 └─ Project  (= Customer Engagement = Tenant; RLS boundary)
     └─ Repository

Organization entities (shared, Steward-controlled):
  Standards (F-001), Policies (F-003), Templates (F-002),
  Artifact Registry (F-010), Agent Registry (F-011),
  Model Provider Registry (F-012), Connector Registry (F-007/F-015),
  GSD White-Label Registry (F-019)

Project entities (isolated per tenant via RLS + per-tenant CMK):
  Repositories (F-101, F-102)
  Knowledge Graph (F-103..F-115)   ← Apache AGE + pgvector
  Artifacts:
    Ideation Output Bundle (F-211)
    ADR (F-301), API Contract (F-302), Task Breakdown (F-303)
    Risk Register (F-304), Acceptance Criteria (F-310)
  Approvals (F-212, F-305, F-006)
  Snapshots (F-109)
  Terminal Sessions (F-401..F-415)
  Cost Ledger (NFR-030)            ← per session, per workflow
  Freshness Ledger (NFR-031)       ← per graph node

Multi-tenant invariants (every Project entity row must carry):
  tenant_id  (non-nullable, RLS enforced)
  project_id (non-nullable, RLS enforced)
```

---

## Appendix B — GSD White-Label Command Map (v2.0 — F-019 Registry)

The complete FORGE_COMMAND_MAP implemented by F-019:

| Forge Command (UI-facing) | GSD Underlying | Category |
|---|---|---|
| forge-new-project | gsd new-project | Onboarding |
| forge-onboard-codebase | gsd onboarding-existing-codebase | Onboarding |
| forge-map-codebase | gsd map-codebase | Project Intelligence |
| forge-graphify | gsd graphify | Project Intelligence |
| forge-ingest-docs | gsd ingest-docs | Project Intelligence |
| forge-capture | gsd capture | Project Intelligence |
| forge-intel | gsd intel | Project Intelligence |
| forge-surface | gsd surface | Project Intelligence |
| forge-explore | gsd explore | Project Intelligence |
| forge-ns-ideate | gsd ns-ideate | Ideation |
| forge-ns-project | gsd ns-project | Ideation |
| forge-ns-workflow | gsd ns-workflow | Ideation |
| forge-inbox | gsd inbox | Ideation |
| forge-spec-phase | gsd spec-phase | Architecture |
| forge-discuss-phase | gsd discuss-phase | Architecture |
| forge-plan-phase | gsd plan-phase | Architecture |
| forge-ultraplan-phase | gsd ultraplan-phase | Architecture |
| forge-validate-phase | gsd validate-phase | Architecture |
| forge-execute-phase | gsd execute-phase | Development |
| forge-mvp-phase | gsd mvp-phase | Development |
| forge-quick | gsd quick | Development |
| forge-fast | gsd fast | Development |
| forge-spike | gsd spike | Development |
| forge-ui-phase | gsd ui-phase | Development |
| forge-verify-work | gsd verify-work | Testing |
| forge-add-tests | gsd add-tests | Testing |
| forge-eval-review | gsd eval-review | Testing |
| forge-audit-uat | gsd audit-uat | Testing |
| forge-secure-phase | gsd secure-phase | Security |
| forge-audit-fix | gsd audit-fix | Security |
| forge-code-review | gsd code-review | Code Review |
| forge-review | gsd review | Code Review |
| forge-review-backlog | gsd review-backlog | Code Review |
| forge-ship | gsd ship | Deployment |
| forge-pr-branch | gsd pr-branch | Deployment |
| forge-cleanup | gsd cleanup | Deployment |
| forge-new-milestone | gsd new-milestone | Milestones |
| forge-complete-milestone | gsd complete-milestone | Milestones |
| forge-milestone-summary | gsd milestone-summary | Milestones |
| forge-progress | gsd progress | Milestones |
| forge-stats | gsd stats | Milestones |
| forge-extract-learnings | gsd extract-learnings | Learning |
| forge-mempalace-capture | gsd mempalace-capture | Learning |
| forge-mempalace-recall | gsd mempalace-recall | Learning |
| forge-workstreams | gsd workstreams | Workflow |
| forge-pause-work | gsd pause-work | Workflow |
| forge-resume-work | gsd resume-work | Workflow |
| forge-thread | gsd thread | Workflow |
| forge-undo | gsd undo | Workflow |
| forge-autonomous | gsd autonomous | Workflow |
| forge-workspace | gsd workspace | Environment |
| forge-config | gsd config | Environment |
| forge-settings | gsd settings | Environment |
| forge-debug | gsd debug | Environment |
| forge-import | gsd import | Environment |

*Intelligence tools (wrapped, not white-labeled from GSD):*

| Forge Command | Tool | Note |
|---|---|---|
| forge-repomix | npx repomix | Multi-repo intelligence generation |
| forge-codegraph | codegraph | Dependency/architecture graph |

---

## Appendix C — Glossary (v2.0 additions)

| Term | Definition |
|---|---|
| **Forge Command Center** | The UI surface exposing all white-labeled GSD commands as clickable, audited workflow panels. Users see `forge-*`; GSD runs underneath. |
| **Forge Terminal Center** | In-browser multi-agent terminal hub (xterm.js + PTY). Every session governed, audited, workspace-isolated, and persistable. |
| **FORGE_COMMAND_MAP** | The authoritative registry mapping every `forge-*` command to its underlying `gsd` command. Implemented by F-019. |
| **GSD White-Label Principle** | GSD Core's 60+ commands are white-labeled as `forge-*` commands. Users never see "GSD" — they see Forge brand. GSD runs under the hood. *(DL-024)* |
| **LiteLLM Proxy** | The Forge Provider Abstraction Layer. All LLM traffic routes through LiteLLM. No service imports a provider SDK directly. *(DL-025)* |
| **PTY Process** | Pseudo-terminal process spawned by the Terminal Session Manager. Enables real browser-based terminal emulation for CLI agents. |
| **Terminal Session** | A single agent terminal session: ID, agent_type, project_id, PTY process, status, audit_enabled. |
| **Workspace Isolation** | Each terminal session operates in a scoped workspace directory. No cross-project filesystem access. |
| **Constitutional Constraint** | One of the 8 immutable rules from the Master Development Charter, each mapped to PRD NFRs in §6.14. |
| **Process Manager** | FastAPI subprocess manager that spawns and manages GSD CLI, intelligence tool, and agent CLI processes (F-020). |
| **M1 Substrate** | The set of primitives that must be built in M1 (not retrofitted later): typed event bus, LiteLLM integration, cost/freshness ledgers, RLS isolation, append-only artifacts, connector failure states, policy evaluation engine. *(§6.13, DL-027)* |

---

*PRD v2.0 — Forge Delivery Accelerator — 2026-06-21*
*Supersedes v1.3 (2026-06-20)*
*Total V1 FRs: 75 (Foundation: F-001..F-021 = 21 FRs; Phase 0: F-101..F-115 = 15 FRs; Phase 1: F-201..F-213 = 13 FRs; Phase 2: F-301..F-310 = 10 FRs; Phase 3: F-401..F-415 = 15 FRs; V1-Optional: F-009)*