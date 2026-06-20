---
title: "PRD: Forge Delivery Accelerator"
status: final
version: 1.3
created: 2026-06-19
updated: 2026-06-20
project: forge-ai
north_star: "Time to Trusted Delivery (TTTD)"
supporting_pillars:
  - Codified Delivery Methodology
  - Knowledge Propagation
  - Delivery Intelligence
  - Agent Orchestration
  - GSD Adoption (Open GSD as default Development Execution Framework)  # v1.3
platform_posture: "Web Platform first — the UI is the product"
strategic_positioning: "Agent Operating System — the control plane for any model, any agent, any connector; development execution powered by Open GSD"
supersedes: "v1.2 (2026-06-19) — added Ideation as V1 Phase 1, FR-210/211, GSD adoption principle, resolved OQ-005/006/007"
v1_3_changes:
  - Added Pillar 5 (GSD Adoption) to §1.4
  - Added FR-016 (Agent Runtime Management) to §5.1 Foundation
  - Added FR-017 (Hook Orchestration) to §5.1 Foundation
  - Updated §5.5 Out-of-V1: Phase 3 Development Accelerator = GSD-Core powered
  - Resolved OQ-005 (ADR-001: Cloud-Only AWS at V1), OQ-006 (ADR-002: PostgreSQL+Apache AGE), OQ-007 (ADR-003: Hybrid MDM+Steward Priority)
  - Fixed duplicate §5.4 numbering typo (§5.5 Out-of-V1)
  - Added Governance Center + Analytics Center to §8.7 Platform Surfaces
---

# PRD: Forge Delivery Accelerator

## Executive Summary

**Forge** is a delivery intelligence and acceleration platform that codifies KnackForge's engineering methodology as typed artifacts, approval gates, and a per-engagement knowledge layer — so every customer engagement inherits the same standards, architectural rigor, and delivery practices regardless of team or stack.

**Forge is a Web Platform first.** The UI is the product, not an optional surface. Leadership buys a *Forge Dashboard* — Projects, Architecture, Approvals, Audit Trail, Metrics in one place. API access exists for integration but is not the primary surface.

- **North Star Metric:** Time to Trusted Delivery (TTTD) — from an approved requirement to a deployment-approved release package with all required approvals. Replaces "Delivery Predictability" because leadership needs an observable, daily metric.
- **V1 scope:** Foundation (Organization Knowledge + Compliance & Governance) + Phase 0 (Project Intelligence Accelerator) + Phase 1 (Architecture Accelerator). Phases 2–5 explicitly deferred.
- **Pilot posture:** No numeric targets committed until baseline measurements exist. Pilot establishes baselines; directional improvement validated statistically.
- **Headline UX promise (First Aha Time):** A Tech Lead connecting a brownfield project experiences *"the platform understood our project in minutes."* Validated at end of M3 with the Project Intelligence UI as the first demo.
- **Three pillars:** Codified Delivery Methodology · Knowledge Propagation · Delivery Intelligence.
- **Strategic posture:** Forge scales delivery quality through systems, not individuals — addressing key-person dependency, inconsistent delivery, scaling teams, and knowledge loss.
- **Domain model:** Organization → Project (= Customer Engagement = Tenant) → Repository. Each Project gets an isolated Knowledge Graph, Artifacts, Audit Trail, and Memory.
- **Critical architecture invariants:** shared Organization Knowledge Layer, per-Project Project Intelligence isolation, human approval gates at every governance boundary, audit immutability, model-provider independence, UI-first delivery.
- **Phase-blockers** (must resolve before Architecture): pilot identification (OQ-001), TTTD baseline methodology (OQ-002), commercial pricing (OQ-004), V1 connector scope (OQ-008), P1.5 validation rubric (OQ-009). **Resolved in v1.3:** deployment model (OQ-005 → ADR-001 cloud-only AWS), knowledge graph strategy (OQ-006 → ADR-002 PostgreSQL+Apache AGE), source-of-truth policy (OQ-007 → ADR-003 hybrid MDM+Steward priority).

---

## 1. Vision

### 1.1 Vision statement

**Forge is a delivery Agent Operating System.** It is the governed control plane where organizations connect any model, any agent, and any connector — and visualize the entire SDLC and knowledge graph in one place. Forge does not force users to use one AI agent. Forge orchestrates the agents that already exist (Claude Code, Codex, Gemini CLI, Aider, Kiro, Hermes, OpenHands, Cursor Agent, and custom agents) inside a substrate of typed artifacts, approval gates, audit trails, and a per-Project knowledge layer.

By combining Organization Knowledge, Project Intelligence, governed delivery workflows, and runtime agent orchestration, Forge ensures every customer engagement inherits the same engineering standards, architectural rigor, security controls, and delivery practices — regardless of team, project, technology stack, or which agent happens to be assigned.

Forge enables KnackForge to scale delivery quality through systems rather than individual expertise — and now through *systems that orchestrate other systems*. The competitive differentiator is not "the agent" but "the governed substrate the agents live in." Turn-key SDLC acceleration becomes turn-**up** SDLC acceleration: customers connect their existing agents and immediately inherit the platform's governance, knowledge, and visualization.

### 1.1a Strategic positioning (v1.1)

Forge is **not** an SDLC agent. Forge is **not** in head-to-head competition with Claude Code, Codex, Cursor Agent, or any single coding agent. Those are *components Forge orchestrates*.

Forge's defensibility is the platform layer: typed artifacts and approval gates, the governed knowledge graph, the connector registry, the multi-agent orchestration runtime, the audit trail, and the unified visualization. Each is hard to replicate in isolation; together they form a control plane that any agent — current or future — plugs into.

### 1.2 Strategic posture (leadership-facing)

Forge reduces dependence on individual experts by making delivery knowledge explicit, governed, reusable, and discoverable. As KnackForge grows, delivery quality becomes a property of the system rather than a property of who happens to be assigned to a project.

This explicitly addresses four concerns every delivery leadership team carries:

- Key-person dependency
- Inconsistent delivery
- Scaling teams
- Knowledge loss

### 1.3 One-sentence vision

> Forge enables KnackForge to scale delivery quality through systems, not individuals, by capturing, governing, propagating, and reusing delivery knowledge across every customer engagement.

### 1.4 Four pillars (v1.1)

