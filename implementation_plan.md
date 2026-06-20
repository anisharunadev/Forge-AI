# Forge AI — Implementation Plan (v2.0)

## Overview

Rebuild Forge AI as an enterprise SDLC Agent Operating System by stripping all Paperclip-specific code into `archive/paperclip/`, then building the new platform using **LangGraph** (Python agent orchestration), **FastAPI** (backend), **GSD Core + GSD Pi** (TypeScript development execution — white-labeled as `forge-*`), and the existing **Next.js 15 Forge UI** (enhanced with Shadcn UI, React Flow, xterm.js, Recharts).

**Constitutional constraint:** Forge is NOT an AI agent. Forge is the operating system that orchestrates agents, knowledge, governance, and delivery workflows.

**V1 scope — 5 packages, 75 FRs, 11 milestones:**
1. **Foundation** (F-001..F-021) — Organization Knowledge, Compliance, Agent Center, Connector Center, Command Center, Terminal Center base, M1 Substrate
2. **Project Intelligence** (F-101..F-115) — Multi-repo ingestion, knowledge graph, Q&A
3. **Ideation** (F-201..F-213) — AI Product Management Workspace
4. **Architecture Accelerator** (F-301..F-310) — ADR, API Contract generation
5. **Terminal Center** (F-401..F-415) — In-browser multi-agent terminal (xterm.js + PTY)

**White-label principle:** GSD Core's 60+ commands white-labeled as `forge-*`. Users never see "GSD." *(DL-024)*

**ADR decisions locked:** Cloud-only AWS (ADR-001), PostgreSQL 17 + Apache AGE (ADR-002), Hybrid MDM + Steward conflict policy (ADR-003), LiteLLM as Provider Abstraction Layer (DL-025).

---

## Constitution (8 Immutable Rules) — Mapped to NFRs

| # | Rule | PRD NFR |
|---|---|---|
| **R1** | Model-provider agnostic — all LLM traffic through LiteLLM Proxy | NFR-029, DL-025 |
| **R2** | Multi-tenancy by default — every record carries `tenant_id` + `project_id` with RLS | NFR-006, NFR-007, DL-026 |
| **R3** | Human approval gates — no autonomous Architecture/Security/Deployment boundary crossing | NFR-032, DL-002 |
| **R4** | Typed artifacts only — ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan, Terminal Session Log | F-010, §5.4 |
| **R5** | Layer isolation — Organization Knowledge shared; Project Intelligence isolated | NFR-006, DL-004, DL-005 |
| **R6** | Mandatory auditability — agent, model, prompt, tool, cost, artifact, timestamp, result | NFR-020, F-005, F-407 |
| **R7** | Mandatory observability — OpenTelemetry tracing, metrics, logs from day one | NFR-021, NFR-022, NFR-023 |
| **R8** | Configurable everything — no hardcoded GitHub/Claude/OpenAI/AWS/Jira assumptions | NFR-029, F-014, F-016 |

---

## Tech Stack (locked per ADR-001/002/003)

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript 5.x, Shadcn/UI, Tailwind CSS 4 |
| State/Data | TanStack Query, Zustand |
| Visualization | React Flow, Recharts, Cytoscape (secondary) |
| Terminal Emulator | xterm.js + xterm-addon-fit |
| Realtime | WebSocket + Redis Pub/Sub |
| Backend | FastAPI, Python 3.13, Pydantic v2 |
| Agent Runtime | LangGraph, LangChain, LiteLLM, OpenTelemetry |
| Database | PostgreSQL 17 + pgvector |
| Graph | Apache AGE (PostgreSQL extension per ADR-002) |
| Cache/Queue | Redis |
| Auth | Keycloak, OIDC, SAML, RBAC |
| Provider Abstraction | LiteLLM Proxy (DL-025) |
| Dev Execution | GSD Core + GSD Pi (@opengsd) — white-labeled as forge-* |
| Intelligence Gen | repomix, GSD graphify + map-codebase + ingest-docs + capture |
| Process Manager | FastAPI subprocess manager (PTY for terminals, CLI for GSD) |
| Infra | AWS ECS Fargate, RDS PostgreSQL 17, ElastiCache Redis, S3, KMS (ADR-001) |
| Local Dev | Docker, Docker Compose |

