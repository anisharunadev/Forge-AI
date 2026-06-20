# Addendum — prd-forge-ai-2026-06-19

User-contributed depth that earns a place but doesn't fit the PRD main narrative. PRD audit/override information lives in `.decision-log.md`.

---

## A. Domain Model Sketch

Captured during Section 5 (NFRs) discussion and refined during Section 6 steering (A-004 hierarchy change). **Architectural only** — tech stack is explicitly deferred to Architecture ADRs per the brief. Candidate technologies surfaced in conversation (FastAPI, PostgreSQL, LangGraph) are **not committed** here and remain `[TO BE DECIDED IN ADR]`.

### A.1 Hierarchy

```
Organization
 └─ Project         (Customer Engagement = Tenant boundary for data isolation)
     └─ Repository
```

Reason for the hierarchy: KnackForge's reality — CMC, GAPI, Honeywell — is one engagement per customer with many direct repositories. There is no internal sub-Project layer in V1. Earlier drafts considered `Organization → Engagement → Project → Repository` to handle customers with multiple workstreams; that layer turned out to be theoretical, not load-bearing. If a customer later has multiple distinct workstreams, the model extends to insert a sub-Project level. The simpler V1 hierarchy is the safe default.

### A.2 Entity sketch

```
Organization
 ├─ Standards        (F-001)        ── shared across Projects
 ├─ Policies         (F-003)        ── shared
 ├─ Templates        (F-002)        ── shared
 └─ Artifact Registry (F-010)       ── shared

Project  (Tenant = Customer Engagement — fully isolated)
 ├─ Repositories      (F-101, F-102)
 ├─ Knowledge Graph   (F-103, F-104, F-105, F-106, F-107, F-110, F-111)
 ├─ Artifacts
 │   ├─ ADR                  (F-201)
 │   ├─ API Contract         (F-202)
 │   ├─ Task Breakdown       (F-203)
 │   ├─ Risk Register        (F-204)
 │   └─ Acceptance Criteria  (F-210)
 ├─ Approvals         (F-205, F-006, F-005)
 └─ Snapshots         (F-109)

Workflow
 ├─ Phase 0  (Project Intelligence)
 ├─ Phase 1  (Architecture)
 └─ Future phases  (Phase 2–5, out of V1)
```

### A.3 Foundational invariants (from §6.11) encoded in the model

- `Organization` entities (Standards, Policies, Templates, Artifact Registry schema) are shared across engagements (tenants); the data row carries an `engagement_scope` flag, and read access is governed by F-004 RBAC + Steward-controlled publishing.
- `Engagement`-scoped entities (Project, Repositories, Knowledge Graph, Artifacts, Approvals, Snapshots) are fully isolated per engagement. **No cross-engagement query path exists.** Customer knowledge graphs (CMC, Honeywell, etc.) never mix.
- `Artifact` rows are immutable once approved; supersession creates a new version (F-207). Approval + audit rows reference the artifact *version*, not the artifact.
- `Approval` rows are the only path to transition an artifact across governance boundaries (NFR-032). No background process may write a `status: approved` value.
- `Knowledge Graph` nodes carry `freshness_at` and `freshness_source` (NFR-031). Staleness is a first-class property.
- `Workflow` instances carry `cost_estimate`, `cost_actual`, `cost_budget` (NFR-030) and a `model_provider_id` (NFR-029) — the application never hard-codes a provider.
- `Organization Knowledge` content (Standards, Templates, Policies) is **curated manually during V1** (A-008). Forge is the substrate; the Steward is the source.

---

## B. Rejected Alternatives (recorded for traceability)

### B.1 Delivery Predictability as North Star (rejected)

Brief proposed "Delivery Predictability" as North Star. User steered to **Time to Trusted Delivery (TTTD)** because predictability is a second-order outcome leadership cannot see daily. Predictability is now a supporting metric. Recorded as a deliberate choice, not an oversight.

### B.2 Knowledge Acquisition Time as separate metric (rejected)

Originally listed as a separate operational metric. User merged into **Time to Project Understanding** — leadership cares about understanding, not ingestion clock-time. Operational detail belongs in pilot ops, not strategic metric stack.

### B.3 F-101 Brownfield Ingestion as a single FR (rejected)

