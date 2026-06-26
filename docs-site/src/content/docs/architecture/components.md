---
draft: false
title: Components
description: Per-component responsibilities, ownership, and interfaces.
---

Forge has eight named components. This page describes each one's responsibility, owner, and external interfaces.

## What is this?

A component reference. The [Architecture overview](/architecture/overview/) shows how they fit together; this page describes what each one does.

## The eight components

```text
+------------------------------------------------------------------+
| 1. Browser (Next.js 15 + React 19)                               |
|    - Command Center / Terminal Center / Knowledge Center         |
+------------------------------------------------------------------+
| 2. FastAPI Backend                                               |
|    - REST API, WebSocket, OpenAPI 3                               |
+------------------------------------------------------------------+
| 3. LangGraph Orchestrator                                        |
|    - SDLCState, checkpoints, HITL gates                          |
+------------------------------------------------------------------+
| 4. LiteLLM Proxy                                                 |
|    - Virtual keys, audit logs, guardrails, metrics               |
+------------------------------------------------------------------+
| 5. Project Intelligence Knowledge Graph                          |
|    - Apache AGE + pgvector, RLS, conflict resolution             |
+------------------------------------------------------------------+
| 6. Append-Only Audit Ledger                                      |
|    - PostgreSQL table + hash chain + S3 anchors                  |
+------------------------------------------------------------------+
| 7. Connector Framework (MCP Servers)                             |
|    - 13 first-party connectors + extension model                 |
+------------------------------------------------------------------+
| 8. Identity & Policy (Keycloak + Policy Engine)                  |
|    - OIDC/SAML, RBAC, per-tenant policy                          |
+------------------------------------------------------------------+
```

## 1. Browser

| Aspect | Detail |
|---|---|
| Tech | Next.js 15, React 19, TypeScript 5, Shadcn/UI, Tailwind 4 |
| Surfaces | Command Center, Terminal Center, Knowledge Center, Persona dashboards |
| Realtime | WebSocket via Redis Pub/Sub |
| State | TanStack Query (server state), Zustand (local state) |

The browser never speaks to Postgres or the LLM provider directly. It goes through the FastAPI backend.

## 2. FastAPI Backend

| Aspect | Detail |
|---|---|
| Tech | FastAPI, Python 3.13, Pydantic v2 |
| API | REST + WebSocket, OpenAPI 3 schema |
| Auth | JWT (Keycloak-issued), per-request `tenant_id` |
| Observability | OpenTelemetry middleware on every route |

The backend is the single ingress. It dispatches to the orchestrator, the connector framework, and the data layer.

## 3. LangGraph Orchestrator

| Aspect | Detail |
|---|---|
| Tech | LangGraph, LangChain, Python 3.13 |
| State | `SDLCState` (Pydantic v2) per workflow run |
| Persistence | PostgreSQL checkpoints |
| Gates | HITL nodes with typed approval |

The orchestrator composes agents into workflows. See [ADR-007](/architecture/adr-007-langgraph/) and [Agent operating system](/concepts/agent-operating-system/).

## 4. LiteLLM Proxy

| Aspect | Detail |
|---|---|
| Tech | LiteLLM Proxy |
| Auth | Virtual keys per tenant |
| Audit | Own access log, mirrored to the audit account |
| Metrics | Prometheus exporter |

The proxy is the only egress for LLM traffic. See [ADR-005](/architecture/adr-005-litellm/) and [Observability](/concepts/observability/).

## 5. Project Intelligence Knowledge Graph

| Aspect | Detail |
|---|---|
| Tech | PostgreSQL 17 + Apache AGE (graph) + pgvector (embeddings) |
| Storage | Nodes and edges in AGE; vectors in pgvector |
| Isolation | RLS by `tenant_id` + `project_id` |
| Conflict | Steward-priority per [ADR-003](/architecture/adr-003-mdm-steward/) |

See [Knowledge graph](/concepts/knowledge-graph/) and [ADR-002](/architecture/adr-002-postgres-age/).

## 6. Append-Only Audit Ledger

| Aspect | Detail |
|---|---|
| Tech | PostgreSQL table with INSERT-only grants |
| Anchoring | Daily hash chain anchor to S3 Object Lock |
| Mirror | Cross-account mirror in the audit AWS account |

See [Auditability](/concepts/auditability/) and [ADR-008](/architecture/adr-008-worm-audit/).

## 7. Connector Framework (MCP Servers)

| Aspect | Detail |
|---|---|
| Tech | MCP servers, one per external system |
| Coverage | GitHub, Jira, Confluence, Figma, Slack, AWS, SonarQube, Zendesk, ClickUp, Azure DevOps, Databricks, arch-analyzer, secrets |
| Health | State machine: pending / live / degraded / down |

See [Adding connectors](/guides/adding-connectors/) and [ADR-004](/architecture/adr-004-white-label/).

## 8. Identity & Policy

| Aspect | Detail |
|---|---|
| Identity | Keycloak with OIDC and SAML |
| AuthZ | RBAC + ABAC (per-tenant policy) |
| Roles | `user`, `admin`, `steward`, `security_reviewer`, `architect`, `release_manager` |

The policy engine evaluates which `forge-*` commands a user can run, whether they require approval, and which approval role applies.

## Interfaces

| From → To | Interface |
|---|---|
| Browser → Backend | HTTPS REST + WebSocket |
| Backend → Orchestrator | Python in-process |
| Orchestrator → LiteLLM | HTTPS with virtual key |
| Backend → Postgres | psycopg via asyncpg |
| Connector → External | Vendor SDK or HTTPS |
| Backend → Audit | Append-only table writes + daily anchor Lambda |

## Related

- [Architecture overview](/architecture/overview/)
- [Data flow](/architecture/data-flow/)
- [Layer isolation](/architecture/layer-isolation/)
- [ADR-001: AWS-only deployment](/architecture/adr-001-aws/)
