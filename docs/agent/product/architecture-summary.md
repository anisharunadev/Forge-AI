# Product: Architecture Summary

> **Status:** ✅ Canonical — high-level system diagram + 3-package split
> **Doc owner:** Platform team
> **Source of truth:** `~/forge-ai/docs/ARCHITECTURE.md` + `CLAUDE.md`
> **Last updated:** 2026-06-30
> **Related:** [Vision](./vision.md), [Reference: forge-core](../reference/forge-core.md)

---

## Mission

> **Forge is NOT an AI agent.**
> **Forge is the operating system that orchestrates agents, knowledge, governance, and delivery workflows.**

Forge AI Agent OS is an **enterprise SDLC Agent Operating System**. It ingests a tenant's repositories, documentation, and ticketing systems into a Project Intelligence knowledge graph; provides delivery accelerators (Ideation, Architecture, Development, Security, Testing, Deployment) that produce typed artifacts; and governs every action through approval gates, audit, cost attribution, and observability.

---

## High-level system diagram

```
+--------------------------------------------------------------------------------------+
|                                       Browser                                        |
|   Next.js 15 + React 19 + xterm.js + React Flow + Shadcn UI                         |
+--------------------------------------------+-----------------------------------------+
                                             |
                                             | HTTPS / WebSocket / SSE
                                             v
+--------------------------------------------------------------------------------------+
|                                  AWS Account: Primary                                |
|                                                                                      |
|  +-------------------------------+      +------------------------------------------+ |
|  |        ECS Fargate            |      |              RDS PostgreSQL 17           | |
|  |   +-----------------------+   |      |  +-------------+  +-------------------+  | |
|  |   | FastAPI backend       |   |      |  | Apache AGE  |  | pgvector          |  | |
|  |   |  - LangGraph SDLC     |   |      |  | (graph)     |  | (vectors)         |  | |
|  |   |  - Terminal Manager   |<--+----->|  +-------------+  +-------------------+  | |
|  |   |  - Forge commands     |   |      |  +-----------------------------------+ | |
|  |   |  - Knowledge graph    |   |      |  | RLS policies (tenant_id, project)  | | |
|  |   |  - Connector center   |   |      |  | Append-only audit_log + hash chain | | |
|  |   +-----------------------+   |      |  | priority_policy, conflict_events   | | |
|  |                               |      |  +-----------------------------------+ | |
|  +-------------------------------+      +------------------------------------------+ |
|             |              ^                              |              ^           |
|             |              |                              |              |           |
|             |              |   +------------------+       |              |           |
|             |              +---| ElastiCache Redis|-------+              |           |
|             |                  |  (pub/sub, cache) |                      |           |
|             |                  +------------------+                       |           |
|             v                                                             |           |
|  +-------------------------+    +--------------------+                     |           |
|  |  S3 (artifacts, exports)|    | LiteLLM Proxy      |                     |           |
|  |  KMS per-tenant CMK     |    |  - virtual keys    |                     |           |
|  +-------------------------+    |  - audit logs      |                     |           |
|                                 |  - guardrails      |                     |           |
|                                 +---------+----------+                     |           |
|                                           |                                |           |
+-------------------------------------------+--------------------------------+--------+
                                            |                                |
                                            v                                |
+--------------------------------------------------------------------------------------+
|                              LLM Providers (model-provider agnostic)                |
|   Anthropic | OpenAI | Bedrock | Vertex AI | Azure OpenAI | OpenRouter | ...        |
+--------------------------------------------------------------------------------------+

+--------------------------------------------------------------------------------------+
|                       AWS Account: Audit (separate, isolated)                        |
|   CloudTrail -> S3 Object Lock -> audit log mirror + chain anchors                    |
+--------------------------------------------------------------------------------------+
```

---

## Component map

