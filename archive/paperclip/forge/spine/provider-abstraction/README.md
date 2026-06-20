# Forge AI-392 — Provider Abstraction Layer (Spine Workstream)

**Workstream:** Spine — Provider Abstraction Layer
**Phase:** 2 (Spine)
**Issue:** [Forge AI-392](/Forge AI/issues/Forge AI-392)
**Master plan reference:** Forge AI-388 plan rev `3ea71321`
**Owner:** Senior Engineer (`27431e10-478f-45da-a058-92770d404b53`)
**Mode:** Planning only. No code. No implementation subtasks.
**Co-required by:** Phase 2 GSD-core integration
**Reconciles with:** Audit spine ([Forge AI-399](/Forge AI/issues/Forge AI-399)) — every LLM call records model + cost
**Reconciles with:** Typed-artifact generation ([Forge AI-389](/Forge AI/issues/Forge AI-389)) — provider-agnostic structured outputs
**Status (2026-06-20):** Five sub-plans drafted; awaiting Board approval via `request_confirmation` interactions on Forge AI-392.

---

## 0. Why this exists

The Forge AI charter requires that **no agent calls a model API directly**. All inference flows through a single typed seam — the Provider Abstraction Layer (PAL). The PAL is the runtime contract for:

- provider routing (which provider handles which call),
- retry / failover (what happens when the primary is down),
- cost capture (every call records model + token cost into the audit spine),
- tool-calling and structured-output normalisation (so the rest of the platform is provider-agnostic).

Without the PAL, the seven-stage spine ([Forge AI-388](Forge AI-388) §3) leaks vendor specifics into every sub-agent, the typed-artifact generator (Forge AI-389) cannot guarantee its output schema, and the audit spine (Forge AI-399) cannot reliably attribute spend to a model.

This directory holds the five planning artefacts the charter requires before implementation. Each artefact below is independent for review purposes, but they compose into a single runtime contract.

---

## 1. Sub-plan index

| # | Artefact | Path | Board gate |
|---|----------|------|------------|
| 1 | Provider inventory & priority | [`PROVIDER_INVENTORY.md`](./PROVIDER_INVENTORY.md) | `request_confirmation` on Forge AI-392 |
| 2 | LiteLLM-backed abstraction spec | [`LITELLM_ABSTRACTION.md`](./LITELLM_ABSTRACTION.md) | `request_confirmation` on Forge AI-392 |
| 3 | Routing & failover plan | [`ROUTING_FAILOVER.md`](./ROUTING_FAILOVER.md) | `request_confirmation` on Forge AI-392 |
| 4 | Tool-call & structured-output contract | [`TOOL_STRUCTURED_OUTPUT.md`](./TOOL_STRUCTURED_OUTPUT.md) | `request_confirmation` on Forge AI-392 |
| 5 | OpenAI compatibility adapter | [`OPENAI_COMPAT_ADAPTER.md`](./OPENAI_COMPAT_ADAPTER.md) | `request_confirmation` on Forge AI-392 |

Each artefact carries:

- **Scope** — what it covers and what it explicitly does not.
- **Decisions** — the recommended shape, with the alternative rejected.
- **Reconciliation points** — links to Forge AI-389 (typed-artifact) and Forge AI-399 (audit) where the seam matters.
- **Acceptance criteria** — the bar for "this sub-plan is done."
- **Open questions** — anything the Board should decide before implementation.

---

## 2. The seam the PAL must enforce

Every plan in this directory converges on one runtime contract:

```text
   caller (sub-agent / orchestrator / typed-artifact generator)
                          │
                          ▼
            ┌──────────────────────────┐
            │   Provider Abstraction   │   ← single import; no other path allowed
            │   Layer (PAL)            │
            │  ┌────────────────────┐  │
            │  │ RouteSelector      │  │   (per-tenant + per-stage + per-budget)
            │  │ RetryPolicy        │  │   (exponential backoff + circuit-breaker)
            │  │ FailoverEngine     │  │   (primary → secondary → tertiary)
            │  │ CostRecorder       │──┼───► audit.events (Forge AI-399)
            │  │ ToolNormaliser     │  │   (provider schema → canonical schema)
            │  │ StructuredOutAdapt │  │   (JSON-schema enforcement)
            │  └────────────────────┘  │
            └──────────┬───────────────┘
                       ▼
            ┌──────────────────────────┐
            │   Provider Adapters      │   ← one per provider family
            │   (OpenAI, Anthropic,    │
            │    Gemini, OpenRouter,   │
            │    Bedrock, Azure OAI,   │
            │    Vertex AI,            │
            │    OpenAI-compatible)    │
            └──────────────────────────┘
```

The PAL is the only object the rest of the platform imports. Provider adapters are isolated, individually tested, and individually circuit-broken.

---

## 3. Cross-references

- **Charter:** Forge AI-7 (`docs/architecture/charter.md`) — Provider Abstraction Layer section
- **Master plan:** Forge AI-388 rev `3ea71321`
- **Audit spine:** [Forge AI-399](/Forge AI/issues/Forge AI-399) — every model call lands an `llm.call` audit event
- **Typed-artifact generator:** [Forge AI-389](/Forge AI/issues/Forge AI-389) — consumes the PAL's structured-output contract
- **Knowledge Layer conventions:** `workspace/memory/coding.md` (test pyramid), `workspace/memory/security.md` (scoped credentials, prompt-injection defense), `workspace/memory/architecture.md` §2 (cost as first-class output), §9 (LLM provider outage failure mode)

---

## 4. Acceptance criteria (Forge AI-392 done)

- [x] Provider inventory & priority drafted → `PROVIDER_INVENTORY.md`
- [x] LiteLLM abstraction spec drafted → `LITELLM_ABSTRACTION.md`
- [x] Routing & failover plan drafted → `ROUTING_FAILOVER.md`
- [x] Tool-call & structured-output contract drafted → `TOOL_STRUCTURED_OUTPUT.md`
- [x] OpenAI compatibility adapter plan drafted → `OPENAI_COMPAT_ADAPTER.md`
- [ ] All five approved by Board via `request_confirmation` on Forge AI-392
- [ ] No code, no implementation subtasks (per directive)

**Versioning:** rev `v0.1` (2026-06-20). Bumps to `v1.0` only after all five sub-plan confirmations land.