Original sketch had F-101 covering all brownfield ingestion. User split into F-101 (Repository Ingestion) → F-102 (Repository Discovery) → F-103 (Architecture Discovery) → F-104 (Dependency Graph) → outputs (F-105 API Catalog, F-106 Database Map, F-107 Service Catalog). Reason: F-101 was impossible to estimate as a single FR. Split enables estimation and parallelization.

### B.4 F-009 Governance Dashboard as V1-critical (rejected)

Originally in V1. User downgraded to **V1-Optional / Phase 1.5** — platform works without it; leadership visibility is value-add but not core thesis.

### B.5 Institutional Memory as Pillar #3 (rejected)

Original draft had "Institutional Memory" as the third pillar. User reframed as **Delivery Intelligence** — covers institutional memory, project intelligence, refactor intelligence, cross-project learning, and knowledge graphs under one umbrella. "Institutional Memory" alone sounded like a knowledge base or documentation tool.

### B.6 SOC2 certification timing (rejected premature commitment)

V1 is **SOC2-ready** (controls designed for certification). SOC2 Type I / Type II timing deferred to commercial path.

### B.7 1000+ concurrent workflows for V1 (rejected as over-committed)

V1 relaxed to **100+ concurrent workflows**. V1 users are KnackForge internal, not 10,000 enterprise users. Pilot data will validate whether right-sized.

---

## C. Pilot Project Context (informational, not committed)

User mentioned candidate engagement names during Section 4 steering: **CMC, GAPI, Honeywell, Neptune, Voyager**. Per the brief, pilot project is `[TO BE DETERMINED — deferred to Pilot Plan]`. Captured here as project-context signal only. **Not committed** in PRD as a target customer until a Pilot Plan document exists.

---

## D. Out-of-V1 Phases (for traceability)

Captured explicitly so reviewers don't infer V1 commitment:

- **Phase 2 — Development Accelerator:** code patches, unit-test scaffolds, review packages, code-level standards attestations.
- **Phase 3 — Security + QA Accelerator:** security reports, OWASP, IaC validation, integration / E2E, release readiness.
- **Phase 4 — Modernization Accelerator:** legacy migration plans, target architecture.
- **Phase 5 — Delivery Orchestration Accelerator:** end-to-end workflow with audit.

Foundation + Phase 0 + Phase 1 constitute a fundable, demoable, pilotable V1.

---

## E. Out-of-V1 NFRs (for traceability)

- Multi-region active/active deployment
- Customer-managed encryption keys (BYOK)
- Offline / air-gapped deployment
- White-labeling
- Federated identity across customer IdPs (commercial path)
- SOC2 Type I / Type II certification
- Cost Attribution / Chargeback
- Agent Marketplace
- Custom Customer Methodologies
- Multi-Organization Federation

---

## F. Tech Stack (deferred to ADRs)

Per the brief, tech stack is **explicitly deferred to Architecture ADRs**. No technology commitments in this PRD.

User surfaced candidate technologies during Section 5 steering (FastAPI, PostgreSQL, LangGraph, Next.js for UI). Captured here as project-context signals only — not committed.

---

## G. Glossary

Disambiguating definitions for terms that the rubric walker flagged as drifting across the PRD. Future artifact authors should preserve these.