---

## Phase 0: Archive Paperclip Code

### Move to `archive/paperclip/`

| Source | Reason |
|---|---|
| `apps/agent-runtime/`, `apps/orchestrator/`, `apps/connector-config/`, `apps/customer-cloud-broker/`, `apps/event-bus-bridge/`, `apps/identity-broker/`, `apps/jira-adapter/`, `apps/project-intelligence/`, `apps/sync-plane-job/` | Paperclip-specific apps |
| `agents/` (entire directory) | All 22+ Paperclip Python agents |
| `packages/cache-broker/`, `packages/db-migrator/`, `packages/db-pool/`, `packages/event-bus/`, `packages/session-tokens/`, `packages/sync-plane-ratelimit/`, `packages/mcp-breaker/` | Paperclip-specific packages |
| `forge/`, `migrations/`, `infra/`, `config/`, `docs/`, `docs-site/`, `engagements/`, `workspace/`, `var/` | Paperclip runtime artifacts |
| `.agents/`, `.omc/`, `.fora/` | Paperclip state |
| Root config files | Paperclip config |

### Retained

| Path | Reason |
|---|---|
| `apps/forge/` | Forge dashboard UI — retain and enhance |
| `mcp-servers/` | All MCP integration servers (Jira, GitHub, Confluence, Figma, AWS, Slack, etc.) |
| `packages/forge-ui/`, `packages/mcp-transport/`, `packages/mcp-router/`, `packages/mcp-schemas/`, `packages/contracts/`, `packages/object-store/`, `packages/oidc-clients/`, `packages/tenancy-lint/` | Non-Paperclip shared libraries |
| `tenants/` | Multi-tenant configuration |
| `tools/`, `scripts/`, `tests/` | Dev tooling and tests |
| `docker-compose.yml` | Keep and update |

---

## Phase 1: GSD Integration & White-Labeling

### Install
```bash
pnpm add @opengsd/gsd-core @opengsd/gsd-pi
gsd-core init
```

### FORGE_COMMAND_MAP (F-019)
Complete mapping of 60+ `forge-*` commands to `gsd` commands across 13 categories: Onboarding, Project Intelligence, Ideation, Architecture, Development, Testing, Security, Code Review, Deployment, Milestones, Learning, Workflow, Environment. Implemented as a Python dict in `forge_commands.py`.

### White-Label Principle (DL-024)
Users never see "GSD" in the UI. The Command Center, Terminal Center, and all workflow panels use `forge-*` as the brand. GSD runs underneath as the execution engine.

---

## Phase 2: Architecture

```
forge-ai/
├── backend/                    # FastAPI Python 3.13
│   ├── app/
│   │   ├── main.py
│   │   ├── api/v1/
│   │   │   ├── runs.py, agents.py, connectors.py, knowledge.py,
│   │   │   ├── intelligence.py, ideation.py, architecture.py,
│   │   │   ├── governance.py, audit.py, metrics.py,
│   │   │   ├── forge-commands.py, terminal.py, onboarding.py
│   │   ├── api/ws/
│   │   │   ├── runs.py, forge-commands.py, terminal.py
│   │   ├── agents/             # LangGraph SDLC agent
│   │   │   ├── sdlc_agent.py, state.py
│   │   │   ├── nodes/          # Each GSD phase as node
│   │   │   └── tools/          # gsd_wrapper, mcp_client, knowledge_graph, repomix_wrapper
│   │   ├── terminal/           # Multi-agent terminal backend
│   │   │   ├── session_manager.py, pty_process.py, agent_launcher.py
│   │   ├── core/               # state_machine, idempotency, audit
│   │   ├── db/                 # SQLAlchemy + AGE models, Alembic
│   │   ├── schemas/            # Pydantic v2
│   │   └── services/
│   │       ├── forge_commands.py, intelligence.py, knowledge_graph.py,
│   │       ├── project_intelligence.py, connector_manager.py,
│   │       └── project_onboarding/
│   ├── requirements.txt
│   └── Dockerfile
├── apps/forge/                 # RETAINED + ENHANCED Next.js 15
│   ├── app/
│   │   ├── dashboard/
│   │   ├── forge-terminal/          # NEW: xterm.js terminal center
│   │   ├── forge-command-center/    # NEW: white-labeled GSD commands
│   │   ├── project-onboarding/      # NEW: multi-repo onboarding
│   │   ├── connector-center/
│   │   ├── knowledge-center/
│   │   ├── project-intelligence/
│   │   ├── organization-knowledge/
│   │   ├── agent-center/
│   │   ├── ideation/
│   │   ├── architecture/
│   │   ├── governance-center/
│   │   ├── audit-center/
│   │   └── analytics-center/
│   ├── components/
│   │   ├── ui/                 # Shadcn
│   │   ├── forge-terminal/     # TerminalPane, TerminalTabs, TerminalSplit (xterm.js)
│   │   ├── knowledge-graph/    # React Flow
│   │   ├── forge-commands/     # White-labeled command panels
│   │   └── analytics/          # Recharts
│   └── lib/
├── mcp-servers/                # RETAINED
├── packages/                   # RETAINED non-Paperclip
├── tenants/                    # RETAINED
├── archive/paperclip/
├── docker-compose.yml
└── package.json
```

