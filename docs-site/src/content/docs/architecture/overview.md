---
draft: false
title: Architecture Overview
description: A single-page summary of the Forge AI architecture — anchored to the eight locked ADRs.
---

This page is the single-page summary of the Forge AI architecture. It pulls from the eight locked Architecture Decision Records (ADRs) without repeating their detail. For the underlying evidence, see the research document in the repository.

## What is this?

The canonical reference for the Forge architecture. If a section here disagrees with an ADR, the ADR wins. The ADRs are the binding decisions; this page is the orientation.

## Mission

> **Forge is not an AI agent.**
> **Forge is the operating system that orchestrates agents, knowledge, governance, and delivery workflows.**

Forge AI is an enterprise SDLC Agent Operating System. It ingests a tenant's repositories, documentation, and ticketing systems into a project intelligence knowledge graph; it provides delivery accelerators (Ideation, Architecture, Development, Security, Testing, Deployment) that produce typed artifacts; and it governs every action through approval gates, audit, cost attribution, and observability.

## Constitutional rules

| # | Rule | ADR |
|---|---|---|
| **R1** | Model-provider agnostic — all LLM traffic through LiteLLM Proxy | [ADR-005](/architecture/adr-005-litellm/) |
| **R2** | Multi-tenancy by default — `tenant_id` + `project_id` + RLS on every record | [ADR-002](/architecture/adr-002-postgres-age/) |
| **R3** | Mandatory human approval gates at Architecture, Security, Deployment | [ADR-007](/architecture/adr-007-langgraph/) |
| **R4** | Typed artifacts only — ADR, API Contract, Task Breakdown, Risk Register, Security Report, Deployment Plan | F-010 |
| **R5** | Layer isolation — Organization Knowledge shared; Project Intelligence isolated | NFR-006, DL-004, DL-005 |
| **R6** | Mandatory auditability — agent, model, prompt, tool, cost, artifact, timestamp, result | [ADR-008](/architecture/adr-008-worm-audit/) |
| **R7** | Mandatory observability — OpenTelemetry tracing, metrics, logs from day one | Rule 7, NFR-021..023 |
| **R8** | Configurable everything — no hardcoded GitHub/Claude/AWS/Jira assumptions | NFR-029, F-014, F-016 |

## Tech stack (locked)

| Layer | Technology | ADR |
|---|---|---|
| Frontend | Next.js 15, React 19, TypeScript 5.x, Shadcn/UI, Tailwind CSS 4 | project context |
| State / Data | TanStack Query, Zustand | project context |
| Visualization | React Flow, Recharts | project context |
| Terminal Emulator | xterm.js + xterm-addon-fit | [ADR-006](/architecture/adr-006-terminal-pty/) |
| Realtime | WebSocket + Redis Pub/Sub | project context |
| Backend | FastAPI, Python 3.13, Pydantic v2 | project context |
| Agent Runtime | LangGraph, LangChain, LiteLLM, OpenTelemetry | [ADR-007](/architecture/adr-007-langgraph/) |
| Database | PostgreSQL 17 + pgvector | [ADR-002](/architecture/adr-002-postgres-age/) |
| Graph | Apache AGE (PostgreSQL extension) | [ADR-002](/architecture/adr-002-postgres-age/) |
| Cache / Queue | Redis | project context |
| Auth | Keycloak, OIDC, SAML, RBAC | project context |
| Provider Abstraction | LiteLLM Proxy | [ADR-005](/architecture/adr-005-litellm/) |
| Dev Execution | Multi-runtime agent runtime, white-labeled as `forge-*` | [ADR-004](/architecture/adr-004-white-label/) |
| Process Manager | FastAPI subprocess manager (PTY for terminals) | [ADR-006](/architecture/adr-006-terminal-pty/) |
| Infra | AWS ECS Fargate, RDS PostgreSQL 17, ElastiCache Redis, S3, KMS | [ADR-001](/architecture/adr-001-aws/) |
| Audit | Append-only PostgreSQL table with daily hash chain | [ADR-008](/architecture/adr-008-worm-audit/) |
| Local Dev | Docker, Docker Compose | project context |

## Topology diagram

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
|  |   +-----------------------+   |      |  | Append-only audit_log + hash chain | | |
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

## Layer isolation

Forge separates knowledge into two layers per Rule 5:

```text
+--------------------------------------------------------------------+
|                  Organization Knowledge Layer                       |
|  - Shared across all projects within a tenant                       |
|  - Owned by Steward role                                            |
|  - Examples: standards, templates, policies, org glossary           |
|  - Stored as relational tables in PostgreSQL 17                     |
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

The two layers are physically co-located in the same database but isolated by RLS policies that use both `tenant_id` and a layer discriminator.

## Data flow for a typical SDLC run

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
   - forge-intel-scan-* commands
   - Read from PostgreSQL + AGE; write to graph nodes
   - Each ingestion event audited to audit_log  (ADR-008)
   - Conflicts (code vs. Jira vs. Confluence) enter `conflicted` state
     per ADR-003, surfaced in Steward queue
   |
   v
5. Plan phase
   - LangGraph node invokes LLM via LiteLLM Proxy  (ADR-005)
   - Prompt + result hashes recorded in audit_log
   - Cost attributed to workflow.cost_actual
   |
   v
6. Architecture phase
   - LangGraph HITL gate pauses for human approval  (Rule 3, ADR-007)
   - Approval decision audited
   - If approved, ADR + API Contract + Task Breakdown produced  (Rule 4)
   |
   v
7. Build / Test / Review phases
   - Forge Terminal Center may launch an agent CLI in a browser tab  (ADR-006)
   - Workspace isolation: PTY cwd = session.workspace
   - Every byte streamed to the browser is audited
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
    - Audit database is in a separate AWS account from primary data (ADR-001)
```

## Cross-references

- [ADRs](/architecture/adr-001-aws/) — eight binding decisions
- [Components](/architecture/components/) — per-component responsibilities
- [Data flow](/architecture/data-flow/) — sequence diagrams
- [Layer isolation](/architecture/layer-isolation/) — RLS and knowledge layers
- [Approval model](/architecture/approval-model/) — HITL gate details