| Term | Definition | Disambiguation |
|---|---|---|
| **Organization** | KnackForge's institution-level entity. Owns shared standards, policies, templates, and the artifact registry. | Top of hierarchy. |
| **Engagement** | *(Deprecated term in V1.)* Earlier drafts named this layer explicitly; final A-004 collapses *Engagement* and *Project* into one. Kept here as historical reference only — use **Project**. | Was the customer-engagement boundary in intermediate drafts. Now equivalent to Project. |
| **Project** | A customer engagement with KnackForge. **Tenant boundary for data isolation (NFR-006 / DL-005).** | One customer (e.g., CMC, GAPI, Honeywell) is one Project. Repositories are direct children. No internal sub-Project layer in V1. *(A-004 — final.)* |
| **Repository** | A source-control repository, ingested by F-101 / F-102. Lives within a Project. | Lowest of the hierarchy. |
| **Organization Knowledge Layer** | The cross-engagement shared substrate: standards (F-001), templates (F-002), policies (F-003), artifact registry (F-010). Read-only across Engagements; Steward-controlled publishing. | *Shared.* |
| **Project Intelligence Layer** | The per-Engagement knowledge graph, catalogs, Q&A index, and snapshots (F-102 through F-111). | *Per-Engagement; fully isolated.* |
| **Delivery Intelligence** | Umbrella term for the knowledge assets that improve future engagements. Includes institutional memory, project intelligence, refactor intelligence, cross-project learning, and knowledge graphs. *(Pillar 3.)* | Supersedes "Institutional Memory" as Pillar #3. |
| **Knowledge Graph** | The internal graph representation of repositories, services, APIs, databases, and their dependencies (F-103, F-104). Lives inside the Project Intelligence Layer. | Subset of Project Intelligence Layer; the substrate is an ADR (OQ-006). |
| **Artifact** | A typed, versioned object in the artifact registry (F-010). Examples: ADR, API Contract, Task Breakdown, Risk Register, Acceptance Criteria Package. | Has lifecycle state (see §5.3 state machine). |
| **ADR (draft vs approved)** | An Architecture Decision Record artifact. **Draft** = authored, not yet authoritative. **Approved** = authoritative for downstream work, signed by human approver, audit-recorded. The state transition between them is a governance boundary (§4.5). | Draft and approved are distinct states; only `approved` ADRs may be referenced by downstream artifacts. |
| **Acceptance Criteria Package** | The Phase 1 artifact (F-210) containing functional criteria, non-functional criteria, and validation rules. Provides Definition of Done for downstream phases. | Distinct from acceptance criteria for individual FRs (those live in Epics). |
| **TTTD (Time to Trusted Delivery)** | Elapsed time from an approved requirement entering the delivery system to the creation of a deployment-approved release package containing all required artifacts, approvals, security validations, quality validations, and deployment instructions. *(North Star Metric, §3.1.)* | Was *Delivery Predictability* in the brief; renamed to TTTD per user steering (DL-006). |
| **First Aha Time** | Time from a Tech Lead connecting a brownfield project to the moment they experience *"the platform understood our project in minutes."* *(§8.5 adoption signal; validated at end of M3.)* | Headline UX success criterion. Distinct from TTTD (which is process-time, not experience-time). |
| **Governance Boundary** | Any transition in an artifact's lifecycle that changes its authoritative status — most importantly `draft → approved` or `approved → superseded`. *(§4.5; NFR-032.)* | Load-bearing term. The invariant NFR-032 names; the specific boundaries per workflow are ADR + F-003-derived. |
| **Knowledge Reuse Rate** | % of stories, ADRs, or projects that reference existing artifacts rather than creating new ones. *(§3.3.)* | Strategic metric; signals whether the knowledge layer is actually working. |
| **Architecture Drift Rate** | % of implemented changes that diverge from approved architecture. *(§3.3.)* | Executive metric; signals governance effectiveness. |
| **Human Override Rate** | % of generated artifacts rejected or heavily modified by human reviewers. *(§3.4 counter-metric.)* | Trust signal; early warning of standards-alignment or quality regression. |
| **Artifact Consumption Rate** | How many generated artifacts are *used* downstream (e.g., ADR → Task Breakdown → referenced during implementation). *(§8.5 adoption signal.)* | Measures utility, not generation volume. |
| **MCP Connection** | A Model Context Protocol connection between Forge and an external system of record (GitHub, Jira, Confluence, etc.). *(F-007.)* | Uniform contract across all connectors per NFR-016. |
| **Practice Standard** | The rollout stage where KnackForge uses Forge as its default delivery workflow internally, before any commercial packaging. *(§8.3.)* | Distinct from "Industry Standard" — internal-only stage. |
| **Platform Surface** | A UI surface in the Forge web app (Project Intelligence, Architecture, Audit, Metrics, Administration, Agent Center, Knowledge Center, Connector Center, etc.). The product *is* the platform surfaces. | Captured fully in PRD §8.7 (v1.1). |
| **KnackForge DNA** | The set of standards, templates, policies, and governance rules surfaced via the Administration UI. "Every agent reads from here." | Tied to F-001 / F-002 / F-003 / F-010. |
| **Agent Operating System (v1.1)** | The strategic positioning: Forge is not an agent — it is the control plane that orchestrates external agents. *The defensibility is the platform, not the agent.* | Captured in PRD §1.1, §1.4 (Pillar 4), §8.7. |
| **Agent Center (v1.1)** | The platform surface (Settings → Agents) where users configure which external agents are available, which model providers they bind to, and which workflow stages they are assigned to. *The "Forge is a control plane" proof.* | F-011 + F-012 + F-013 + F-014. |
| **Knowledge Center (v1.1)** | The platform surface (and expanded Phase 0 capability) that unifies documentation, communication, asset, and repository sources into a single traversable Knowledge Graph — not just code repositories. | F-112 + F-113 + F-114 + F-115. *The killer feature.* |
| **Connector Center (v1.1)** | The platform surface (and expanded F-007 → F-015) that registers and manages connectors across Engineering, Project Management, Documentation, Cloud, and Communication. Marketplace-style. | F-015. |
| **Agent Runtime Adapter (v1.1)** | The pluggable adapter (F-014) that lets Forge talk to any external agent (Claude Code, Codex, Gemini CLI, etc.) through a uniform contract. Forge never hard-codes a single agent's tool surface or output shape. | F-014 + NFR-029 (Agent Runtime Portability). |
| **Agent Runtime Portability (v1.1)** | The NFR-029 upgrade: Forge is portable across agents at runtime, not just across models. *Stronger invariant than multi-provider-LLM.* | NFR-029. |
| **Agent Workflow Visualization (v1.1)** | The React Flow / Cytoscape-driven live view of multi-agent orchestration: Jira Story → Architecture Agent → ADR → Development Agent → PR → Security Agent → Approval. Live. Animated. | PRD §8.7, demo §8.6. |
| **Realtime Agent Dashboard (v1.1)** | The V1-Optional / Phase 1.5 surface that shows live progress across multiple agents (Architecture Agent ████░░ 80%, Codex Agent ███░░░ 60%). *CEO-demo material.* | M8 / F-009 sibling. |
| **CodeGraph (v1.1)** | A Graphiti / Neo4j / Mem0 / CodeGraph-style traversable graph spanning repositories, services, APIs, databases, deployments, ADRs, Jira tickets, and dependencies. The visualization in Knowledge Center. | F-115 + §8.7. |
| **Ideation Center (v1.2)** | The platform surface — and V1 Phase 1 capability — where product stakeholders and Tech Leads submit ideas, see architecture impact, score opportunities, generate roadmaps and PRD drafts, and push approved bundles to delivery systems. *An AI Product Management Workspace, not a ticket generator.* | F-201 → F-213, §5.3, §8.1 Package 3. |
| **Idea Intake (v1.2)** | Free-form text + structured intake of an idea (e.g., "Add MFA Authentication"). F-201. | §5.3. |
| **Architecture Impact Graph (v1.2)** | Visual mapping of an idea to affected services / repos / APIs / databases. *The connection between Ideation and Project Intelligence.* | F-203, §5.3, §8.6. |
| **Opportunity Scoring (v1.2)** | Multi-factor scoring: Business Value, Complexity, Risk, Customer Demand, Tech Debt → Priority Score. Configurable weights per Project. | F-204. |
| **PRD Generator (v1.2)** | From an approved idea, generates a draft PRD matching BMad PRD structure (Executive Summary, Problem, Solution, Requirements, NFRs, Success Metrics, Risks, Scope). *Forge becomes BMad-compatible by design.* | F-206. |
| **Architecture Preview (v1.2)** | Pre-approval impact visualization: affected repos, services, APIs, DB changes, estimated effort, risks. *The differentiator — most AI tools generate stories; Forge shows consequences.* | F-207. |
| **Ideation Output Bundle (v1.2)** | Standard approved-output package: Business Case + Epic + Stories + Architecture Impact + Risk Assessment + Effort Estimate + Affected Repositories + Affected Services + Affected APIs + ADR Draft + PRD Draft + Roadmap Placement. | F-211, F-213. |
| **Realtime Ideation Workflow (v1.2)** | WebSocket-driven progress for analysis / scoring / generation: "Analyzing Repositories ████████░░ 80% → Analyzing APIs ██████░░░░ 60% → Generating Epic ██████████ 100% → Generating Stories ██████░░░░ 60%." | F-210, §5.3. |

