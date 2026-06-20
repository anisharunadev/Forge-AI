# Forge AI-392.2 — LiteLLM-Backed Abstraction Spec

**Sub-plan:** 2 of 5
**Issue:** [Forge AI-392](/Forge AI/issues/Forge AI-392)
**Owner:** Senior Engineer
**Rev:** v0.1 — 2026-06-20 (draft, awaiting Board approval)
**Companion:** [`PROVIDER_INVENTORY.md`](./PROVIDER_INVENTORY.md) · [`ROUTING_FAILOVER.md`](./ROUTING_FAILOVER.md) · [`TOOL_STRUCTURED_OUTPUT.md`](./TOOL_STRUCTURED_OUTPUT.md)

---

## 0. Scope

This artefact specifies the **runtime surface** of the Provider Abstraction Layer (PAL): the typed interface every sub-agent imports, the retry / fallback policy, the cost-tracking seam, and the implementation choice (LiteLLM as the underlay).

**In scope:** interface contract, retry policy, fallback policy, cost recorder, audit-spine reconciliation, the LiteLLM choice with rationale.
**Out of scope:** per-provider adapter internals (sub-plan 4), routing rules (sub-plan 3), OpenAI-compat shim (sub-plan 5).

---

## 1. Why LiteLLM

LiteLLM is a Python library that exposes a single OpenAI-shaped interface across ~100 model providers, with built-in retry, fallback, cost tracking, and a per-model rate-limit registry. Forge AI already uses Python 3.12 for the agent runtime, evals, and ML ([coding.md §2](../../workspace/memory/coding.md)).

**Reasons to use LiteLLM as the underlay:**

1. **OpenAI-shaped surface.** LiteLLM's `completion()` / `acompletion()` matches the OpenAI request/response shape. Our own PAL can wrap it behind a richer typed contract without leaking the OpenAI shape to sub-agents.
2. **Built-in cost tracking.** `litellm.completion_cost(completion_response)` returns USD per call using its rate-card registry. We replace it with our own `provider_rates` table join (Forge AI-399 reconciliation) but the integration point is the same.
3. **Built-in retry + circuit breaker.** LiteLLM supports per-model retry, cooldown, and fallback. We configure it; we do not reinvent it.
4. **Provider coverage.** All seven charter providers are supported. We don't have to write per-provider SDK plumbing for the routing layer.
5. **Open source, MIT, vendor-neutral.** No lock-in to a single model vendor.

**Reasons we wrap, not expose:**

1. **TypeScript-first sub-agents.** The rest of Forge AI's sub-agents (BA, Architect, Dev, QA, Security, DevOps, Docs) are TypeScript. We need a thin TS client over LiteLLM (or a LiteLLM proxy server) so the abstraction is portable to TS without re-implementing routing.
2. **Audit spine (Forge AI-399) is not optional.** LiteLLM's cost callback is good; we replace it with an audit appender that writes to `audit.events` per the schema in `workspace/memory/security.md` §7.
3. **Scoped credentials per tenant (Forge AI-125).** LiteLLM keys belong to the Forge AI-126 broker, not to the agent runtime. The PAL holds a broker reference; LiteLLM holds the broker-supplied credential for the duration of one call.
4. **Prompt-injection defense (Forge AI-5 §5.2).** LiteLLM does not validate the boundary between user content and tool-call content. The PAL does (see sub-plan 4).

---

## 2. The PAL TypeScript surface (canonical)

