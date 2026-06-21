---
title: ADR-005 — LiteLLM Proxy for model-provider abstraction
description: All LLM traffic flows through the LiteLLM Proxy — no direct provider calls.
---

## Status

Accepted — 2026-06-20

## What is this?

The binding decision that **all** LLM traffic in Forge flows through a LiteLLM Proxy. No application code imports a provider SDK directly. The proxy is the only egress.

## Context

The platform needs to call LLMs (Anthropic, OpenAI, Bedrock, Vertex, Azure, OpenRouter, …) for agent reasoning. Without a choke point, each call site imports the provider SDK and we lose:

- Per-tenant cost attribution.
- Per-tenant budget guardrails.
- Audit (which model, which prompt, which result, at what cost).
- Provider swap (changing providers requires code changes everywhere).

The forces at play:

- Rule R1 (model-provider agnostic) is constitutional. It cannot be satisfied without a choke point.
- Cost attribution (NFR-030) requires per-call attribution, which requires a proxy that sees every call.
- Pilot customer auditability (NFR-020) requires a single audit log of all LLM usage.
- Time-to-pilot is reduced if we use a battle-tested proxy rather than build our own.

## Decision drivers

- DL-025: Model-provider agnostic
- NFR-029: Configurable everything (no hardcoded provider assumptions)
- NFR-030: Cost attribution
- NFR-020: Auditability
- Rule R1: Constitutional

## Considered options

- LiteLLM Proxy — **chosen**
- Direct provider SDKs in each call site
- Custom-built proxy
- Per-call-site abstractions (each agent wraps its own provider)

## Decision outcome

Chosen option: **LiteLLM Proxy**.

| Aspect | Detail |
|---|---|
| Deployment | ECS Fargate service in the primary account |
| Auth | Virtual keys per tenant |
| Audit | Own access log, mirrored to the audit account |
| Metrics | Prometheus exporter → CloudWatch |
| Guardrails | Per-tenant budget envelopes, model allowlists |

The application code uses the LiteLLM client (or HTTP) and passes the tenant's virtual key. The proxy translates to the underlying provider.

## How a call flows

```text
Orchestrator (or agent)
    |
    | POST /v1/chat/completions
    | Headers: Authorization: Bearer <virtual-key-for-tenant>
    | Body: { model, messages, ... }
    v
+--------------------+
| LiteLLM Proxy      |
|  - resolves        |
|    virtual key to  |
|    real provider   |
|    key             |
|  - checks budget   |
|  - emits metric    |
|  - writes own      |
|    audit row       |
|  - calls provider  |
+--------------------+
    |
    v
Provider (Anthropic / OpenAI / ...)
    |
    v
LiteLLM Proxy
    |
    v
Caller (with result + cost in headers)
```

## Virtual keys

Per tenant, the proxy holds a virtual key. The mapping from virtual to real key lives in the proxy's config file (`litellm_config.yaml`). The application code never sees the real key.

```yaml
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY

litellm_settings:
  drop_params: true
  set_verbose: false

model_list:
  - model_name: claude-sonnet-4
    litellm_params:
      model: anthropic/claude-sonnet-4-20250514
      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY
```

Tenant virtual keys map to allowed models and budgets.

## Budget envelopes

Per tenant, the proxy enforces a daily budget. When exceeded:

- The call returns 429.
- An alert fires.
- The orchestrator pauses the workflow and emits an audit row.

## Audit

The proxy writes its own audit log. It is mirrored to the audit account. The audit ledger in the primary account references the proxy's log row id.

## Provider swap

To swap providers, edit `litellm_config.yaml` and roll the proxy. No application code changes. The proxy handles the rest.

## Consequences

**Positive:**

- Single choke point for cost, audit, and provider swap.
- Per-tenant budget enforcement.
- Battle-tested proxy; no build-and-maintain cost.
- Native OpenTelemetry and Prometheus support.

**Negative:**

- The proxy is a single point of failure; needs HA.
- Latency overhead per call (a few ms).
- The proxy must be versioned alongside the orchestrator.

**Neutral:**

- The proxy's HA is handled by ECS service auto-scaling.

## Alternatives considered

### Direct provider SDKs

Pros: Lowest latency.

Cons: Violates R1; no cost attribution; no audit; provider swap is a code change.

### Custom-built proxy

Pros: Tailored to our needs.

Cons: Build cost; maintenance; we re-invent LiteLLM.

### Per-call-site abstractions

Pros: Some encapsulation.

Cons: Each call site still imports a provider SDK; doesn't satisfy the choke-point requirement.

## Related

- [ADR-007: LangGraph SDLC orchestrator](/architecture/adr-007-langgraph/)
- [Observability](/concepts/observability/)
- [Constitutional rules](/concepts/constitutional-rules/) — R1