---

## H. Platform Surfaces (UI-first Architecture)

Forge is a **Web Platform first.** The UI is the product, not an optional surface. This addendum captures the canonical platform surface architecture so that downstream artifacts (Architecture ADR, UX, Epics) share a single reference.

### H.1 Reference architecture shape

```
┌─────────────────────────────────────────────┐
│        Next.js + Shadcn UI (Web App)        │
│                                             │
│   Project Intelligence │ Architecture       │
│   Ideation             │ Development        │
│   Security             │ Testing            │
│   Deployment           │ Audit / Metrics    │
│   Administration       │                    │
└─────────────────────────────────────────────┘
                  │  WebSocket (live updates)
                  ▼
┌─────────────────────────────────────────────┐
│        FastAPI Gateway / BFF                │
└─────────────────────────────────────────────┘
                  │
     ┌────────────┼─────────────┐
     ▼            ▼             ▼
 LangGraph      MCP Layer      Memory
 Agents         Connectors     Layer
```

### H.2 Critical V1 surfaces (must ship)

- **Home** — landing dashboard for each persona
- **Project Intelligence** *(M3–M5)* — Repositories, APIs, Databases, Services, Knowledge Graph. **First demo. First Aha Time validated here.**
- **Architecture** *(M6–M7)* — ADRs, API Contracts, Risk Register
- **Audit** *(M7)* — every artifact create / approve / modify / override recorded with timestamp, actor, rationale
- **Metrics** *(M3–M7)* — TTTD, counter-metrics, adoption signals
- **Administration** *(M2)* — Coding/Security/ADR/Review/Deployment/Testing Standards + Governance Rules. **"KnackForge DNA"** — every agent reads from here.