```ts
// packages/pal/src/index.ts — the only import the rest of the platform needs

import type { JSONSchema } from "../sdlc-types/src/json-schema";

export interface ProviderCallRequest {
  /** Canonical tool/function schema. The PAL normalises provider-specific shapes. */
  readonly tools?: ReadonlyArray<ToolSpec>;
  /** JSON-Schema to enforce on the model's output. */
  readonly responseSchema?: JSONSchema;
  /** Per-tenant routing override (see sub-plan 3). */
  readonly routingHint?: RoutingHint;
  /** Stable identifier for idempotent retries. */
  readonly idempotencyKey: string;
  /** Audit correlation IDs. The PAL forwards them to every audit event. */
  readonly correlation: {
    readonly tenantId: string;
    readonly runId: string;
    readonly stage: string;
  };
}

export interface ProviderCallResponse<T> {
  readonly value: T;                          // parsed, schema-validated
  readonly providerId: ProviderId;           // "openai" | "anthropic" | ...
  readonly modelId: string;                  // "claude-sonnet-4-6", ...
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cachedInputTokens?: number;
  };
  readonly costUsd: number;                  // joined from provider_rates
  readonly latencyMs: number;
  readonly attempt: {
    readonly primary: ProviderId;
    readonly tried: ReadonlyArray<ProviderId>;
    readonly finalProviderId: ProviderId;
  };
}

export interface ProviderAbstractionLayer {
  /** One model call. Returns a schema-validated value. */
  complete<T>(req: ProviderCallRequest & {
    readonly system: string;
    readonly user: string | ReadonlyArray<MultiModalPart>;
    readonly temperature?: number;
    readonly maxTokens?: number;
  }): Promise<ProviderCallResponse<T>>;

  /** Tool-use turn. The PAL drives the loop until the model emits a final answer. */
  runWithTools(req: ProviderCallRequest & {
    readonly system: string;
    readonly user: string;
    readonly tools: ReadonlyArray<ToolSpec>;
    readonly maxSteps?: number;
  }): Promise<ProviderCallResponse<unknown>>;

  /** Streaming variant for the UI. Same audit and cost semantics. */
  stream(req: ProviderCallRequest & {
    readonly system: string;
    readonly user: string;
  }): AsyncIterable<StreamChunk>;

  /** Test seam: replace the underlay in unit tests. */
  __withUnderlay(u: PalUnderlay): ProviderAbstractionLayer;
}
```

The underlay (LiteLLM proxy or direct SDK) is hidden behind `PalUnderlay`. The TS-side default is **LiteLLM Proxy** running as a sidecar (Forge AI-126 broker pattern), so we keep LiteLLM in Python where it lives and expose a thin TS HTTP client.

---

## 3. Retry policy

| Failure class | Retry? | Backoff | Attempts | Hard fail? |
|---------------|--------|---------|----------|------------|
| `429 rate_limit_exceeded` | yes | exponential, jittered, cap 8s | 3 | yes after |
| `500 server_error` (provider) | yes | exponential, jittered, cap 16s | 3 | yes after |
| `502/503/504` (provider gateway) | yes | exponential, jittered, cap 8s | 3 | yes after |
| `400 invalid_request` | **no** | n/a | 1 | yes — caller bug |
| `401 unauthorized` | **no** | n/a | 1 | yes — credentials |
| `403 forbidden` (prompt-injection defense trip) | **no** | n/a | 1 | yes — security event |
| Network timeout (>30s) | yes | exponential, cap 8s | 2 | yes after |
| Schema-validation failure on `responseSchema` | yes (one retry with corrective system message) | 0s | 1 | yes after |

Retry is **per-call** with an `idempotency_key` derived from `(tenant_id, run_id, stage, request_hash)`. A retried call that hits a different provider records the failover in the audit event with `attempt.tried`.

---

## 4. Fallback policy

The PAL never silently fails over. A failover emits an audit event with `event_type: llm.failover` and a `from_provider`, `to_provider`, `reason`. The fallback ladder is **per-routing-hint**, decided in sub-plan 3. The PAL's job here is to **honour** the ladder, not decide it.

Default fallback ladder (until sub-plan 3 lands a per-tenant override):

```text
primary:    <routingHint.primaryProvider, primaryModel>
secondary:  <routingHint.secondaryProvider, secondaryModel>     (cheaper / different family)
tertiary:   <routingHint.tertiaryProvider, tertiaryModel>       (cheap-and-cheerful)
```

The PAL retries within the primary tier first, then moves to secondary, then tertiary. Tertiary failure is an `infrastructure` alert.

---

## 5. Cost tracking (Forge AI-399 reconciliation)

Every `complete()` / `runWithTools()` / `stream()` call writes exactly one `llm.call` audit event:

```jsonc
// audit.events row
{
  "event_type": "llm.call",
  "schema_version": "1.0",
  "tenant_id": "...",
  "run_id": "...",
  "stage": "...",
  "provider_id": "anthropic",
  "model_id": "claude-sonnet-4-6",
  "input_tokens": 1234,
  "output_tokens": 567,
  "cached_input_tokens": 0,
  "cost_usd": 0.0143,                 // joined from provider_rates
  "idempotency_key": "...",
  "attempt": {
    "primary": "openai",
    "tried": ["openai", "anthropic"],
    "final_provider_id": "anthropic"
  },
  "latency_ms": 1823,
  "ts": "2026-06-20T12:34:56.789Z"
}
```

The `cost_usd` is computed by the PAL using the `provider_rates` table:

```sql
-- populated monthly from each provider's published price sheet
create table provider_rates (
  provider_id   text not null,
  model_id      text not null,
  input_per_1k  numeric(12, 6) not null,
  output_per_1k numeric(12, 6) not null,
  cached_input_per_1k numeric(12, 6),
  effective_at  timestamptz not null,
  primary key (provider_id, model_id, effective_at)
);
```

A failed call (no response) writes `llm.call.failed` with the same correlation IDs and the failure class. The audit log is the source of truth for spend; the `provider_rates` table is the source of truth for unit price.

---

## 6. Scoped credentials (Forge AI-125 / Forge AI-5 §5.2)

The PAL **never** holds raw provider API keys. Every call resolves a per-tenant scoped credential through the Forge AI-126 broker:

- the broker holds the customer's `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / etc. encrypted,
- the PAL receives a short-lived broker-signed token per call (TTL ≤ 60s),
- the broker logs every `assume()` and `release()` as `cloud.credential.assume` / `cloud.credential.release` audit events,
- the broker enforces per-tenant rate limits, deny-lists, and budget caps.

This satisfies the Forge AI-5 §5.2 scoped-credentials rule: minimum permissions, audited at every step, scoped to the single call.

---

## 7. Prompt-injection defense (Forge AI-5 §5.2)

The PAL enforces three rules on every call:

1. **Untrusted-boundary markers.** Any content originating from outside the system prompt (user input, tool outputs, document chunks, MCP responses) is wrapped in explicit markers:

   ```text
   <untrusted source="user" id="...">
   {{ user content here, never to be re-injected into a tool call as instruction }}
   </untrusted>
   ```

2. **Output re-validation.** A model output that contains tool-call instructions referencing quoted user content is **rejected** with a `403 forbidden` (security event). The model is told, via system prompt, that quoted user content is data, not instruction.

3. **No tool calls based on quoted user content.** The PAL passes tool outputs and user content as **data** to the model's next turn, never as **instructions**. Tool-call decision authority belongs to the model's reasoning over the untrusted content, not to the content itself.

The typed-artifact generator (Forge AI-389) consumes this contract; the security stage signs off on it (see [workspace/memory/security.md](../../workspace/memory/security.md) §6).

---

## 8. Acceptance criteria

- [x] TS surface specified (`ProviderAbstractionLayer`).
- [x] Retry policy table with per-failure-class decisions.
- [x] Fallback ladder handed off to sub-plan 3.
- [x] `llm.call` audit-event shape defined; Forge AI-399 reconciliation explicit.
- [x] Scoped-credentials path via Forge AI-126 broker documented.
- [x] Prompt-injection defense (3 rules) specified.
- [ ] Board approval via `request_confirmation` on Forge AI-392.

---

## 9. Open questions for the Board

1. **LiteLLM Proxy vs direct SDK.** Confirm we run LiteLLM as a proxy sidecar (TS clients over HTTP) rather than embedding the Python SDK in every Node service.
2. **`provider_rates` ownership.** Confirm Engineering (this workstream) owns the table; Finance is a consumer, not a writer.
3. **Idempotency key shape.** Confirm `(tenant_id, run_id, stage, request_hash)` is the right granularity — too fine and retries explode; too coarse and retries can corrupt state.
4. **Cost precision.** Confirm USD with 4 decimal places is sufficient (currently `numeric(12,6)`).