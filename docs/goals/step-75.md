# Forge Backend — Phase 1 Implementation Spec

> **Status:** completed
> **Last classified:** 2026-07-05

> **Phase:** 1 of 4 — Foundation
> **Goal of this doc:** spec the 5 features in Phase 1 with explicit goals, contracts, and acceptance criteria — no code, just the contract.
> **Source API:** LiteLLM `1.82.6` at `https://litellm-api.up.railway.app/` (see `forge-litellm-integration.md` for full endpoint map).

---

## Phase 1 Goal (one sentence)

**Stand up the minimum Forge Backend slice that can (1) hold a master key, (2) issue and verify virtual keys per agent, (3) list available models, (4) proxy a streaming chat completion to LiteLLM and back to the UI, and (5) record per-call spend — without ever exposing the master key to the UI.**

After Phase 1 ships, every other feature in Phases 2–4 has a safe, observable, cost-attributed substrate to build on.

---

## Phase 1 Success Criteria (Definition of Done)

Phase 1 is done only when **all** are true:

1. ✅ Forge Backend holds the LiteLLM master key in an env var; the key is never logged, never returned to UI, never persisted in plain text.
2. ✅ Forge UI can list models visible to the calling user (model picker works).
3. ✅ Forge UI can trigger an agent chat; the chat streams token-by-token back to the UI over SSE.
4. ✅ Every chat completion carries `metadata.{forge_run_id, forge_agent_id, forge_tenant_id, forge_user_id}` so spend can be attributed.
5. ✅ Every chat completion produces a spend record in Forge DB within 5 seconds of stream end.
6. ✅ Virtual keys are issued per-agent, scoped to specific models and budgets; UI never sees them.
7. ✅ All LiteLLM errors are translated into typed Forge errors (never raw 500s propagated).
8. ✅ Health check endpoint on Forge Backend reports LiteLLM reachability + version.
9. ✅ All requests and responses are logged in Forge audit log (request id, duration, token counts, cost, model).
10. ✅ No secrets appear in logs (master key, virtual keys redacted).

---

## Feature Map

| # | Feature | LiteLLM endpoints | Forge-side module |
|---|---|---|---|
| 1 | **Config & Auth foundation** | `/health/readiness`, `/health`, `/health/license` | `forge.config`, `forge.auth` |
| 2 | **Models registry** | `/v1/models`, `/models`, `/model/info`, `/model_group/info` | `forge.models` |
| 3 | **Virtual key broker** | `/key/generate`, `/key/info`, `/key/list`, `/key/update`, `/key/delete`, `/key/health` | `forge.keys` |
| 4 | **Chat completion (SSE)** | `/v1/chat/completions`, `/v1/responses`, `/responses/{id}/cancel` | `forge.chat` |
| 5 | **Spend aggregation** | `/spend/logs`, `/global/spend`, `/user/daily`, `/team/daily`, `/key/info` | `forge.spend` |

---

## Feature 1 — Config & Auth Foundation

### Goal
Establish the **trust root** for Forge Backend: load secrets from env, validate them at boot, prove LiteLLM reachability, expose a typed config to every other module. No LiteLLM call elsewhere in the system should ever re-implement this.

### Spec

**Config surface (env-driven):**
- `LITELLM_BASE_URL` — default `https://litellm-api.up.railway.app`
- `LITELLM_MASTER_KEY` — required, never logged
- `LITELLM_TIMEOUT_MS` — default `30000`
- `LITELLM_RETRY_MAX` — default `3`
- `FORGE_TENANT_HEADER` — default `X-Forge-Tenant`
- `FORGE_RUN_HEADER` — default `X-Forge-Run-Id`
- `FORGE_LOG_LEVEL` — default `info`

**Boot validation:**
- On startup, Forge Backend MUST hit `GET /health/readiness` with the master key.
- If 200 + `status == "healthy"` → boot succeeds.
- If 401 → fail loud, do not start.
- If 200 + `db == "Not connected"` → warn but allow (LiteLLM may be DB-less in dev).
- Cache the response for 60s; do not hit `/health/readiness` more than once per minute.