### H.3 V1-Optional surfaces (deferred to Phase 1.5)

- **Governance Dashboard** *(F-009)* — Delivery Sponsor's TTTD / predictability / gate metrics
- **Realtime Agent Dashboard** — live progress for any executed agent (when Phase 2/3 agents exist)

### H.4 Out-of-V1 surfaces (Phase 2–5)

- **Ideation** (Opportunities, Backlog, Stories) — Phase 2
- **Development** (Tasks, PRs, Code Reviews) — Phase 2
- **Security** (Vulnerabilities, Compliance) — Phase 3
- **Testing** (Unit, Integration, E2E) — Phase 3
- **Deployment** (AWS, Kubernetes, Releases) — Phase 3 / 5

### H.5 Captured tech-stack signals (NOT committed in PRD)

The brief explicitly defers tech stack to Architecture ADRs. The user surfaced the following candidate stack during steering; these are **captured signals** that the relevant ADRs may validate, modify, or override.

| Layer | Candidate |
|---|---|
| Frontend framework | Next.js 15 |
| Language | TypeScript |
| UI components | Shadcn UI + Tailwind |
| State / data | TanStack Query + Zustand |
| Graph visualization | React Flow |
| Charts | Recharts |
| Realtime | WebSocket (with Redis Pub/Sub fanout where needed) |
| Backend / BFF | FastAPI Gateway |
| Agent orchestration | LangGraph |
| Memory / vector | Qdrant, pgvector |

The brief's deferral is **preserved** at the PRD level. The Architecture ADR portfolio (OQ-005 deployment; OQ-006 knowledge graph; UI Architecture ADR; ADR-0002 onward) decides the stack. The captured signals above become the **preferred inputs** to those ADRs.

### H.6 Multi-tenant UI model

Each Project (= Customer Engagement = Tenant) gets an isolated Knowledge Graph, Artifacts, Audit Trail, and Memory. The Project is the navigation root for engagement-scoped surfaces. The Administration UI is the only Organization-scoped surface.

```
KnackForge (Organization)
├── CMC (Project) — 20 repos — isolated KG, Artifacts, Audit, Memory
├── GAPI (Project) — 10 repos — isolated KG, Artifacts, Audit, Memory
└── Honeywell (Project) — 30 repos — isolated KG, Artifacts, Audit, Memory
```

### H.7 Realtime posture

Live updates (agent progress, knowledge graph sync, audit events) flow over WebSocket. Where broadcast fanout is needed (e.g., multiple Tech Leads watching the same Project Intelligence dashboard update), a Redis Pub/Sub layer bridges the BFF to WebSocket clients. The Realtime Agent Dashboard (V1-Optional) is the canonical consumer; M7's Audit UI also benefits.

### H.8 MVP demo sequence (refined for UI-first)

The first demo *is* the UI — not an API or CLI:

1. Connect GitHub + Jira + Confluence + AWS connectors.
2. Select CMC in the Project Intelligence UI.
3. Forge builds Knowledge Graph + Service Catalog + Dependency Map *visible in the UI*.
4. Ask: "What repositories are affected by MFA implementation?" — see the answer in the UI.
5. Generate ADR + API Contract + Task Breakdown + Risk Register *in the Architecture UI*.
6. Approve in the UI — see the state-machine transition.
7. Watch agents run live in the Realtime Agent Dashboard (V1-Optional / Phase 1.5).
8. Show Audit Trail with every transition, actor, and rationale.

This is the moment leadership understands the product.

---

## I. Agent Operating System Architecture (v1.1)

Captures the v1.1 strategic pivot — Forge as the control plane that orchestrates external agents, not an SDLC agent itself.

### I.1 Strategic positioning

| Old framing (v1.0) | New framing (v1.1) |
|---|---|
| Forge = **SDLC Agent** (Forge *is* an agent doing SDLC tasks) | Forge = **Agent Operating System** (Forge *orchestrates* external agents) |
| Forge chooses models internally; users interact with one Forge agent | Users configure which agent runs which stage (Architecture → Claude Code, Development → Codex, Testing → Gemini, Security → Claude, Deployment → Hermes) |
| Knowledge = Project Intelligence + Org Knowledge Layer | Knowledge = **Knowledge Center** (full knowledge management: docs, repos, Confluence, Jira, Slack, Teams, PDF, ADR, API specs, DB schemas, Figma, AWS) |
| Connectors = Engineering + light others | **Connector Center** — full marketplace (Engineering, PM, Documentation, Cloud, Communication) |
| Single-product positioning | **Control plane positioning** — connect any model, any agent, any connector; visualize entire SDLC + knowledge graph |

### I.2 Why a control plane is more defensible than an agent

A single SDLC agent competes head-on with Claude Code, Codex, Cursor Agent. Each of those moves fast; competing on the model's shoulders is a losing game. A control plane compounds:

- **Every new agent that ships becomes a feature of Forge**, not a competitor. If a customer prefers Codex over Claude Code for Development, Forge supports both. The agent swap is a configuration change in the Agent Center, not a re-platforming.
- **The substrate is durable.** Typed artifacts and approval gates, the governed knowledge graph, the connector registry, the audit trail, and the unified visualization are hard to replicate in isolation. Together they form a control plane.
- **Switching cost grows with each integration.** Each agent, connector, knowledge source, and audit trail adds to the lock-in — not by trapping users, but by making the platform more valuable the more it's used.
- **Defensibility is the platform, not the agent.** This is the v1.1 thesis.

### I.3 Orchestration architecture (v1.1 reference)

```
┌─────────────────────────────────────────────────────────┐
│                  Forge UI (Next.js)                     │
│   Project Intelligence │ Architecture                   │
│   Knowledge Center     │ Agent Center                   │
│   Connector Center     │ Audit / Metrics                │
└─────────────────────────────────────────────────────────┘
                       │  WebSocket (live updates)
                       ▼
┌─────────────────────────────────────────────────────────┐
│             Forge Orchestration Layer                   │
│                                                         │
│  • Governance (NFR-032 — no autonomous transitions)     │
│  • Approval Engine (F-006)                              │
│  • Audit (F-005, NFR-020 — append-only)                 │
│  • Artifact State Machine (§5.3)                        │
│  • Agent Assignment (F-013)                             │
│  • Cost Attribution (NFR-030, multi-agent)              │
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

The **Orchestration Layer** is the load-bearing component. The UI never calls an agent, knowledge source, or connector directly — it goes through Orchestration. This is what enforces governance, audit, and the artifact state machine across all agents uniformly.

### I.4 Agent Center — the proof of "control plane"

The Agent Center is the surface that makes the v1.1 positioning credible. It's where the user sees:

- **Development Agents** available: Claude Code ✓, Codex ✓, Gemini CLI ✓, Kiro ✓, Hermes ✓, Custom ✓.
- **Model Providers** registered: OpenAI ✓, Anthropic ✓, Gemini ✓, Bedrock ✓, Azure OpenAI ✓, OpenRouter ✓, Ollama ✓, Vertex AI ✓.
- **Agent Assignment** (per Project): Architecture → Claude Code, Development → Codex, Testing → Gemini, Security → Claude, Deployment → Hermes.

This is *configurable*, not hard-coded. A customer with a Codex preference can swap Development in two clicks. A new agent that ships next quarter becomes available via F-014 (Agent Runtime Adapter), not a re-platforming.

### I.5 Knowledge Center — the killer feature

The Knowledge Center unifies sources beyond repositories into a single traversable graph:

| Source | Ingestion FR | What it adds to the graph |
|---|---|---|
| Repositories | F-101 → F-104 | Services, modules, dependencies, code |
| Documentation (Confluence, Notion, Google Drive, SharePoint) | F-112 | Design docs, RFCs, runbooks |
| Communication (Slack, Teams, Email, Zendesk) | F-113 | Decisions, threads (metadata; bodies only if configured) |
| Assets (PDF, Figma, AWS metadata) | F-114 | Diagrams, infrastructure topology |
| **Unified Knowledge Graph** | F-115 | Cross-source traversals |

Click *Auth Service* — see User Service, Login API, Database, ADR-120, Jira-456, Repository, Deployment, the Confluence design doc, the Slack thread where the team decided the auth approach. **All linked. All traversable.**

This is Graphiti / Neo4j / Mem0 / CodeGraph-style visualization, scoped to delivery knowledge. The killer feature is the *cross-source* traversal: from a Jira ticket to an ADR to a service to a deployment to the AWS topology, in one graph.

### I.6 Realtime Agent Dashboard — CEO-demo material

When agents run, the Realtime Agent Dashboard shows live progress across multiple concurrent agents:

```
Architecture Agent (Claude Code)
Running... ████████░░ 80%