---

## Phase 3: M1 Substrate Primitives (DL-027)

These MUST be built in M1, not retrofitted:

1. **Typed event bus** — events for every artifact state transition, connector sync, agent execution, terminal command
2. **LiteLLM Proxy integration** — Provider Abstraction Layer (F-012/F-014)
3. **Tenant-scoped cost ledger** — per-tenant/project/workflow cost rows in PostgreSQL
4. **Tenant-scoped freshness ledger** — `freshness_at` + `freshness_source` on every AGE graph node
5. **Query-layer RLS isolation** — `SET LOCAL app.tenant_id` + RLS policies on every table
6. **Append-only artifact storage** — `version`, `status`, `superseded_by`, `superseded_at` on artifact tables
7. **Connector failure-mode primitives** — `pending/syncing/healthy/stale/quarantined/failed`
8. **Policy evaluation engine** — F-003 policies evaluable at DB layer

---

## Phase 4: 5 Packages, 11 Milestones, 75 FRs

### Package 1 — Foundation (M1-M2, FRs: F-001..F-021)

**M1 — Foundation Core + GSD Base + M1 Substrate**
- F-001 (Standards), F-002 (Templates), F-003 (Policies), F-004 (RBAC), F-005 (Audit), F-006 (Approval Engine), F-010 (Artifact Registry)
- F-019 (GSD White-Label Registry — FORGE_COMMAND_MAP scaffold)
- F-020 (Process Manager base)
- **M1 Substrate primitives** per §6.13 (typed event bus, LiteLLM, cost/freshness ledgers, RLS, append-only artifacts, connector failure states, policy engine)
- GSD Core + GSD Pi install
- Admin UI shell

**M2 — Connectors + Agent Center + Command Center + Terminal Center base**
- F-007 (Connectors), F-008 (Admin UI complete), F-011 (Agent Registry), F-012 (Model Provider Registry), F-013 (Agent Assignment), F-014 (Agent Runtime Adapter), F-015 (Connector Marketplace), F-016 (Agent Runtime Management), F-017 (Hook Orchestration)
- F-018 (Forge Command Center UI), F-021 (Project Onboarding Wizard)
- F-401 (Terminal Session Manager), F-402 (WebSocket Streaming), F-403 (Tab Interface), F-404 (Split Panes), F-405 (Agent Process Launcher), F-407 (Terminal Audit Trail), F-408 (Workspace Isolation), F-409 (Agent Detection), F-410 (Theme)
- Org Knowledge UI, Agent Center UI, Connector Center UI, Command Center UI, Terminal Center UI

### Package 2 — Project Intelligence (M3-M5, FRs: F-101..F-115)

**M3 — Project Intelligence Core**
- F-101 (Repo Ingestion), F-102 (Repo Discovery), F-103 (Architecture Discovery), F-104 (Dependency Graph)
- Project Intelligence UI + React Flow Knowledge Graph
- **First Aha Time validated here**