**Auth chain (all LiteLLM calls):**
- Master key is used **only** for: `/key/*`, `/spend/*` (admin endpoints), `/guardrails/*`, `/policies/*`, `/model/*`, `/user/*`, `/team/*`, `/organization/*`, `/project/*`, `/budget/*`, `/audit`, `/global/*`, `/health/*`.
- Virtual keys are used for: `/v1/chat/completions`, `/v1/embeddings`, `/v1/audio/*`, `/v1/images/*`, `/v1/files/*`, `/v1/responses`, `/v1/batches/*`, `/v1/vector_stores/*`, `/v1/mcp/*`, `/v1/skills`, `/v1/agents`, `/v1beta/interactions`, `/rerank`, `/ocr`, `/search_tools/*`.
- Forge Backend MUST refuse to call an admin endpoint with a virtual key and refuse to call an inference endpoint with the master key.

**Secrets hygiene:**
- Master key, virtual keys, and any `Authorization` header value are redacted in logs.
- Keys are never stored in URL query strings.
- Errors from LiteLLM that contain key fragments are scrubbed before logging.

### LiteLLM endpoints used
- `GET /health/readiness`
- `GET /health`
- `GET /health/license`
- `GET /routes` (capability discovery — list every route LiteLLM exposes)

### Forge Backend contract
- Internal `getConfig(): ForgeConfig` — returns validated config or throws on missing fields.
- Internal `withMasterKey(req)` / `withVirtualKey(key, req)` — typed wrappers.
- Public `GET /api/forge/health` — returns `{ status, litellm: { version, reachable, db, cache, callbacks } }`.

### Acceptance criteria
1. Boot fails fast when `LITELLM_MASTER_KEY` is missing.
2. `/api/forge/health` reports LiteLLM version + reachable status within 1s on a healthy proxy.
3. Master key never appears in any log line, even at `debug` level.
4. `grep -r LITELLM_MASTER_KEY logs/` returns zero matches after 100 requests.
5. Capability discovery (`GET /routes`) is logged once at boot with route counts per domain.

---

## Feature 2 — Models Registry

### Goal
Give Forge UI a **fast, cached, scoped model picker**. UI never asks LiteLLM directly; Forge Backend filters by what the calling user's virtual key is allowed to use.

### Spec

**Inputs:**
- `user_id`, `team_id`, `tenant_id` — from Forge session.

**Outputs:**
- `GET /api/forge/models` → `{ models: ModelDescriptor[], groups: ModelGroup[], fetched_at }`
- `ModelDescriptor` — `{ id, provider, tier, context_window, supports: { tools, vision, audio, streaming, json_mode }, cost: { input_per_1k, output_per_1k }, allowed_for_caller: boolean }`

**Behavior:**
- On first request, Forge Backend calls `GET /v1/models` with the user's virtual key.
- Result is cached in Redis (or in-process LRU) for **5 minutes**.
- Forge Backend augments each model with metadata from `/model/info` (tier, context window, cost map) — these come from the master key call, cached for **1 hour**.
- `allowed_for_caller` is computed by intersecting the user's virtual key's allowed models with the master-key-known model registry.
- Cost data comes from `/public/litellm_model_cost_map` (no auth needed), cached for **24 hours**.

**Model picker rules:**
- Default model: cheapest capable model that supports tools + streaming + the requested agent's required features.
- Show a `(default)` chip on the recommended model.
- Group by provider (OpenAI, Anthropic, Bedrock, etc.).
- If a model disappears from `/v1/models` but is in cache, mark it `unavailable_until_next_refresh`; do not remove it from the picker for 24 hours.

### LiteLLM endpoints used
- `GET /v1/models` (with virtual key)
- `GET /model/info` (with master key)
- `GET /model_group/info` (with master key)
- `GET /public/litellm_model_cost_map` (no auth)

### Forge Backend contract
- `GET /api/forge/models` — list models for the caller
- `GET /api/forge/models/:id` — single model detail
- `POST /api/forge/models/refresh` — admin: bust cache
- `GET /api/forge/models/groups` — group models by provider

### Acceptance criteria
1. Cold cache: first request hits LiteLLM once per category (model list, model info, cost map) — total 3 calls.
2. Warm cache: subsequent requests within 5 min hit zero LiteLLM endpoints.
3. Model picker in Forge UI shows the right `allowed_for_caller` chip for at least 3 distinct users with different virtual key scopes.
4. Adding a model in LiteLLM is reflected in Forge UI within 5 minutes (cache TTL).
5. Cost numbers in Forge UI match the cost map from `/public/litellm_model_cost_map` to the cent.
6. Disallowed models are filtered out, not just greyed out — UI cannot submit a chat with a forbidden model.

