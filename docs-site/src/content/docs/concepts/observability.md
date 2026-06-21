---
title: Observability
description: How Forge instruments every layer — traces, metrics, logs from day one.
---

Observability is a constitutional rule in Forge. Every layer emits OpenTelemetry spans, every LLM call is metered through the LiteLLM Proxy, and the audit ledger is the canonical event log.

## What is this?

Three pillars of observability, anchored to specific layers:

| Pillar | Tooling | Source layer |
|---|---|---|
| **Traces** | OpenTelemetry → CloudWatch (AWS) | LangGraph orchestrator, FastAPI, MCP servers, browser |
| **Metrics** | OpenTelemetry + Prometheus | LiteLLM Proxy, FastAPI, ECS Fargate, RDS |
| **Logs** | Structured JSON → CloudWatch | FastAPI, LangGraph, GSDWrapper, MCP servers |

Plus the **append-only audit ledger** as the canonical event log — see [Auditability](/concepts/auditability/).

## Why does it exist?

You cannot operate an AI platform you cannot observe. Cost attribution, latency budgets, error budgets, prompt drift, agent success rates — none of these are computable from logs alone. They require structured traces with tenant, project, workflow, and prompt attributes.

R7 (mandatory observability) was added in the architecture constitution after the team observed that "we know the cost is too high, but we don't know which workflow caused it" was the most expensive operational problem of the early system.

## What problem does it solve?

| Problem | Without observability | With observability |
|---|---|---|
| "Which workflow is expensive?" | Guess | Query LiteLLM metrics filtered by `workflow.id` |
| "Why did this approval take 24 hours?" | Read chat history | Trace the approval event with timestamps |
| "Did the prompt change last week?" | Diff the prompt manually | Pull prompt_hash from audit_log |
| "What is the p99 latency of `forge-arch-adr`?" | Run the command and time it | Query the metric directly |

## How does it work?

### Tracing

Every workflow run emits a root span with attributes:

```text
trace.id          = 7f9c...
span.name         = "workflow.run"
attributes:
  tenant.id       = acme-corp
  project.id      = acme-api
  workflow.id     = wf-2026-06-21-001
  forge.command   = forge-arch-adr
  user.id         = alice@acme.com
```

Each child span (LLM call, tool call, connector call, DB write) inherits the trace context and adds its own attributes. The full trace is queryable by `workflow.id`.

### Metrics

LiteLLM emits metrics on every LLM call:

- `litellm_requests_total{tenant, model, command}`
- `litellm_cost_usd_total{tenant, model, command}`
- `litellm_tokens_total{tenant, model, direction}`
- `litellm_latency_seconds{tenant, model}`

FastAPI emits RED metrics (Rate, Errors, Duration) per route. ECS Fargate emits container metrics. RDS emits database metrics.

### Logs

Structured JSON. Every log line includes `trace.id`, `tenant.id`, `project.id`, and `user.id` when available. Logs are queryable by any of these fields.

### Audit ledger as event log

The append-only `audit_log` table is the canonical event log for business events: command invocations, approvals, artifact state transitions, conflicts, deploys. It is mirrored to a separate AWS account — see [ADR-008](/architecture/adr-008-worm-audit/).

## How do I use it?

As a developer, you mostly consume traces via the Trace Explorer in the observability dashboard. Filters: `tenant.id`, `project.id`, `workflow.id`, `forge.command`, `user.id`.

As an operator, you set SLOs and alerts on the metrics. The standard alerts are:

- LiteLLM cost > budget envelope per tenant per day
- `forge-deploy-prod` p99 latency > 5 minutes
- Approval latency p90 > 24 hours (operational KPI)
- Audit ledger hash chain anchor failure

As a security reviewer, you query the audit ledger by actor, action, or artifact.

## When should I use it?

Always — observability is on by default. The only decisions you make are:

- **SLO targets** — what's "fast enough" for each command?
- **Budget envelopes** — how much per tenant per day?
- **Retention** — how long do you keep traces? (Default 30 days; audit ledger is forever in the audit account.)

## Related

- [Auditability](/concepts/auditability/)
- [Cost attribution](/operations/success-metrics/) — Cost per Cycle
- [ADR-005: LiteLLM Proxy](/architecture/adr-005-litellm/)
- [ADR-008: Append-only audit](/architecture/adr-008-worm-audit/)