**M4 — Catalogs + Q&A + Impact Analysis**
- F-105 (API Catalog), F-106 (Database Map), F-107 (Service Catalog), F-108 (Q&A Interface), F-110 (Impact Analysis)
- Service/API/DB Catalog UI + Q&A UI

**M5 — Operations + Knowledge Center + Conflict Resolution**
- F-109 (Snapshot), F-111 (Incremental Sync — ADR-003 conflicts), F-112 (Doc Ingestion), F-113 (Comm Ingestion), F-114 (Asset Ingestion), F-115 (Unified Knowledge Graph)
- Knowledge Center UI + Freshness Indicators

### Package 3 — Ideation (M6-M8, FRs: F-201..F-213)

**M6 — Ideation Core**
- F-201 (Idea Intake), F-202 (Idea Analysis), F-203 (Architecture Impact Graph), F-204 (Opportunity Scoring), F-208 (Ideation Knowledge Graph)
- Ideation Center UI

**M7 — Ideation Generation + Realtime Workflow**
- F-205 (Roadmap Generator), F-206 (PRD Generator), F-207 (Architecture Preview), F-209 (Agent Selection), F-210 (Realtime Workflow), F-211 (Output Bundle)
- Roadmap/PRD/Preview UI + Realtime WebSocket progress

**M8 — Ideation Approval + Push to Delivery**
- F-212 (Approval Queue), F-213 (Push to Jira/Confluence/Architecture)
- Approval Queue UI

### Package 4 — Architecture Accelerator (M9-M10, FRs: F-301..F-310)

**M9 — Architecture Generation Core**
- F-301 (ADR Generation), F-302 (API Contract Gen), F-303 (Task Breakdown), F-304 (Risk Register)
- Architecture UI + live Agent Center assignment

**M10 — Governance + Traceability + Agent Workflow Viz**
- F-305 (Approval Workflow), F-306 (Traceability), F-307 (Versioning), F-308 (Standards Attestation), F-309 (Context-Aware Gen), F-310 (Acceptance Criteria)
- Approval UI + Audit Trail UI + Agent Workflow Visualization (React Flow)

### Package 5 — Terminal Center Full + Governance (M11, FRs: F-411..F-415 + F-009 V1-Optional)

**M11 — Terminal Center Full + V1-Optional**
- F-411 (Command Center Integration), F-412 (Session Cost Tracking), F-413 (Session Broadcast), F-414 (Terminal Knowledge Context), F-415 (Terminal Export)
- F-009 (Governance Dashboard — V1-Optional)
- Realtime Agent Dashboard
- Analytics Center

---

## Phase 5: Implementation Steps

### Step 1: Archive Paperclip
- Create `archive/paperclip/`, move all Paperclip code
- Update `.gitignore`, rewrite `package.json` and `pnpm-workspace.yaml`

### Step 2: Install GSD + Intelligence Tools
```bash
pnpm add @opengsd/gsd-core @opengsd/gsd-pi
gsd-core init
npx repomix --init
```

### Step 3: Backend Foundation + M1 Substrate + Terminal Base (M1)
- FastAPI app + PostgreSQL 17 + Apache AGE + pgvector + Redis
- SQLAlchemy models + Alembic + Pydantic v2
- **M1 Substrate** — typed event bus, LiteLLM proxy, cost/freshness ledgers, RLS, append-only artifacts, connector failure states, policy engine
- F-001..F-006, F-010 (Standards, Templates, Policies, RBAC, Audit, Approval, Artifact Registry)
- F-019 (FORGE_COMMAND_MAP), F-020 (Process Manager)
- `terminal/session_manager.py` + `pty_process.py` + `agent_launcher.py`

### Step 4: Forge UI Foundation + Command Center + Terminal UI (M1)
- Shadcn UI + Tailwind CSS + xterm.js
- Admin UI shell (Standards, Templates, RBAC, Audit, Approval)
- Command Center UI (all white-labeled commands)
- Terminal Center UI (tabs, split panes, agent selector)

### Step 5: Agent Center + Connector Center + Onboarding + Terminal Full (M2)
- F-007, F-008, F-011..F-017 (Connectors, Agent Center full)
- F-018 (Command Center UI complete), F-021 (Onboarding Wizard)
- F-401..F-410 (Terminal Center full: session manager, tabs, split, audit, isolation, detection, theme)
- UI: Agent Center, Connector Center, Org Knowledge, Command Center, Terminal Center