---

## Feature 3 — Virtual Key Broker

### Goal
Forge Backend becomes the **only entity** that issues, verifies, rotates, and revokes virtual keys. The UI never sees a key; it sees a Forge session, and Forge Backend maps that session to a virtual key on every request.

### Spec

**Key issuance (per-agent at spawn):**
- Trigger: when a tenant creates or updates an agent.
- Forge Backend calls `POST /key/generate` with:
  - `models`: list of model IDs this agent is allowed to use (from agent config).
  - `max_budget`: agent's cost ceiling in USD.
  - `duration`: agent lifetime (default 30 days).
  - `tpm_limit`, `rpm_limit`: per-agent throughput caps.
  - `metadata`: `{ forge_agent_id, forge_tenant_id, forge_user_id, forge_team_id }`.
  - `aliases`: human-readable alias (e.g. `forge-agent-prd-writer`).
- The returned `key` (`sk-…`) is stored in Forge DB (encrypted at rest) and mapped to the agent id. The plaintext key is **never** logged or returned to the UI; only a key fingerprint is shown.

**Key verification (every chat call):**
- Before each LiteLLM call, Forge Backend:
  1. Looks up the agent by id.
  2. Fetches the agent's virtual key from encrypted store.
  3. Optionally calls `GET /key/info` to refresh budget state (cached 60s).
  4. Verifies budget remaining > estimated cost.
  5. Uses the key for the call.

**Key rotation:**
- Every 7 days, or when budget hits 80%, Forge Backend rotates:
  - Issue a new key via `POST /key/generate`.
  - Update Forge DB mapping atomically.
  - Delete old key via `POST /key/delete`.
  - Notify (audit event): `key.rotated`.

**Key revocation:**
- When an agent is deleted, the key is deleted via `POST /key/delete`.
- When a tenant offboards, all keys for that tenant are deleted in bulk.

**Budget enforcement:**
- Before each call, compare `max_budget` to current spend (`/key/info`).
- If `current_spend / max_budget > 0.9` → return typed error `BudgetWarning` (still allow).
- If `current_spend >= max_budget` → return typed error `BudgetExceeded` (block, surface in UI).

### LiteLLM endpoints used
- `POST /key/generate`
- `GET /key/info`
- `GET /key/list`
- `POST /key/update`
- `POST /key/bulk_update`
- `POST /key/delete`
- `POST /key/reset_spend`
- `POST /key/block` / `POST /key/unblock`
- `POST /key/regenerate`
- `GET /key/health`
- `GET /key/aliases`

### Forge Backend contract
- `POST /api/forge/agents/:id/key/issue` — admin: issue/rotate key
- `GET /api/forge/agents/:id/key/status` — returns fingerprint, budget used, expiry, blocked state. **Never returns the key.**
- `POST /api/forge/agents/:id/key/revoke` — admin
- `POST /api/forge/agents/:id/key/rotate` — admin

### Acceptance criteria
1. Creating an agent in Forge UI triggers exactly one `/key/generate` call.
2. The plaintext virtual key never appears in any UI response, log, or DB query result.
3. Two agents with different model scopes cannot call models the other is scoped to.
4. Budget exhaustion on agent A does not affect agent B.
5. Rotating a key does not require any UI interaction; in-flight requests using the old key fail gracefully and are retried with the new key.
6. `/api/forge/agents/:id/key/status` returns within 100ms warm-cache, 1s cold.

---

## Feature 4 — Chat Completion (SSE passthrough)

### Goal
Forge UI gets **token-by-token streaming** from LiteLLM, with full Forge metadata attached, full reasoning visibility, and full tool-call support — without ever touching the master key or virtual key directly.

### Spec

**Request shape (UI → Forge Backend):**
- `POST /api/forge/chat/stream`
- Body: `{ agent_id, messages[], tools?, tool_choice?, temperature?, max_tokens?, stop?, response_format? }`
- Headers: Forge session JWT, `X-Forge-Run-Id` (optional, generated if absent).