| Component | Package | Purpose |
|---|---|---|
| **FastAPI backend** | `backend/app/main.py` | HTTP entry; mounts `/api/v1` REST + root-level WebSocket routes |
| **LangGraph orchestrator** | `backend/app/agents/sdlc_agent.py` + `sdlc_state.py` | `SDLCState` (Pydantic) + supervisor graph; GSD phases as nodes; HITL + checkpointing |
| **Forge command map** | `backend/app/services/forge_commands.py` | 63 `forge-*` commands across 13 categories; resolver + iterator; CLI hooks |
| **Terminal Manager** | `backend/app/api/ws/terminal.py` + `terminal_broadcast.py` | xterm.js WebSocket bridge to native Python `pty`; per-session workspace isolation |
| **Knowledge Graph** | `backend/app/services/knowledge_graph.py` + `api/v1/knowledge_graph.py` | Apache AGE (graph) + pgvector (vectors); Cypher, SQL, hybrid query, vector search |
| **Connector Center** | `backend/app/services/connector_manager.py` | Per-tenant MCP servers (Jira, GitHub, Confluence, Slack, Figma, SonarQube, AWS) |
| **Approval gate** | `backend/app/services/policy_engine.py` + `api/v1/approvals.py` + `api/v1/architecture/approvals.py` + `api/v1/ideation/approvals.py` | HITL gate for Architecture, Security, Deployment boundaries |
| **Audit ledger** | `backend/app/services/audit_service.py` + `core/audit.py` | Append-only WORM table + SHA-256 hash chain |
| **Cost ledger** | `backend/app/services/cost_ledger.py` | Per-run, per-tenant, per-project cost attribution |
| **Hook orchestrator** | `backend/app/services/hook_orchestrator.py` | Event-driven hooks (pre/post SDLC stage) |
| **Idempotency** | `backend/app/core/idempotency.py` | `Idempotency-Key` middleware on write paths |
| **Telemetry** | `backend/app/core/telemetry.py` | OpenTelemetry tracing + metrics + logs |
| **RBAC** | `backend/app/services/rbac.py` + `api/v1/rbac.py` | Role-based access for `user` / `admin` / `system` tiers |
| **Frontend** | `apps/forge/app/*` | Next.js 15 App Router pages + components for all 4 personas |
| **MCP servers** | `mcp-servers/*` | One TypeScript package per external tool |
| **Forge-core** | `packages/forge-core/` | Canonical skills/agents/commands (R9) |
| **Forge-pi** | `packages/forge-pi/` | Product intelligence: KG construction, idea scoring, PRD generation (R10) |
| **Forge-browser** | `packages/forge-browser/` | Visual automation: screenshots, a11y audits, UAT (R11) |

---

## Data flow for a typical SDLC run

```
1. User initiates a workflow in the Forge UI
   |
   v
2. Command Center maps the user-facing action to a `forge-*` command
   via FORGE_COMMAND_MAP (DL-024, ADR-004)
   |
   v
3. LangGraph orchestrator spawns an SDLC agent run
   - SDLCState (Pydantic) created
   - Checkpointing enabled for resumability (ADR-007)
   |
   v
4. Discovery phase
   - F-101..F-104: ingest repos, run repomix + graphify + map-codebase
   - Read from PostgreSQL + AGE; write to graph nodes
   - Each ingestion event audited to audit_log (ADR-008)
   - Conflicts (code vs. Jira vs. Confluence) enter `conflicted` state
     per ADR-003, surfaced in Steward queue
   |
   v
5. Plan phase
   - LangGraph node invokes LLM via LiteLLM Proxy (ADR-005)
   - Prompt + result hashes recorded in audit_log
   - Cost attributed to workflow.cost_actual (NFR-030)
   |
   v
6. Architecture phase
   - LangGraph HITL gate pauses for human approval (Rule 3, ADR-007)
   - Approval decision audited
   - If approved, ADR + API Contract + Task Breakdown produced (Rule 4)
   |
   v
7. Build / Test / Review phases
   - Forge Terminal Center may launch Claude Code / Codex / Gemini CLI
     in a browser tab (ADR-006)
   - Workspace isolation: PTY cwd = session.workspace
   - Every byte streamed to the browser is audited (NFR-039, ADR-008)
   - LLM calls go through LiteLLM Proxy (ADR-005)
   |
   v
8. Security phase
   - HITL gate: Steward must approve before any Security Report
     is marked final
   |
   v
9. Deployment phase
   - HITL gate: final approval before any deployment action
   - Deployment Plan artifact (typed, Rule 4) is the binding document
   |
   v
10. Audit and observability
    - Every step above has an audit_log row with chain hash (ADR-008)
    - OpenTelemetry spans emit traces and metrics (Rule 7)
    - LiteLLM Prometheus metrics + cost ledger provide budget visibility
    - Audit database is in a separate AWS account from primary data
      (ADR-001)
```

---

## The 3-package architecture (R9, R10, R11)

Forge ships as 3 canonical packages + the host application. **Each package has a single responsibility and a forbidden duplication rule.**

### Package 1: `forge-core` (canonical)

```
packages/forge-core/
├── .claude-plugin/         # Plugin metadata
├── bin/                    # CLI entrypoints
├── capabilities/           # Per-CLI integrations (claude, codex, ...)
├── agents/                 # Agent specs (pm-agent, qa-agent, etc.)
├── commands/forge/         # 69 forge-* command specs
└── workflows/              # Workflow methodology
```

