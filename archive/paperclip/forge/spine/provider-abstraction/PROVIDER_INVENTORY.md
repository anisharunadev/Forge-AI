# Forge AI-392.1 — Provider Inventory & Priority

**Sub-plan:** 1 of 5
**Issue:** [Forge AI-392](/Forge AI/issues/Forge AI-392)
**Owner:** Senior Engineer
**Rev:** v0.1 — 2026-06-20 (draft, awaiting Board approval)
**Companion:** [`../README.md`](../README.md) · [`LITELLM_ABSTRACTION.md`](./LITELLM_ABSTRACTION.md) · [`ROUTING_FAILOVER.md`](./ROUTING_FAILOVER.md)

---

## 0. Scope

This artefact decides **which model providers the Forge AI Provider Abstraction Layer (PAL) supports in V1, and in what order**. It is the input gate for the abstraction spec (sub-plan 2) and the routing plan (sub-plan 3).

**In scope:** the seven providers named in the charter.
**Out of scope:** self-hosted open-weights (vLLM, llama.cpp, Ollama) — parked for a future customer-pull epic; Azure ML Foundry endpoints — same. Cohere, Mistral, Groq — not in charter; parked.

---

## 1. The seven charter providers

| # | Provider | Family | Auth shape | Tool-call | Structured JSON | Cost capture | V1 priority |
|---|----------|--------|------------|-----------|-----------------|--------------|-------------|
| 1 | **OpenAI** | OpenAI-compatible native | Bearer (`OPENAI_API_KEY`) | ✅ native `tools` / `tool_choice` | ✅ native `response_format: { type: "json_schema" }` | ✅ per-token pricing | **P0** |
| 2 | **Anthropic** | Anthropic-native | Bearer (`ANTHROPIC_API_KEY`) | ✅ native `tools` (input_schema JSON-Schema) | ✅ via tool-use or system-prompt + JSON extraction | ✅ per-token pricing | **P0** |
| 3 | **Gemini** (Google AI Studio) | Gemini-native | API key or Vertex IAM | ✅ `functionCalling` | ✅ `responseSchema` (subset of JSON-Schema) | ✅ per-token pricing | **P1** |
| 4 | **OpenRouter** | OpenAI-compatible proxy | Bearer (`OPENROUTER_API_KEY`) | ✅ inherits OpenAI shape | ✅ inherits OpenAI shape | ✅ unified pricing page | **P1** |
| 5 | **AWS Bedrock** | Bedrock-native (Anthropic, Mistral, Cohere, Llama, etc. on AWS) | AWS SigV4 (Forge AI-126 broker) | ⚠ per-model surface; Anthropic-on-Bedrock matches Anthropic | ⚠ per-model | ✅ via token ledger in broker | **P1** |
| 6 | **Azure OpenAI** | OpenAI-compatible | Azure AD / API key (`AZURE_OPENAI_*`) | ✅ inherits OpenAI shape | ✅ inherits OpenAI shape | ✅ per-token pricing (Azure rate card) | **P2** |
| 7 | **Vertex AI** | Gemini-native (Google Cloud) | GCP service account (Forge AI-126 broker) | ✅ matches Gemini AI Studio surface | ✅ matches | ✅ via GCP billing export | **P2** |

---

## 2. Recommended V1 priority order

### Tier P0 — ship in V1.0 (must)

**Anthropic + OpenAI.**

Rationale:

1. **Coverage breadth.** Together they cover ~95 % of the model surface Forge AI needs for V1 (Sonnet/Opus/Haiku from Anthropic; GPT-4o / GPT-4.1 / o-series from OpenAI). Adding Gemini or Bedrock in V1.0 widens the test matrix without proportional user value.
2. **Tool-calling maturity.** Both have stable, well-documented native tool-call surfaces. Anthropic uses JSON-Schema in `tools[].input_schema`; OpenAI uses the OpenAI Tools shape. The PAL can wrap both behind one canonical Tool schema (sub-plan 4).
3. **Structured-output maturity.** OpenAI has native `json_schema` enforcement; Anthropic has reliable JSON tool-use and a documented JSON-mode. The PAL structured-output contract (sub-plan 4) is implementable against both today.
4. **Per-token pricing is published and stable.** Both publish per-token pricing that can be encoded in `provider_rates` and joined against `usage.input_tokens` / `usage.output_tokens` from the API responses. Cost capture (Forge AI-399 reconciliation) is the cheapest of the seven.
5. **Bedrock as the broker path.** Customers with AWS-only compliance needs can hit Anthropic *and* OpenAI via Bedrock in a future epic without rewriting the PAL, because the canonical schema is provider-agnostic.