1. **Codified Delivery Methodology** — Standards, governance, patterns, and best practices become reusable assets.
2. **Knowledge Propagation** — Delivery knowledge flows forward through the SDLC as typed artifacts and approvals: Requirements → Architecture → Development → Security → Deployment.
3. **Delivery Intelligence** — Every engagement contributes reusable knowledge that accelerates future work. Umbrella covering institutional memory, project intelligence, refactor intelligence, cross-project learning, and knowledge graphs.
4. **Agent Orchestration** *(v1.1 — added)* — Forge is the runtime substrate that orchestrates external agents (Claude Code, Codex, Gemini CLI, Aider, Kiro, Hermes, OpenHands, Cursor Agent, custom) into governed workflows. Agents are configurable, pluggable, swappable; the orchestration is governed by Forge. *This pillar is what makes Forge a control plane rather than a single agent.*
5. **GSD Adoption** *(v1.3 — added)* — Forge adopts [Open GSD](https://www.opengsd.net/) as the default Development Execution Framework for the post-V1 Development Accelerator. Forge extends Open GSD with multi-tenancy, project intelligence, organization knowledge, governance, audit, visualization, and enterprise integrations — rather than reimplementing development-execution primitives. Forge is the **enterprise control plane around GSD**, not a competitor to it. Components reused: `gsd-core` (Plan / Execute / Verify / Ship), `gsd-pi` (Milestones / State / Context / Execution), `gsd-workbench` concepts (absorbed into Forge Development Center), `gsd-cloud` concepts (Forge Cloud long-term). *This pillar makes Forge a delivery operating system rather than a re-implementer of solved problems.*

### 1.5 Why now (v1.1)

Three layers of commoditization have created the opening:

1. **Code generation is commoditized** — Cursor, Claude Code, Copilot, Kiro and others all generate code competently. The developer-side terminal is no longer the differentiator.
2. **Coding agents are commoditized** — Claude Code, Codex, Gemini CLI, Aider, Kiro, Hermes, OpenHands, Cursor Agent are all available as agents with tool-use and code-modification capabilities. A single "SDLC agent" cannot out-compete the frontier; the field moves too fast.
3. **The control plane is not.** Orchestrating any model, any agent, and any connector inside a governed substrate — with typed artifacts, approval gates, audit trails, knowledge graphs, and visualization — is the missing layer. *That* is where KnackForge's differentiator lives.

A single agent competes on the model's shoulders. A control plane compounds: every new agent that ships becomes a feature of Forge, not a competitor. The platform surfaces (Project Intelligence, Architecture, Audit, Metrics, Administration, **Agent Center**, **Knowledge Center**, **Connector Center**) are the durable assets. The agents are interchangeable.

### 1.6 Leadership framing — what Forge is not

A reader from leadership, practice, or commercial may carry unspoken concerns. Naming them here so downstream artifacts (Architecture, UX, Epics, commercial positioning) carry the same reassurance register:

- **Forge does not replace engineers, architects, or delivery teams.** It is a delivery teammate that makes humans more effective. Humans own every governance boundary and every production release decision. *(NFR-032 enforces; §4.3 reinforces.)* *(Governance boundary: any transition that changes an artifact's authoritative status — e.g., `draft → approved` — gated by a human approver distinct from the author. Full definition in §4.5.)*
- **Forge does not displace Jira, GitHub, Confluence, or other systems of record.** It integrates with them. Each system stays the authority for what it's good at; Forge orchestrates the connections and surfaces the inconsistencies. *(§4.4.)*
- **Forge does not make decisions for delivery teams.** A generated ADR is a draft until an Architect approves it. An approval workflow is a structured conversation, not a rubber stamp. *(F-205 + F-006.)*
- **Forge is not a coding-agent bake-off.** Cursor, Claude Code, Copilot, Kiro optimize for code generation. Forge optimizes for the *system* that makes code generation *useful* — governance, propagation, reuse. *(Brief, verbatim.)*
- **Forge is not a bottleneck.** The Steward governs standards; the Architect governs approvals; the Tech Lead governs delivery. No single role is a chokepoint because each is supported by typed artifacts and audit trails.
- **Forge is not an API product.** It is a **Web Platform first.** The UI is the product, not an optional surface. Leadership buys a *Forge Dashboard* — Projects, Architecture, Approvals, Audit Trail, Metrics in one place. *(See §8.7 — Platform Surfaces.)* API access exists for integration (NFR-018) but is not the primary surface.

This section is the executive reassurance register. Epics, UX, and Architecture artifacts should preserve it, not silently reduce it to a prohibition.

---

## 2. Decision Log (forward-flowing reference)

These decisions are **locked** and flow forward into Architecture, UX, Epics, and Stories. They prevent re-litigation each sprint. The full audit trail (with rationale and override history) lives in `.decision-log.md` alongside this PRD.

| ID | Decision | Locked by |
|---|---|---|
| **DL-001** | Brownfield-first strategy approved. Most V1 customers will have 10+ repos. Greenfield is not the V1 target. | Brief + Section 5 |
| **DL-002** | Human approval gates are mandatory at every governance boundary. No autonomous cross-boundary transitions. *(NFR-032 enforces.)* | Steering + NFR-032 |
| **DL-003** | Project Intelligence (Phase 0) precedes SDLC acceleration (Phase 1+). Understanding comes before generation. | Section 5 (FR ordering) |
| **DL-004** | Organization Knowledge Layer is shared across tenants (Steward-controlled publishing). | NFR-006 + steering |
| **DL-005** | Project Intelligence Layer is fully isolated per tenant (Engagement). Customer knowledge graphs never mix. | NFR-006 + A-004 |
| **DL-006** | North Star Metric is **Time to Trusted Delivery (TTTD)** — not Delivery Predictability. | Steering (Section 1) |
| **DL-007** | Tech Lead is the strategic through-line persona. Persona remains primary even if Project Intelligence becomes automatic. | Steering (Section 4) |
| **DL-008** | All numeric targets `[TO BE VALIDATED DURING PILOT]` until baseline measurement exists. | Steering (Section 3.5) |
| **DL-009** | V1 scope is Foundation + Phase 0 + Phase 1 only. Phase 2–5 explicitly deferred. | Steering (Section 5) |
| **DL-010** | Model Provider Independence is a foundational constraint. Forge's value is not tied to a specific model. | NFR-029 + steering |
| **DL-011** | V1 is **SOC2-ready** (controls designed for certification), not certified. Type I / Type II timing deferred. | Steering (Section 6.1) |
| **DL-012** | **Forge is a Web Platform first.** The UI is the product, not an optional surface. API access exists for integration but is not the primary surface. | Steering (Section 8.7) |
| **DL-013** | **Domain model simplified:** Organization → Project (= Customer Engagement = Tenant) → Repository. No internal sub-Project layer in V1. KnackForge's reality (CMC, GAPI, Honeywell) is one engagement per customer with many direct repos. | Steering (Section 7.2 A-004 final) |
| **DL-014** | **UI-first delivery.** Each milestone (M1–M8) ships a working UI surface *with* its backend capability. The first demo is Project Intelligence UI (M3), not architecture generation. | Steering (Section 8.1) |
| **DL-015** *(v1.1)* | **Forge is an Agent Operating System, not an SDLC agent.** Forge orchestrates external agents (Claude Code, Codex, Gemini CLI, Aider, Kiro, Hermes, OpenHands, Cursor Agent, custom) via the Agent Center. *Defensibility is the platform, not the agent.* | Steering (Sections 1.1, 1.4 Pillar 4, 8.7) |
| **DL-016** *(v1.1)* | **NFR-029 upgraded to Agent Runtime Portability.** Stronger invariant than multi-provider-LLM: Forge is portable across agents at runtime, not just across models. | Steering (Section 6.8) |
| **DL-017** *(v1.1)* | **Knowledge Center is the killer feature.** Cross-source traversable graph (repos + docs + comms + assets) — not just code repositories. Graphiti / Neo4j / Mem0 / CodeGraph-style visualization. | Steering (Sections 4.2, 8.7) |
| **DL-018** *(v1.1)* | **V1 ships as three packages** — Foundation (incl. Agent Center + Connector Center), Project Intelligence (incl. Knowledge Center), Architecture Accelerator. Each independently demoable and pilotable. | Steering (Section 8.1) |
| **DL-019** *(v1.2)* | **Ideation is V1 Phase 1.** A full **AI Product Management Workspace** — not a Phase 2 surface, not "an Ideation Agent." Sits between Project Intelligence (Phase 0) and Architecture (Phase 2). Includes Idea Intake, Idea Analysis, Architecture Impact Graph, Opportunity Scoring, Roadmap Generator, PRD Generator, Architecture Preview, Ideation Knowledge Graph, Ideation Agent Selection, Realtime Workflow, Output Bundle, Approval Queue, Push to Delivery Systems. | Steering (Sections 5.3, 8.1) |
| **DL-020** *(v1.2)* | **Phase renumbering.** Phase 1 = Ideation (NEW). Architecture renumbered to Phase 2 (FRs F-201-F-210 → F-301-F-310). Out-of-V1 phases renumbered to Phase 3 (Development), Phase 4 (Security + QA), Phase 5 (Modernization), Phase 6 (Delivery Orchestration). | v1.2 structural refresh |
| **DL-021** *(v1.2)* | **Forge flow:** Project Intelligence → Ideation → Architecture → Development → Testing → Security → Deployment. *Self-contained: the platform that understands the codebase also generates the requirements that flow into Architecture.* | Steering (Sections 1.1, 5.3, 8.6) |

---

## 3. Success Metrics

### 3.1 North Star Metric

**Time to Trusted Delivery (TTTD)**

**Definition:** Elapsed time from an approved requirement entering the delivery system to the creation of a deployment-approved release package containing all required artifacts, approvals, security validations, quality validations, and deployment instructions required for production release. TTTD measures the efficiency of the governed delivery process and intentionally includes all mandatory approval gates.

**Why this definition:** Pre-empts ambiguity about what "deployment-ready" means across teams. The package definition forecloses arguments about gate-skipping (e.g., "QA done but deployment not ready," "code merged but security pending," "infrastructure not provisioned").

**Baseline:** `[TO BE MEASURED — establish during pilot baseline phase]`
**Target:** `[TO BE VALIDATED DURING PILOT]`

### 3.2 Business Outcomes

| Metric | Definition | Direction |
|---|---|---|
| Predictability | Variance of TTTD across teams, projects, time | Lower variance = better |
| Rework Rate | % of stories reopened / ADRs revised post-approval | Lower = better |
| Story Reopen Rate | % of accepted stories reopened within sprint | Lower = better |
| Architecture Review Time | Time from ADR request → ADR approved | Lower = better |
| Onboarding Time | Time for new engineer to ship first merged PR to a project | Lower = better |

### 3.3 Project Intelligence Outcomes

| Metric | Definition | Direction |
|---|---|---|
| Time to Project Understanding | Time from brownfield project intake → architecture map + service catalog + dependency graph available | Lower = better (target: hours from days/weeks) |
| Architecture Discovery Coverage | % of repos / services surfaced with metadata + relations | Higher = better |
| Question Resolution Accuracy | % of project-intelligence queries answered correctly without human escalation | Higher = better |
| Delivery Knowledge Reuse Rate | % of stories, ADRs, or projects that reference existing artifacts rather than creating new ones | Higher = better (knowledge layer working) |
| Architecture Drift Rate | % of implemented changes that diverge from approved architecture | Lower = better (executive metric) |

### 3.4 Counter-Metrics (anti-gaming)

These catch when TTTD is optimized by skipping work that should not be skipped, or when trust in Forge-generated artifacts has regressed.

| Counter-metric | What it catches |
|---|---|
| Architecture Approval Skip Rate | Teams fast-tracking by skipping ADR review |
| Security Approval Skip Rate | "Approved by self" / blanket-waiver patterns |
| Production Incident Rate | Delivery speed at cost of stability |
| Defect Escape Rate | Velocity purchased via insufficient QA |
| Knowledge Reuse Avoidance Rate | Teams re-inventing instead of consulting the knowledge layer |
| Human Override Rate | % of generated artifacts rejected or heavily modified by human reviewers — early warning for low confidence / quality / standards alignment |

### 3.5 Pilot framing

> Forge will not commit to target improvements until baseline measurements have been established through pilot engagements. Initial pilot success will be measured by successful baseline establishment, user adoption, and statistically significant directional improvement across the defined metrics.

All numeric targets remain `[TO BE VALIDATED DURING PILOT]` until baseline data exists.

---

## 4. Personas

Forge is capability-first and multi-stakeholder. This section names the V1 persona inventory with jobs-to-be-done; full persona context lives inline where each capability invokes the persona. **The Tech Lead is the strategic through-line** — the persona most aligned with the vision, the North Star (TTTD), and the differentiation strategy. Forge's long-term success is not "connect repositories" — it is "help Tech Leads deliver consistently across every KnackForge engagement."

### 4.1 V1-active personas

| Persona | Role | Job-to-be-done |
|---|---|---|
| **The Steward** — Engineering Excellence Lead | Owns the Organization Knowledge Layer: standards, templates, governance | Make KnackForge's delivery standards explicit, reusable, and enforceable across every engagement — without becoming the bottleneck. |
| **The Tech Lead** — KnackForge Technical Lead *(primary V1 persona)* — *now also Agent Orchestrator* | Owns delivery outcomes for a customer engagement. Bridges business requirements, architecture decisions, engineering execution, and delivery risk. **Configures which agents run which stages, monitors the Realtime Agent Dashboard, and intervenes on escalations.** | Understand an existing project, identify the impact of proposed changes, and **orchestrate governed agents** through a governed architecture process that produces reviewable, reusable delivery artifacts without depending on tribal knowledge. *(Persona remains primary even if Project Intelligence becomes automatic; the orchestration role remains even if individual agents become commoditized.)* |
| **The Architect** — KnackForge Architect *(V1 secondary)* | Owns architecture decisions across engagements; reviews ADRs; sets standards | Produce and approve ADRs / API contracts that downstream teams can execute against, without rewriting them. |
| **The Delivery Sponsor** *(executive observer)* — Director of Engineering, VP Engineering, Practice Lead, CTO | Funds Forge; measures initiative success | Understand delivery health, predictability, and organizational risk; answer "are we actually becoming more predictable?" *(Not a daily user; consumes dashboards and reports.)* |

### 4.2 Future-state personas (post-V1)

Ordered to follow the delivery chain:

1. **The Developer** — implements code from approved tasks + ADRs *(Phase 2)*
2. **The QA Engineer** — owns integration / E2E / release readiness *(Phase 3)*
3. **The Security Engineer** — owns security approvals, OWASP, IaC validation *(Phase 3)*
4. **The Solution Architect** — cross-engagement patterns, modernization roadmaps *(Phase 4)*
5. **The Delivery Manager** — Engineering / Delivery Manager; forecasts capacity, tracks predictability, owns engagement economics
6. **The Customer Delivery Team** — runs the customer engagement day-to-day *(Phase 5)*
7. **The Commercial Buyer** — VP Engineering, Director Engineering, CTO, Head of Delivery *(mid-market and enterprise)* *(Strategic Phase B)*

### 4.3 Out-of-scope personas

Forge is a delivery acceleration platform, **not an autonomous software delivery system**. Human judgment remains required at every governance boundary, approval gate, and production release decision.

- **AI Delivery Operator** — Forge does not make decisions for delivery teams.
- **Replacement Engineer** — Forge accelerates humans; does not replace them.
- **Autonomous Release Manager** — Production release decisions remain human-owned.

### 4.4 Systems of Record

Forge interacts with existing systems of record rather than replacing them. Examples: GitHub, Bitbucket, Jira, Confluence, SonarQube, AWS, Figma, Slack, Zendesk, Azure DevOps, Databricks. Integration specifics captured in capability groups (Section 5) and as NFRs (Section 6).

### 4.5 Governance Boundary (load-bearing term)

A **governance boundary** is any transition in an artifact's lifecycle that changes its authoritative status — most importantly `draft → approved`, `approved → superseded`, or any transition that affects what downstream work may rely on. Each boundary is *gated*: no background process, automation, or AI may cross it without a human approver who is *not* the author of the artifact being approved (separation of duties, NFR-004b access-review cadence).

This is the *invariant* NFR-032 names. The *specific set of boundaries* in any given workflow is defined by Architecture ADRs and the Steward-authored governance policies (F-003). The artifact state machine in §5.3 is the starting shape: `draft → under_review → approved | rejected | changes_requested` and `approved → superseded`.

For a Tech Lead drafting an ADR (F-201), the boundary is the moment they submit it for Architect review (F-205). For an Architect approving a Phase 1 package, the boundary is the moment they click *approve*. For a Steward publishing a standard (F-001), the boundary is the moment the standard version becomes authoritative for downstream consumption. *Each of these requires a human approver distinct from the author, an audit row, and a record of rationale.*

---

## 5. Capability Groups

**V1 scope:** Foundation + Phase 0 + Phase 1. Development Accelerator, Security Accelerator, Refactor Accelerator, and Modernization Accelerator are **explicitly out of V1 scope** — leadership needs to see "Understand Existing Project + Generate Architecture Package" working end-to-end before further capability investment.

FRs are globally numbered and grouped under the three capabilities. Personas are referenced inline.

**Note on acceptance criteria:** FRs in this PRD are stated at *capability shape* — each names what must be achievable, the persona(s) it serves, and its dependencies. **Acceptance criteria (testable conditions, measurable outcomes) are authored downstream in Epics.** This is a deliberate deferral: the brief places story-level acceptance in `bmad-create-epics-and-stories`, and over-specifying acceptance at PRD level would lock the architecture prematurely. Where this PRD *does* commit a measurable target (e.g., F-110 → P1.5 ≥80% acceptance gate), the commitment is named explicitly.

### 5.1 Foundation — Organization Knowledge Layer & Compliance & Governance

The substrate Phase 0 and Phase 1 read from. Owns the artifact model, the standards, the governance rules, and the integration points.

| ID | Name | Description | Personas | Depends on |
|---|---|---|---|---|
| **F-001** | Standards Library | Versioned catalog of KnackForge engineering standards (architecture, security, coding, governance). Steward authors/edits; downstream phases consume. | Steward (author), Tech Lead + Architect (consume) | — |
| **F-002** | Templates | Typed templates for ADR, API contract, task breakdown, risk register, security report, acceptance criteria package. | Steward (author), Tech Lead + Architect (consume) | F-010 |
| **F-003** | Governance Policy Engine | Declarative policies defining which gates are mandatory at which artifact transitions (e.g., ADR approval → API contract → task breakdown). Enforced by F-005 + F-006. | Steward (author), Tech Lead (subject to) | F-004, F-005, F-006 |
| **F-004** | RBAC | Multi-tenant org / project / role model. Per-tenant isolation. Role definitions cover at minimum: Steward, Tech Lead, Architect, Developer (future), Security Engineer (future), Delivery Sponsor. | Steward (admin), all personas (subject to) | F-007 (identity provider integration) |
| **F-005** | Audit Log | Append-only log of every artifact create / approve / modify / override / gate-skip event. Queryable by Steward, Architect, and Delivery Sponsor. | Steward + Architect (review), Delivery Sponsor (dashboards) | F-006 |
| **F-006** | Approval Engine | Workflow primitives: request → review → decide (approve / reject / request-changes) → record. Mandatory vs. advisory gates per F-003. Rejections and overrides logged via F-005. | Tech Lead (request), Architect (decide) | F-004, F-005 |
| **F-007** | Connectors / MCP Registry | Pluggable connectors for systems of record (GitHub, Bitbucket, GitLab, Jira, Confluence, SonarQube, AWS, Figma, Slack, Zendesk, Azure DevOps, Databricks). Connector contract is uniform. | Steward (admin), Tech Lead + Architect (consume) | F-004 |
| **F-008** | Admin UI | Steward-facing UI for managing standards, templates, policies, roles, connectors, and reviewing audit logs. | Steward | F-001 through F-007 |
| **F-010** | Artifact Registry | Central definition of every artifact type (ADR, API Contract, Risk Register, Task Breakdown, Acceptance Criteria, etc.) with: schema, version, required fields, relationships, lifecycle. Without this, traceability breaks and new artifact types can't be retro-fitted. | Steward (define), Tech Lead + Architect (consume) | F-002 |
| **`[V1-OPTIONAL]` F-009** | Governance Dashboard | Delivery-Sponsor-facing views of TTTD, predictability, gate-pass/skip/override, and counter-metrics. *V1-Optional / Phase 1.5.* Platform works without it. | Delivery Sponsor | F-005, F-006 |
| **F-011** *(v1.1)* | Agent Registry | Catalog of external agents available to Forge (Claude Code, Codex, Gemini CLI, Aider, Kiro, Hermes, OpenHands, Cursor Agent, custom). Steward-curated; per-Project assignment. *(Pillar 4 — Agent Orchestration.)* | Steward (curate), Tech Lead (assign), Architect (validate) | F-004 |
| **F-012** *(v1.1)* | Model Provider Registry | Catalog of model providers (OpenAI, Anthropic, Gemini, Bedrock, Azure OpenAI, OpenRouter, Ollama, Vertex AI). Each agent binds to one or more providers; switches do not require workflow changes. | Steward (curate) | F-004 |
| **F-013** *(v1.1)* | Agent Assignment | Map workflow stages to agents (e.g., Architecture → Claude Code, Development → Codex, Testing → Gemini, Security → Claude, Deployment → Hermes). Assignment is per-Project, configurable by Tech Lead, reviewed by Architect. | Tech Lead (configure), Architect (review) | F-011, F-012 |
| **F-014** *(v1.1)* | Agent Runtime Adapter | Pluggable adapter for each agent's tool surface and output shape. Forge speaks to agents through a uniform contract; the adapter handles per-agent quirks (Claude Code vs. Codex invocation, output format, error handling, cost reporting). | Steward (admin), Tech Lead (operate) | F-011, F-012, F-013 |
| **F-015** *(v1.1)* | Connector Marketplace / Center | Marketplace-style connector registry expanding beyond V1-required to full registry: Engineering (GitHub, Bitbucket, GitLab, Azure DevOps), Project Management (Jira, Linear, Azure Boards, Monday), Documentation (Confluence, Notion, Google Drive, SharePoint), Cloud (AWS, Azure, GCP, Kubernetes), Communication (Slack, Teams, Email, Zendesk). V1-required subset (F-007) is the minimum. | Steward (admin), Tech Lead + Architect (consume) | F-007 |
| **F-016** *(v1.3 — Agent Runtime Management)* | Agent Runtime Management | The system shall support multiple development runtimes — Claude Code, Codex CLI, Gemini CLI, OpenCode, Aider, Hermes, GSD Core, and future runtimes — without requiring platform code changes. Each runtime has a registered adapter that translates between Forge's hook protocol (F-017) and the runtime's native lifecycle events. *(Pillar 5 — GSD Adoption.)* | Steward (curate), Tech Lead (assign) | F-011, F-012, F-014, F-017 |
| **F-017** *(v1.3 — Hook Orchestration)* | Hook Orchestration | The system shall provide pre/post execution hooks for every supported runtime (F-016) and visualize hook execution through the Forge UI. Hooks are scoped at three levels: global (Steward-configured), tenant (admin-configured), project (lead-configured). Canonical hook pipeline: User Story → pre-plan → GSD Planning → post-plan → pre-code → Runtime (Claude Code / Codex / GSD Core / etc.) → post-code → Validator → Security → pre-commit → Git → pre-pr → post-pr. *(Pillar 5 — GSD Adoption. Powers Forge's universal governance across heterogeneous runtimes.)* | Steward (configure global), Tenant admin (configure tenant), Tech Lead (configure project) | F-016, F-014 |

### 5.2 Phase 0 — Project Intelligence Accelerator

Converts an unfamiliar codebase into a queryable model, then keeps that model current. The Tech Lead's primary productivity surface.

| ID | Name | Description | Personas | Depends on |
|---|---|---|---|---|
| **F-101** | Repository Ingestion | Pull repositories from connected source-control systems. Idempotent re-ingest. Honors rate limits. | Tech Lead (operate), Steward (admin) | F-007 |
| **F-102** | Repository Discovery | Analyze ingested repositories to detect languages, frameworks, dependencies, build systems. | Tech Lead (consume) | F-101, F-010 |
| **F-103** | Architecture Discovery | Infer services, modules, and architectural boundaries from repository + dependency evidence. Output is reviewable and editable. | Tech Lead (consume), Architect (validate) | F-102, F-010 |
| **F-104** | Dependency Graph | Build cross-service and cross-repo dependency graph. Captures direct + inferred dependencies. | Tech Lead (consume), Architect (validate) | F-103 |
| **F-105** | API Catalog | Curated list of APIs (internal + external) derived from ingestion. Each entry: owner, contract reference, version, status. *(Output of F-103.)* | Tech Lead (consume), Architect (validate) | F-103, F-010 |
| **F-106** | Database Map | Schemas, table relationships, ownership metadata. *(Output of F-103.)* | Tech Lead (consume), Architect (validate) | F-103, F-010 |
| **F-107** | Service Catalog | Curated list of services with ownership, runtime characteristics, dependencies (links to F-104). *(Output of F-103.)* | Tech Lead (consume), Architect (validate) | F-103, F-104, F-010 |
| **F-108** | Question-Answering Interface | Natural-language interface for project questions. Answers draw from F-102 through F-107. Escalation path to human when confidence is low (drives `Question Resolution Accuracy`). | Tech Lead (primary user) | F-102, F-103, F-104, F-105, F-106, F-107 |
| **F-109** | Snapshot | Versioned snapshot of project intelligence at a point in time; restore + diff between snapshots. | Tech Lead | F-105, F-106, F-107 |
| **F-110** | Impact Analysis | Given a requirement (natural-language or structured), produce affected repositories, services, APIs, and databases. *Likely the most impressive demo feature.* Example: "Add MFA authentication" → auth-service, frontend, mobile-app, notification-service. | Tech Lead (operate), Architect (validate) | F-103, F-104, F-105, F-106, F-107 |
| **F-111** | Incremental Sync | Event-driven update of the knowledge graph on git push, PR merge, Jira ticket update. Real projects change daily; without this, intelligence becomes stale. | Tech Lead (passive), Steward (admin) | F-101, F-007 |
| **F-112** *(v1.1)* | Documentation Ingestion | Ingest knowledge artifacts from documentation sources (Confluence, Notion, Google Drive, SharePoint). Surface as nodes in the unified Knowledge Graph (F-115). *(Knowledge Center expansion.)* | Tech Lead (operate), Steward (admin) | F-007 (F-015) |
| **F-113** *(v1.1)* | Communication Ingestion | Ingest threads and decisions from communication sources (Slack, Teams, Email, Zendesk) into the Knowledge Graph — without storing message bodies unless explicitly configured. *(Knowledge Center expansion.)* | Tech Lead (operate), Steward (admin) | F-007 (F-015) |
| **F-114** *(v1.1)* | Asset Ingestion | Ingest design and operational assets (PDF, Figma diagrams, AWS infrastructure metadata) into the Knowledge Graph as nodes linked to services, repos, or ADRs. *(Knowledge Center expansion.)* | Tech Lead (operate), Steward (admin) | F-007 (F-015) |
| **F-115** *(v1.1)* | Unified Knowledge Graph | Single graph spanning repositories (F-101–F-104), documentation (F-112), communication (F-113), and assets (F-114). Cross-source traversals enabled (e.g., "show me the ADR for this Jira ticket → and the service it touches → and the deployment that depends on it"). *(The killer feature — Graphiti / Neo4j / Mem0 / CodeGraph-style visualization.)* | Tech Lead (consume), Architect (validate) | F-103, F-104, F-112, F-113, F-114 |

### 5.3 Phase 1 — Ideation Accelerator (v1.2 NEW — V1)

**The AI Product Management Workspace.** Where "what should we build" meets "what exists." Connected to Project Intelligence (Phase 0), Organization Knowledge (Foundation), Customer Feedback, and Technical Debt. The Tech Lead and product stakeholders work here, with configured agents (F-209) doing the heavy lifting of analysis, scoring, and draft generation. Approved ideation outputs push directly into the Architecture Accelerator (Phase 2).

> *Forge is not just an Ideation Agent — it is an AI Product Management Workspace connected to the project's knowledge graph, repositories, architecture, customer feedback, and KnackForge standards.*

**Sub-surfaces under Ideation:**
- Ideas (raw intake)
- Opportunities (scored)
- Customer Feedback (Zendesk, Jira, Support)
- Market Intelligence (research source)
- Tech Debt (SonarQube integration)
- Roadmap (Epic/Story grouping)
- Epic Generator (auto-grouping into epics)
- Story Generator (epic → stories → tasks)
- Architecture Impact (visual map of idea → affected systems)
- Approval Queue (governed)

| ID | Name | Description | Personas | Depends on |
|---|---|---|---|---|
| **F-201** *(v1.2)* | Idea Intake | Free-form text and structured input. Users enter ideas like "Add MFA Authentication," "Support SSO," "Reduce page load time." Optional intake template (problem, audience, hypothesis). | Tech Lead, Product stakeholders | F-007 (Connector Center) for customer feedback sources |
| **F-202** *(v1.2)* | Idea Analysis | Auto-analysis pulling from Project Intelligence (knowledge graph, repos, APIs, DBs, dependencies — Phase 0 FRs), Organization Knowledge (KnackForge Standards — F-001/F-002), Customer Feedback (Zendesk, Jira, Support via F-113), and Technical Debt (SonarQube integration). | Tech Lead (operate), Architect (validate) | F-101–F-115 (Phase 0), F-001/F-002, F-113 |
| **F-203** *(v1.2)* | Architecture Impact Graph | Visual mapping of an idea to affected services / repos / APIs / databases. **The connection point between Ideation and Project Intelligence.** React Flow / Cytoscape-driven; click any node to navigate. | Tech Lead (operate), Architect (validate) | F-103, F-104, F-115 |
| **F-204** *(v1.2)* | Opportunity Scoring | Multi-factor scoring per idea: Business Value, Complexity, Risk, Customer Demand, Technical Debt → composite Priority Score. Leadership-facing metric. Configurable weights per Project. | Tech Lead (configure), Product stakeholders (review), Delivery Sponsor (consume) | F-202, F-203 |
| **F-205** *(v1.2)* | Roadmap Generator | Auto-group ideas → Epics → Stories → Tasks. Honors dependencies, capacity hints, and target release windows. Editable. | Tech Lead (operate), Product stakeholders (review) | F-202, F-204 |
| **F-206** *(v1.2)* | PRD Generator | From an approved idea, generate a draft PRD following the same structure as BMad PRD authoring: Executive Summary, Problem, Solution, Requirements, NFRs, Success Metrics, Risks, Scope. **Forge becomes BMad-compatible by design.** | Tech Lead (operate), Product stakeholders (review) | F-001, F-202, F-203, F-204 |
| **F-207** *(v1.2)* | Architecture Preview | Pre-approval impact visualization: Repositories Impacted, Services Impacted, APIs Impacted, Database Changes, Estimated Effort, Risks. *The differentiator — most AI tools generate stories; Forge shows consequences.* | Tech Lead (consume), Architect (validate), Delivery Sponsor (oversight) | F-203, F-204 |
| **F-208** *(v1.2)* | Ideation Knowledge Graph | Visual node graph (React Flow / Cytoscape): Customer Request → Epic → Story → ADR → Repository → Service. Click any node to navigate to the underlying artifact. | Tech Lead (consume), Product stakeholders (review) | F-115 |
| **F-209** *(v1.2)* | Ideation Agent Selection | Per-ideation-task agent configuration: Ideation Agent / Provider / Fallback / Research binding / Company Standards binding. **First end-to-end demonstration of Agent Center working.** | Tech Lead (configure), Steward (admin) | F-011, F-012, F-013, F-014 |
| **F-210** *(v1.2)* | Realtime Ideation Workflow | WebSocket-driven progress for analysis / scoring / generation: "Analyzing Repositories ████████░░ 80%" → "Analyzing APIs ██████░░░░ 60%" → "Generating Epic ██████████ 100%" → "Generating Stories ██████░░░░ 60%." | Tech Lead (operate) | F-014 (Agent Runtime Adapter) |
| **F-211** *(v1.2)* | Ideation Output Bundle | Standard approved-output package: Business Case + Epic + Stories + Architecture Impact + Risk Assessment + Effort Estimate + Affected Repositories + Affected Services + Affected APIs + ADR Draft + PRD Draft + Roadmap Placement. | Tech Lead (assemble), Architect (approve) | F-205, F-206, F-207 |
| **F-212** *(v1.2)* | Approval Queue | Review/approve ideation output. Uses the same governance boundary machinery (NFR-032, §4.5) as Architecture Accelerator. Distinct state machine if needed (e.g., draft → under_review → approved → pushed-to-delivery). | Tech Lead (submit), Architect / Product Lead (decide) | F-006, F-003, NFR-032 |
| **F-213** *(v1.2)* | Push to Delivery Systems | On approval, push the Ideation Output Bundle to Jira (epics/stories), Confluence (PRD draft + Architecture Preview), and the Architecture Accelerator (Phase 2, F-301–F-310) for downstream propagation. | Tech Lead (operate), Steward (admin) | F-211, F-212 |

**Artifact state machine (Ideation output and any artifact using F-212):**

```
draft → under_review → approved → pushed-to-delivery
                     ↘ rejected (with rationale; may return to draft)
                     ↘ changes_requested (returns to draft with reviewer notes)

approved → superseded (only by a new approved version; pushes a new bundle to delivery systems)
```

This is the same boundary machinery as Phase 2 Architecture Accelerator; reuse §5.4 cross-boundary invariants.

### 5.4 Phase 2 — Architecture Accelerator (renumbered v1.2)

Converts an approved requirement (typically sourced from Ideation F-211) into a governed architecture package. The Tech Lead drafts; the Architect approves.

**Artifact state machine (Phase 2 artifacts and any artifact using F-305 / F-306):**

```
draft → under_review → approved
                     ↘ rejected (with rationale; may return to draft)
                     ↘ changes_requested (returns to draft with reviewer notes)

approved → superseded (only by a new approved version per F-307)
```

**`draft` and `approved` are distinct, immutable at the version level once `approved`.** The approval gate (NFR-032) operates on transitions out of `draft` — no background process may write `approved`. Cross-boundary transitions require the human approver named by F-005 + F-006. Audit rows reference the artifact *version*, not the artifact; this is the lineage hook for right-to-erasure tombstoning (see NFR-002 + NFR-020 in §6).

| ID | Name | Description | Personas | Depends on |
|---|---|---|---|---|
| **F-301** | ADR Generation | Given an approved requirement (often from F-211 Ideation Output Bundle), generate a typed Architecture Decision Record. Consumes context (see F-309). | Tech Lead (operate) | F-001, F-002, F-309, F-010, F-211 |
| **F-302** | API Contract Generation | From an approved ADR, generate an API contract artifact. Linked to the source ADR. | Tech Lead (operate) | F-301 |
| **F-303** | Task Breakdown Generation | From an approved ADR, generate a task breakdown artifact consumable by future Phase 3 (Development Accelerator). | Tech Lead (operate) | F-301 |
| **F-304** | Risk Register Generation | From an approved ADR, generate a risk register artifact. Risks linked back to ADRs and to project context (Phase 0). | Tech Lead (operate) | F-301, Phase 0 (F-103, F-104) |
| **F-305** | Approval Workflow | Tech Lead submits package → Architect reviews → approve / request-changes / reject. State machine governed by F-003 / F-006. | Tech Lead (submit), Architect (decide) | F-006, F-003 |
| **F-306** | Traceability | Every artifact references its source(s). Every downstream artifact (code patch, deployment) can be traced back to the originating requirement. Audit trail via F-005. | Tech Lead (consume), Architect (validate), Delivery Sponsor (oversight) | F-005, F-010 |
| **F-307** | Versioning & Supersession | ADRs and derived artifacts have versions; new versions can supersede prior versions with explicit rationale. Snapshot diff via F-109. | Tech Lead + Architect | F-010, F-109 |
| **F-308** | Standards Attestation | Every generated artifact carries an attestation of which standards (F-001) it complies with and which are flagged for review. Anti-`Human Override Rate` signal. | Architect (consume), Steward (configure) | F-001, F-005 |
| **F-309** | Context-Aware Architecture Generation | Architecture generation MUST consume *requirement + project knowledge graph (Phase 0) + applicable standards (F-001)* — not the requirement alone. *Key differentiator: Forge does not generate architecture in a vacuum.* | Tech Lead (operate), Architect (validate) | F-001, Phase 0 (F-103, F-104, F-110), F-211 (Ideation Output Bundle) |
| **F-310** | Acceptance Criteria Package | Functional criteria, non-functional criteria, validation rules. Provides a Definition of Done that downstream phases (Phase 3+) can execute against. *"Development cannot start from architecture alone."* | Tech Lead (operate), Architect (validate) | F-301, F-302 |

### 5.5 Out-of-V1 capability phases (renumbered v1.2, **v1.3 — Phase 3 GSD-powered**)

- **Phase 3 — Development Accelerator (GSD-Core powered, v1.3):** code patches, unit-test scaffolds, review packages, standards-compliance attestations at the code level. **Powered by [Open GSD](https://www.opengsd.net/) as the default Development Execution Framework** (Pillar 5). Forge extends `gsd-core` (Plan/Execute/Verify/Ship), `gsd-pi` (Milestones/State/Context/Execution), and `gsd-workbench` concepts with multi-tenancy, project intelligence, organization knowledge, governance, audit, and enterprise integrations. Universal hook orchestration via F-017 spans every supported runtime (Claude Code, Codex, Gemini CLI, GSD Core, etc.).
- **Phase 4 — Security + QA Accelerator:** security reports, OWASP, IaC validation, integration / E2E, release readiness.
- **Phase 5 — Modernization / Refactor Accelerator:** legacy migration plans, target architecture, modernization workflows. *Renamed from "Modernization" to "Modernization / Refactor" in v1.3 to align with Master Charter's "Refactor Accelerator" product line.*
- **Phase 6 — Delivery Orchestration Accelerator:** end-to-end workflow with audit.

Foundation + Phase 0 + Phase 1 (Ideation) + Phase 2 (Architecture) constitute a fundable, demoable, pilotable V1 without depending on these.

### 5.6 Out-of-V1 capability phases (for traceability only — explicitly NOT in V1) *(v1.3 — fixed duplicate numbering; was incorrectly labeled §5.4)*

The capability phases below are explicitly out of V1 and remain so until Phase 2 (Architecture Accelerator) is pilot-validated. No FRs are added at the PRD layer for these phases — they earn their place after V1 pilot metrics justify the investment.

- **Phase 2 — Development Accelerator:** code patches, unit-test scaffolds, review packages, standards-compliance attestations at the code level.
- **Phase 3 — Security + QA Accelerator:** security reports, OWASP, IaC validation, integration / E2E, release readiness.
- **Phase 4 — Modernization Accelerator:** legacy migration plans, target architecture.
- **Phase 5 — Delivery Orchestration Accelerator:** end-to-end workflow with audit.

Foundation + Phase 0 + Phase 1 constitute a fundable, demoable, pilotable V1 without depending on these.

---

## 6. Non-Functional Requirements

NFRs grouped by domain. Numerical targets carry the same `[TO BE VALIDATED DURING PILOT]` posture as Section 3 unless explicitly locked. **Foundational architecture constraints** (named at the end) flow into downstream ADRs as fixed decisions.

### 6.1 Security & Compliance

| ID | Requirement | Notes |
|---|---|---|
| **NFR-001** | SOC2-ready controls | Audit logging (F-005), access reviews, change management. **Controls designed for certification, NOT certified** at V1. SOC2 Type I / Type II timing deferred. |
| **NFR-002** | GDPR-ready data handling | Data subject rights (access, rectification, erasure, portability), lawful basis, breach notification posture, **Forge as sub-processor of customer data with documented sub-processor list and Data Processing Addendum (DPA) commitments**, **72-hour breach notification to controllers**. Per-tenant data isolation (NFR-006). |
| **NFR-002a** | Right-to-erasure tombstoning | GDPR Article 17 erasure is achieved by *tombstoning* the artifact (status → `erased`); the artifact row remains in storage for audit but its content is removed from query and display paths. **Audit log (NFR-020) is preserved** — audit rows survive erasure because they reference the artifact *version*, not the artifact content, and are exempted under GDPR Article 17(3) for legal-obligation / public-interest reasons. Tombstoning pattern documented for Architecture ADR. |
| **NFR-003** | Encryption | In transit (TLS 1.2+); at rest (industry-standard AES); backup encryption; log encryption; internal service-to-service (mTLS). Key management via cloud KMS. |
| **NFR-004** | Identity & SSO | SSO via OIDC / SAML (required at V1); SCIM for user provisioning (`[V1-OPTIONAL]` SCIM at V1). |
| **NFR-004a** | MFA | **Required** for all users with approval-gate or Steward privileges at V1. SSO-only users without approval authority are exempt. |
| **NFR-004b** | Access-review cadence | Privileged roles (Steward, Architect, Approver) reviewed **quarterly**; documented evidence retained for audit. |
| **NFR-005** | Secrets handling | No secrets in logs; secrets stored in a managed vault; rotation supported. |
| **NFR-034** | Data minimization & retention | Connector ingestion (F-007) commits to: ingest only data needed for the named purpose (project intelligence, knowledge graph, traceability); retain only as long as the engagement is active plus a configurable retention window (default `[TO BE DECIDED]`, target ≤ 90 days post-engagement for raw ingested content); provide tenant-controlled deletion. **No silent re-purposing of ingested data for model training or unrelated analytics.** |
| **NFR-035** | Pen-testing cadence | Pre-pilot pen-test (NFR-007 baseline) plus **annual** external pen-test thereafter. Findings tracked; critical/high resolved before next pilot phase. |

### 6.2 Multi-tenancy & Data Governance

| ID | Requirement | Notes |
|---|---|---|
| **NFR-006** | Per-tenant isolation | **Organization Knowledge Layer is shared (read-only across tenants, Steward-controlled publishing). Project Intelligence Layer is per-tenant, fully isolated.** Architectural strength; never mix customer knowledge graphs. |
| **NFR-007** | No cross-tenant data leakage | Enforced at query layer + storage layer. Pen-test required pre-pilot. |
| **NFR-008** | Data residency | Single-region at V1. Multi-region support deferred. `[TO BE DECIDED]` if commercial path requires residency controls. |

### 6.3 Performance & Scale

| ID | Requirement | Notes |
|---|---|---|
| **NFR-009** | Concurrent workflows | Support **100+ concurrent governed workflows** at V1 (relaxed from earlier 1000+ draft — V1 users are KnackForge internal, not 10,000 enterprise users). `[TO BE VALIDATED DURING PILOT]` |
| **NFR-010** | Project intelligence ingestion | Baseline: 10–20 repos ingested to a queryable knowledge graph within 24h. `[TO BE VALIDATED DURING PILOT]` |
| **NFR-011** | Impact analysis latency | Median p50 `[TO BE MEASURED]`; p95 `[TO BE MEASURED]`. `[TO BE VALIDATED DURING PILOT]` |
| **NFR-012** | Approval latency | Approval workflow decisions surface in ≤ `[TO BE MEASURED]` seconds end-to-end. `[TO BE VALIDATED DURING PILOT]` |

### 6.4 Reliability & Availability

| ID | Requirement | Notes |
|---|---|---|
| **NFR-013** | Availability | 99.9% target for the governed workflow path. `[TO BE VALIDATED DURING PILOT]` |
| **NFR-014** | Disaster recovery | **RPO ≤ 24 hours; RTO ≤ 4 hours** for V1. Backups daily minimum; tested quarterly. |
| **NFR-015** | Brownfield graceful degradation | Ingestion or sync failures do not block governed workflow operations. Knowledge graph may be partially stale; system explicitly signals staleness (NFR-031). |
| **NFR-033** | Partial Discovery Tolerance | Project Intelligence shall remain usable even when some repositories, connectors, or documentation sources are unavailable. *Real projects will have flaky integrations; PI must not collapse.* |

### 6.5 Integration & Interoperability

| ID | Requirement | Notes |
|---|---|---|
| **NFR-016** | Connector contract | All F-007 connectors conform to a uniform contract: auth, rate-limit handling, pagination, event subscription, idempotent re-sync. |
| **NFR-017** | Webhook + polling fallback | Each connector supports webhook-driven updates (preferred) with polling fallback for systems that lack webhooks. |
| **NFR-018** | API surface | Public, versioned REST API for artifact read/write (subject to F-004 RBAC). OpenAPI spec maintained. |
| **NFR-019** | Export | All artifacts exportable in human-readable + machine-readable formats (Markdown + JSON / YAML). |
| **NFR-027** | Connector SDK target | New connectors implementable in **3–5 engineer-days** by a competent engineer. *Locked target — prevents connector sprawl.* |

### 6.6 Auditability & Observability

| ID | Requirement | Notes |
|---|---|---|
| **NFR-020** | Audit immutability | Audit log (F-005) is append-only. Tamper-evident (signed entries or equivalent). |
| **NFR-021** | Structured logging | Every request, gate decision, and connector call emits structured logs with trace IDs. |
| **NFR-022** | Metrics & dashboards | Per-tenant + global. Dashboards cover TTTD, predictability, gate pass/skip/override, counter-metrics (Section 3). |
| **NFR-023** | Trace propagation | Distributed traces across web → workflow engine → connector calls. |

### 6.7 Maintainability & Operability

| ID | Requirement | Notes |
|---|---|---|
| **NFR-024** | Deployability | Single-command deployment to a target environment; zero-downtime deploys. |
| **NFR-025** | Configuration via code | Environment-specific config in code, not in dashboards. Twelve-factor posture. |
| **NFR-026** | Tenant onboarding | New tenant onboarding is automated (provision org, seed defaults from F-001 / F-002); manual steps documented but minimal. |

### 6.8 AI Governance

| ID | Requirement | Notes |
|---|---|---|
| **NFR-029** | Agent Runtime Portability *(upgraded v1.1)* | Forge is portable across agents at runtime, not just across models. The application never hard-codes a specific agent's identity, tool surface, or output shape. Agents (Claude Code, Codex, Gemini CLI, Aider, Kiro, Hermes, OpenHands, Cursor Agent, custom) plug in via the Agent Runtime Adapter (F-014). *Forge's value is not tied to a specific agent OR a specific model. Adding or swapping an agent does not require workflow changes.* |
| **NFR-030** | Cost Controls | Per-tenant token usage, model spend, workflow cost, and budget thresholds tracked and enforceable. *One badly designed ingestion can burn thousands of dollars.* |
| **NFR-031** | Knowledge Freshness | The system explicitly indicates freshness of PI artifacts and knowledge graph nodes (e.g., "Repository Graph Last Updated: 2 hours ago"). Surfaces staleness rather than hiding it. |
| **NFR-032** | Human Governance Enforcement | **No workflow may transition across defined governance boundaries without required human approvals.** *Protects the entire Forge philosophy.* Governance boundary defined in §4.5; specific boundaries per workflow are Steward-authored via F-003. |

### 6.9 Accessibility

| ID | Requirement | Notes |
|---|---|---|
| **NFR-028** | WCAG 2.1 AA | Admin UI (F-008) and Tech Lead / Architect / Delivery Sponsor surfaces meet WCAG 2.1 AA. |

### 6.10 Out-of-V1 NFRs (named for traceability)

- Multi-region active/active deployment
- Customer-managed encryption keys (BYOK)
- Offline / air-gapped deployment
- White-labeling
- Federated identity across customer IdPs (commercial path)
- SOC2 Type I / Type II certification (controls-ready only at V1)
- Cost Attribution / Chargeback
- Agent Marketplace
- Custom Customer Methodologies
- Multi-Organization Federation

### 6.11 Foundational architecture constraints (for downstream ADRs)

These are not implementation details — they are fixed decisions that flow into Architecture ADRs:

- **Shared Organization Knowledge Layer** (Steward-controlled cross-tenant publishing)
- **Per-Tenant Project Intelligence Layer** (full isolation)
- **Human Approval Gates** (no autonomous cross-boundary transitions)
- **Audit Immutability** (append-only, tamper-evident)
- **Model Provider Independence** (multi-provider abstraction)
- **Cost Governance** (per-tenant budgets + enforcement)
- **Knowledge Freshness** (explicit staleness signals)
- **SOC2-Ready Controls** (designed for certification, not certified)

### 6.12 Architecture substrate boundary

The PRD commits to *what* must be true of the system (the constraints above and the FRs in §5). It does **not** prescribe the substrate that delivers those properties. The following are explicitly the responsibility of Architecture ADRs to invent and document, not the PRD:

- **Knowledge graph substrate characteristics** — Neo4j, PostgreSQL + Apache AGE, PostgreSQL graph tables, GraphRAG, or hybrid. *Tracked as OQ-006.*
- **Source-of-truth conflict resolution policy** — when Jira / Confluence / GitHub / Code disagree, which wins, by what precedence. *Tracked as OQ-007.*
- **"Governance boundary" formal definition** — the set of state transitions that require human approval (NFR-032). The PRD names the *invariant* (no autonomous transitions); Architecture defines the *boundary*. *(See artifact state machine in §5.3 as the starting shape.)*
- **Per-tenant isolation enforcement points** — query layer, storage layer, connector layer, or all three; how verified (pen-test, automated tests, runtime monitoring).
- **Audit-log tamper-resistance beyond signed entries** — WORM / Object-Lock storage, hash-chained entries, externally-anchored signing, or runtime tamper-detection monitoring.
- **Connector failure-mode primitives** — how connectors signal partial / stale / unavailable, and how downstream (F-108, F-110, F-111) reacts.
- **Cost and freshness ledger substrate** — per-tenant, per-workflow cost attribution and freshness tracking. PRD names the *invariant* (NFR-030, NFR-031); Architecture invents the storage shape.
- **Right-to-erasure tombstoning mechanism** — physical implementation of NFR-002a.

M1's substrate (F-001 / F-002 / F-004 / F-005 / F-006 / F-010) must be designed against this boundary so M3–M7 don't require re-platforming. This is the Architecture ADR portfolio that the M1 build sequencing implies.

---

## 7. Open Questions / Assumptions / Out-of-Scope

This section lists the items that **block downstream phases** (UX, architecture, epics) and the items that don't. Phase-blockers must be resolved before Finalize; non-blockers are deferred with owner and revisit condition.

### 7.1 Phase-blockers (must resolve before Architecture / Epics)

| ID | Question | Why it blocks | Owner | Resolution path |
|---|---|---|---|---|
| **OQ-001** | Pilot project identification (repo, customer engagement, timeline) | Cannot establish baseline metrics, cannot scope pilot scope or success criteria | Engineering Excellence | Pilot Plan document (separate) |
| **OQ-002** | `TTTD` baseline measurement methodology | Cannot set directional improvement targets without knowing how the metric is computed on day one | Engineering Excellence + Pilot TL | Decide alongside OQ-001 |
| **OQ-003** | Specific percentage targets for any metric | Per Section 3.5, no numbers committed until baseline exists. *Locked decision — not a blocker, just a revisit condition.* | Steward + Delivery Sponsor | Pilot kickoff + 4 weeks of baseline data |
| **OQ-004** | Commercial pricing posture | Determines V1/V2 feature priorities and bundle structure | Commercial / Practice Lead | Strategic Phase B document (separate) |
| **OQ-005** ✅ **RESOLVED v1.3** | V1 deployment model (cloud / self-hosted / hybrid) | Drives NFR-008 (data residency), NFR-024 (deployability), cost model | Engineering Excellence + Delivery Sponsor | **ADR-001 (Accepted): Cloud-Only (AWS) at V1.** Self-hosted and hybrid explicitly deferred to Strategic Phase B. See `decisions/ADR-001-deployment-topology.md`. |
| **OQ-006** ✅ **RESOLVED v1.3** | Knowledge Graph strategy (single graph engine vs. federated; Neo4j vs. PostgreSQL+AGE vs. PostgreSQL graph tables vs. GraphRAG vs. hybrid) | *Not an implementation detail.* Affects F-103, F-104, F-110 estimation, multi-tenancy, and cost. | Engineering Excellence + Architect | **ADR-002 (Accepted): PostgreSQL 17 + Apache AGE.** Co-located graph + relational + vector (pgvector) in a single database engine; RLS applies to all. NetworkX offload for complex algorithms. Satisfies A-007 (single graph engine). See `decisions/ADR-002-graph-substrate.md`. |
| **OQ-007** ✅ **RESOLVED v1.3** | Source-of-truth hierarchy when systems disagree (Jira / Confluence / GitHub / Code). *Example: Jira says Cognito, code says Keycloak.* | Forge must have a documented policy before architecture can resolve conflicts. | Architect + Steward | **ADR-003 (Accepted): Hybrid MDM + Steward-Editable Priority Policy.** Default priority: code > CODEOWNERS > code (API/DB) > Jira > Confluence > AWS/SonarQube > explicit human override. Conflicts flagged, never silently auto-merged. Steward resolves via Governance Center UI. NFR-032 compliant. See `decisions/ADR-003-source-of-truth-conflict-policy.md`. |
| **OQ-008** | V1 connector scope | Required: GitHub, Bitbucket, Jira, Confluence. Optional: Slack, Figma, Zendesk, Databricks, Azure DevOps. *Without this, UX, Architecture, and Phase 0 cannot proceed.* | Engineering Excellence | Before Architecture Phase |
| **OQ-009** | P1.5 Architecture Validation Rubric | §8.2 exit criterion "≥80% accepted without major correction" needs a rubric — severity tiers, reviewer roles, dispute resolution. *The gate that prevents "8 weeks measuring a wrong system" must itself be operationalized.* | Pilot TL + Architect | Pilot Plan rubric authored before P1 |

### 7.2 Open assumptions (recorded for traceability)

| ID | Assumption | Where it appears | If wrong, impact |
|---|---|---|---|
| **A-001** | Pilot is brownfield-first (10+ repos baseline) per the brief | Section 3.3, Section 5 (Phase 0 FRs) | Greenfield-pilot would de-scope F-102 / F-103 / F-104 ingestion volumes; FR structure unchanged. |
| **A-002** | V1 budget = Innovation / Engineering Excellence, not product revenue | Section 1.4 (decision log) | If commercial path is forced earlier, pricing posture (OQ-004) becomes a blocker. |
| **A-003** | Identity provider is cloud-IdP-friendly (OIDC / SAML) for SSO | NFR-004 | If self-hosted IdP required, add SCIM + federation scope. |
| **A-004** | **Project = Customer Engagement = Tenant.** Hierarchy: **Organization → Project → Repository**. No internal sub-Project layer in V1. *(KnackForge's reality — CMC, GAPI, Honeywell — is one engagement per customer with many repos; an internal Project layer would be theoretical, not load-bearing.)* | NFR-006, multi-tenancy model, addendum domain model | If a customer later has multiple distinct workstreams, the model extends to insert a sub-Project level. The simpler V1 hierarchy is the safe default. |
| **A-005** | Webhooks available for primary source-control and ticketing systems | NFR-017 | If polling-only for some connectors, document fallback in NFR-027 (Connector SDK target). |
| **A-006** | Standard cloud KMS suffices for encryption key management | NFR-003 | If BYOK required by enterprise customers, BYOK moves from out-of-V1 to in-V1. |
| **A-007** | Knowledge graph storage is a single graph engine, not federated | F-103, F-104, F-110 | If federated (per-source sub-graphs), NFR-007 (no cross-tenant leakage) becomes harder to enforce; model needs federation-aware query layer. *Now linked to OQ-006.* |
| **A-008** | **Organization Knowledge is curated manually during V1.** The Steward creates standards, templates, and policies — Forge is the substrate, not the source. | F-001, F-002, F-003, F-010 | If V1 commits to AI-suggested standards, scope grows materially and Steward workflow changes. |

### 7.3 Out-of-Scope (V1 explicit)

Beyond the out-of-V1 capability phases (Section 5.4) and out-of-V1 NFRs (Section 6.10):

- **Replacing software engineers, architects, or delivery processes** (per brief, verbatim).
- **Autonomous software delivery** — humans remain in the loop at every governance boundary.
- **Replacing Jira / GitHub / Confluence** — Forge integrates, does not displace.
- **100% automation** — partial coverage is acceptable at V1.
- **A bake-off against coding agents** (Cursor, Claude Code, Copilot, Kiro) — different value proposition.
- **Production code generation without human review** — never in scope, by philosophy (NFR-032).
- **Customer-managed encryption keys (BYOK)** at V1.
- **Multi-region active/active** at V1.
- **Custom customer methodologies** at V1 — methodology is KnackForge-standardized at V1.
- **Multi-organization federation** at V1.
- **Real-time autonomous repository modification without human approval.**
- **Automatic production deployment without deployment approval gates.**

### 7.4 Non-blockers (deferred with owner + revisit condition)

| ID | Item | Owner | Revisit condition |
|---|---|---|---|
| **N-001** | Specific ROI model and capacity planning | Practice Lead / Finance | Strategic Phase B + commercial pricing decision |
| **N-002** | Database schema, folder structure, internal ADRs (beyond OQ-005 / OQ-006 / OQ-007) | Architecture | ADR-0002 and onward |
| **N-003** | Pilot ops runbook (incident response, on-call, SLO breach handling) | Pilot TL | Pilot kickoff − 2 weeks |
| **N-004** | Specific UI design (admin, TL workspace, Architect review) | UX (next artifact) | After PRD sign-off |
| **N-005** | Connector roadmap *beyond* the V1 required set (Bitbucket / GitLab / Azure DevOps / Databricks / Zendesk / Figma / Slack) | Steward | V1 retrospective |
| **N-006** | Marketing / launch positioning for commercial path | Commercial | Strategic Phase B |
| **N-007** | Connector SDK realism audit | NFR-027 target (3–5 engineer-days) may underestimate Bitbucket Cloud/Server, GitHub Apps/PAT, Jira REST versions, Confluence Cloud/DC complexity. Architecture ADR validates per connector during M2. Target holds or adjusts before M3. | Architecture | M2 → M3 transition |

---

## 8. Implementation & Pilot Phasing

This section makes the PRD *executable* — it converts decisions into build order, pilot phases, rollout sequence, validation timing, adoption signals, and the canonical demo path. Phasing is explicit because the brief left it implicit.

### 8.1 V1 build phasing — Four V1 packages (v1.2)

**v1.2 framing:** Forge ships as **four V1 packages** — Foundation, Project Intelligence, **Ideation** (NEW v1.2), and Architecture Accelerator. Each is independently demoable and pilotable. Together they constitute a fundable, demoable, pilotable V1. Development Accelerator (Phase 3), Security + QA Accelerator (Phase 4), Modernization Accelerator (Phase 5), and Delivery Orchestration Accelerator (Phase 6) remain explicitly out of V1.

**UI-first principle:** Forge is a Web Platform first (§8.7). Each milestone below delivers a working UI surface *with* its backend capability — not backend-only. The headline first demo is **Project Intelligence UI** (M3), not architecture generation.

**Forge flow (v1.2):** Project Intelligence (Phase 0) → **Ideation (Phase 1, NEW V1)** → Architecture (Phase 2) → Development (Phase 3, OOV) → Testing (Phase 4, OOV) → Security (Phase 4 sibling, OOV) → Deployment (Phase 5, OOV).

---

#### Package 1 — Forge Foundation

The substrate everything else lives on. Includes the Agent Center (v1.1) — Forge's orchestration layer for external agents.

| Milestone | Capability + UI surface | Why this order | First demoable artifact |
|---|---|---|---|
| **M1** | **Foundation core** (F-001, F-002, F-004, F-005, F-006, F-010). Admin UI shell. | Standards + Templates + RBAC + Audit + Approval + Artifact Registry are the substrate. | Steward publishes a sample standard and template; audit row appears. |
| **M2** | **Foundation connectors + Agent Center + Connector Center shells** (F-007, F-008, F-011, F-012, F-013, F-014, F-015). **Organization Knowledge UI** (Coding/Security/ADR/Review/Deployment/Testing Standards + Governance Rules) — "KnackForge DNA." **Agent Center UI** (Settings → Agents → Development Agents, Model Providers, Agent Assignment). **Connector Center UI** (Engineering, PM, Documentation, Cloud, Communication). | The Steward wires systems of record, registers agents and model providers, configures assignments. *Every agent and every connector Forge touches is configured here.* | A connector (GitHub) is registered; the Agent Center shows Claude Code + Codex available; Tech Lead assigns "Architecture → Claude Code." |

---

#### Package 2 — Project Intelligence (+ Knowledge Center)

The Tech Lead's primary productivity surface. Foundation's agents run inside this package once M3 lands.

| Milestone | Capability + UI surface | Why this order | First demoable artifact |
|---|---|---|---|
| **M3** | **Phase 0 Project Intelligence Core** (F-101, F-102, F-103, F-104). **Project Intelligence UI** (Repositories, APIs, Databases, Services, Knowledge Graph). | Tech Lead can ingest a real project and ask "what does this codebase do?" — **the headline first demo**. *(Renamed from "Repository Intelligence" — leadership cares about Project Understanding, not repositories.)* | Architecture Discovery + Dependency Graph produced for one reference project; rendered as a clickable, navigable Knowledge Graph in the UI. **First Aha Time validated here.** |
| **M4** | **Phase 0 catalogs + Q&A** (F-105, F-106, F-107, F-108). Service Catalog + Impact Analysis view. | Once services and dependencies are inferred, catalog them and let the Tech Lead query. | Service Catalog + API Catalog + DB Map available; Q&A answers a Tech Lead question; Impact Analysis surfaces affected services visually. |
| **M5** | **Phase 0 operations + Knowledge Center** (F-109, F-110, F-111, F-112, F-113, F-114, F-115). **Knowledge Center UI** (Documentation, Communication, Asset sources unified into the Knowledge Graph). | Snapshot + Impact Analysis + Incremental Sync complete the productivity story. Knowledge Center unifies repos + docs + comms + assets into a single graph. | Impact Analysis: "Add MFA authentication" surfaces affected services in UI; freshness indicators visible; clicking *Auth Service* shows User Service, Login API, Database, ADR-120, Jira-456, Repo, Deployment — all linked. **The killer feature.** |

---

#### Package 3 — Ideation (NEW v1.2 — AI Product Management Workspace)

Where "what should we build" meets "what exists." Connected to Project Intelligence, Organization Knowledge, Customer Feedback, and Tech Debt. The Tech Lead and product stakeholders work here; configured agents (F-209) do the analysis and drafting. Approved bundles push directly to Architecture Accelerator (Phase 2).

| Milestone | Capability + UI surface | Why this order | First demoable artifact |
|---|---|---|---|
| **M6** | **Phase 1 Ideation Core** (F-201, F-202, F-203, F-204, F-208). **Ideation Center UI** (Ideas, Opportunities, Customer Feedback, Tech Debt, Architecture Impact). | Once the project's knowledge graph exists (M5), the Tech Lead and PM can submit ideas and see the impact *instantly*. *The connection point between Ideation and Project Intelligence.* | Idea Intake → Idea Analysis → Architecture Impact Graph visible in UI; Opportunity Scoring produces a Priority Score. |
| **M7** | **Phase 1 Ideation Generation + Agent Configuration** (F-205, F-206, F-207, F-209, F-210, F-211). **Roadmap Generator, PRD Generator, Architecture Preview**, **Realtime Ideation Workflow**. **Ideation Agent Selection** (per-task agent binding via Agent Center). | Once ideas can be analyzed and scored, the platform can generate the artifacts downstream teams consume (Epics, Stories, PRD drafts, Architecture Previews). | A Tech Lead types "Add MFA Authentication"; the Realtime Ideation Workflow shows live progress; the PRD Generator produces a draft PRD matching BMad structure; Architecture Preview shows affected repositories / services / APIs / database changes / estimated effort / risks. |
| **M8** | **Phase 1 Ideation Approval + Push to Delivery** (F-212, F-213). **Approval Queue UI** + push to Jira / Confluence / Architecture Accelerator. | Approval closes the loop; Push propagates the bundle downstream. *Phase 2 Architecture Accelerator receives a structured bundle, not a free-form ticket.* | An approved Ideation Output Bundle pushes to Jira (epics + stories), Confluence (PRD draft + Architecture Preview), and the Architecture Accelerator (Phase 2) — where F-301 ADR Generation runs against the bundle. |

---

#### Package 4 — Architecture Accelerator

Where the Tech Lead's Agent Center configuration (M2) starts to *do* things on Ideation-approved inputs: configured agents run governed workflows end-to-end.

| Milestone | Capability + UI surface | Why this order | First demoable artifact |
|---|---|---|---|
| **M9** | **Phase 2 generation core** (F-301, F-302, F-303, F-304). Architecture UI surface (ADRs, API Contracts, Risk Register). **Agent Center assignment is live here** — Architecture runs Claude Code, etc. | The configured agent (from M2) executes against the unified Knowledge Graph (M5) plus an approved Ideation Output Bundle (M8) to produce a governed package. *This is where the orchestration thesis is exercised end-to-end.* | A complete architecture package (ADR + API contract + task breakdown + risk register) produced for an approved requirement by the assigned agent, viewable in the Architecture UI. |
| **M10** | **Phase 2 governance + traceability + Agent Workflow Visualization** (F-305, F-306, F-307, F-308, F-309, F-310). Approval workflow UI + Audit Trail UI + **Agent Workflow Visualization** (React Flow / Cytoscape) — live view of agent orchestration as a graph (Ideation Bundle → Architecture Agent → ADR → Development Agent → PR → Security Agent → Approval). | Approval workflow + traceability + versioning complete the package. The Agent Workflow Visualization is the live view of what *just happened* — what agent, what model, what tools, what artifacts. | Architect approves a Phase 2 package end-to-end with full audit + traceability; the Agent Workflow Visualization animates the multi-agent orchestration; Audit Trail surfaces every transition with timestamp, actor, and rationale. |
| **M11** | **V1-Optional** (F-009 Governance Dashboard) + **Realtime Agent Dashboard** (V1-Optional / Phase 1.5) | Delivery Sponsor visibility + live multi-agent progress. *Deferred — Phase 1.5.* Build the engine first; build executive reporting and live multi-agent visualization second. **Realtime Agent Dashboard is CEO-demo material.** | Delivery Sponsor views TTTD, gate metrics, counter-metrics; when agents run, the Realtime Agent Dashboard shows live progress across multiple agents (Architecture Agent ████████░░ 80%, Codex Agent ██████░░░░ 60%, Claude Code ██████████ 100%). |

**Out-of-V1 UI surfaces** (named for traceability; surfaces in later phases per §5.5):
- **Development** (Tasks, PRs, Code Reviews) — Phase 3
- **Security** (Vulnerabilities, Compliance) — Phase 4
- **Testing** (Unit, Integration, E2E) — Phase 4
- **Deployment** (AWS, Kubernetes, Releases) — Phase 5

### 8.2 Pilot phasing

| Phase | Duration | Goal | Exit criteria |
|---|---|---|---|
| **P0 — Pre-pilot** | 4 weeks | Establish baseline measurements on TTTD and supporting metrics in the pilot tenant *without* Forge enabled (or with Forge in observe-only mode). | Baseline measurements recorded; pilot scope (engagement, repos) confirmed. |
| **P1 — Pilot kickoff** | 1 week | Enable Forge for the pilot tenant; instrument metrics; train Steward, Tech Lead, Architect on the workflows they own. | First artifact created in Forge by the pilot Tech Lead. |
| **P1.5 — Architecture Validation Gate** | 1–2 weeks | Validate Knowledge Graph, Impact Analysis, and ADR Generation outputs against senior engineers (e.g., pilot Tech Lead + pilot Architect reviewing side-by-side). | **≥ 80% of generated outputs accepted without major correction.** *Prevents spending 8 weeks measuring a system whose architecture output is fundamentally wrong.* |
| **P2 — Pilot execution** | 8–12 weeks | Run V1 in production with the pilot team. Capture directional improvement on TTTD + supporting metrics. Monitor counter-metrics for any anti-pattern (gate-skip, override spike). | Directional improvement shown; counter-metrics stable or improving; no governance regression. |
| **P3 — Pilot evaluation** | 2 weeks | Statistical review of directional improvement; decide whether to expand pilot, iterate, or hold. | Decision recorded; metric targets formalized for next phase. |
| **P4 — Pilot expansion** *(conditional)* | TBD | Expand pilot to additional engagements within KnackForge. *Only proceeds if P3 shows directional improvement without governance regression AND P1.5 acceptance holds in the new engagements.* | Two or more engagements operating on V1 concurrently. |

### 8.3 Rollout

```
Single Pilot (P0–P3)
        ↓ (if P3 green)
Multi-Engagement Rollout (P4)
        ↓ (after V1 stability demonstrated)
Practice Standard  ←  KnackForge uses Forge as the default delivery workflow
        ↓
Strategic Phase B — Commercial Path (deferred)
        ↓
V2 Capability Expansion (Phase 2–5, deferred)
```

**Why "Practice Standard" is its own stage:** Before Forge is sold externally, KnackForge must use Forge internally as the default delivery workflow. *"We use it ourselves"* is leadership framing that builds the case for commercial packaging.

**Commercial path (deferred to Strategic Phase B):**
- Bundle with delivery engagements vs. license standalone — pricing posture (OQ-004).
- Multi-region (NFR-008), BYOK (NFR-003 future), SOC2 certification (NFR-001 future).
- Agent Marketplace, Custom Customer Methodologies, Multi-Org Federation — all out-of-V1.

### 8.4 What gets validated when

| Artifact / target | Validated at |
|---|---|
| **Project Intelligence Accuracy** *(Architecture Discovery Coverage, Question Resolution Accuracy, Impact Analysis Accuracy)* | **End of M5** — catch PI failures early, before Phase 1 builds on a wrong foundation |
| **First Aha Time** *(headline UX success criterion — "the platform understood our project in minutes")* | **End of M3** — must be achievable at M3 to validate the headline UX promise before pilot kickoff |
| **Ideation Center Accuracy** *(Opportunity Scoring calibration, PRD Generator output quality vs. human-authored PRD)* | **End of M7** — validate before pilot kickoff that ideation outputs are usable downstream |
| TTTD baseline | End of P0 |
| P1.5 architecture validation (≥80% acceptance) | End of P1.5 |
| TTTD directional improvement | End of P2 |
| Specific % targets (any metric) | End of P3 (statistical review) |
| NFR-009 (concurrent workflows) — is 100+ right-sized? | End of P2 |
| NFR-010 (ingestion time) — is 10–20 repos in 24h achievable? | End of M5 demo |
| NFR-013 (99.9% availability) — is this right-sized for V1? | End of P3 |
| Counter-metrics (Section 3.4) — are any thresholds needed? | Continuous during P1–P3 |
| Pilot → multi-engagement decision | End of P3 |

### 8.5 Adoption signals (Delivery Sponsor metric)

V1 success is not just metric improvement — it's **delivery teams choosing to use it.** Adoption is monitored as a separate signal from raw throughput.

- **Active Tech Leads** per week — logged-in users with at least one artifact action.
- **Approval cycle completion rate** — % of approval requests that reach a decision within the SLA window.
- **Knowledge Reuse Rate** *(Section 3.3)* — directly measures whether the knowledge layer is working.
- **Human Override Rate trend** *(Section 3.4)* — early warning if trust is regressing.
- **Artifact Consumption Rate** — how many generated artifacts are actually *used* downstream (e.g., ADR generated → Task Breakdown generated → referenced during implementation). Measures artifact *utility*, not just generation volume.
- **Self-Reported Time Saved** — qualitative post-approval survey (0–25%, 25–50%, 50–75%, 75%+ buckets). Leadership signal *before* hard ROI exists.
- **First Aha Time** *(headline UX success criterion)* — time from a Tech Lead connecting a brownfield project to the moment they experience *"the platform understood our project in minutes."* Validated at end of M3. *This is the moment the headline demo promise is either real or it isn't. If it isn't achievable by M3, the demo script (8.6) is theater, and the broader adoption story follows.*

If adoption lags despite technical success, pilot evaluation flags it as a separate problem to investigate.

### 8.6 Demo Path — *Forge Demo Script v1.2*

Forge is an internal transformation initiative, not just a product. Every funding conversation, leadership review, architecture review, customer pilot, and commercial discussion will eventually be driven by the same demonstration. This section codifies that script so everyone stays aligned. *v1.2 updates the script to feature Ideation as the moment the demo lands — the user submits an idea, Forge turns it into a governed package end-to-end.*

**Canonical demo flow (target run-time: 25–35 minutes):**

1. **Open the Agent Center** — show that Forge is not "an agent" but a *control plane* for agents. Show Development Agents (Claude Code, Codex, Gemini CLI, Kiro, Hermes, Custom) and Model Providers (OpenAI, Anthropic, Gemini, Bedrock, Azure OpenAI, OpenRouter, Ollama, Vertex AI) registered. Show Agent Assignment: Architecture → Claude Code, Development → Codex, Testing → Gemini, Security → Claude, Deployment → Hermes. *Per-Project configuration.*
2. **Connect a brownfield project** (e.g., CMC). Wire GitHub + Jira + Confluence + Slack + Notion + Zendesk connectors via the Connector Center. Show ingestion in progress.
3. **Generate Project Intelligence.** Show the architecture map, service catalog, dependency graph, and API catalog populating for the ingested project — *rendered as a clickable, navigable Knowledge Graph*.
4. **Open the Knowledge Center.** Show Documentation, Communication, Asset sources unified into the same graph. Click *Auth Service* — show User Service, Login API, Database, ADR-120, Jira-456, Repository, Deployment, all linked.
5. **Ask an impact question:** *"Which repositories are affected by adding MFA authentication?"* Show the Q&A interface surfacing the answer.
6. **Generate Impact Analysis.** Show affected repositories, services, APIs, and databases — visibly tied to the knowledge graph.
7. **Open Ideation Center.** The user types: *"Add MFA Authentication"* (or "Support SSO" or "Reduce page load time"). The Realtime Ideation Workflow shows live progress: *Analyzing Repositories ████████░░ 80% → Analyzing APIs ██████░░░░ 60% → Generating Epic ██████████ 100% → Generating Stories ██████░░░░ 60%.*
8. **Architecture Impact Graph** displays the idea mapped to affected services / repos / APIs / databases.
9. **Opportunity Scoring** shows Business Value, Complexity, Risk, Customer Demand, Tech Debt → Priority Score.
10. **PRD Generator** produces a draft PRD matching BMad structure (Executive Summary, Problem, Solution, Requirements, NFRs, Success Metrics, Risks, Scope).
11. **Architecture Preview** shows affected repositories, services, APIs, database changes, estimated effort, risks — *the differentiator: most AI tools generate stories; Forge shows consequences.*
12. **Open the Realtime Agent Dashboard.** The configured Architecture Agent (Claude Code) starts running on the approved Ideation Output Bundle. Watch it: ████████░░ 80%. Then it completes.
13. **Generate the rest of the architecture package** — the configured Development Agent (Codex) generates API Contract + Task Breakdown; the Security Agent (Claude) generates Risk Register. All governed. All on the Audit Trail.
14. **Show Agent Workflow Visualization** (React Flow / Cytoscape) — Customer Request → Ideation → Epic → Architecture Agent → ADR → Development Agent → PR → Security Agent → Approval. Live. Animated. *Users see exactly what happened, why, which agent, which model, which tools, which artifacts.*
15. **Architect approves** the package. Show the approval workflow + human-in-the-loop transition.
16. **Show the audit trail** — every artifact create / approve / modify recorded with timestamp, actor, and rationale.
17. **Show counter-metrics:** gate-pass rate, override rate, knowledge reuse rate, multi-agent cost attribution for this session.

**Why this script:** Agent Center → Connector Center → Knowledge Graph (cross-source) → Impact Analysis → **Ideation → Multi-Agent Orchestration** → Approval → Audit Trail is the clearest expression of the entire Forge vision end-to-end. The *Ideation step is the moment leadership understands the product* — they type an idea, and Forge produces a governed, traceable, multi-agent-executed package. Every other capability in V1 supports this flow.

**Stewardship of the script:** Owned by the Steward (with input from the Architect). Reviewed quarterly. Revisions recorded in the decision log.

### 8.7 Platform Surfaces — UI-first Architecture (v1.1)

Forge is a **Web Platform first.** The UI is the product, not an optional surface. API access exists for integration (NFR-018) but is not the primary surface. This section captures the canonical platform surface so that Architecture, UX, and Epics share a single reference. *v1.1 adds Agent Center, Knowledge Center, and Connector Center as primary surfaces.*

**Reference architecture shape (v1.1):**

```
┌─────────────────────────────────────────────────────────┐
│                  Forge UI (Next.js)                     │
│                                                         │
│   Project Intelligence │ Architecture                   │
│   Knowledge Center     │ Agent Center                   │
│   Connector Center     │ Ideation                       │
│   Development          │ Security                       │
│   Deployment           │ Audit / Metrics                │
│   Administration       │                                │
└─────────────────────────────────────────────────────────┘
                       │  WebSocket (live updates)
                       ▼
┌─────────────────────────────────────────────────────────┐
│             Forge Orchestration Layer                   │
└─────────────────────────────────────────────────────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
  Agent Runtime   Knowledge       Connectors
   (Agents)       Intelligence    (MCP Layer)
                       │
                       ▼
                 Memory Layer
```

The **Forge Orchestration Layer** is the v1.1 control plane — it sits between the UI and the underlying capabilities (agents, knowledge graph, connectors), enforcing governance (NFR-032), audit (F-005), approval (F-006), and the artifact state machine (§5.3). The UI never calls an agent, knowledge source, or connector directly; it goes through Orchestration.

**Navigation structure (canonical, v1.1):**

```
Forge
├── Home
├── Project Intelligence
│    ├── Repositories
│    ├── APIs
│    ├── Databases
│    ├── Services
│    └── Knowledge Graph
├── Knowledge Center              ← v1.1
│    ├── Documentation
│    ├── Communication
│    ├── Assets
│    ├── Unified Knowledge Graph   (cross-source view)
│    └── Freshness Indicators
├── Agent Center                  ← v1.1 — most important page
│    ├── Development Agents        (Claude Code, Codex, Gemini CLI, Kiro, Hermes, Custom)
│    ├── Model Providers           (OpenAI, Anthropic, Gemini, Bedrock, Azure OpenAI, OpenRouter, Ollama, Vertex AI)
│    ├── Agent Assignment          (Architecture → Claude Code, Development → Codex, …)
│    └── Agent Runtime Status
├── Connector Center              ← v1.1 (expansion of F-007 → F-015)
│    ├── Engineering                (GitHub, Bitbucket, GitLab, Azure DevOps)
│    ├── Project Management         (Jira, Linear, Azure Boards, Monday)
│    ├── Documentation              (Confluence, Notion, Google Drive, SharePoint)
│    ├── Cloud                      (AWS, Azure, GCP, Kubernetes)
│    └── Communication              (Slack, Teams, Email, Zendesk)
├── Ideation                      ← v1.2 — AI Product Management Workspace
│    ├── Ideas
│    ├── Opportunities             (scored)
│    ├── Customer Feedback         (Zendesk, Jira, Support)
│    ├── Market Intelligence       (research source)
│    ├── Tech Debt                 (SonarQube)
│    ├── Roadmap                   (Epic/Story grouping)
│    ├── Epic Generator            (auto-grouping into epics)
│    ├── Story Generator           (epic → stories → tasks)
│    ├── Architecture Impact       (visual map of idea → affected systems)
│    ├── Approval Queue            (governed)
│    ├── Idea Knowledge Graph      (Customer Request → Epic → Story → ADR → Repo → Service)
│    └── Realtime Workflow         (WebSocket-driven progress)
├── Architecture
│    ├── ADRs
│    ├── API Contracts
│    └── Risk Register
├── Development       *(Phase 2 — out of V1)*
│    ├── Tasks
│    ├── PRs
│    └── Code Reviews
├── Security          *(Phase 3 — out of V1)*
│    ├── Vulnerabilities
│    └── Compliance
├── Testing           *(Phase 3 — out of V1)*
│    ├── Unit
│    ├── Integration
│    └── E2E
├── Deployment        *(Phases 3/5 — out of V1)*
│    ├── AWS
│    ├── Kubernetes
│    └── Releases
├── Audit
├── Metrics
└── Administration
     ├── Coding Standards
     ├── Security Standards
     ├── ADR Templates
     ├── Review Checklists
     ├── Deployment Standards
     ├── Testing Standards
     └── Governance Rules   ← "KnackForge DNA"
```

**Critical V1 surfaces (must ship, v1.1):**
- **Home** — landing dashboard for each persona
- **Project Intelligence** *(M3–M5)* — Repositories, APIs, Databases, Services, Knowledge Graph. **First demo, First Aha Time validated here.**
- **Knowledge Center** *(M5)* — Documentation, Communication, Asset sources unified into the Knowledge Graph. **The killer feature.**
- **Agent Center** *(M2)* — configure agents, model providers, and assignments. **The "Forge is a control plane" proof.**
- **Connector Center** *(M2)* — full marketplace across Engineering, PM, Documentation, Cloud, Communication.
- **Architecture** *(M9–M10)* — ADRs, API Contracts, Risk Register
- **Audit** *(M10)* — every artifact create / approve / modify / override recorded with timestamp, actor, rationale
- **Metrics** *(M3–M10)* — TTTD, counter-metrics, adoption signals, multi-agent cost attribution
- **Administration** *(M2)* — Coding/Security/ADR/Review/Deployment/Testing Standards + Governance Rules. **"KnackForge DNA"** — every agent reads from here.

**V1-Optional surfaces (deferred to Phase 1.5):**
- **Governance Dashboard** *(F-009)* — Delivery Sponsor's TTTD / predictability / gate metrics
- **Realtime Agent Dashboard** — live progress for multiple agents running concurrently (CEO-demo material; the user's "Architecture Agent ████░░ 80%" view)

### 8.7a Master Charter UI Module alignment (v1.3 — added)

The Master Development Charter (2026-06-20) names **12 Core UI Modules**. Mapping to the existing PRD navigation (some are renamed for consistency, none are net-new at v1.3):

| Master Charter module | PRD v1.2/v1.3 surface | Notes |
|---|---|---|
| Dashboard | Home | Renamed in narrative; PRD body retains "Home" as navigation root |
| Connector Center | Connector Center *(F-015)* | Same |
| Knowledge Center | Knowledge Center *(F-112..F-115)* | Same |
| Project Intelligence | Project Intelligence *(F-101..F-111)* | Same |
| Organization Knowledge | Administration → Standards *(F-001..F-003)* | PRD surfaces it under Administration; Master Charter elevates it to top-level. *v1.3 keeps PRD navigation but flags for UX review.* |
| Agent Center | Agent Center *(F-011..F-014)* | Same |
| Development Center | Development *(Phase 3, OOV, GSD-powered per F-016/F-017)* | Renamed "Development" → "Development Center" for consistency; GSD-powered when built |
| Security Center | Security *(Phase 4, OOV)* | Renamed "Security" → "Security Center" |
| Testing Center | Testing *(Phase 4, OOV)* | Renamed "Testing" → "Testing Center" |
| Deployment Center | Deployment *(Phase 5/6, OOV)* | Renamed "Deployment" → "Deployment Center" |
| Governance Center | Governance Dashboard *(F-009, V1-Optional)* | **Elevated from V1-Optional to a named module.** Phase 1.5+ delivery; aligned with Steward conflict resolution (ADR-003). |
| Audit Center | Audit | Renamed "Audit" → "Audit Center" |
| Analytics Center | Metrics | Renamed "Metrics" → "Analytics Center"; absorbs F-009 counter-metrics when built |

*Navigation-level renaming is a UX task, not a PRD commitment. The capability content (FRs) is unchanged. UX (next artifact) implements the Master Charter's naming in the actual UI shell.*

**Captured project-context signals — UI tech stack (NOT committed in PRD):**

The brief explicitly defers tech stack to Architecture ADRs. The user has surfaced the following candidate stack during steering; these are **captured signals** that the relevant ADRs may validate, modify, or override:

| Layer | Candidate |
|---|---|
| Frontend framework | Next.js 15 |
| Language | TypeScript |
| UI components | Shadcn UI + Tailwind |
| State / data | TanStack Query + Zustand |
| Graph visualization | **React Flow** *(primary)*, **Cytoscape** *(secondary)* |
| Charts | Recharts |
| Realtime | WebSocket (with Redis Pub/Sub fanout where needed) |
| Backend / BFF | FastAPI Gateway |
| **Agent orchestration runtime** | LangGraph *(primary)*; pluggable via Agent Runtime Adapter (F-014) |
| Memory / vector | Qdrant, pgvector |
| Knowledge graph style | **Graphiti / Neo4j / Mem0 / CodeGraph-style** traversals |

The brief's deferral is **preserved** at the PRD level — these are not PRD commitments. The Architecture ADR portfolio (OQ-005 deployment; OQ-006 knowledge graph; UI Architecture ADR; ADR-0002 onward) decides the stack. The captured signals above become the **preferred inputs** to those ADRs.

**Realtime posture (v1.1):**

Live updates flow over WebSocket. Sources of live updates:
- Agent progress (Architecture Agent, Development Agent, etc.) — feeds the Realtime Agent Dashboard.
- Knowledge graph sync (Incremental Sync F-111) — feeds freshness indicators.
- Audit events — feed the Audit Trail UI.
- Connector state — feeds the Connector Center.

Where broadcast fanout is needed (e.g., multiple Tech Leads watching the same Project Intelligence dashboard update), a Redis Pub/Sub layer bridges the BFF to WebSocket clients. The Realtime Agent Dashboard (V1-Optional) is the canonical consumer; M7's Audit UI also benefits.
