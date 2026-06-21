# Forge AI — System Architecture

This document is the single-page summary of the Forge AI architecture. For the underlying evidence, see [`docs/architecture/overview.md`](architecture/overview.md) and the locked Architecture Decision Records ([`docs/architecture/decisions/`](architecture/decisions/README.md)). Research that grounds the decisions lives at [`docs/research-forge-architecture-decisions-2026-06-20.md`](research-forge-architecture-decisions-2026-06-20.md).

## Mission

> **Forge is NOT an AI agent.**
> **Forge is the operating system that orchestrates agents, knowledge, governance, and delivery workflows.**

Forge AI is an enterprise SDLC Agent Operating System. It ingests a tenant's repositories, documentation, and ticketing systems into a project intelligence knowledge graph; provides delivery accelerators (Ideation, Architecture, Development, Security, Testing, Deployment) that produce typed artifacts; and governs every action through approval gates, audit, cost attribution, and observability.

## High-Level System Diagram

```text
+--------------------------------------------------------------------------------------+
|                                       Browser                                        |
|   Next.js 15 + React 19 + xterm.js + React Flow + Shadcn UI                         |
+--------------------------------------------+-----------------------------------------+
                                             |
                                             | HTTPS / WebSocket
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

## Component Map

| Component | Package | Purpose |
| --- | --- | --- |
| FastAPI backend | `backend/app/main.py` | HTTP entry, mounts `/api/v1` REST + root-level WebSocket routes |
| LangGraph orchestrator | `backend/app/agents/sdlc_agent.py` + `sdlc_state.py` | SDLCState (Pydantic) + supervisor graph; GSD phases as nodes; native HITL and checkpointing |
| Forge command map | `backend/app/services/forge_commands.py` | 60+ `forge-*` commands across 13 categories; resolver + iterator; CLI hooks (`forge:list`, `forge:exec`) |
| Terminal Manager | `backend/app/api/ws/terminal.py` + `terminal_broadcast.py` | xterm.js WebSocket bridge to native Python `pty`; per-session workspace isolation |
| Knowledge Graph | `backend/app/services/knowledge_graph.py` + `api/v1/knowledge_graph.py` | Apache AGE (graph) + pgvector (vectors); Cypher, SQL, hybrid query, vector search |
| Connector Center | `backend/app/services/connector_manager.py` | Per-tenant MCP servers (Jira, GitHub, Confluence, Slack, Figma, SonarQube, AWS, ...) |
| Approval gate | `backend/app/services/policy_engine.py` + `api/v1/approvals.py` + `api/v1/architecture/approvals.py` + `api/v1/ideation/approvals.py` | HITL gate for Architecture, Security, Deployment boundaries |
| Audit ledger | `backend/app/services/audit_service.py` + `core/audit.py` | Append-only WORM table + daily hash chain |
| Cost ledger | `backend/app/services/cost_ledger.py` | Per-run, per-tenant, per-project cost attribution |
| Hook orchestrator | `backend/app/services/hook_orchestrator.py` | Event-driven hooks (pre/post SDLC stage) |
| Idempotency | `backend/app/core/idempotency.py` | `Idempotency-Key` middleware on write paths |
| Telemetry | `backend/app/core/telemetry.py` | OpenTelemetry tracing + metrics + logs |
| RBAC | `backend/app/services/rbac.py` + `api/v1/rbac.py` | Role-based access for `user` / `admin` / `system` tiers |
| Frontend | `apps/forge/app/*` | Next.js 15 App Router pages + components for all personas |
| MCP servers | `mcp-servers/*` | One TypeScript package per external tool |

## Data Flow for a Typical SDLC Run

```text
1. User initiates a workflow in the Forge UI
   |
   v
2. Command Center maps the user-facing action to a `forge-*` command
   via FORGE_COMMAND_MAP  (ADR-004)
   |
   v
3. LangGraph orchestrator spawns an SDLC agent run
   - SDLCState (Pydantic) created
   - Checkpointing enabled for resumability  (ADR-007)
   |
   v
4. Discovery phase
   - F-101..F-104: ingest repos, run repomix + graphify + map-codebase
   - Read from PostgreSQL + AGE; write to graph nodes
   - Each ingestion event audited to audit_log  (ADR-008)
   - Conflicts (code vs. Jira vs. Confluence) enter `conflicted` state
     per ADR-003, surfaced in Steward queue
   |
   v
5. Plan phase
   - LangGraph node invokes LLM via LiteLLM Proxy  (ADR-005)
   - Prompt + result hashes recorded in audit_log
   - Cost attributed to workflow.cost_actual (NFR-030)
   |
   v
6. Architecture phase
   - LangGraph HITL gate pauses for human approval  (Rule 3, ADR-007)
   - Approval decision audited
   - If approved, ADR + API Contract + Task Breakdown produced  (Rule 4)
   |
   v
7. Build / Test / Review phases
   - Forge Terminal Center may launch Claude Code / Codex / Gemini CLI
     in a browser tab  (ADR-006)
   - Workspace isolation: PTY cwd = session.workspace
   - Every byte streamed to the browser is audited (NFR-039, ADR-008)
   - LLM calls go through LiteLLM Proxy  (ADR-005)
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
    - Every step above has an audit_log row with chain hash  (ADR-008)
    - OpenTelemetry spans emit traces and metrics  (Rule 7)
    - LiteLLM Prometheus metrics + cost ledger provide budget visibility
    - Audit database is in a separate AWS account from primary data
      (ADR-001)
```

## Layer Isolation Model

Forge separates knowledge into two layers per Rule 5:

```text
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

## Multi-Tenancy Model

- Every row in every table carries `tenant_id`; every project-scoped row also carries `project_id`.
- PostgreSQL Row-Level Security (RLS) is enabled per-table; the policy clauses use both `tenant_id` and `project_id` to constrain reads and writes.
- The application sets a session-level `app.tenant_id` / `app.project_id` before any query; the migrator is the only path that bypasses RLS, and only in allow-listed migration paths.
- The LiteLLM Proxy carries a per-tenant virtual key, so cost attribution and audit trail are tenant-isolated even at the model-provider boundary.

## Approval Gate Model

Forge enforces mandatory human approval at three boundaries (Rule 3):

1. **Architecture boundary** — before any `ADR`, `API Contract`, `Task Breakdown`, `Risk Register`, or `Acceptance Criteria` is marked final. See [`backend/app/api/v1/architecture/approvals.py`](../backend/app/api/v1/architecture/approvals.py).
2. **Security boundary** — before any `Security Report` is marked final; gated by the Steward role.
3. **Deployment boundary** — before any deployment action (stage, prod, rollback). See [`backend/app/api/v1/architecture/approvals.py`](../backend/app/api/v1/architecture/approvals.py) and the `forge-deploy-*` commands in [`docs/FORGE_COMMANDS.md`](FORGE_COMMANDS.md).

Each gate is implemented as a LangGraph interrupt (`ADR-007`); the orchestrator pauses, surfaces the decision in the UI, and resumes only after the approver decides. The decision (approver, timestamp, decision, rationale) is recorded in the audit ledger.

## White-Label Architecture

Per [`ADR-004`](architecture/decisions/0004-gsd-white-labeling.md) (DL-024), users of Forge AI must NEVER see "GSD" anywhere in the UI, in logs, or in API responses. Every internal engine command is exposed under a `forge-*` name.

```text
Forge UI  -->  forge-* command  -->  GSDWrapper  -->  gsd-core (internal)
                                           \\-->  gsd:phase:discovery (opaque)
```

The single source of truth for that mapping is [`backend/app/services/forge_commands.py`](../backend/app/services/forge_commands.py) (`FORGE_COMMAND_MAP`, 60+ entries across 13 categories). The internal command names use the opaque `gsd:<area>:<verb>` form so that any leaked reference (log line, error message, audit record) still does not advertise the underlying engine to a customer reading their own audit trail.

The full command reference lives at [`docs/FORGE_COMMANDS.md`](FORGE_COMMANDS.md).

## Append-Only Audit Trail

Per [`ADR-008`](architecture/decisions/0008-append-only-worm-audit-trail.md), Forge maintains a tamper-evident, queryable, GDPR-compatible audit log:

```text
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

## Cross-References

- ADRs: [`docs/architecture/decisions/README.md`](architecture/decisions/README.md)
- Architecture overview: [`docs/architecture/overview.md`](architecture/overview.md)
- Research: [`docs/research-forge-architecture-decisions-2026-06-20.md`](research-forge-architecture-decisions-2026-06-20.md)
- Charter: [`docs/CHARTER.md`](CHARTER.md)
- Backend internals: [`backend/README.md`](../backend/README.md)
- Frontend pages: [`apps/forge/README.md`](../apps/forge/README.md)
- MCP servers: [`mcp-servers/README.md`](../mcp-servers/README.md)
- Forge command reference: [`docs/FORGE_COMMANDS.md`](FORGE_COMMANDS.md)
- Backend API spec: [`docs/openapi.json`](openapi.json)