Codex Agent (Development)
Generating API ██████░░░░ 60%

Claude Code (Security)
Reviewing Architecture ██████████ 100%
```

WebSocket-driven. Multiple Tech Leads can watch the same orchestration live. When the Architect approves the package, the state machine transition is visible to all viewers.

### I.7 Agent Workflow Visualization (React Flow / Cytoscape)

A live, animated graph of the multi-agent orchestration as it happens:

```
Jira Story
      │
      ▼
Architecture Agent  ─── Claude Code
      │
      ▼
ADR
      │
      ▼
Development Agent  ─── Codex
      │
      ▼
PR
      │
      ▼
Security Agent  ─── Claude
      │
      ▼
Approval
```

Users see *exactly* what happened, why, which agent, which model, which tools, which artifacts. Every node is clickable to see the underlying audit row. This is the surface that turns "an agent did something" into "a governed workflow ran, here is its full provenance."

### I.8 V1 packages (v1.1)

| Package | Contents |
|---|---|
| **Package 1 — Forge Foundation** | Organization Knowledge, **Connector Center**, **Agent Center**, RBAC, Audit, Multi-Tenant |
| **Package 2 — Project Intelligence** | Repository Discovery, **CodeGraph**, Knowledge Graph, Service Catalog, Dependency Map, Impact Analysis, **Knowledge Center** |
| **Package 3 — Architecture Accelerator** | ADR, API Contract, Task Breakdown, Risk Register — produced by configured agents via the Orchestration Layer |

Each package is independently demoable and pilotable.

### I.9 What this changes for downstream artifacts

- **Architecture ADR portfolio** — the Orchestration Layer is now a first-class component to design. ADR-0000 (Orchestration Architecture) likely precedes ADR-0001 (Deployment).
- **UX** — Agent Center, Knowledge Center, and Connector Center are primary surfaces. Multi-agent live progress and workflow visualization shape the visual language.
- **Epics + Stories** — FRs F-011 through F-015 (Agent Center / Knowledge Center / Connector Center) become first-class epics. Agent Center is M2 — high-priority.
- **Pilot Plan** — should explicitly verify that the configured agents (e.g., Claude Code for Architecture, Codex for Development) execute end-to-end, not just that "an agent" works.

---

## J. Ideation as AI Product Management Workspace (v1.2)

v1.2 substantially elevated Ideation from a Phase 2 out-of-V1 surface to a **V1 Phase 1 capability** — the AI Product Management Workspace.

### J.1 Strategic repositioning

| Old framing (v1.0 / v1.1) | New framing (v1.2) |
|---|---|
| Ideation = a Phase 2 surface (Opportunities, Backlog, Stories). Out of V1. | Ideation = **AI Product Management Workspace**. V1 Phase 1 capability. |
| "An Ideation Agent." | A governed workspace connected to Project Intelligence, Org Knowledge, Customer Feedback, Tech Debt. |
| Free-text idea → story. | Free-text idea → Business Case + Epic + Stories + Architecture Impact + Risk Assessment + Effort Estimate + Affected Repos/Services/APIs + ADR Draft + PRD Draft + Roadmap Placement. |
| Architecture Accelerator receives requirements from external Jira/Slack. | Architecture Accelerator receives structured **Ideation Output Bundles** from the same platform that understands the codebase. |

### J.2 The Forge flow (v1.2)

```
Project Intelligence (Phase 0)
        ↓
