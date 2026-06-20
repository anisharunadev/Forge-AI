# Forge AI-392.3 — Routing & Failover Plan

**Sub-plan:** 3 of 5
**Issue:** [Forge AI-392](/Forge AI/issues/Forge AI-392)
**Owner:** Senior Engineer
**Rev:** v0.1 — 2026-06-20 (draft, awaiting Board approval)
**Companion:** [`PROVIDER_INVENTORY.md`](./PROVIDER_INVENTORY.md) · [`LITELLM_ABSTRACTION.md`](./LITELLM_ABSTRACTION.md)

---

## 0. Scope

This artefact decides **which provider handles which call, and what happens when it fails.** It defines the primary/secondary/tertiary ladder, the per-tenant override surface, and the budget-burn fallback (when spend exceeds the tenant's budget cap).

**In scope:** routing-hint shape, default ladder, per-tenant override, budget-burn fallback, circuit-breaker policy.
**Out of scope:** the PAL runtime surface (sub-plan 2) and the audit event shape (Forge AI-399).

---

## 1. RoutingHint — the input to the PAL

Every PAL call carries an optional `RoutingHint`:

```ts
export interface RoutingHint {
  /** The default routing if no override applies. */
  readonly primary: ProviderModelRef;
  /** Cheaper / different-family fallback. */
  readonly secondary?: ProviderModelRef;
  /** Cheap-and-cheerful tertiary, e.g. Haiku class. */
  readonly tertiary?: ProviderModelRef;
  /** Per-tenant override (see §3). */
  readonly tenantOverride?: TenantRoutingOverride;
  /** Budget-burn cap for this call's run (see §4). */
  readonly budgetUsd?: number;
}

export interface ProviderModelRef {
  readonly providerId: ProviderId;
  readonly modelId: string;
  /** Optional quality floor; PAL may upgrade if a higher-tier model is free. */
  readonly minQuality?: "fast" | "balanced" | "best";
}
```

The PAL resolves the hint into a concrete primary/secondary/tertiary before calling the underlay. Resolution is **per-call**, not cached, so per-tenant overrides take effect immediately.

---

## 2. Default routing ladder

The default ladder assumes **Anthropic + OpenAI** as Tier-P0 (sub-plan 1 §2). It is the ladder Forge AI itself uses when no per-tenant override is present.

| Stage / task | Primary | Secondary | Tertiary |
|--------------|---------|-----------|----------|
| **Ideation** (PRD, brainstorming) | `openai/gpt-4.1` | `anthropic/claude-sonnet-4-6` | `anthropic/claude-haiku-4-5-20251001` |
| **Architect** (ADR drafting, design) | `anthropic/claude-sonnet-4-6` | `openai/gpt-4.1` | `anthropic/claude-haiku-4-5-20251001` |
| **Dev** (code generation) | `anthropic/claude-sonnet-4-6` | `openai/gpt-4.1` | `anthropic/claude-haiku-4-5-20251001` |
| **QA** (test generation, eval authoring) | `anthropic/claude-sonnet-4-6` | `openai/gpt-4.1` | `anthropic/claude-haiku-4-5-20251001` |
| **Security** (review, threat modelling) | `anthropic/claude-opus-4-8` | `anthropic/claude-sonnet-4-6` | `openai/gpt-4.1` |
| **DevOps** (pipeline, IaC) | `anthropic/claude-sonnet-4-6` | `openai/gpt-4.1` | `anthropic/claude-haiku-4-5-20251001` |
| **Docs** (runbooks, READMEs) | `anthropic/claude-sonnet-4-6` | `openai/gpt-4.1` | `anthropic/claude-haiku-4-5-20251001` |
| **Cost / Eval / Audit / Memory** (cross-cutting) | `anthropic/claude-haiku-4-5-20251001` | `openai/gpt-4.1-mini` | `anthropic/claude-haiku-4-5-20251001` |

**Why this shape:**

- **Anthropic for code / architecture / security.** Sonnet class is the strongest for structured technical output; Opus is reserved for security review where mistake cost is highest.
- **OpenAI for ideation / fallback.** GPT-4.1 has strong general reasoning; serves as a strong cross-family fallback.
- **Haiku class for cross-cutting.** Cost matters more than quality for routine extraction / classification / summarisation tasks.

The ladder is a **default**, not a hard rule. Tenants override per §3.

---

## 3. Per-tenant routing override

A tenant configures overrides in their tenant policy (`tenants/<slug>/policy.yaml`):

```yaml
# tenants/<slug>/policy.yaml
routing:
  defaults:
    primary:   { provider: anthropic, model: claude-sonnet-4-6 }
    secondary: { provider: openai,    model: gpt-4.1 }
    tertiary:  { provider: anthropic, model: claude-haiku-4-5-20251001 }

  # Stage-specific overrides
  stages:
    security:
      primary:   { provider: anthropic, model: claude-opus-4-8 }
      secondary: { provider: anthropic, model: claude-sonnet-4-6 }
    docs:
      primary:   { provider: openai,    model: gpt-4.1 }   # tenant preference

  # Hard rule: never send this tenant's data outside their region
  region_lock: us-east-1
  # Hard rule: this tenant is OpenAI-only (compliance)
  allowlist: [openai]
  # Hard rule: never use this provider (compliance / contract)
  denylist: [gemini, vertex_ai]

  # Per-stage budget cap. PAL halts and asks when burn exceeds it.
  budget_usd_per_run:
    ideation: 2.00
    architect: 4.00
    dev:       8.00
    qa:        4.00
    security:  6.00
    devops:    2.00
    docs:      1.00
```

**Resolution rules:**

1. Tenant override wins over default.
2. `denylist` removes models from consideration (failover cannot use them).
3. `allowlist` restricts the ladder to listed providers (failover cannot exit the allowlist).
4. `region_lock` is enforced by the Forge AI-126 broker — the broker refuses to hand out a credential for a provider in a different region.
5. The `region_lock` / `allowlist` / `denylist` constraints are evaluated **before** each failover hop, not just on the primary.

A tenant cannot override the **audit-spine recording** — every call still emits an `llm.call` event regardless of provider.

---

## 4. Budget-burn fallback

A "budget-burn" is when a single run's spend exceeds its `budget_usd_per_run` cap. The PAL's response is **halt-and-ask**, not silent failover.

```text
PAL observes accumulated cost >= budgetUsd
   │
   ▼
emit llm.budget.exceeded audit event
   │
   ▼
halt the run, surface "budget exceeded, need more $ or a cheaper ladder" to the orchestrator
   │
   ▼
the orchestrator either (a) extends the budget (admin action), or
                       (b) downgrades the ladder (haiku-only), or
                       (c) cancels the run.
```

The PAL never silently downgrades a primary to save money. Every ladder change is an explicit decision, recorded in the audit log.

**Quarterly budget state:**

- `tenant_budget_quota_usd` — total spend cap per calendar quarter (set in `tenants/<slug>/policy.yaml`).
- The Cost cross-cutting agent monitors quarterly burn; when a tenant hits 80 %, an alert fires; when it hits 100 %, the broker refuses to hand out credentials for non-cross-cutting stages until the next quarter or an admin extension.

---

## 5. Circuit breaker

The PAL holds an in-memory **per-provider circuit breaker** keyed by `(provider_id, model_id)`:

| State | Trigger | Behaviour |
|-------|---------|-----------|
| **Closed** | < 5 errors in a 60s window | normal operation |
| **Half-open** | 5 errors in 60s, OR a 5xx-class outage signal from the provider | one probe call; on success → closed; on failure → open |
| **Open** | probe fails | all calls short-circuit to the next ladder tier for 60s; emit `llm.circuit.open` audit event |

The breaker state is **per-process**, not shared across PAL instances. Sharing breaker state is a future epic (Redis-backed). The blast radius is bounded because each PAL instance is short-lived and request-scoped.

---

## 6. Cross-provider failover: when the family changes

When the primary and secondary are different **provider families** (e.g. Anthropic → OpenAI), the PAL performs three transformations before forwarding the call:

1. **Tool schema transformation.** Anthropic's `tools[].input_schema` JSON-Schema → OpenAI's `tools[].function.parameters` JSON-Schema (the wire shapes are the same; the wrapping is different). See sub-plan 4.
2. **System prompt transformation.** Anthropic uses a `system` field; OpenAI uses a `messages[0]` with role `system`. The PAL emits the right wire shape.
3. **Token counting transformation.** Each provider's response carries its own usage counters. The PAL normalises them into the canonical `usage` shape (sub-plan 2 §2).

The transformations are **the adapter's job**, not the PAL's job. The PAL hands the resolved hint + transformed call to the adapter. The adapter owns the provider-specific surface.

---

## 7. Acceptance criteria

- [x] `RoutingHint` shape specified.
- [x] Default ladder by stage decided.
- [x] Per-tenant override mechanism defined (`tenants/<slug>/policy.yaml`).
- [x] Budget-burn fallback behaviour decided (halt-and-ask, not silent downgrade).
- [x] Circuit-breaker policy specified.
- [x] Cross-provider failover transformations identified.
- [ ] Board approval via `request_confirmation` on Forge AI-392.

---

## 8. Open questions for the Board

1. **Default ladder.** Confirm Anthropic-for-everything-except-Ideation as the V1 default, or do we want a more aggressive cost posture (Haiku primary for non-critical stages)?
2. **Per-tenant `allowlist` / `denylist` semantics.** Confirm these are hard rules (failover cannot violate them), not preferences.
3. **Budget halt-and-ask.** Confirm the orchestrator's responsibility to extend / downgrade / cancel — the PAL never decides.
4. **Quarterly budget ownership.** Confirm the Cost cross-cutting agent owns monitoring; broker owns enforcement.
5. **Cross-region failover.** Out of scope for V1 (region-lock is enforced), but confirm we don't need cross-region failover for the first design-partner.