### Tier P1 — ship in V1.1 (should)

**Gemini, OpenRouter, Bedrock.**

- **Gemini** — needed for cost-sensitive bulk workloads and for customers already on GCP. The PAL adapter is straightforward (`@google/generative-ai`).
- **OpenRouter** — gives us a single integration for ~30 open and closed models behind one OpenAI-compatible surface. Useful for cost-arbitration experiments.
- **Bedrock** — needed for AWS-native compliance and for the customer-cloud-broker (Forge AI-126) story. Adapter goes through the broker's per-tenant scoped credential (Forge AI-125).

### Tier P2 — ship in V1.2 (could)

**Azure OpenAI, Vertex AI.**

Both are essentially enterprise-cloud mirrors of OpenAI and Gemini respectively. They ship last because:

- they add the most auth complexity (Azure AD, GCP IAM, both via Forge AI-126 broker),
- they don't add new model capabilities over their Tier-P0/1 cousins,
- the customer-pull signal for them is weaker in the current pipeline.

If a design-partner pulls us earlier, they bump to P1.

---

## 3. Decisions

| Decision | Choice | Rejected alternative |
|----------|--------|----------------------|
| V1 launch set | Anthropic + OpenAI | All seven at once (test matrix explosion) |
| Default routing | OpenAI GPT-4.1 class for bulk, Anthropic Sonnet for code/reasoning, fallback to Haiku | Single provider default (single point of failure) |
| Bedrock support path | Via Forge AI-126 broker with per-tenant scoped credentials | Native AWS SigV4 in the PAL (auth sprawl) |
| OpenRouter scope | Bring-your-own key for cost experimentation; not a primary | Primary provider (vendor risk) |
| Cohere / Mistral / Groq | Not in charter; explicit backlog entry | Add to V1 (scope creep) |
| Self-hosted (vLLM / Ollama) | Parked | Add to V1 (deployment scope explosion) |

---

## 4. Reconciliation with Forge AI-399 (audit)

The audit spine requires every LLM call to record:

- `provider_id` (e.g. `openai`, `anthropic`, `gemini`, `openrouter`, `bedrock`, `azure_openai`, `vertex_ai`)
- `model_id` (provider-specific, e.g. `gpt-4.1-2025-04-14`, `claude-sonnet-4-6`)
- `input_tokens`, `output_tokens`, `cached_input_tokens` (when reported)
- `cost_usd` (joined from `provider_rates` table; the source-of-truth rate card is updated monthly)
- `tenant_id`, `run_id`, `stage`, `idempotency_key`

Every Tier-P0/1/2 provider above returns enough token-usage information to satisfy this. The PAL's `CostRecorder` is provider-agnostic — it joins on `(provider_id, model_id, observed_at)` and writes one `llm.call` audit event per call. Rate-card drift is a monitored, alerted event, not a silent failure.

---

## 5. Acceptance criteria

- [x] All seven charter providers inventoried with auth/tool-call/structured-output/cost columns.
- [x] Priority order (P0/P1/P2) decided with rationale.
- [x] Reconciliation with Forge AI-399 audit spine documented.
- [ ] Board approval via `request_confirmation` on Forge AI-392.

---

## 6. Open questions for the Board

1. **Default-routing policy** — is "OpenAI for bulk, Anthropic for code/reasoning" the right V1 default, or should we route by tenant tier instead? (Decision shapes sub-plan 3.)
2. **OpenRouter as primary** — confirm OpenRouter is **never** a primary; only a fallback / cost-arbitration layer.
3. **Bedrock adapter placement** — confirm the Bedrock adapter goes through the Forge AI-126 broker rather than holding AWS SigV4 credentials directly.
4. **Rate-card ownership** — confirm Engineering (this workstream) owns `provider_rates` table population, not Finance. (Cost capture breaks otherwise.)