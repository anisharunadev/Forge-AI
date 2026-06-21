---
title: Architecture Tour
description: A guided walkthrough of the Forge AI architecture — concepts mapped onto components.
---

This page is a guided walkthrough of the Forge AI architecture. It assumes you've read [What is Forge?](/start-here/what-is-forge/) and gives you a map from concepts to components before you dive into individual [ADRs](/architecture/adr-001-aws/).

## What is this?

A reading path. The full [Architecture overview](/architecture/overview/) is the canonical reference; this tour is the path through it.

## The five layers

Forge is a five-layer system. Each layer has a clear boundary and a clear owner.

```text
+-----------------------------------------------------------+
|  L5. Browser — Next.js 15, React 19, xterm.js, React Flow |
+-----------------------------------------------------------+
|  L4. API — FastAPI, Pydantic v2, OpenAPI 3                |
+-----------------------------------------------------------+
|  L3. Orchestration — LangGraph, LiteLLM, OpenTelemetry    |
+-----------------------------------------------------------+
|  L2. Data — PostgreSQL 17, Apache AGE, pgvector, Redis    |
+-----------------------------------------------------------+
|  L1. Platform — AWS ECS Fargate, RDS, KMS, S3, LocalStack |
+-----------------------------------------------------------+
```

| Layer | Stack | ADR |
|---|---|---|
| L1. Platform | AWS ECS Fargate, RDS PostgreSQL 17, ElastiCache Redis, S3, KMS, LocalStack (dev) | [ADR-001](/architecture/adr-001-aws/) |
| L2. Data | PostgreSQL 17 + Apache AGE (graph) + pgvector (embeddings), Redis cache + pub/sub, RLS on every table | [ADR-002](/architecture/adr-002-postgres-age/) |
| L3. Orchestration | LangGraph SDLC agent runtime, LiteLLM Proxy for model-provider abstraction, OpenTelemetry instrumentation | [ADR-005](/architecture/adr-005-litellm/), [ADR-007](/architecture/adr-007-langgraph/) |
| L4. API | FastAPI, Pydantic v2, WebSocket for realtime, OpenAPI 3 schema | n/a |
| L5. Browser | Next.js 15, React 19, xterm.js (terminal), React Flow (graph viz), Shadcn/UI, Tailwind 4 | n/a |

## Tour stops

### Stop 1 — A user invokes a forge-* command

Open `/forge-command-center`. Pick a category, pick a command, fill the args form, submit. This is layer 5 in action.

The Command Center maps the user-facing action to a `forge-<area>-<verb>` triple via the `FORGE_COMMAND_MAP`. The map is the single source of truth — see [ADR-004](/architecture/adr-004-white-label/).

### Stop 2 — The orchestrator spawns a workflow

The `forge-*` command reaches the LangGraph orchestrator (layer 3). An `SDLCState` Pydantic object is created; checkpointing is enabled for resumability. See [ADR-007](/architecture/adr-007-langgraph/).

If the command is `requires_approval=True`, the orchestrator pauses at the HITL gate. The command does **not** execute until an authorized human approves.

### Stop 3 — The orchestrator calls the LLM

Every LLM call goes through the LiteLLM Proxy. The proxy holds virtual keys per tenant, emits its own audit log, enforces budget guardrails, and emits Prometheus metrics. See [ADR-005](/architecture/adr-005-litellm/).

This is the choke point for model-provider swap, cost attribution, and guardrails. If the LLM traffic doesn't go through the proxy, the architecture is broken.

### Stop 4 — The orchestrator writes to data

Discovery and knowledge-graph writes go to PostgreSQL 17 + Apache AGE (graph nodes) + pgvector (embeddings). All writes pass through RLS that filters by `tenant_id` + `project_id`. See [ADR-002](/architecture/adr-002-postgres-age/).

The two-layer model — Organization Knowledge shared, Project Intelligence isolated — is enforced at the RLS layer. See [ADR-003](/architecture/adr-003-mdm-steward/) for how conflicts are resolved.

### Stop 5 — The orchestrator emits audit + observability

Every action — agent invocation, model call, prompt, tool, cost, timestamp, result — lands in the append-only `audit_log` table with a daily hash chain. See [ADR-008](/architecture/adr-008-worm-audit/).

OpenTelemetry spans flow to the observability backend (CloudWatch in production). LiteLLM metrics flow to Prometheus.

### Stop 6 — The orchestrator may launch a terminal

Some workflows (Build, Test, Review, Hotfix) need a real shell. The orchestrator launches a process through the **Terminal Manager**, which streams a native PTY to the browser via xterm.js. Every byte is audited. See [ADR-006](/architecture/adr-006-terminal-pty/).

### Stop 7 — The audit account mirrors everything

The audit database lives in a separate AWS account from the primary data plane. CloudTrail mirrors into S3 Object Lock. The daily hash chain anchors the mirror. This separation is what makes the audit trail tamper-evident even against a compromised primary account.

## Cross-cutting concerns

| Concern | Where it lives | ADR |
|---|---|---|
| Multi-tenancy | RLS policies on every table + per-tenant KMS CMK | [ADR-001](/architecture/adr-001-aws/), [ADR-002](/architecture/adr-002-postgres-age/) |
| White-labeling | `FORGE_COMMAND_MAP` is the only user-facing name surface | [ADR-004](/architecture/adr-004-white-label/) |
| Approval | LangGraph HITL gate, enforced by orchestrator | [ADR-007](/architecture/adr-007-langgraph/) |
| Model-provider swap | LiteLLM Proxy is the only egress | [ADR-005](/architecture/adr-005-litellm/) |
| Audit | Append-only PostgreSQL table + daily hash chain | [ADR-008](/architecture/adr-008-worm-audit/) |

## When should I use this tour?

Read this tour if you are:

- A new engineer onboarding to Forge.
- An architect evaluating whether Forge fits your needs.
- A reviewer trying to understand where a specific concern is anchored.

If you want to go deeper, the [Architecture overview](/architecture/overview/) is the canonical reference and the eight [ADRs](/architecture/adr-001-aws/) are the binding decisions.

## Related

- [Architecture overview](/architecture/overview/)
- [ADR-001: AWS-only deployment](/architecture/adr-001-aws/)
- [ADR-002: PostgreSQL + AGE + pgvector](/architecture/adr-002-postgres-age/)
- [ADR-007: LangGraph SDLC orchestrator](/architecture/adr-007-langgraph/)