**Backend behavior:**
1. Resolve `agent_id` → virtual key from broker.
2. Build LiteLLM request:
   - `model`: agent's default model (overridable per request).
   - `messages`: pass through, but inject Forge system prompt at index 0 if not present.
   - `tools`: merge agent's static tools + MCP-derived tools (Phase 2 will own MCP).
   - `stream: true`.
   - `metadata`: `{ forge_run_id, forge_agent_id, forge_tenant_id, forge_user_id, forge_team_id }`.
   - `user`: forge user id (for spend attribution).
3. Open SSE connection to LiteLLM `POST /v1/chat/completions`.
4. Pipe each chunk back to UI over SSE with the following per-chunk translation:

| LiteLLM chunk field | Forge SSE event |
|---|---|
| `choices[].delta.content` | `event: token\ndata: {"text": "..."}` |
| `choices[].delta.reasoning_content` | `event: reasoning\ndata: {"text": "..."}` |
| `choices[].delta.tool_calls` | `event: tool_call\ndata: {...}` |
| `choices[].finish_reason` | `event: finish\ndata: {"reason": "stop"}` |
| `usage` (final chunk) | `event: usage\ndata: {prompt_tokens, completion_tokens, total_tokens}` |
| any error chunk | `event: error\ndata: {code, message}` |

5. On stream end: record spend (see Feature 5).
6. On UI disconnect: call LiteLLM abort to cancel the upstream request.

**Cancel support:**
- `POST /api/forge/chat/cancel` with `{ run_id }` → call `/responses/{id}/cancel` if the response has been backgrounded, or close the SSE stream locally.

**Error model (typed):**
- `AuthenticationError` → 401 to UI, log + audit.
- `BudgetExceeded` → 402 to UI, surface in agent panel.
- `RateLimitError` → 429 to UI, exponential backoff suggested.
- `GuardrailViolation` → 422 to UI, include triggered policy (Phase 2).
- `ContextLengthExceeded` → 413 to UI, suggest summarization.
- `UpstreamError` (LiteLLM 5xx) → 502 to UI, retry internally up to 3x.
- `ValidationError` → 400 to UI with field-level details.

**Streaming rules:**
- First byte to UI within 200ms of request.
- No buffering beyond one chunk.
- Backpressure honored: if UI is slow, LiteLLM upstream is paused.
- All chunks logged at `debug` level; never logged at `info` or higher (token-level data is sensitive).

### LiteLLM endpoints used
- `POST /v1/chat/completions` (virtual key, streaming)
- `POST /v1/responses` (for long-running background runs)
- `POST /responses/{id}/cancel`
- `POST /responses/{id}/input_items` (resume/append to background run)

### Forge Backend contract
- `POST /api/forge/chat/stream` — SSE endpoint
- `POST /api/forge/chat/cancel` — abort a running stream
- `GET /api/forge/chat/runs/:run_id` — get run status
- `WS /api/forge/chat/ws` — WebSocket variant for clients that prefer it

### Acceptance criteria
1. First token reaches UI within 300ms of request.
2. Tool calls appear as discrete `tool_call` events, not interleaved with text tokens.
3. Reasoning content (for reasoning models) streams as a separate `reasoning` event.
4. Disconnecting the UI cancels the upstream LiteLLM call (no orphaned requests).
5. A 1000-token response streams in under 5 seconds end-to-end.
6. Master key and virtual key never appear in any SSE event payload.
7. Every chat completion produces a `forge.chat.completed` audit event with token counts and cost.
8. Budget-exceeded and rate-limit errors are surfaced to UI as typed errors, not raw 500s.

---

## Feature 5 — Spend Aggregation

### Goal
Forge Backend records **per-call spend in real time** for the live cost meter, and reconciles against LiteLLM's authoritative spend logs on a schedule so Forge UI's numbers never drift.

### Spec

**Real-time path (every chat completion):**
- On stream end, the final `usage` chunk contains `{prompt_tokens, completion_tokens, total_tokens}`.
- Forge Backend computes cost:
  - Look up model cost in cached cost map (`/public/litellm_model_cost_map`).
  - `cost_usd = (prompt_tokens / 1000) * input_cost_per_1k + (completion_tokens / 1000) * output_cost_per_1k`.
