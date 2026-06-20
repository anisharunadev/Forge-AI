# Forge AI-392.5 — OpenAI Compatibility Adapter

**Sub-plan:** 5 of 5
**Issue:** [Forge AI-392](/Forge AI/issues/Forge AI-392)
**Owner:** Senior Engineer
**Rev:** v0.1 — 2026-06-20 (draft, awaiting Board approval)
**Companion:** [`LITELLM_ABSTRACTION.md`](./LITELLM_ABSTRACTION.md) · [`TOOL_STRUCTURED_OUTPUT.md`](./TOOL_STRUCTURED_OUTPUT.md)

---

## 0. Scope

This artefact specifies the **OpenAI-compatibility adapter** — the seam by which any OpenAI-compatible runtime (GSD, Hermes, vLLM with an OpenAI server, a customer's self-hosted fine-tune, etc.) can plug into the Forge AI PAL without writing a new provider adapter.

**In scope:** adapter contract, configuration surface, what is honoured vs. degraded, the conformance suite extension, the security/audit posture for unknown runtimes.
**Out of scope:** the per-provider adapters in sub-plan 4, the routing rules in sub-plan 3.

---

## 1. The promise

> Any runtime that speaks the OpenAI Chat Completions API (or OpenAI Responses API) — at the wire level, not the SDK level — can be registered with the Forge AI PAL as a `provider_id: "openai_compatible"` and used by all sub-agents without code changes.

The promise exists because:

- the Forge AI platform is intended to be **model-agnostic** at every layer (charter §2),
- the OpenAI Chat Completions API has become the **de-facto standard** that hundreds of runtimes implement (GSD, Hermes, vLLM's `--api-type openai`, llama.cpp's `server`, Ollama's OpenAI-compat surface, LM Studio, etc.),
- writing a bespoke adapter for each one would explode the test matrix,
- customers want to bring their own fine-tunes (often OpenAI-API-compatible) without going through the Forge AI-126 broker.

The adapter is a **single adapter** with a **runtime configuration** that tells it where to talk and which features are honoured.

---

## 2. Adapter contract

```ts
// packages/pal/src/adapters/openai-compatible.ts

export interface OpenAICompatibleAdapterConfig {
  /** Stable id used in audit events. Default: a slug derived from base_url. */
  readonly providerId: ProviderId;
  /** Display name shown in dashboards. */
  readonly displayName: string;
  /** Base URL of the OpenAI-compatible endpoint (no trailing slash). */
  readonly baseUrl: string;
  /** Per-tenant scoped credential reference. Resolved via the Forge AI-126 broker. */
  readonly credentialRef: string;
  /** Optional model-id remap: customer model name → provider model name. */
  readonly modelAliases?: Readonly<Record<string, string>>;
  /** Capability flags; the PAL uses these to decide which features to enable. */
  readonly capabilities: {
    readonly tools: boolean;
    readonly structuredOutputs: boolean;        // response_format json_schema
    readonly streaming: boolean;
    readonly toolChoice: "none" | "auto" | "required" | "function";
    readonly vision: boolean;
    readonly parallelToolCalls: boolean;
  };
  /** Per-call timeout (ms). Default 30 000. */
  readonly timeoutMs?: number;
  /** Extra HTTP headers to forward (e.g. customer org id). */
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

export interface OpenAICompatibleAdapter {
  /** Initialises the adapter; called once per process. */
  init(): Promise<void>;
  /** Health probe; called by the circuit breaker (sub-plan 3 §5). */
  health(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  /** The adapter conforms to the canonical ToolSpec and JSONSchema contracts. */
  // (delegates to the standard OpenAI transformation in sub-plan 4 §4.1)
}
```

The adapter **inherits** the canonical `ToolSpec` and `JSONSchema` transformations from the OpenAI adapter (sub-plan 4 §4.1). It does **not** redefine them. The transformation is a shared module; the only per-runtime config is `capabilities` and `modelAliases`.

---

## 3. Configuration surface

### 3.1 Tenant registration (`tenants/<slug>/policy.yaml`)

```yaml
routing:
  providers:
    openai_compatible:
      - providerId: gsd-prod
        displayName: "GSD (customer self-hosted)"
        baseUrl: https://gsd.internal.customer.example/v1
        credentialRef: gsd-prod-key
        capabilities:
          tools: true
          structuredOutputs: true
          streaming: true
          toolChoice: auto
          vision: false
          parallelToolCalls: true
        modelAliases:
          gsd-7b: "GSD-7B-Chat-v2.1"
          gsd-13b: "GSD-13B-Chat-v2.1"

      - providerId: hermes-local
        displayName: "Hermes (local workstation)"
        baseUrl: http://localhost:8080/v1
        credentialRef: hermes-local-key
        capabilities:
          tools: false                  # Hermes 13B base does not support tool-calling
          structuredOutputs: false      # and structured outputs
          streaming: true
          toolChoice: auto
          vision: false
          parallelToolCalls: false
```

### 3.2 What happens when capabilities are absent

The PAL uses the capability flags to decide what to send. If a feature is disabled, the PAL degrades **explicitly**, never silently:

| Capability disabled | Degraded behaviour | Audit event |
|---------------------|--------------------|-------------|
| `tools: false` | tool-calling removed from the request; `runWithTools` rejects with `ToolsNotSupported` | `llm.capability.degraded` with `feature: "tools"` |
| `structuredOutputs: false` | `responseSchema` is omitted; the PAL falls back to a system-prompt instruction + JSON extraction; validation tolerance raised to lenient | `llm.capability.degraded` with `feature: "structured_outputs"` |
| `streaming: false` | `stream()` rejects with `StreamingNotSupported`; caller falls back to `complete()` | `llm.capability.degraded` with `feature: "streaming"` |
| `vision: false` | image parts in `MultiModalPart` rejected before send | `llm.capability.degraded` with `feature: "vision"` |
| `parallelToolCalls: false` | `parallel_tool_calls: false` set on the request; the model emits one tool call at a time | (silent — wire-level hint) |

Every degradation is an audit event. The Cost cross-cutting agent can flag runs that over-rely on degraded paths (a strong signal the routing ladder is mismatched).

---

## 4. Wire-level conformance

The adapter conforms to OpenAI's Chat Completions API as documented at <https://platform.openai.com/docs/api-reference/chat>. Specifically:

- `POST /v1/chat/completions` with the request shape in sub-plan 4 §4.1.
- Bearer-token authentication via `Authorization: Bearer <credential>` (the credential is the broker-resolved token, not the raw key).
- Standard error envelope (`{"error": {"message": "...", "type": "...", "code": "..."}}`); the adapter maps it to the canonical error taxonomy in sub-plan 2 §3.
- `usage` field in the response carries `prompt_tokens`, `completion_tokens`, and (where supported) `prompt_tokens_details.cached_tokens`. The adapter normalises these into the canonical `usage` shape.
- Streaming via Server-Sent Events; the adapter re-emits `AsyncIterable<StreamChunk>`.

If a runtime deviates from the wire spec (e.g. uses `prompt_eval_count` instead of `prompt_tokens`), the adapter applies a **field remap** in its config:

```yaml
wire_overrides:
  usage:
    input_tokens: prompt_eval_count
    output_tokens: eval_count
```

The remap is a tenant-config escape hatch; the default is the OpenAI standard.

---

## 5. Conformance suite extension

The conformance suite (sub-plan 4 §1) gains an `openai_compatible` matrix:

| Test | OpenAI | OpenAI-Compatible (registered runtimes) |
|------|--------|-----------------------------------------|
| Canonical `ToolSpec` round-trip | ✅ | ✅ — must accept the same `tools` shape |
| Canonical `JSONSchema` round-trip | ✅ | ✅ if `structuredOutputs: true`; degraded-path test if false |
| `usage` normalisation | ✅ | ✅ with `wire_overrides` applied |
| Error envelope mapping | ✅ | ✅ |
| Streaming | ✅ | ✅ if `streaming: true` |
| Auth (broker-resolved credential) | ✅ | ✅ |

A runtime that fails any of its enabled tests is **not registered**. Registration is gated on a green conformance run.

---

## 6. Security & audit posture

Unknown runtimes are an **expanded attack surface**. The adapter enforces:

1. **Per-tenant credential resolution.** The adapter never holds a raw key. It receives a broker-signed token per call (sub-plan 2 §6).
2. **Per-tenant `baseUrl` allowlist.** The PAL refuses to call a `baseUrl` not registered in the tenant's policy. A misconfigured tenant cannot accidentally point the adapter at a hostile endpoint.
3. **Per-call timeout.** `timeoutMs` (default 30s) is enforced at the HTTP layer. There is no streaming-forever fallback.
4. **Output re-validation.** Even when `structuredOutputs: false`, the PAL validates parsed JSON against the schema before returning to the caller. A model that emits malformed JSON is retried once with a corrective system message; on second failure, the call fails.
5. **Prompt-injection boundary.** All untrusted-boundary markers from sub-plan 4 §7 apply. A runtime that ignores tool-output markers is logged as a `security.runtime.untrusted_output` audit event and the run halts.

The Security stage reviews every registered OpenAI-compatible runtime before it goes live for a tenant. The review checks:

- `baseUrl` ownership (does the customer control this host?),
- `credentialRef` scope (is the credential least-privilege?),
- capability flags (does the runtime actually support what the tenant is asking for?),
- audit-event production (does the runtime emit enough information for the audit spine to capture spend and errors?).

---

## 7. Why not just use LiteLLM's OpenAI-compat path?

LiteLLM already supports a configurable OpenAI-compatible base URL. We could route every customer runtime through LiteLLM and call it done. We don't, because:

1. **The PAL's TypeScript surface is the canonical import.** Routing through LiteLLM adds a Python hop and a second source of truth for routing rules. We want a single PAL surface, not two layers.
2. **Per-tenant routing lives in the PAL.** Sub-plan 3 specifies routing at the PAL level. Delegating to LiteLLM splits that ownership.
3. **LiteLLM is the underlay, not the policy.** LiteLLM is excellent at talking to providers; the policy of *when* to talk to which provider is Forge AI's responsibility, encoded in `tenants/<slug>/policy.yaml` and the PAL.

The OpenAI-compatible adapter is a **PAL adapter**, not a LiteLLM proxy. LiteLLM still mediates the call to a first-class provider (OpenAI, Anthropic, etc.); the OpenAI-compatible adapter is the path for runtimes outside that set.

---

## 8. Acceptance criteria

- [x] Adapter contract specified (`OpenAICompatibleAdapterConfig`).
- [x] Tenant registration shape specified (`tenants/<slug>/policy.yaml`).
- [x] Capability-flag degradation behaviour decided (explicit, never silent).
- [x] Wire-level conformance to OpenAI Chat Completions API documented.
- [x] Conformance suite extension specified.
- [x] Security & audit posture specified (5 rules + Security stage review).
- [x] Reconciliation with LiteLLM as underlay, not policy, documented.
- [ ] Board approval via `request_confirmation` on Forge AI-392.

---

## 9. Open questions for the Board

1. **Default capability flags.** When a customer registers a runtime without explicit `capabilities`, do we assume `tools: true, structuredOutputs: true` (permissive) or `false` (safe)? Recommend: `false`, force explicit declaration.
2. **Wire-level conformance strictness.** Confirm we reject runtimes that deviate from the OpenAI Chat Completions wire shape unless they provide a `wire_overrides` mapping. (Alternative: ship a "lenient" mode that tries to parse any reasonable shape; reject because of the audit-spine cost-capture risk.)
3. **Security stage review per runtime.** Confirm every registration is gated on Security review; we don't auto-approve based on conformance alone.
4. **Multi-tenant isolation.** Confirm a tenant's `baseUrl` cannot be hijacked by another tenant's configuration (DNS / cert pinning story is in §6.2; confirm we're satisfied).
5. **Streaming-only runtimes.** A runtime that only supports streaming (no `complete()` response) is registered with `streaming: true` only. Confirm the PAL's caller falls back to `stream()` and accumulates chunks, rather than rejecting the runtime.