**Responsibility:** All skills, agents, commands, and workflow methodology.

**Rule (R9):** If a UI surface lists skills, agents, or commands, it MUST load from `forge-core`. Never hardcode lists in `apps/forge`.

**Count:** 69 `forge-*` commands across 13 categories.

### Package 2: `forge-pi` (product intelligence)

```
packages/forge-pi/
├── agents/
│   └── pm-agent.md
└── commands/forge-pi/
    ├── build-graph.md     # Build Knowledge Graph from scanned code
    ├── cluster-voice.md   # Customer voice clustering
    ├── draft-prd.md       # PRD generation from ideation
    ├── market-signals.md  # Market signal processing
    ├── scan.md            # Codebase scan
    └── score-idea.md      # Idea scoring
```

**Responsibility:** Codebase scanning, knowledge graph construction, idea scoring, customer-voice clustering, market-signal processing, PRD generation, architecture-diagram auto-gen, API-contract discovery.

**Rule (R10):** If a UI feature claims to ingest a codebase, score an idea, or build a knowledge graph, it MUST delegate to `forge-pi`. Never reimplement in `apps/forge`.

**Count:** 6 commands.

### Package 3: `forge-browser` (visual automation)

```
packages/forge-browser/
├── agents/
│   ├── canary-agent.md    # Post-deploy smoke testing
│   └── qa-agent.md        # Visual QA agent
└── commands/forge-browser/
    ├── a11y-audit.md      # WCAG accessibility audit
    ├── deploy-verify.md   # Post-deploy verification
    ├── journey.md         # User journey automation
    ├── screenshot.md      # Screenshot capture
    ├── ui-review.md       # UI review
    └── visual-test.md     # Visual regression test
```

**Responsibility:** Visual regression testing on PR diffs, post-deploy smoke testing, UAT automation, WCAG accessibility audits, the QA Agent, the Canary Agent.

**Rule (R11):** If a UI feature claims to take screenshots, compare pixels, or run a11y checks, it MUST delegate to `forge-browser`. Never reimplement in `apps/forge`.

**Count:** 6 commands.

### The 81-command total

| Package | Commands | Categories |
|---|---|---|
| `forge-core` | 69 | 13 categories (Build, Test, Review, Deploy, Audit, etc.) |
| `forge-pi` | 6 | Product intelligence |
| `forge-browser` | 6 | Visual automation |
| **Total** | **81** | (63 unique after dedup; some commands shared) |

---

## Layer isolation model (R5)

Forge separates knowledge into two layers:

```
+--------------------------------------------------------------------+
|                  Organization Knowledge Layer                       |
|  - Shared across all projects within a tenant                       |
|  - Owned by Steward role                                            |
|  - Examples: standards, templates, policies, org glossary           |
|  - Stored as relational tables in PostgreSQL 17 (AGE not required) |
+--------------------------------------------------------------------+
                                |
                                | tenant_id boundary (RLS)
                                v
+--------------------------------------------------------------------+
|                  Project Intelligence Layer                         |
|  - Isolated per project within a tenant                             |
|  - Ingested from GitHub, Jira, Confluence, Figma, Slack, code, docs  |
|  - Examples: services, APIs, DBs, dependencies, ADRs, tasks         |
|  - Stored as Apache AGE graph nodes + pgvector embeddings           |
|  - Conflict resolution per ADR-003                                  |
+--------------------------------------------------------------------+
```

The two layers are physically co-located in the same database but isolated by RLS policies that use both `tenant_id` and a layer discriminator. Project Intelligence rows carry project-scoped RLS; Organization Knowledge rows carry tenant-scoped RLS without project scope.

---

## Multi-tenancy model (R2)

- **Every row in every table carries `tenant_id`; every project-scoped row also carries `project_id`.**
- **PostgreSQL Row-Level Security (RLS)** is enabled per-table; the policy clauses use both `tenant_id` and `project_id` to constrain reads and writes.
- **The application sets a session-level `app.tenant_id` / `app.project_id`** before any query; the migrator is the only path that bypasses RLS, and only in allow-listed migration paths.
- **The LiteLLM Proxy carries a per-tenant virtual key**, so cost attribution and audit trail are tenant-isolated even at the model-provider boundary.

---

## Approval gate model (R3)

Forge enforces mandatory human approval at three boundaries:

1. **Architecture boundary** — before any `ADR`, `API Contract`, `Task Breakdown`, `Risk Register`, or `Acceptance Criteria` is marked final. (`backend/app/api/v1/architecture/approvals.py`)
2. **Security boundary** — before any `Security Report` is marked final; gated by the Steward role.
3. **Deployment boundary** — before any deployment action (stage, prod, rollback). (`backend/app/api/v1/architecture/approvals.py` + `forge-deploy-*` commands)

Each gate is implemented as a LangGraph `interrupt()` (ADR-007); the orchestrator pauses, surfaces the decision in the UI, and resumes only after the approver decides. The decision (approver, timestamp, decision, rationale) is recorded in the audit ledger.

---

## White-label architecture (DL-024)

Per ADR-004 (DL-024), users of Forge AI must **NEVER see "GSD" anywhere** in the UI, logs, or API responses. Every internal engine command is exposed under a `forge-*` name.

```
Forge UI  -->  forge-* command  -->  GSDWrapper  -->  gsd-core (internal)
                                           \-->  gsd:phase:discovery (opaque)
```

The single source of truth is `backend/app/services/forge_commands.py` (`FORGE_COMMAND_MAP`, 63 entries across 13 categories). Internal command names use the opaque `gsd:<area>:<verb>` form so any leaked reference (log line, error message, audit record) still does not advertise the underlying engine.

---

## Append-only audit trail (R6)

Per ADR-008, Forge maintains a tamper-evident, queryable, GDPR-compatible audit log:

```
+------------+     +----------------+     +----------------+     +----------------+
|  Action    | --> |  prompt_hash   | --> |  result_hash   | --> |  cost_usd      |
+------------+     +----------------+     +----------------+     +----------------+
       |                  |                      |                      |
       v                  v                      v                      v
+------------------------------------------------------------------------------------+
|                       audit_log (append-only, INSERT-only triggers)               |
|   chain_hash = sha256(audit_id || prev_chain_hash || canonical(record))           |
+------------------------------------------------------------------------------------+
                                  |
                                  v
+------------------------------------------------------------------------------------+
|   daily hash anchor -> audit_account / S3 Object Lock (separate AWS account)      |
+------------------------------------------------------------------------------------+
```

Every auditable action carries: `audit_id`, `tenant_id`, `project_id`, `actor_id`, `action`, `target_type`, `target_id`, `prompt_hash`, `result_hash`, `cost_usd`, `ts`, `prev_chain_hash`, `chain_hash`. DB-level triggers reject UPDATE and DELETE; only INSERT is permitted. A daily job anchors the chain head to a separate AWS account so even a full primary-account compromise cannot rewrite history.

---

## Tech stack

### Frontend

- **Next.js 15** (App Router, Server Components, streaming)
- **React 19** (concurrent rendering, transitions)
- **TypeScript 5** (strict mode)
- **Tailwind CSS** (bound to design tokens via `tailwind.config.ts`)
- **shadcn/ui** (headless primitives)
- **TanStack Query** (server state)
- **Zustand** (client state)
- **xterm.js** (terminal)
- **React Flow** (workflow DAGs)
- **Recharts** (charts)

### Backend

- **Python 3.13**
- **FastAPI** (async REST + WebSocket)
- **LangGraph** (orchestration)
- **SQLAlchemy 2.0** (async, 2.0 style with `Mapped[T]`)
- **Pydantic v2** (typed artifacts, `extra="forbid"`)
- **Alembic** (migrations)
- **Postgres 17** + **Apache AGE** + **pgvector**
- **Redis** (cache + pub/sub + idempotency)
- **OpenTelemetry** (tracing + metrics + logs)
- **LiteLLM** (AI gateway)
- **Keycloak** (OIDC identity)
- **AWS S3** (artifact storage + Object Lock for audit)
- **AWS KMS** (per-tenant CMK)

### Packages

- **forge-core** — Markdown + YAML skills/agents/commands
- **forge-pi** — Python + CLI for product intelligence
- **forge-browser** — TypeScript + Playwright for visual automation

---

## Where to go next

- [Vision](./vision.md) — Mission + the 18 rules
- [Personas](./personas.md) — 4 personas + permissions
- [Glossary](./glossary.md) — Domain terms
- [Reference: forge-core](../reference/forge-core.md) — Canonical skills/agents/commands
- [Reference: litellm-bridge](../reference/litellm-bridge.md) — Endpoint map
- [Reference: api-catalog](../reference/api-catalog.md) — Every route
- [Reference: db-schema](../reference/db-schema.md) — Every table
- [Standards](../standards/architecture-rules.md) — The 18 rules in detail
- [Features](../features/README.md) — 26 feature docs

---

**Forge is an operating system, not an agent. Every architectural decision flows from that positioning.**