# Forge AI — Architecture Overview

This document is the single-page summary of the Forge AI architecture. It pulls from the locked Architecture Decision Records ([decisions/](decisions/README.md)) without repeating their detail. For the underlying evidence, see [docs/research-forge-architecture-decisions-2026-06-20.md](../research-forge-architecture-decisions-2026-06-20.md).

## Mission

> **Forge is not an AI agent.**
> **Forge is the operating system that orchestrates agents, knowledge, governance, and delivery workflows.**

Forge AI is an enterprise SDLC Agent Operating System. It ingests a tenant's repositories, documentation, and ticketing systems into a project intelligence knowledge graph; it provides delivery accelerators (Ideation, Architecture, Development, Security, Testing, Deployment) that produce typed artifacts; and it governs every action through approval gates, audit, cost attribution, and observability.

## Constitution (8 Immutable Rules)

| # | Rule | ADR / Source |
|---|---|---|
| **R1** | Model-provider agnostic — all LLM traffic through LiteLLM Proxy | [ADR-005](decisions/0005-litellm-proxy-provider-abstraction.md) (DL-025, NFR-029) |
| **R2** | Multi-tenancy by default — `tenant_id` + `project_id` + RLS on every record | [ADR-002](decisions/0002-postgresql-17-apache-age-pgvector.md) (NFR-006, NFR-007, DL-026) |
| **R3** | Mandatory human approval gates at Architecture, Security, Deployment boundaries | [ADR-007](decisions/0007-langgraph-sdlc-agent-orchestrator.md) (NFR-032, DL-002) |
| **R4** | Typed artifacts only — ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan | F-010 |
| **R5** | Layer isolation — Organization Knowledge shared; Project Intelligence isolated | NFR-006, DL-004, DL-005 |
| **R6** | Mandatory auditability — agent, model, prompt, tool, cost, artifact, timestamp, result | [ADR-008](decisions/0008-append-only-worm-audit-trail.md) (NFR-020, F-005, F-407) |
| **R7** | Mandatory observability — OpenTelemetry tracing, metrics, logs from day one | Rule 7, NFR-021..023 |
| **R8** | Configurable everything — no hardcoded GitHub/Claude/OpenAI/AWS/Jira assumptions | NFR-029, F-014, F-016 |

## Tech Stack (Locked)

| Layer | Technology | ADR / Source |
|---|---|---|
| Frontend | Next.js 15, React 19, TypeScript 5.x, Shadcn/UI, Tailwind CSS 3.4.x | project-context.md |
| State / Data | TanStack Query, Zustand | project-context.md |
| Visualization | React Flow, Recharts | project-context.md |
| Terminal Emulator | xterm.js + xterm-addon-fit | [ADR-006](decisions/0006-terminal-center-xterm-native-pty.md) |
| Realtime | WebSocket + Redis Pub/Sub | project-context.md |
| Backend | FastAPI, Python 3.13, Pydantic v2 | project-context.md |
| Agent Runtime | LangGraph, LangChain, LiteLLM, OpenTelemetry | [ADR-007](decisions/0007-langgraph-sdlc-agent-orchestrator.md) |
| Database | PostgreSQL 17 + pgvector | [ADR-002](decisions/0002-postgresql-17-apache-age-pgvector.md) |

**Note:** Tailwind 4 migration is deferred to post-pilot (see REQUIREMENTS.md "Out of Scope" — Tailwind 4 migration). Pinned at 3.4.14 in apps/forge/package.json.
| Graph | Apache AGE (PostgreSQL extension) | [ADR-002](decisions/0002-postgresql-17-apache-age-pgvector.md) |
| Cache / Queue | Redis | project-context.md |
| Auth | Keycloak, OIDC, SAML, RBAC | project-context.md |
| Provider Abstraction | LiteLLM Proxy | [ADR-005](decisions/0005-litellm-proxy-provider-abstraction.md) (DL-025) |
| Dev Execution | GSD Core + GSD Pi (`@opengsd`) — white-labeled as `forge-*` | [ADR-004](decisions/0004-gsd-white-labeling.md) (DL-024) |
| Intelligence Gen | repomix, GSD graphify, map-codebase, ingest-docs, capture | implementation_plan.md |
| Process Manager | FastAPI subprocess manager (PTY for terminals) | [ADR-006](decisions/0006-terminal-center-xterm-native-pty.md) |
| Infra | AWS ECS Fargate, RDS PostgreSQL 17, ElastiCache Redis, S3, KMS | [ADR-001](decisions/0001-cloud-only-aws-deployment.md) |
| Audit | Append-only PostgreSQL table with daily hash chain | [ADR-008](decisions/0008-append-only-worm-audit-trail.md) |
| Local Dev | Docker, Docker Compose | project-context.md |

## Topology Diagram

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

## Data Flow for a Typical SDLC Run

The following sequence shows a typical Forge SDLC run from initiation to deployment. Each step traces which ADRs apply.

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

## Cross-References

- ADRs (full detail): [decisions/README.md](decisions/README.md)
- Research that grounds these decisions: [docs/research-forge-architecture-decisions-2026-06-20.md](../research-forge-architecture-decisions-2026-06-20.md)
- Constitutional rules: [docs/project-context.md](../project-context.md)
- Implementation plan (75 FRs, 11 milestones): [implementation_plan.md](../../implementation_plan.md)