- Write to Forge DB `spend_records` table:
  - `run_id`, `agent_id`, `user_id`, `tenant_id`, `team_id`, `model`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost_usd`, `created_at`, `litellm_request_id` (idempotency key).
- Emit `forge.spend.recorded` event for downstream UI updates (cost meter, dashboards).

**Reconciliation path (every 5 min):**
- Forge Backend calls `GET /spend/logs?start_date=<last_sync>` with master key.
- For each log row:
  - Compare `litellm_request_id` against Forge DB.
  - If missing → insert.
  - If exists but cost differs → update (LiteLLM is authoritative for cost).
  - Mark with `reconciled_at`.
- If reconciliation finds > 1% drift → emit `forge.spend.drift_detected` alert.

**Rollup endpoints (for dashboards):**
- `GET /api/forge/spend/summary?tenant_id&since=7d` → `{ total_cost, by_model[], by_agent[], by_user[], trend[] }`
- `GET /api/forge/spend/agents/:id?since=24h` → per-agent breakdown
- `GET /api/forge/spend/tenants/:id/budget?since=24h` → tenant budget consumption
- `GET /api/forge/spend/cost-meter?run_id=...` → live cost meter for an active run (real-time path)

**Budget guard:**
- Before each call: estimate cost, check against agent's `max_budget - current_spend`.
- If estimated cost > remaining → return `BudgetExceeded` to UI **before** the call.
- After each call: re-check. If `current_spend / max_budget > 0.9` → emit `forge.spend.budget_warning`.
- If `current_spend >= max_budget` → auto-block the agent's key, emit `forge.spend.budget_exceeded`.

**Idempotency:**
- `litellm_request_id` (the LiteLLM response `id`) is the unique key.
- Reconciliation must not double-count.
- Manual backfill is supported via `POST /api/forge/spend/backfill?since=<date>`.

### LiteLLM endpoints used
- `GET /spend/logs` (master key)
- `GET /global/spend` (master key)
- `GET /key/info` (master key, per-agent)
- `GET /user/daily/activity` (master key)
- `GET /team/daily/activity` (master key)
- `GET /organization/daily/activity` (master key)
- `GET /customer/daily/activity` (master key)
- `GET /agent/daily/activity` (master key)
- `GET /tag/daily`, `/tag/dau`, `/tag/wau`, `/tag/mau` (master key)

### Forge Backend contract
- `GET /api/forge/spend/summary` — dashboard rollup
- `GET /api/forge/spend/agents/:id` — per-agent
- `GET /api/forge/spend/tenants/:id` — per-tenant
- `GET /api/forge/spend/cost-meter/:run_id` — live
- `POST /api/forge/spend/backfill` — admin reconciliation
- `WS /api/forge/spend/stream` — real-time spend event stream (for UI cost meter)

### Acceptance criteria
1. Cost meter in UI updates within 5 seconds of a chat completion ending.
2. After 100 chat completions, Forge DB `spend_records` has exactly 100 rows.
3. Reconciliation round-trip with LiteLLM shows zero drift over a 1-hour window.
4. Budget-exceeded blocks the call **before** it hits LiteLLM (verified by LiteLLM spend log absence).
5. Cost summary at `/api/forge/spend/summary` returns within 200ms warm-cache.
6. Spend events stream over WebSocket with backpressure handling.
7. `forge.spend.drift_detected` alert fires when LiteLLM cost differs from Forge-recorded cost by > 1%.

---

## Cross-Cutting Concerns

### Audit logging
Every Phase 1 action emits a `forge.audit` event:
- `forge.auth.config_loaded`
- `forge.models.refreshed` (with route counts)
- `forge.keys.issued` / `forge.keys.rotated` / `forge.keys.revoked`
- `forge.chat.started` / `forge.chat.completed` / `forge.chat.cancelled` / `forge.chat.failed`
- `forge.spend.recorded` / `forge.spend.reconciled` / `forge.spend.drift_detected` / `forge.spend.budget_warning` / `forge.spend.budget_exceeded`

Each event: `{ event_id, ts, tenant_id, agent_id, user_id, request_id, payload_summary, duration_ms, status }`.

### Error envelope
All Forge Backend API responses use:
```json
{ "ok": true,  "data": {...} }
{ "ok": false, "error": { "code": "BudgetExceeded", "message": "...", "details": {...} } }
```

### Rate limiting
- Per-user: 60 req/min.
- Per-agent: 600 req/min (matches typical TPM limits).
- Per-tenant: 6000 req/min.
- LiteLLM `429` triggers exponential backoff at the Forge Backend level.

### Observability
- Every request has a `forge_request_id` (UUIDv7).
- Propagated via header `X-Forge-Request-Id` to LiteLLM.
- All logs and audit events tagged with this id.
- `/api/forge/health` reports: Forge uptime, LiteLLM reachability, cache hit rate, error rate (5m, 1h, 24h), p50/p95/p99 latency for chat completions.

---

## Data Flow (Phase 1)

```
┌─────────────┐  1. chat request    ┌─────────────────┐  2. resolve key
│  Forge UI   │ ──────────────────► │  Forge Backend  │ ───────────────┐
│             │ ◄────────────────── │                 │ ◄─────────────┘
└─────────────┘  3. SSE stream      └────────┬────────┘
                                             │
                  4. withVirtualKey()        │   5. withMasterKey()
                                             ▼                       ▼
                                    ┌─────────────────┐    ┌─────────────────┐
                                    │ LiteLLM (chat)  │    │ LiteLLM (admin) │
                                    │ sk-virtual-key  │    │ master-key      │
                                    └────────┬────────┘    └────────┬────────┘
                                             │                      │
                                             ▼                      ▼
                                    ┌─────────────────────────────────────┐
                                    │  Spend log  ·  Model registry       │
                                    │  Key registry ·  Audit log          │
                                    └─────────────────────────────────────┘
                                                  │
                                                  ▼  6. /spend/logs every 5 min
                                          ┌──────────────┐
                                          │  Forge DB    │
                                          │ spend_records│
                                          └──────────────┘