### Step 6: LangGraph SDLC Agent with GSD Integration
- `SDLCState` type, supervisor graph routing
- Each GSD phase as LangGraph node
- Tools: `gsd_wrapper.py` (white-labeled), `mcp_client.py`, `knowledge_graph.py`, `repomix_wrapper.py`
- Approval gate nodes, hook orchestration (F-017)

### Step 7: Multi-Repo Intelligence Pipeline (M3-M4)
- Repo ingestion via MCP
- repomix + graphify + map-codebase + ingest-docs + capture
- F-101..F-108, F-110
- React Flow knowledge graph visualization

### Step 8: Knowledge Center + Conflict Resolution (M5)
- F-109, F-111..F-115
- Unified Knowledge Graph (AGE + pgvector)
- ADR-003 conflict resolution (Hybrid MDM + Steward priority)

### Step 9: Ideation Center (M6-M7)
- F-201..F-211
- PRD Generator (BMad-compatible), Realtime WebSocket workflow
- Agent selection per task

### Step 10: Ideation Approval + Push (M8)
- F-212, F-213

### Step 11: Architecture Accelerator (M9-M10)
- F-301..F-310
- Agent Workflow Visualization (React Flow)

### Step 12: Terminal Center Full + Governance Dashboard (M11)
- F-411..F-415 (Cost tracking, broadcast, knowledge context, export)
- F-009 (Governance Dashboard — V1-Optional)
- Realtime Agent Dashboard, Analytics Center

### Step 13: Auth + Multi-Tenancy
- Keycloak OIDC/SAML, MFA (NFR-004a)
- RBAC enforcement, RLS per-tenant isolation, data residency

### Step 14: Testing + CI/CD
- Unit tests, LangGraph integration tests, Terminal Center tests
- E2E UI tests, GitHub Actions, pen-testing (NFR-035)

---

## Pilot Phasing

| Phase | Duration | Exit Criteria |
|---|---|---|
| **P0** Pre-pilot | 4 weeks | Baseline TTTD recorded; pilot scope confirmed |
| **P1** Kickoff | 1 week | First artifact created in Forge |
| **P1.5** Validation | 1-2 weeks | ≥80% acceptance across ≥15 artifacts |
| **P2** Execution | 8-12 weeks | Directional TTTD improvement; ≥12 cycles |
| **P3** Evaluation | 2 weeks | Decision recorded; metric targets formalized |
| **P4** Expansion | TBD | Conditional on P3 green |

---

## Success Criteria

- [ ] All Paperclip code archived in `archive/paperclip/`
- [ ] GSD Core + GSD Pi installed and white-labeled as `forge-*` (60+ commands)
- [ ] M1 Substrate primitives built (event bus, LiteLLM, cost/freshness ledgers, RLS, append-only artifacts, connector failures, policy engine)
- [ ] FastAPI + PostgreSQL 17 + Apache AGE + pgvector + Redis running
- [ ] All 75 FRs implemented across 5 packages, 11 milestones
- [ ] Forge Terminal Center working: launch Claude Code, Codex, Gemini CLI in browser with tabs, split panes, audit, persistence
- [ ] Terminal Center audit captures 100% of commands (NFR-039)
- [ ] Multi-repo intelligence generation (repomix + graphify + map-codebase)
- [ ] LangGraph agent executes full SDLC run with white-labeled GSD phases
- [ ] Human approval gates at Architecture, Security, Deployment boundaries
- [ ] React Flow knowledge graph traversable (Unified Knowledge Graph)
- [ ] Apache AGE graph with pgvector + hybrid SQL+Cypher queries
- [ ] PostgreSQL RLS multi-tenant isolation enforced
- [ ] LiteLLM Proxy handling all LLM traffic (no direct SDK imports)
- [ ] MCP servers connected and usable
- [ ] OIDC auth + MFA + RBAC + tenant isolation enforced
- [ ] Append-only WORM audit trail for every action + terminal command
- [ ] WebSocket real-time updates for all forge commands and terminals
- [ ] Pilot P1.5 ≥80% validation gate passed