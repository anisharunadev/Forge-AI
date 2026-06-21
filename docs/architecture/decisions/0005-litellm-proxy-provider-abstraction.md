# ADR-005: LiteLLM Proxy as Provider Abstraction Layer (DL-025)

- Status: Accepted
- Date: 2026-06-20
- Deciders: Forge Architecture Working Group
- Related research: [docs/research-forge-architecture-decisions-2026-06-20.md](../../research-forge-architecture-decisions-2026-06-20.md) (Q4)

## Context and Problem Statement

Constitution Rule 1 requires Forge to be model-provider agnostic: no service may directly depend on the OpenAI SDK, Anthropic SDK, Gemini SDK, or any other provider-specific SDK. All LLM traffic must flow through the Forge Provider Abstraction Layer (DL-025).

The platform must support multiple LLM providers (Anthropic, OpenAI, Google, Bedrock, Vertex AI, OpenRouter, Azure OpenAI) without code changes. Each provider has a different SDK, different request/response shapes, different error semantics, and different cost models. Direct SDK usage in application code would couple the system to specific providers and violate Rule 8 (Configurable Everything).

DL-025 names the Provider Abstraction Layer. We must choose its implementation.

The forces at play:

- Rule 1 forbids direct provider SDK imports in business logic.
- NFR-029 requires model-provider agnosticism.
- NFR-030 requires workflow-level cost attribution with token-level breakdown.
- NFR-020 requires auditable LLM calls (prompt, model, cost, result).
- Rule 8 forbids hardcoded provider assumptions.
- The chosen solution must be operationally tractable - one component, not a chain of adapters.

## Decision Drivers

- Rule 1: Model-provider agnosticism
- NFR-029: Provider-agnostic LLM access
- NFR-030: Cost attribution as architectural invariant
- NFR-020: Auditability
- DL-025: Provider Abstraction Layer
- Operational simplicity (one component, not many)

## Considered Options

- LiteLLM Proxy (self-hosted, OpenAI-compatible) - chosen
- Direct OpenAI SDK with retry-on-failover abstraction
- LangChain model abstraction
- Custom gateway (in-house)
- Portkey AI Gateway

## Decision Outcome

Chosen option: **A self-hosted LiteLLM Proxy is the single ingress point for all LLM traffic**.

Architecture:

```text
Forge services (LangGraph agents, FastAPI handlers, Forge UI server actions)
    |
    v
Forge Provider Abstraction Layer (thin in-house wrapper)
    - Enforces tenant binding
    - Tags every call with workflow_id, engagement_id, tenant_id
    - Emits OpenTelemetry spans
    - Adds workflow tag for cost attribution
    |
    v
LiteLLM Proxy (single LLM ingress)
    - OpenAI-compatible /v1/chat/completions
    - Virtual keys per tenant/team/user with budgets
    - store_audit_logs: true
    - Prometheus metrics on remaining_budget, request count, model latency
    - Guardrails for content filtering and PII masking
    |
    v
[OpenAI] [Anthropic] [Bedrock] [Vertex AI] [OpenRouter] [Azure OpenAI]
```

Key commitments:

- Application code only knows the proxy URL (an env var) and the OpenAI-compatible request shape.
- Provider credentials live only in LiteLLM's config; application services never see them.
- Per-tenant virtual keys with budgets (LiteLLM's `max_budget` per virtual key) implement pre-call admission control.
- `store_audit_logs: true` captures every LLM call into a queryable audit store.
- Prometheus metrics expose `litellm_remaining_budget` for post-call alerting.
- A workflow-level cost ledger (PostgreSQL table) aggregates per-call costs from LiteLLM's `response_cost` callback into `workflow.cost_actual`.

### Consequences

Positive:

- Single point of provider swap: change LiteLLM config, no code changes.
- Built-in audit logs satisfy NFR-020 for LLM traffic.
- Built-in virtual keys with budgets satisfy NFR-030's pre-call admission control.
- Prometheus metrics satisfy NFR-022 (metrics) and provide budget burn-down alerting.
- Guardrails (PII masking, content filtering) help with NFR-002 GDPR posture.
- LangGraph, custom agents, and OpenAI-compatible clients all work without per-provider code.

Negative:

- Extra hop on every LLM call adds latency (single-digit milliseconds at p50, more at p99).
- LiteLLM Proxy becomes a critical dependency; its uptime is Forge's uptime.
- LiteLLM Enterprise tier evaluation is required for HA, multi-region, SOC2 attestation.

Neutral:

- Provider-specific quirks (Anthropic's prompt caching, Bedrock's regional endpoints) are abstracted by LiteLLM but may surface in support tickets.

## Alternatives Considered

### Direct OpenAI SDK with retry-on-failover abstraction

Pros:

- Lowest possible latency (no proxy hop).
- Full SDK features (function calling, streaming, vision).

Cons:

- Couples code to OpenAI; switching providers requires code changes.
- Violates Rule 1 directly.
- Each provider requires its own retry/failover logic.

Rejected: violates Rule 1 by design.

### LangChain model abstraction

Pros:

- Already in the stack (LangChain + LangGraph).
- Provider abstraction via `ChatModel` interface.

Cons:

- LangChain abstractions are leaky: provider-specific features (Anthropic prompt caching, OpenAI tool_calls vs. Anthropic tool_use) surface in code.
- "Magic" behavior in chains obscures the actual LLM call shape.
- Audit and cost attribution must still be implemented; LangChain does not give them for free.

Rejected: leaks provider details into code; does not satisfy NFR-030 out of the box.

### Custom gateway (in-house)

Pros:

- Exactly fits Forge's needs.
- No external dependency.

Cons:

- Significant engineering effort (provider adapters, retries, cost tracking, audit, metrics).
- Continues to require maintenance as providers add features.
- Reinventing LiteLLM is a worse use of engineering time.

Rejected: too much work; LiteLLM already solves this.

### Portkey AI Gateway

Pros:

- Strong on gateway strategies (fallbacks, circuit breakers, conditional routing, canary testing).
- Production-grade gateway.

Cons:

- Weaker on built-in audit logging than LiteLLM.
- Less integrated Prometheus / virtual-key budget story.
- Two gateways (LiteLLM + Portkey) add complexity.

Rejected: weaker built-in audit and budget primitives than LiteLLM for Forge's specific needs.

## Pros and Cons of the Chosen Option

Pros:

- Aligns with Rule 1 without leaking provider details into code.
- Provides audit + cost + budgets out of the box.
- OpenAI-compatible interface means LangGraph, custom code, and OpenAI clients all work.
- Operational simplicity: one proxy to monitor, back up, and patch.

Cons:

- LiteLLM Proxy is a critical dependency; HA design needed for production.
- Latency overhead per call (small but non-zero).

## References

- [docs/research-forge-architecture-decisions-2026-06-20.md](../../research-forge-architecture-decisions-2026-06-20.md) (Q4 LLM Provider Abstraction)
- ADR-007: LangGraph as SDLC agent orchestrator (orchestrator uses the abstraction layer)
- ADR-008: Append-only WORM audit trail (LLM calls recorded here)
- Constitution Rule 1 (Model-provider agnosticism)
- PRD NFR-029, NFR-030, NFR-020, DL-025