```

---

## Build Order (within Phase 1)

1. **Feature 1: Config & Auth** — must come first; everything else depends on it.
2. **Feature 2: Models Registry** — needs auth, easy to verify.
3. **Feature 5: Spend Aggregation** — build the write-path early so chat completions can record spend from day one.
4. **Feature 3: Virtual Key Broker** — needs auth + models (so we know what to scope).
5. **Feature 4: Chat Completion (SSE)** — the biggest piece; build last so it sits on top of all others.

**Verification gate after each feature:** the corresponding acceptance criteria are met, demonstrated with a recorded run (curl + UI screenshot).

---

## Anti-Patterns (auto-reject if seen)

- ❌ Master key in any URL, log, error message, or DB row.
- ❌ Virtual key returned in any UI response (not even fingerprint + key preview).
- ❌ Chat completion call without `metadata.{forge_*}`.
- ❌ `/spend/logs` called synchronously in a UI render path.
- ❌ Cost computed from `usage.total_tokens * flat_rate` (must use model's actual cost map).
- ❌ Reconciliation that double-counts.
- ❌ Stream buffering (any code that waits for "full response" before forwarding to UI).
- ❌ Catching all LiteLLM errors as `Error` (must translate to typed Forge errors).
- ❌ Health check that polls `/health/readiness` more than once per minute.
- ❌ Budget enforcement that runs after the call instead of before.

---

## Deliverables for Phase 1

1. `forge-backend-config.md` — env var spec, boot validation, secrets hygiene rules
2. `forge-backend-auth.md` — auth chain rules, master-vs-virtual key split, redaction policy
3. `forge-models-service.md` — model picker contract, cache TTLs, grouping
4. `forge-virtual-key-broker.md` — key lifecycle, rotation, revocation, budget enforcement
5. `forge-chat-stream.md` — SSE protocol spec, error model, cancel/retry semantics
6. `forge-spend-aggregation.md` — real-time + reconciliation paths, rollup queries
7. `forge-audit-events.md` — every event Phase 1 emits, with payload schema
8. `forge-phase1-verification.md` — acceptance criteria checklist with evidence per feature

---

## Out of Scope for Phase 1 (deferred to later phases)

- Guardrails & policies (Phase 2)
- MCP tool gateway (Phase 2)
- Skills registry (Phase 2)
- Tools registry (Phase 2)
- Prompts (Phase 3)
- RAG / vector stores (Phase 3)
- Files / batches / fine-tuning (Phase 3)
- Provider pass-through for Cursor-compat OpenAI (Phase 4)
- Realtime / responses / interactions (Phase 4)
- OAuth / SCIM / SSO (Phase 4)
- Cache, credentials, CloudZero / Vantage exports (Phase 4)

These are listed in `forge-litellm-integration.md` §3 with their LiteLLM endpoints; they are explicitly **not** part of Phase 1's spec.