Ideation (Phase 1 — NEW V1)
        ↓
Architecture (Phase 2 — renumbered from v1.1 Phase 1)
        ↓
Development (Phase 3 — out of V1)
        ↓
Testing / Security (Phase 4 — out of V1)
        ↓
Deployment (Phase 5 — out of V1)
```

*Self-contained: the platform that understands the codebase also generates the requirements that flow into Architecture.* The flow no longer depends on external ticketing systems as the source of "what to build" — Forge is the source.

### J.3 Why "AI Product Management Workspace" beats "Ideation Agent"

A ticket generator competes with Jira, Linear, Monday, ClickUp, Asana. An *AI Product Management Workspace* connected to the project's knowledge graph, repositories, architecture, customer feedback, and KnackForge standards does not. The latter is *vertical-specific*, *defensible*, and *compounds* with each new knowledge source connected.

Specifically, the v1.2 Ideation Center:
- **Generates a draft PRD matching BMad PRD structure** (Executive Summary, Problem, Solution, Requirements, NFRs, Success Metrics, Risks, Scope). This means a PRD produced by Ideation flows directly into BMad's downstream artifacts (Architecture, UX, Epics, Stories). *Forge becomes BMad-compatible by design.*
- **Shows consequences, not just stories.** The Architecture Preview (F-207) shows affected repositories, services, APIs, database changes, estimated effort, and risks *before* approval. Most AI tools generate stories; Forge shows what changes if the story is built.
- **Scores opportunities with leadership-facing metrics.** Business Value, Complexity, Risk, Customer Demand, Tech Debt → Priority Score. Configurable weights per Project.
- **Configures agents per ideation task.** Ideation Agent Selection (F-209) is the first concrete demonstration that the Agent Center works end-to-end: a Tech Lead assigns Ideation Agent → Claude Sonnet, Fallback → GPT, Research → Gemini, Company Standards → Organization Knowledge Layer — and the system respects all four.

### J.4 V1 packaging (v1.2 — four packages)

| Package | Contents |
|---|---|
| **Package 1 — Forge Foundation** | Organization Knowledge, Connector Center, Agent Center, RBAC, Audit, Multi-Tenant |
| **Package 2 — Project Intelligence** | Repository Discovery, CodeGraph, Knowledge Graph, Service Catalog, Dependency Map, Impact Analysis, Knowledge Center |
| **Package 3 — Ideation** *(NEW V1)* | Idea Intake, Idea Analysis, Architecture Impact Graph, Opportunity Scoring, Roadmap Generator, PRD Generator, Architecture Preview, Ideation Knowledge Graph, Ideation Agent Selection, Realtime Workflow, Output Bundle, Approval Queue, Push to Delivery Systems |
| **Package 4 — Architecture Accelerator** | ADR, API Contract, Task Breakdown, Risk Register — produced by configured agents from approved Ideation Output Bundles |

### J.5 Phase renumbering consequences

| Phase | v1.1 | v1.2 |
|---|---|---|
| Project Intelligence | Phase 0 (F-101 → F-115) | Phase 0 — unchanged |
| **Ideation** | out-of-V1 | **Phase 1 (NEW V1)** — F-201 → F-213 |
| Architecture | Phase 1 (F-201 → F-210) | **Phase 2** (F-301 → F-310, renumbered) |
| Development | out-of-V1 (Phase 2) | out-of-V1 — **Phase 3** |
| Security + QA | out-of-V1 (Phase 3) | out-of-V1 — **Phase 4** |
| Modernization | out-of-V1 (Phase 4) | out-of-V1 — **Phase 5** |
| Delivery Orchestration | out-of-V1 (Phase 5) | out-of-V1 — **Phase 6** |

### J.6 Validation timing addition

A new validation gate at **end of M7** validates Ideation Center accuracy:
- Opportunity Scoring calibration (does the score match what leadership would have scored?)
- PRD Generator output quality vs. human-authored PRD (does the BMad-compatible structure flow into Architecture without rework?)

This gate is added to §8.4 in the PRD body.

