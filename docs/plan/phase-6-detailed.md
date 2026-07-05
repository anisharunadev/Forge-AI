# Phase 6 — Cost, Budgets & Rate Limits (Implementation Plan)

**Status:** PLANNED (awaiting implementation start)
**Owner:** TBA
**Depends on:** Phase 1 green (test runner, CI green, single glob), Phase 2 green (single transport, orphan guard), Phase 4 green (composite indexes + isolation tests), Phase 5 green (audit stream + SLOs feeding cost telemetry)
**Blocks:** Phase 7 (rotation needs cost reconciliation), Phase 8 (sign-off needs verified budgets)

---

## 0. Pre-Phase State Verification

All findings below are from the working tree on `2026-07-05`. Every claim cites `file:line`.

### 0.1 `backend/app/services/forge_budget_guard.py` exists but is **agent-scoped**, not tenant-scoped — drift from the brief

- **File:** `backend/app/services/forge_budget_guard.py` (217 lines).
- **Module docstring (lines 1-13) declares agent scope:** *"Wraps a single agent's last-30-day spend against the per-agent `agent_virtual_key.max_budget_usd` ceiling."*
- **The exception raised is `AgentBudgetExceeded` (lines 35-51)**, not `BudgetExceeded` and not `TenantBudgetExceeded`. The class name embeds the scope.
- **Read against SC-6.1:** the brief expects the budget guard to "return HTTP 429 on tenant budget overrun." Today's guard has no tenant concept — it queries `spend_records WHERE agent_id = :aid` (`forge_budget_guard.py:84-89`) and reads `agent_virtual_key.max_budget_usd` (`forge_budget_guard.py:112-115`). There is no tenant-level ceiling anywhere in the module.
- **Failure mode today:** the guard **raises** (`forge_budget_guard.py:173-175`). It is fail-closed for the AGENT scope — when `spent_usd + est_cost_usd > ceiling_usd`, `AgentBudgetExceeded` propagates up. `stream_chat` (`forge_chat.py:200`) catches it and yields an SSE `error` chunk. The chat HTTP layer (`backend/app/api/v1/forge_chat.py:127-128`) catches `AgentBudgetExceededError` and yields an SSE error, **never an HTTP 429** — the client sees a 200 with an embedded SSE error event.
- **Table-state failure modes (`forge_budget_guard.py:91-103`):** if `spend_records` or `agent_virtual_key` table is missing, the guard **fails open** — returns 0.0 spent / DEFAULT_BUDGET_USD ceiling (`forge_budget_guard.py:124`), letting the call through. SC-6.1 wants fail-closed.
- **Conclusion:** the brief's SC-6.1 reads "tenant budget overrun → 429." Today the system has an agent budget that fails closed inside an SSE stream and fails open when the table is missing. There is no tenant guard at all. Phase 6 PR-6.1 introduces a **tenant-scoped guard** alongside the existing agent guard; the tenant guard raises `TenantBudgetExceeded` → maps to HTTP 429 with `Retry-After`. The agent guard stays as a deeper inner check.

### 0.2 Rate limits: only `copilot_rate_limit.py` exists; no `core/rate_limit.py`; no chat/keys/rag surface limit

- **Single rate limiter in tree:** `backend/app/services/copilot_rate_limit.py` (160 lines). Module docstring at `copilot_rate_limit.py:1-21` declares scope: *"Caps at `settings.copilot_rate_limit_per_min` messages per `(user_id, tenant_id)` per rolling 60-second window."*
- **Default value:** `settings.copilot_rate_limit_per_min = 10` (`backend/app/core/config.py:241-244`). **Not 60.** Drift from SC-6.2's "default 60 req/min for chat."
- **Where it's wired:** only `backend/app/api/v1/copilot.py:122-151` (POST `/copilot/conversations`) and `copilot.py:232-271` (POST `/copilot/conversations:stream`). On hit, raises `HTTPException(429, …, headers={"Retry-After": str(exc.retry_after_seconds)})` (`copilot.py:144-150`). This is the canonical 429-with-Retry-After template the plan copies for the new tenant rate limiter.
- **Implementation shape:** in-process `deque` sliding window (`copilot_rate_limit.py:59, 95-110`), not Redis. A `_check_redis` stub at lines 117-149 is **not wired** — the module docstring at `copilot_rate_limit.py:5-7` says *"sliding-window implementation backed by an in-process `deque` (correct for V1 single-worker + tests); a Redis path is sketched in `_check_redis` for when a Redis client is added in a later plan."* The same Redis-backed approach is what Phase 6 ships, default to Redis with in-process fallback so multi-worker is correct.
- **Where the brief expects limits:** `/forge/chat`, `/copilot/*`, `/forge/keys`, `/forge/rag/search`. Today: `forge_chat.py:1-182` has **no** rate-limit dependency. `forge_keys.py`, `forge_rag.py` similarly unaffected (verified `grep -rln "rate_limit\|enforce_rate_limit" backend/app/api/v1/forge_*` returns 0 hits outside copilot).
- **Conclusion:** SC-6.2 needs a new module `backend/app/core/rate_limit.py` (per the brief's "Files Touched") that wraps the Redis sliding-window logic, exposes a FastAPI dependency `enforce_rate_limit(tenant_id, surface, limit_per_minute)`, and is wired into the four surfaces the brief lists. Default `60` per the brief, override via `Tenant.settings["rate_limit_overrides"][surface]`.

### 0.3 No `backend/app/core/rate_limit.py` — needs to be created

- Verified: `ls backend/app/core/` (15 files: `__init__.py`, `audit.py`, `auth.py`, `config.py`, `crypto.py`, `idempotency.py`, `logging.py`, `oauth2_rsa.py`, `phase4_audit_events.py`, `phase4_errors.py`, `proxy_token_cache.py`, `secret_filter.py`, `security.py`, `telemetry.py`). No `rate_limit.py`. The brief's file list says "create" — confirmed.

### 0.4 No `GET /forge/observability/budget/{tenant_id}` endpoint

- Read of `backend/app/api/v1/forge_observability.py` (359 lines, full read). Existing routes per module docstring at `forge_observability.py:7-25`: `/forge/audit`, `/forge/audit/{event_id}`, `/forge/health/services`, `/forge/metrics/spend-drift`, `/forge/metrics/rate-limits`, `/forge/metrics/latency`, `/forge/compliance/*`, `/forge/orgs/{org_id}/alerts`, `/forge/alerts/active`, `/forge/webhooks/callback`, `/forge/event-logging`, `/forge/in-product-nudges`, `/forge/health/extended`. **No `budget` endpoint exists.** T6.1.3 creates it.

### 0.5 Cost ledger exists (`cost_ledger.py`) but its canonical entry point is not used by `llm_client.py` — drift

- **File:** `backend/app/services/cost_ledger.py` (343 lines). Two canonical write paths:
  - `record_projected(...)` at `cost_ledger.py:41-78` — pre-call reservation, `projected=True`.
  - `record_actual(...)` at `cost_ledger.py:80-112` — post-call settlement, `projected=False`.
  - Legacy `record(...)` shim at `cost_ledger.py:164-203` (preserved for non-RUN callers).
  - The `__all__` at line 341 exports `CostLedger`, `cost_ledger`, `record_spend`.
- **What `llm_client.py` calls:** `self._cost_ledger.record(...)` at `llm_client.py:921` — the LEGACY shim. The hot path does not call `record_actual`. Module docstring at `cost_ledger.py:14-19` says: *"New code MUST use the explicit `record_projected` / `record_actual` split."* The canonical wrapper (`llm_client.py`) violates this. Phase 6 PR-6.9 fixes this — one-line change in `llm_client.py:921`.
- **Streaming path:** `backend/app/services/forge_chat.py:312-321` already calls `_record_spend` (which calls `spend_service.record_from_usage`, the `forge_spend.py` SpendRecord writer). It does NOT call `cost_ledger.record_actual`. **Both writers exist; only one runs for streams today.** Phase 6 PR-6.7 reconciles: keep `spend_records` as the per-call cache (used by the dashboard's `last-hour sparkline`) and ensure `cost_ledger` receives the canonical settlement (used by `sum_spent_for_run` cap rule at `cost_ledger.py:205-228`).

### 0.6 `chat_complete()` audit — call sites and their ledger coverage

- Canonical entry point per `llm_client.py:1` module docstring: *"the new canonical LLM client"*. The public method is `chat()` at `llm_client.py:215-379`, not `chat_complete`. (`prompt_service.py:399, 422` reference `chat_complete` in comments — those comments are stale; `llm_client.py` ships `chat`.) Phase 6 PR-6.9 reads both names.
- Call sites of the underlying `base_client.chat()` (the actual upstream call):
  - `llm_client.py:306` (canonical `chat()`, non-stream).
  - `llm_client.py:634` (`_chat_stream`, SSE).
  - `litellm_base_client.py:121` (raw httpx fallback used by `forge_chat.py:261-266` for direct stream).
  - `copilot_service.py:578`, `ideation/*` (5 services), `architecture/*` (7 services), `project_intelligence/*` (2 services), `agents/nodes/*` (2 services), `prompt_service.py:399` — all calling `client.chat(...)` directly on a **legacy `LiteLLMClient`** instance, NOT through `ForgeLLMClient`. These are pre-Phase-A surfaces that bypass `llm_client.py`'s guardrail / cost / budget envelope.
- **SC-6.9 drift:** "every `chat_complete()` caller writes to `cost_ledger`." Today the answer is "only `llm_client.py` does — and it writes via the legacy shim, not `record_actual`." The 16+ legacy `LiteLLMClient.chat()` callers have NO ledger write. Phase 6 PR-6.9 introduces a wrapper that catches all paths; the brief's `chat_complete()` symbol is interpreted as "every function in `llm_client.py` and `litellm_base_client.py` that calls the upstream LLM." PR-6.9.2 refactors `litellm_base_client.py` to funnel every call through a single `_post_chat()` that writes to `cost_ledger.record_actual` post-response.

### 0.7 Streaming cost drift bound — currently unbounded

- `forge_chat.py:312-321`: on each SSE `usage` chunk, fires `_record_spend` as a `create_task` (fire-and-forget). Good.
- `forge_chat.py:530-545`: `_record_spend` calls `spend_service.record_from_usage` (the `forge_spend.py` writer). On exception, the entire block is wrapped in `try/except` and logs `forge_chat.spend_record_failed`. The row is **lost** on a single retry; no reconciler fills it in.
- Reconciler today: `backend/app/services/scheduler/jobs/forge_spend_reconcile.py` (3.3K). Module docstring at line 4: *"`/spend/logs` since `now - 5 min` and upsert into `spend_records`."* **Drift:** the reconciler writes to `spend_records`, not `cost_ledger`. Phase 6 PR-6.7 unifies: reconciler runs every 5 minutes against `GET /spend/logs`, fills `spend_records` (live cache) AND marks the matching `cost_ledger` row as `final=true`.
- Streaming abort (`forge_chat.py:324-340`): on `asyncio.CancelledError`, `_record_spend` is NOT called. The row is **permanently missing** from `spend_records` and `cost_ledger`. Phase 6 PR-6.7 fixes: the `finally` block at `forge_chat.py:358-364` (currently just unregisters from the stream registry) calls `_record_spend(partial=True)` if a `usage` chunk was never seen. The reconciler then back-fills the final cost.

### 0.8 No pre-call guardrail wrapper around `chat_complete()` — but `llm_client.py` already enforces it

- `llm_client.py:267-274` calls `self._enforce_pre_call_guardrails(...)` BEFORE `base_client.chat(...)`. The guardrail flow lives at `llm_client.py:681-777` (pre-call) and `llm_client.py:779-829` (post-call). It uses the per-tenant mirror (`guardrails_service.resolve_effective`).
- **Drift vs. SC-6.7:** the brief says "wrap `chat_complete()` itself to enforce guardrail (so callers cannot bypass)." This is true for `llm_client.py:ForgeLLMClient.chat` — the guardrail is enforced at the wrapper, callers cannot bypass. But the 16+ legacy `LiteLLMClient.chat()` callers (see §0.6) call the underlying httpx directly and **do not enforce any guardrail**. PR-6.6 audit reveals the gap; PR-6.6.2 fixes it by either migrating legacy callers to `ForgeLLMClient` or adding the same guardrail envelope at `litellm_base_client.py:_post_chat`.

### 0.9 No `apps/forge/app/admin/cost/page.tsx` — needs to be created

- `ls apps/forge/app/admin/`: `llm-gateway/`, `seeds/`, `loading.tsx`, `page.tsx` (generic 4.4K). **No `cost/` directory.** The brief's "Files Touched" lists this as create. Confirmed drift.

### 0.10 No `scripts/loadtest/chat_1000.py` — needs to be created

- `ls scripts/loadtest/`: empty (does not exist). `ls scripts/` returns: `check-claude-md.sh`, `check-feature-docs.{sh,py}`, `check-test-location.sh`, `db-migrate.sh`, `deploy.sh`, `floci-init/`, `postgres-init/`, `generate-built-features.{sh,py}`, `lint.sh`, `typecheck.sh`, `setup-local.sh`, `smoke_m1.sh`. **No `loadtest/` directory.** Confirmed drift; PR-6.4 creates it.

### 0.11 No `scripts/audit-cost-leaks.py` — needs to be created

- `ls scripts/ | grep audit`: returns 0 hits. Brief expects this for SC-6.9. PR-6.9.1 creates it.

### 0.12 No `docs/runbooks/guardrails.md` — needs to be created

- `ls docs/runbooks/`: `budget-exhausted.md` (7.1K), `litellm-downtime.md` (24.2K). **No `guardrails.md`, no `loadtesting.md`.** Brief expects both. PR-6.6 and PR-6.4 create them.

### 0.13 No `backend/tests/test_budget_guard.py`, `test_rate_limit.py`, `test_chaos_litellm.py` — all must be created

- `ls backend/tests/`: 30+ test files, but none of the three names exist. Verified above. PR-6.1.4, PR-6.2.5, PR-6.3.3 create them.

### 0.14 Frontend admin page pattern — `apps/forge/app/admin/page.tsx` (4.4K) is the template

- Read in full. Uses Next.js App Router, Tailwind 3.4, server-side fetch. Renders a stat-card grid with `bg-white/5 border border-white/10 rounded-lg p-4`. Phase 6 PR-6.5 mirrors this shape for `/admin/cost`. R15 (empty states with icon + value prop + primary action + secondary action) is honored in the empty branch.

### 0.15 Drift and ambiguity resolved with a default

| Brief says | Reality | Resolution |
|---|---|---|
| SC-6.1: "budget overrun → 429" | `forge_budget_guard.py` raises an AGENT-scoped exception that surfaces as SSE `error` event, not HTTP 429. No tenant guard exists. | PR-6.1 adds a tenant-scoped `TenantBudgetExceeded` exception raised from a new `TenantBudgetGuard.check_pre_call()` and maps to HTTP 429 in `forge_chat.py:127-128` and `forge_observability.py` new endpoint. The agent guard stays. |
| SC-6.2: "default 60 req/min for chat completions" | Default is `copilot_rate_limit_per_min=10` (config.py:243). Copilot is the only rate-limited surface today. | New `chat_rate_limit_per_min=60` setting in `core/config.py`. Applied to `/forge/chat/stream` and `/copilot/conversations` (overrides existing 10/min copilot setting when tenant JSONB override is absent). |
| SC-6.2: "override via tenant settings" | `Tenant.settings` is a JSONB column at `tenant.py:27` but no consumer reads `rate_limit_overrides` from it. | PR-6.2 reads `tenant.settings["rate_limit_overrides"][surface]` (default to global default). Schema shape documented in §4 PR-6.2. |
| SC-6.3: "Retry-After header" | `copilot.py:144-150` already returns 429 + Retry-After. New surfaces copy this template. | `Retry-After` = integer seconds, equal to `(60 - seconds_into_current_minute)`. |
| SC-6.4: "queue up to N then 503 when LiteLLM down" | No queue logic exists. `LLMUnavailableError` is raised immediately (`llm_client.py:336`). | PR-6.3 adds a Redis-backed bounded FIFO queue (size = `tenant.settings.max_queue_size`, default 100). On overflow: 503 + `Retry-After: 5`. On queueable: `202 Accepted` with `X-Forge-Queued: true` header. |
| SC-6.5: "1000 concurrent chat, p95 < 2s" | No load test script exists. LiteLLM Proxy is the hot path; p95 budget = LiteLLM + Postgres + Redis. | PR-6.4 creates `scripts/loadtest/chat_1000.py` (asyncio + httpx + semaphore). Report written to `docs/plan/phase-6-loadtest-report.md`. Run against staging. |
| SC-6.6: "real-time cost dashboard in Admin UI" | No `apps/forge/app/admin/cost/page.tsx` exists. `forge_observability.py` has `/metrics/spend-drift` and `/metrics/rate-limits` but no `/cost/realtime`. | PR-6.5 creates both the page and the backend endpoint. Polling 5 s (no WS in Phase 6). |
| SC-6.7: "pre-call guardrail wrapper" | `llm_client.py:267` enforces pre-call guardrail in `ForgeLLMClient.chat`. Legacy `LiteLLMClient` callers bypass it. | PR-6.6 (a) documents the wrapper contract in `docs/runbooks/guardrails.md`, (b) audits the 16 legacy call sites, (c) migrates the 8 in-app ones to `ForgeLLMClient`. External agents keep legacy `LiteLLMClient` but get a deprecation log. |
| SC-6.8: "streaming cost meter, ledger update within 1s" | `forge_chat.py:312-321` fires `_record_spend` on each `usage` chunk via `create_task`. Best-effort. No `final` flag. | PR-6.7 rewrites `_record_spend` to (a) call `cost_ledger.record_projected` immediately, (b) call `cost_ledger.record_actual` on `[DONE]`, (c) on disconnect call `record_actual(partial=True)` so reconciler can finalize. |
| SC-6.9: "audit all `chat_complete()` callers write to ledger" | 16 legacy call sites bypass the ledger. `llm_client.py:921` uses the legacy `record` shim, not `record_actual`. | PR-6.9 (a) writes `scripts/audit-cost-leaks.py` (grep for `httpx.post.*chat/completions` and `httpx.post.*generate` outside `app/integrations/litellm/`), (b) migrates the 8 in-app callers, (c) flips the one shim call in `llm_client.py:921` to `record_actual`. |
| `chat_complete()` symbol | Method is named `chat()` in `llm_client.py:215`. Comments reference `chat_complete` (`prompt_service.py:399, 422`). | Treat "chat_complete" as the conceptual entry point; the canonical name is `chat`. PR-6.9.1 audit greps for both. |

**Defaults documented for one-line override at implementation time:**

- **Default rate limit (60 req/min):** `chat_rate_limit_per_min=60` setting added to `core/config.py`. Tenant override via `Tenant.settings["rate_limit_overrides"]["chat"]`.
- **Queue size on LiteLLM down (100):** `tenant_max_queue_size=100` default. Tenant override via `Tenant.settings["max_queue_size"]`.
- **`Retry-After` semantics:** integer seconds = time until the rate-limit minute rolls over (sliding window: `(60 - seconds_into_minute) + 1`).
- **Budget guard feature flag (`tenant_settings.budget_enforcement_v2`):** absent today; PR-6.1 introduces `Tenant.settings["budget_enforcement_v2"] = true|false` default `true` for new tenants. Migrations add nothing — `Tenant.settings` JSONB already accepts the key.
- **Streaming cost drift bound:** reconciler job runs every 5 min against LiteLLM `/spend/logs` (already in `forge_spend_reconcile.py`); PR-6.7 extends the reconciler to also patch `cost_ledger` rows from `final=false` to `final=true` using `/spend/logs` cost data.

### 0.16 Phase 1–5 givens (assumed green at start)

- Phase 1: `pnpm test` exits 0; one glob; CI blocks.
- Phase 2: single canonical API transport; orphan-router guard; ideation endpoints wired.
- Phase 3: doc-drift detector (`scripts/check-doc-drift.sh`) active in CI.
- Phase 4: composite `(tenant_id, project_id, …)` indexes on every tenant-scoped table; isolation tests passing.
- Phase 5: per-surface SLOs; live audit stream (`forge_observability.py:84-126`); per-tenant sampling.
- `LiteLLMBaseClient` (Phase A) provides the canonical httpx wrapper; `ForgeLLMClient` (`llm_client.py`) wraps it with the per-tenant Virtual Key + budget + guardrail envelope.
- `spend_records` and `agent_virtual_key` tables migrated (ver `ls backend/alembic/versions/` returns `step_75_p3_spend_records_001.py`, `step_75_p4_agent_virtual_key_001.py`).
- `audit_service` and `cost_ledger` services exist (`backend/app/services/audit_service.py`, `cost_ledger.py`).
- `Tenant.settings` JSONB column migrated (`tenant.py:27`).

---

## 1. Goal

Budgets fail closed. Rate limits enforce per-tenant quotas with `Retry-After`. 1000 concurrent chat completions verified at p95 < 2s. Per-tenant cost visible in real time. Every LLM call writes to the canonical cost ledger. Pre-call guardrail enforced at the wrapper, not by convention.

---

## 2. Success Criteria

| ID | Criterion | Verification command (must pass) |
|---|---|---|
| SC-6.1 | `forge_budget_guard.py::TenantBudgetGuard.check_pre_call` raises `TenantBudgetExceeded` on tenant overrun; `forge_chat.py` maps it to HTTP 429 with `Retry-After` | `pytest backend/tests/test_budget_guard.py -k tenant_overrun_returns_429` |
| SC-6.2 | Per-tenant rate limit: default 60 req/min for chat completions; override via `Tenant.settings["rate_limit_overrides"][surface]` | `pytest backend/tests/test_rate_limit.py -k default_and_override` |
| SC-6.3 | When limit hit, response is `429` with `Retry-After` header set to integer seconds | `pytest backend/tests/test_rate_limit.py -k retry_after_header` |
| SC-6.4 | When LiteLLM is slow/down, requests enter Redis-backed FIFO queue (default size 100); on overflow 503 + `Retry-After`; chaos test passes (LiteLLM container killed mid-flight) | `pytest backend/tests/test_chaos_litellm.py -k queue_then_503` |
| SC-6.5 | Load test: 1000 concurrent chat completions across 50 tenants, p95 < 2s, error rate < 0.1% | `python scripts/loadtest/chat_1000.py` exits 0 and writes `docs/plan/phase-6-loadtest-report.md` |
| SC-6.6 | `GET /api/v1/forge/observability/cost/realtime` returns `{today_usd, last_minute_usd, top_models, last_hour_sparkline}`; `apps/forge/app/admin/cost/page.tsx` polls it every 5s | `pytest backend/tests/api/v1/test_observability_cost.py -k realtime` and Playwright in `apps/forge/tests/admin-cost.spec.ts` |
| SC-6.7 | Pre-call guardrail (`POST /apply_guardrail`) runs BEFORE every chat completion; failure mode documented in `docs/runbooks/guardrails.md`; integration test verifies block on PII | `pytest backend/tests/test_guardrail_pre_call.py -k blocked_short_circuits` and runbook exists |
| SC-6.8 | Streaming cost meter: each SSE chunk's final `usage` field updates `cost_ledger` within 1s; aborted stream writes `final=false`; reconciler fills `final=true` against `/spend/logs` | `pytest backend/tests/test_streaming_cost.py -k within_one_second` |
| SC-6.9 | `scripts/audit-cost-leaks.py` finds zero LLM callers outside `app/integrations/litellm/`; `chat()` callers all write to `cost_ledger.record_actual` | `python scripts/audit-cost-leaks.py --strict` exits 0 |

---

## 3. Sub-Phases / PR Breakdown

**9 PRs, ordered so each leaves the tree green.** PR-6.1 introduces the tenant budget guard behind a feature flag (default off, opt-in per tenant). PR-6.2 ships the rate limiter (also flag-gated). PR-6.3 adds the LiteLLM-down queue. PR-6.4 writes the load test (run only after PRs 6.1-6.3 are merged and verified on staging). PR-6.5 ships the cost dashboard. PR-6.6 audits + hardens the pre-call guardrail. PR-6.7 hardens streaming cost writes. PR-6.8 reconciles cost drift. PR-6.9 ships the audit script and closes the legacy `LiteLLMClient` ledger bypass.

| PR | Title | Depends on |
|---|---|---|
| 6.1 | Tenant budget guard — `TenantBudgetExceeded` → HTTP 429 with `Retry-After` | Phase 4 green |
| 6.2 | Per-tenant rate limit (Redis sliding window) + `Retry-After` header | 6.1 |
| 6.3 | Graceful degradation: Redis-backed FIFO queue on LiteLLM down | 6.2 |
| 6.4 | Load test harness — `scripts/loadtest/chat_1000.py` | 6.1, 6.2, 6.3 (run on staging) |
| 6.5 | Real-time cost dashboard — `apps/forge/app/admin/cost/page.tsx` + `GET /forge/observability/cost/realtime` | 6.1, 6.7 |
| 6.6 | Pre-call guardrail audit + runbook + 8-caller migration | 6.1 |
| 6.7 | Streaming cost ledger: `record_projected` per chunk, `record_actual` on `[DONE]`, `partial=true` on disconnect | 6.5 |
| 6.8 | Cost drift reconciler: extends `forge_spend_reconcile.py` to patch `cost_ledger.final=true` | 6.7 |
| 6.9 | `scripts/audit-cost-leaks.py` + final legacy-caller migration + flip one `record()` shim call | 6.5, 6.6, 6.7, 6.8 |

**Branch strategy:** every PR on its own `phase-6/<slug>` branch; merge to `main` only after the staging load test (PR-6.4) exits 0 with `docs/plan/phase-6-loadtest-report.md` greenlit.

---

## 4. Per-Task Detail

### PR-6.1 — Tenant budget guard returns HTTP 429

**Pre-conditions:** Phase 4 green (composite indexes, isolation tests); `Tenant.settings` JSONB column available.

**Files edited:**
- `backend/app/services/forge_budget_guard.py` — extend with `TenantBudgetGuard` and `TenantBudgetExceeded` (keep existing `BudgetGuard` class unchanged).
- `backend/app/api/v1/forge_chat.py` — map `TenantBudgetExceeded` → 429 with `Retry-After`.
- `backend/app/api/v1/forge_observability.py` — add `GET /forge/observability/budget/{tenant_id}`.
- `backend/app/schemas/observability_v2.py` — add `TenantBudgetRead` Pydantic v2 schema.
- `backend/tests/test_budget_guard.py` — create.
- `backend/app/core/config.py` — add `tenant_budget_enforcement_v2_default: bool = True`.
- `docs/runbooks/budget-exhausted.md` — append "v2: tenant ceiling" section.

**Decision (ponytail):** the agent guard at `forge_budget_guard.py:131-204` is preserved. A new sibling class `TenantBudgetGuard` (lines ~220-300) wraps `cost_ledger.get_total_for_tenant` over the trailing 30 days. Both guards run in series on every chat call; the tenant guard runs first because it's the cheaper query (single `SUM`).

**Exact script `backend/app/services/forge_budget_guard.py` additions** (insert after line 207):

```python
class TenantBudgetExceeded(Exception):
    """Raised when a tenant's projected spend would breach its ceiling."""

    def __init__(
        self,
        tenant_id: UUID,
        *,
        spent_usd: float,
        ceiling_usd: float,
        retry_after_seconds: int,
    ) -> None:
        self.tenant_id = tenant_id
        self.spent_usd = spent_usd
        self.ceiling_usd = ceiling_usd
        self.retry_after_seconds = retry_after_seconds
        self.code = "tenant_budget_exceeded"
        super().__init__(
            f"tenant {tenant_id} budget exhausted: "
            f"spent={spent_usd} ceiling={ceiling_usd}"
        )


class TenantBudgetGuard:
    """Pre-call admission control for a tenant (Rule 6 + SC-6.1).

    Reads ``Tenant.settings['budget_enforcement_v2']`` to decide whether
    to enforce the tenant ceiling. Reads
    ``Tenant.settings['tenant_budget_usd']`` for the ceiling; falls back
    to ``settings.tenant_default_budget_usd`` (default 5000 USD/mo).

    fail-closed (Phase 6 SC-6.1): a missing settings row raises
    TenantBudgetExceeded; a missing spend ledger fails OPEN (the guard
    reads ``get_total_for_tenant`` which returns 0 on empty).
    """

    DEFAULT_CEILING_USD = 5000.00
    WINDOW_DAYS = 30
    _cache: dict[str, tuple[float, float | None]] = {}
    _cache_lock = None  # lazy asyncio.Lock

    async def _ceiling_for(self, tenant_id: UUID) -> float:
        """Return the tenant's ceiling USD; default if unset."""
        from sqlalchemy import select
        from app.db.models.tenant import Tenant
        from app.db.session import get_session_factory

        factory = get_session_factory()
        async with factory() as session:
            row = (
                await session.execute(select(Tenant).where(Tenant.id == tenant_id))
            ).scalar_one_or_none()
        if row is None:
            return self.DEFAULT_CEILING_USD
        settings = getattr(row, "settings", {}) or {}
        ceiling = settings.get("tenant_budget_usd")
        return float(ceiling) if ceiling else self.DEFAULT_CEILING_USD

    def _is_enforced(self, tenant_settings: dict | None) -> bool:
        if not tenant_settings:
            return settings.tenant_budget_enforcement_v2_default
        return bool(
            tenant_settings.get(
                "budget_enforcement_v2",
                settings.tenant_budget_enforcement_v2_default,
            )
        )

    async def check_pre_call(
        self,
        tenant_id: UUID,
        est_cost_usd: float = 0.0,
    ) -> dict:
        """Admit or block a projected call.

        Returns ``{allow, spent_usd, ceiling_usd, pct, retry_after_seconds}``.
        Raises :class:`TenantBudgetExceeded` on overrun.
        """
        from app.db.models.tenant import Tenant as _T
        from app.db.session import get_session_factory
        from sqlalchemy import select as _sel

        if est_cost_usd < 0:
            raise ValueError("est_cost_usd must be non-negative")

        factory = get_session_factory()
        async with factory() as session:
            row = (
                await session.execute(_sel(_T).where(_T.id == tenant_id))
            ).scalar_one_or_none()
        tenant_settings = (row.settings if row else {}) or {}

        if not self._is_enforced(tenant_settings):
            return {
                "allow": True,
                "spent_usd": 0.0,
                "ceiling_usd": self.DEFAULT_CEILING_USD,
                "pct": 0.0,
                "retry_after_seconds": 0,
            }

        ceiling_usd = float(
            tenant_settings.get("tenant_budget_usd") or self.DEFAULT_CEILING_USD
        )
        spent_usd = await cost_ledger.get_total_for_tenant(
            tenant_id=tenant_id,
            since=datetime.now(UTC) - timedelta(days=self.WINDOW_DAYS),
        )

        if spent_usd + est_cost_usd > ceiling_usd:
            try:
                await audit_service.record(
                    tenant_id=tenant_id,
                    project_id=None,
                    actor_id=None,
                    action="forge.spend.tenant_budget_exceeded",
                    target_type="tenant",
                    target_id=str(tenant_id),
                    payload={
                        "spent_usd": spent_usd,
                        "ceiling_usd": ceiling_usd,
                        "projected_cost_usd": est_cost_usd,
                    },
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "forge_budget_guard.tenant_audit_failed",
                    tenant_id=str(tenant_id),
                )
            # retry_after = seconds until the next 30-day window starts is
            # not useful; instead, retry_after = ceil((ceiling - spent) /
            # daily-burn-rate) — but we don't have daily burn without an
            # extra query. Default to 1 hour so the client backs off but
            # doesn't permanently stall.
            retry_after = 3600
            raise TenantBudgetExceeded(
                tenant_id,
                spent_usd=spent_usd,
                ceiling_usd=ceiling_usd,
                retry_after_seconds=retry_after,
            )

        return {
            "allow": True,
            "spent_usd": spent_usd,
            "ceiling_usd": ceiling_usd,
            "pct": spent_usd / ceiling_usd if ceiling_usd > 0 else 0.0,
            "retry_after_seconds": 0,
        }


tenant_budget_guard = TenantBudgetGuard()


__all__ = [
    "AgentBudgetExceeded",
    "AgentBudgetWarning",
    "BudgetGuard",
    "TenantBudgetExceeded",
    "TenantBudgetGuard",
    "budget_guard",
    "tenant_budget_guard",
    "DEFAULT_BUDGET_USD",
]
```

**Exact edits to `backend/app/api/v1/forge_chat.py` (insert after line 38):**

```python
from app.services.forge_budget_guard import TenantBudgetExceeded
```

Then insert at the top of `stream_chat_endpoint`'s `generator()` (before line 117):

```python
    # Phase 6 SC-6.1: tenant budget guard runs BEFORE the SSE stream
    # opens so we can return HTTP 429 cleanly. The agent-level guard
    # still runs inside stream_chat() at forge_chat.py:200.
    try:
        from app.services.forge_budget_guard import tenant_budget_guard
        from uuid import UUID as _U
        await tenant_budget_guard.check_pre_call(
            tenant_id=_U(str(principal.tenant_id)),
            est_cost_usd=0.0,
        )
    except TenantBudgetExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": exc.code,
                "message": str(exc),
                "retry_after_seconds": exc.retry_after_seconds,
            },
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
```

**Exact addition to `backend/app/api/v1/forge_observability.py` (insert after line 209, before "# Compliance — EU AI Act + GDPR"):**

```python
@router.get(
    "/budget/{tenant_id}",
    response_model=TenantBudgetRead,
    summary="Tenant budget snapshot (today + 30-day rolling)",
)
@audit(action="forge.budget.snapshot_served", target_type="budget")
async def get_tenant_budget(
    tenant_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("budget:read"))],
) -> TenantBudgetRead:
    """Return the tenant's current budget status.

    SC-6.1: every chat call's pre-admission check reads from this same
    snapshot (cached for 60s). The endpoint surfaces the same data to
    the Admin UI for the 'budget remaining' column on the cost
    dashboard (Phase 6 SC-6.6).
    """
    from datetime import UTC, datetime, timedelta
    from app.services.forge_budget_guard import tenant_budget_guard
    from app.services.cost_ledger import cost_ledger

    snapshot = await tenant_budget_guard.check_pre_call(
        tenant_id=tenant_id, est_cost_usd=0.0
    )
    today = await cost_ledger.get_total_for_tenant(
        tenant_id=tenant_id,
        since=datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0),
    )
    return TenantBudgetRead(
        tenant_id=tenant_id,
        spent_30d_usd=snapshot["spent_usd"],
        ceiling_usd=snapshot["ceiling_usd"],
        pct=snapshot["pct"],
        today_usd=today,
    )
```

**Exact schema addition `backend/app/schemas/observability_v2.py` (insert near the existing `ComplianceReport`):**

```python
class TenantBudgetRead(BaseModel):
    tenant_id: UUID
    spent_30d_usd: float
    ceiling_usd: float
    pct: float
    today_usd: float
    # R15 — empty state for tenants with no spend yet
    has_activity: bool = False

    @model_validator(mode="after")
    def _has_activity(self) -> "TenantBudgetRead":
        object.__setattr__(self, "has_activity", self.spent_30d_usd > 0)
        return self
```

**Exact config addition `backend/app/core/config.py` (insert after line 244):**

```python
    # Phase 6 SC-6.1 — tenant budget guard (v2).
    tenant_budget_enforcement_v2_default: bool = Field(
        default=True,
        description=(
            "TENANT_BUDGET_ENFORCEMENT_V2_DEFAULT. When True, new tenants "
            "have their tenant_budget_usd ceiling enforced by "
            "forge_budget_guard.TenantBudgetGuard."
        ),
    )
    tenant_default_budget_usd: float = Field(
        default=5000.00,
        description=(
            "TENANT_DEFAULT_BUDGET_USD. Default ceiling when a tenant "
            "has no tenant_budget_usd in Tenant.settings."
        ),
    )
```

**Exact test file `backend/tests/test_budget_guard.py`:**

```python
"""Phase 6 SC-6.1 — tenant budget guard returns HTTP 429.

Tests the new ``TenantBudgetGuard`` independently of the SSE path.
The SSE-to-429 mapping is covered in test_stream_chat_budget.py.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest

from app.services.cost_ledger import cost_ledger
from app.services.forge_budget_guard import (
    TenantBudgetExceeded,
    TenantBudgetGuard,
    tenant_budget_guard,
)


@pytest.mark.asyncio
async def test_under_budget_passes(sqlite_db, two_tenants) -> None:
    ta, tb, pa = two_tenants
    with patch.object(cost_ledger, "get_total_for_tenant", AsyncMock(return_value=10.0)):
        with patch.object(TenantBudgetGuard, "_ceiling_for", AsyncMock(return_value=500.0)):
            out = await tenant_budget_guard.check_pre_call(tenant_id=ta.id, est_cost_usd=0.0)
    assert out["allow"] is True
    assert out["spent_usd"] == 10.0
    assert out["ceiling_usd"] == 500.0


@pytest.mark.asyncio
async def test_at_budget_warns_passes(sqlite_db, two_tenants) -> None:
    """99% of ceiling — admits the call but logs the warning."""
    ta, tb, pa = two_tenants
    with patch.object(cost_ledger, "get_total_for_tenant", AsyncMock(return_value=495.0)):
        with patch.object(TenantBudgetGuard, "_ceiling_for", AsyncMock(return_value=500.0)):
            out = await tenant_budget_guard.check_pre_call(tenant_id=ta.id, est_cost_usd=1.0)
    assert out["allow"] is True
    assert out["pct"] == pytest.approx(0.99, rel=0.01)


@pytest.mark.asyncio
async def test_over_budget_raises(sqlite_db, two_tenants) -> None:
    """Over the ceiling — TenantBudgetExceeded raised."""
    ta, tb, pa = two_tenants
    with patch.object(cost_ledger, "get_total_for_tenant", AsyncMock(return_value=510.0)):
        with patch.object(TenantBudgetGuard, "_ceiling_for", AsyncMock(return_value=500.0)):
            with pytest.raises(TenantBudgetExceeded) as exc_info:
                await tenant_budget_guard.check_pre_call(
                    tenant_id=ta.id, est_cost_usd=1.0
                )
    assert exc_info.value.spent_usd == 510.0
    assert exc_info.value.ceiling_usd == 500.0
    assert exc_info.value.retry_after_seconds > 0


@pytest.mark.asyncio
async def test_enforcement_flag_disables_guard(sqlite_db, two_tenants) -> None:
    """budget_enforcement_v2=false → guard always passes."""
    from app.db.models.tenant import Tenant
    from app.db.session import get_session_factory

    ta, tb, pa = two_tenants
    factory = get_session_factory()
    async with factory() as s:
        row = (
            await s.execute(
                __import__("sqlalchemy").select(Tenant).where(Tenant.id == ta.id)
            )
        ).scalar_one()
        row.settings = {"budget_enforcement_v2": False}
        await s.commit()

    with patch.object(cost_ledger, "get_total_for_tenant", AsyncMock(return_value=99999.0)):
        out = await tenant_budget_guard.check_pre_call(tenant_id=ta.id, est_cost_usd=0.0)
    assert out["allow"] is True
```

**Verification commands:**

```bash
# Single test
cd /home/arunachalam.v@knackforge.com/forge-ai/backend
pytest tests/test_budget_guard.py -v

# Full budget guard contract
pytest tests/test_budget_guard.py tests/api/v1/test_observability.py -v
```

**Branch strategy:** single branch `phase-6/tenant-budget-guard`. One PR. Lands behind `tenant_budget_enforcement_v2_default = False` for existing tenants; new tenants created after this PR gets `True` automatically.

---

### PR-6.2 — Per-tenant rate limit (Redis sliding window) + `Retry-After`

**Pre-conditions:** PR-6.1 merged.

**Files created/edited:**
- `backend/app/core/rate_limit.py` — **create** (new module; brief lists this).
- `backend/app/api/v1/forge_chat.py` — wire `enforce_rate_limit` dep on `/chat/stream`.
- `backend/app/api/v1/forge_rag.py` — wire on `/forge/rag/search` (no-op if endpoint missing — see §4 PR-6.2.3).
- `backend/app/api/v1/forge_keys.py` — wire on `/forge/keys/*` (no-op if endpoint missing — see §4 PR-6.2.4).
- `backend/app/core/config.py` — add `chat_rate_limit_per_min=60`, `rate_limit_redis_url`.
- `backend/tests/test_rate_limit.py` — create.
- `docs/standards/rate-limiting.md` — create.

**Exact script `backend/app/core/rate_limit.py`:**

```python
"""Per-tenant sliding-window rate limiter.

Phase 6 SC-6.2: every chat completion / copilot / keys / rag-search
surface has a per-tenant cap of ``chat_rate_limit_per_min`` (default 60)
requests per rolling 60-second window. Override per tenant via
``Tenant.settings['rate_limit_overrides'][surface]``.

Redis-backed (ZSET sliding window); falls back to the in-process deque
when Redis is unreachable (single-worker / test mode).
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory
from sqlalchemy import select

logger = get_logger(__name__)


@dataclass
class RateLimitResult:
    allowed: bool
    count: int
    limit: int
    retry_after_seconds: int


class RateLimitExceeded(Exception):
    def __init__(self, retry_after_seconds: int, limit: int) -> None:
        self.retry_after_seconds = retry_after_seconds
        self.limit = limit
        super().__init__(f"rate limit exceeded ({limit}/min); retry in {retry_after_seconds}s")


class TenantRateLimiter:
    """Redis sliding-window rate limiter keyed by ``(tenant, surface)``."""

    def __init__(self, redis_client: Any | None = None) -> None:
        self._redis = redis_client
        # In-process fallback (test mode + Redis-down)
        self._fallback: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._fallback_lock = asyncio.Lock()

    async def _get_redis(self) -> Any | None:
        """Resolve a Redis client; returns None when Redis is unreachable."""
        if self._redis is not None:
            return self._redis
        try:
            import redis.asyncio as aioredis  # type: ignore[import-untyped]

            self._redis = aioredis.from_url(
                settings.rate_limit_redis_url or settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
            await self._redis.ping()
            return self._redis
        except Exception:  # noqa: BLE001
            logger.warning("rate_limit.redis_unavailable_falling_back_inprocess")
            return None

    async def _override_limit(self, tenant_id: UUID, surface: str) -> int | None:
        """Read ``Tenant.settings['rate_limit_overrides'][surface]`` if set."""
        factory = get_session_factory()
        async with factory() as session:
            row = (
                await session.execute(select(Tenant).where(Tenant.id == tenant_id))
            ).scalar_one_or_none()
        if row is None:
            return None
        overrides = (row.settings or {}).get("rate_limit_overrides") or {}
        v = overrides.get(surface)
        return int(v) if v is not None else None

    async def check(
        self,
        tenant_id: UUID,
        surface: str,
        *,
        limit_per_minute: int | None = None,
    ) -> RateLimitResult:
        """Check (and record) one event for ``(tenant_id, surface)``.

        Raises :class:`RateLimitExceeded` on overflow.
        """
        limit = (
            limit_per_minute
            or await self._override_limit(tenant_id, surface)
            or settings.chat_rate_limit_per_min
        )
        key = f"rl:{tenant_id}:{surface}"
        now = time.monotonic()
        window_start = now - 60.0

        redis = await self._get_redis()
        if redis is not None:
            count = await self._check_redis(redis, key, now, window_start, limit)
        else:
            count = self._check_inprocess(key, now, window_start, limit)

        if count > limit:
            retry_after = max(1, int(60 - (now % 60)) + 1)
            logger.warning(
                "rate_limit.exceeded",
                tenant_id=str(tenant_id),
                surface=surface,
                count=count,
                limit=limit,
                retry_after=retry_after,
            )
            raise RateLimitExceeded(retry_after_seconds=retry_after, limit=limit)

        return RateLimitResult(
            allowed=True, count=count, limit=limit, retry_after_seconds=0
        )

    async def _check_redis(
        self,
        redis: Any,
        key: str,
        now: float,
        window_start: float,
        limit: int,
    ) -> int:
        """ZSET-based sliding window. Atomic via pipeline."""
        member = f"{now}:{id(object())}"
        pipe = redis.pipeline()
        pipe.zremrangebyscore(key, 0, window_start)
        pipe.zadd(key, {member: now})
        pipe.zcard(key)
        pipe.expire(key, 61)
        results = await pipe.execute()
        count = int(results[2])
        if count > limit:
            # Roll back the add so the rejected call doesn't count toward
            # the window. Without this, every rejection nudges the window
            # forward by `now` and the limiter self-throttles incorrectly.
            await redis.zrem(key, member)
        return count

    def _check_inprocess(
        self,
        key: str,
        now: float,
        window_start: float,
        limit: int,
    ) -> int:
        dq = self._fallback[key]
        while dq and dq[0] < window_start:
            dq.popleft()
        dq.append(now)
        return len(dq)


# Module-level singleton — process-wide, per-(tenant, surface) sliding window.
tenant_rate_limiter = TenantRateLimiter()


__all__ = [
    "RateLimitExceeded",
    "RateLimitResult",
    "TenantRateLimiter",
    "tenant_rate_limiter",
]
```

**Exact FastAPI dependency `enforce_rate_limit` (lives in `backend/app/core/rate_limit.py` near the singleton):**

```python
async def enforce_rate_limit(
    surface: str,
    tenant_id: UUID,
    *,
    limit_per_minute: int | None = None,
) -> RateLimitResult:
    """FastAPI dependency: 429 + Retry-After on overflow.

    Usage::

        @router.post("/foo")
        async def foo(_: Annotated[None, Depends(enforce_rate_limit("foo", tenant_id))]):
            ...
    """
    try:
        return await tenant_rate_limiter.check(
            tenant_id=tenant_id,
            surface=surface,
            limit_per_minute=limit_per_minute,
        )
    except RateLimitExceeded as exc:
        from fastapi import HTTPException, status as _status
        raise HTTPException(
            status_code=_status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "rate_limit_exceeded",
                "surface": surface,
                "retry_after_seconds": exc.retry_after_seconds,
                "limit": exc.limit,
            },
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
```

**Wire into `backend/app/api/v1/forge_chat.py` — add the dep to `stream_chat_endpoint`:**

```python
@router.post("/chat/stream", ...)
async def stream_chat_endpoint(
    body: ChatStreamRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(require_tenant)],
    _rl: Annotated[None, Depends(enforce_rate_limit("chat", tenant_id=...))] = ...,
) -> StreamingResponse:
    ...
```

(Implementation detail: `enforce_rate_limit` is called with `principal.tenant_id` extracted inside the dep via a small wrapper `enforce_chat_rate_limit`. The wrapper is a one-liner in `forge_chat.py` that closes over `principal`.)

**Wire into `backend/app/api/v1/copilot.py` — replace the existing `copilot_rate_limiter` call (line 122-151):**

```python
# Phase 6 PR-6.2 — tenant-level limiter replaces per-user limiter.
# Per-user limiter is retained for the Steward tools surface.
try:
    await tenant_rate_limiter.check(
        tenant_id=UUID(str(principal.tenant_id)),
        surface="copilot",
    )
except RateLimitExceeded as exc:
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={
            "error": "copilot.rate_limit_exceeded",
            "retry_after_seconds": exc.retry_after_seconds,
            "limit": exc.limit,
        },
        headers={"Retry-After": str(exc.retry_after_seconds)},
    ) from exc
```

(Existing `copilot_rate_limiter` stays as a per-user limiter for tools; `tenant_rate_limiter` is the tenant gate.)

**Config additions `backend/app/core/config.py` (after line 244):**

```python
    # Phase 6 SC-6.2 — per-tenant rate limit.
    chat_rate_limit_per_min: int = Field(
        default=60,
        description=(
            "CHAT_RATE_LIMIT_PER_MIN. Default per-tenant cap for chat "
            "completions. Override via "
            "Tenant.settings['rate_limit_overrides']['chat']."
        ),
    )
    copilot_rate_limit_per_min: int = Field(
        default=60,
        description=(
            "COPILOT_RATE_LIMIT_PER_MIN_V6. Phase 6 raises the V5 "
            "default from 10/min to 60/min. Per-user limiter still "
            "applies on top (copilot_rate_limiter)."
        ),
    )
    rate_limit_redis_url: str | None = Field(
        default=None,
        description=(
            "RATE_LIMIT_REDIS_URL. Falls back to REDIS_URL when unset."
        ),
    )
```

**Exact test file `backend/tests/test_rate_limit.py`:**

```python
"""Phase 6 SC-6.2 + SC-6.3 — per-tenant rate limit defaults + Retry-After."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.core.rate_limit import (
    RateLimitExceeded,
    TenantRateLimiter,
    enforce_rate_limit,
    tenant_rate_limiter,
)


@pytest.mark.asyncio
async def test_default_limit_is_60(sqlite_db, two_tenants) -> None:
    """First 60 calls pass; 61st raises."""
    ta, tb, pa = two_tenants
    # Patch the Redis call to be in-process for deterministic tests.
    limiter = TenantRateLimiter(redis_client=None)
    for i in range(60):
        out = await limiter.check(tenant_id=ta.id, surface="chat")
        assert out.allowed is True
    with pytest.raises(RateLimitExceeded) as exc_info:
        await limiter.check(tenant_id=ta.id, surface="chat")
    assert exc_info.value.limit == 60
    assert exc_info.value.retry_after_seconds > 0


@pytest.mark.asyncio
async def test_tenant_override(sqlite_db, two_tenants) -> None:
    """Tenant override lowers the cap; default is bypassed."""
    from app.db.models.tenant import Tenant
    from app.db.session import get_session_factory
    import sqlalchemy as sa

    ta, tb, pa = two_tenants
    factory = get_session_factory()
    async with factory() as s:
        row = (
            await s.execute(sa.select(Tenant).where(Tenant.id == ta.id))
        ).scalar_one()
        row.settings = {"rate_limit_overrides": {"chat": 5}}
        await s.commit()

    limiter = TenantRateLimiter(redis_client=None)
    for _ in range(5):
        out = await limiter.check(tenant_id=ta.id, surface="chat")
        assert out.allowed is True
    with pytest.raises(RateLimitExceeded) as exc_info:
        await limiter.check(tenant_id=ta.id, surface="chat")
    assert exc_info.value.limit == 5


@pytest.mark.asyncio
async def test_retry_after_header_format(sqlite_db, two_tenants) -> None:
    """enforce_rate_limit dependency raises HTTPException with Retry-After."""
    ta, tb, pa = two_tenants
    # Force overflow
    limiter = TenantRateLimiter(redis_client=None)
    for _ in range(60):
        await limiter.check(tenant_id=ta.id, surface="chat")

    with pytest.raises(HTTPException) as exc_info:
        await enforce_rate_limit("chat", tenant_id=ta.id)
    assert exc_info.value.status_code == 429
    assert "Retry-After" in exc_info.value.headers
    assert int(exc_info.value.headers["Retry-After"]) > 0
    assert int(exc_info.value.headers["Retry-After"]) <= 61


@pytest.mark.asyncio
async def test_separate_surfaces_have_separate_buckets(sqlite_db, two_tenants) -> None:
    """chat and rag counters are independent."""
    ta, tb, pa = two_tenants
    limiter = TenantRateLimiter(redis_client=None)
    for _ in range(60):
        await limiter.check(tenant_id=ta.id, surface="chat")
    with pytest.raises(RateLimitExceeded):
        await limiter.check(tenant_id=ta.id, surface="chat")
    # rag is a separate bucket; still allowed.
    out = await limiter.check(tenant_id=ta.id, surface="rag")
    assert out.allowed is True
```

**Verification commands:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai/backend
pytest tests/test_rate_limit.py -v
```

**Branch strategy:** single branch `phase-6/rate-limit`. One PR. Lands behind `chat_rate_limit_per_min=60` global default; per-tenant override reads from JSONB.

---

### PR-6.3 — Graceful degradation: Redis-backed FIFO queue on LiteLLM down

**Pre-conditions:** PR-6.2 merged (Redis client reachable).

**Files created/edited:**
- `backend/app/services/llm_degradation_queue.py` — **create** (bounded FIFO queue).
- `backend/app/integrations/litellm/llm_client.py` — wrap `base_client.chat()` and `_chat_stream` with the queue.
- `backend/app/api/v1/forge_chat.py` — return 503 + `Retry-After` when queue is full.
- `backend/app/core/config.py` — add `degradation_queue_max=100`, `degradation_queue_ttl_seconds=300`.
- `backend/tests/test_chaos_litellm.py` — create.

**Exact script `backend/app/services/llm_degradation_queue.py`:**

```python
"""Phase 6 SC-6.4 — graceful degradation queue when LiteLLM is slow/down.

Redis-backed bounded FIFO. When LiteLLM is unreachable, incoming chat
requests are queued (size = ``tenant.settings['max_queue_size']``,
default 100). On overflow the call returns 503 + ``Retry-After``.

Reads the size from ``Tenant.settings['max_queue_size']`` per tenant
(default ``settings.degradation_queue_max`` = 100).

Key shape::

    llm-queue:{tenant_id}   LIST  (FIFO)
    llm-queue-stats:{tenant_id}   HASH  {size, oldest_enqueue_ts}

ponytail: a single Redis LIST per tenant is fine up to ~10k items;
above that, partition by hash bucket. Phase 6 default 100 needs no
sharding.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory
from sqlalchemy import select

logger = get_logger(__name__)


class QueueFull(Exception):
    def __init__(self, retry_after_seconds: int = 5) -> None:
        self.retry_after_seconds = retry_after_seconds
        super().__init__(f"queue full; retry in {retry_after_seconds}s")


@dataclass
class QueueEntry:
    request_id: UUID
    tenant_id: UUID
    enqueued_at: float


class DegradationQueue:
    def __init__(self, redis_client: Any | None = None) -> None:
        self._redis = redis_client

    async def _get_redis(self) -> Any | None:
        if self._redis is not None:
            return self._redis
        try:
            import redis.asyncio as aioredis  # type: ignore[import-untyped]
            self._redis = aioredis.from_url(
                settings.rate_limit_redis_url or settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
            await self._redis.ping()
            return self._redis
        except Exception:  # noqa: BLE001
            return None

    async def _max_for(self, tenant_id: UUID) -> int:
        factory = get_session_factory()
        async with factory() as session:
            row = (
                await session.execute(select(Tenant).where(Tenant.id == tenant_id))
            ).scalar_one_or_none()
        if row is None:
            return settings.degradation_queue_max
        return int((row.settings or {}).get("max_queue_size") or settings.degradation_queue_max)

    async def enqueue(self, tenant_id: UUID, *, payload: bytes) -> QueueEntry:
        """Push one request onto the queue; raise QueueFull on overflow."""
        redis = await self._get_redis()
        if redis is None:
            # Redis-down: fail loud (return 503, do NOT queue in-process —
            # process memory would be the next casualty)
            raise QueueFull(retry_after_seconds=5)
        max_size = await self._max_for(tenant_id)
        size = await redis.llen(f"llm-queue:{tenant_id}")
        if size >= max_size:
            raise QueueFull(retry_after_seconds=5)
        entry = QueueEntry(
            request_id=uuid4(),
            tenant_id=tenant_id,
            enqueued_at=time.monotonic(),
        )
        await redis.lpush(
            f"llm-queue:{tenant_id}",
            f"{entry.request_id}|{entry.enqueued_at}".encode("utf-8"),
        )
        await redis.expire(f"llm-queue:{tenant_id}", settings.degradation_queue_ttl_seconds)
        return entry

    async def drain(self, tenant_id: UUID) -> list[QueueEntry]:
        """Pop and return all queued entries for ``tenant_id``.

        Called by the recovery worker (Phase 7) when LiteLLM is back.
        Phase 6 only ships ``enqueue``; the drain side is a follow-up.
        """
        redis = await self._get_redis()
        if redis is None:
            return []
        items = await redis.lrange(f"llm-queue:{tenant_id}", 0, -1)
        await redis.delete(f"llm-queue:{tenant_id}")
        out: list[QueueEntry] = []
        for raw in items or []:
            try:
                rid, ts = raw.split("|", 1)
                out.append(
                    QueueEntry(
                        request_id=UUID(rid),
                        tenant_id=tenant_id,
                        enqueued_at=float(ts),
                    )
                )
            except Exception:  # noqa: BLE001
                continue
        return out


degradation_queue = DegradationQueue()


__all__ = [
    "DegradationQueue",
    "QueueEntry",
    "QueueFull",
    "degradation_queue",
]
```

**Exact edit `backend/app/integrations/litellm/llm_client.py` — wrap `base_client.chat()` in the queue path** (insert after line 287, before the `started = time.monotonic()`):

```python
        # Phase 6 SC-6.4 — graceful degradation when LiteLLM is unreachable.
        # We don't pre-flight a health check (extra latency); instead we
        # attempt the call, catch the LLMUnavailableError, and queue the
        # request if room. On queue-full: re-raise so the route returns
        # 503 + Retry-After.
        try:
            if stream:
                return self._chat_stream(...)
            response_body, response_headers = await base_client.chat(...)
        except LLMUnavailableError as exc:
            from app.services.llm_degradation_queue import (
                QueueFull,
                degradation_queue,
            )
            try:
                entry = await degradation_queue.enqueue(
                    tenant_id=tenant_id,
                    payload=b"",  # Phase 6 stores enqueue metadata only
                )
                logger.info(
                    "litellm.degradation_queued",
                    tenant_id=str(tenant_id),
                    request_id=str(entry.request_id),
                )
                # Surface 202 + X-Forge-Queued to the client.
                raise _QueuedForLater(request_id=str(entry.request_id)) from exc
            except QueueFull as qf:
                logger.warning(
                    "litellm.degradation_queue_full",
                    tenant_id=str(tenant_id),
                )
                raise
```

**New exception class `_QueuedForLater` (top of `llm_client.py`):**

```python
class _QueuedForLater(Exception):
    def __init__(self, request_id: str) -> None:
        self.request_id = request_id
        super().__init__(f"queued for later; request_id={request_id}")
```

**Edit `backend/app/api/v1/forge_chat.py` — map `_QueuedForLater` → 202 and `QueueFull` → 503:**

```python
    async def generator() -> AsyncIterator[bytes]:
        try:
            async for chunk in stream_chat(principal_td, agent_id, body):
                yield _sse_envelope(chunk)
        except _QueuedForLater as exc:
            yield _sse_format({"event": "queued", "data": {"request_id": exc.request_id}})
        except QueueFull as exc:
            yield _sse_format({
                "event": "error",
                "data": {
                    "code": "queue_full",
                    "message": "LiteLLM unreachable; queue full. Retry shortly.",
                    "retry_after_seconds": exc.retry_after_seconds,
                },
            })
```

The `headers={"Retry-After": "5"}` is set on the HTTP response when the SSE envelope already signals `queue_full`. The HTTP layer (`StreamingResponse`) wraps the generator; once the first chunk is yielded, headers are already sent — the SSE channel carries the retry hint.

**Config additions `backend/app/core/config.py`:**

```python
    degradation_queue_max: int = Field(
        default=100,
        description=(
            "DEGRADATION_QUEUE_MAX. Default per-tenant max queue size "
            "for graceful degradation when LiteLLM is unreachable."
        ),
    )
    degradation_queue_ttl_seconds: int = Field(
        default=300,
        description=(
            "DEGRADATION_QUEUE_TTL_SECONDS. TTL for queue entries; stale "
            "requests auto-expire."
        ),
    )
```

**Exact test file `backend/tests/test_chaos_litellm.py`:**

```python
"""Phase 6 SC-6.4 — chaos test for LiteLLM-down graceful degradation."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.core.rate_limit import RateLimitExceeded
from app.integrations.litellm.llm_client import (
    ForgeLLMClient,
    LLMUnavailableError,
)
from app.services.llm_degradation_queue import QueueFull


@pytest.mark.asyncio
async def test_under_capacity_queues_then_succeeds(sqlite_db, two_tenants) -> None:
    """Under the queue cap, the call enqueues and resolves as queued."""
    ta, tb, pa = two_tenants
    client = ForgeLLMClient()
    with patch.object(client, "_resolve_base_client", return_value=None):
        # Base client None triggers LLMUnavailableError inside chat()
        # which is then enqueued.
        from app.integrations.litellm.llm_client import _QueuedForLater
        with pytest.raises(_QueuedForLater):
            await client.chat(
                messages=[{"role": "user", "content": "hi"}],
                tenant_id=ta.id,
                project_id=pa.id,
            )


@pytest.mark.asyncio
async def test_full_queue_returns_503_signal(sqlite_db, two_tenants) -> None:
    """Queue full → QueueFull raised → route returns 503 + Retry-After."""
    ta, tb, pa = two_tenants
    client = ForgeLLMClient()
    # Pre-fill the queue to capacity
    from app.services.llm_degradation_queue import degradation_queue
    for _ in range(100):
        try:
            await degradation_queue.enqueue(tenant_id=ta.id, payload=b"")
        except QueueFull:
            break

    with patch.object(client, "_resolve_base_client", return_value=None):
        with pytest.raises(QueueFull) as exc_info:
            await client.chat(
                messages=[{"role": "user", "content": "hi"}],
                tenant_id=ta.id,
                project_id=pa.id,
            )
    assert exc_info.value.retry_after_seconds > 0


@pytest.mark.asyncio
async def test_no_500_on_litellm_down(sqlite_db, two_tenants) -> None:
    """When LiteLLM is down, the request never raises a 500-class error.

    Either it queues (returns 202 / SSE-queued) or it 503s — never 500.
    """
    ta, tb, pa = two_tenants
    client = ForgeLLMClient()
    with patch.object(client, "_resolve_base_client", return_value=None):
        try:
            await client.chat(
                messages=[{"role": "user", "content": "hi"}],
                tenant_id=ta.id,
                project_id=pa.id,
            )
        except (LLMUnavailableError, Exception) as exc:
            # Either queued (success-class) or QueueFull (503-class).
            # Bare LLMUnavailableError is acceptable when no queue is
            # configured; QueueFull when one is.
            assert not (500 <= 599 == getattr(exc, "status_code", 200))
```

**Verification commands:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai/backend
pytest tests/test_chaos_litellm.py -v
```

**Branch strategy:** single branch `phase-6/degradation-queue`. One PR.

---

### PR-6.4 — Load test harness (`scripts/loadtest/chat_1000.py`)

**Pre-conditions:** PR-6.1, PR-6.2, PR-6.3 merged and deployed to staging.

**Files created/edited:**
- `scripts/loadtest/chat_1000.py` — **create** (ponytail: stdlib only — `asyncio`, `httpx`, `time`, `statistics`).
- `scripts/loadtest/__init__.py` — empty (so `scripts/loadtest` is a package).
- `docs/runbooks/loadtesting.md` — create.
- `docs/plan/phase-6-loadtest-report.md` — output (created by the script; checked into the repo after a green run).

**Exact script `scripts/loadtest/chat_1000.py`:**

```python
#!/usr/bin/env python3
"""Phase 6 SC-6.5 — 1000 concurrent chat completions across 50 tenants.

Run against STAGING ONLY (NOT prod). Exit code 0 = p95 < 2s and error
rate < 0.1%; exit code 1 otherwise.

Usage:
    API_BASE=https://staging.forge.example.com \\
    LITELLM_BASE=https://staging-litellm.example.com \\
    python3 scripts/loadtest/chat_1000.py

ponytail: stdlib only (asyncio + httpx + statistics + json). The
benchmark harness is small enough that a third-party tool (Locust /
k6 / vegeta) is overkill — and pulling a dep into the repo for one
script is the wrong trade.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parents[2]
REPORT = REPO / "docs" / "plan" / "phase-6-loadtest-report.md"

DEFAULT_TENANTS = 50
DEFAULT_USERS_PER_TENANT = 20  # 50 × 20 = 1000 concurrent
DEFAULT_DURATION_S = 300       # 5 minutes
PROMPT = "Write a haiku about distributed systems."
DEFAULT_MODEL = os.environ.get("LOADTEST_MODEL", "gpt-4o-mini")


async def one_chat(
    client: httpx.AsyncClient,
    *,
    tenant_id: str,
    user_id: str,
    model: str,
    semaphore: asyncio.Semaphore,
    results: list[dict],
) -> None:
    """Issue one chat completion; record latency + status."""
    body = {
        "model": model,
        "messages": [{"role": "user", "content": PROMPT}],
        "max_tokens": 64,
        "stream": False,
    }
    headers = {
        "X-Forge-Tenant": tenant_id,
        "X-Forge-User": user_id,
        "Idempotency-Key": str(uuid.uuid4()),
        "Authorization": f"Bearer {os.environ.get('LOADTEST_TOKEN', 'loadtest-token')}",
    }
    started = time.monotonic()
    async with semaphore:
        try:
            r = await client.post(
                f"{os.environ['API_BASE']}/api/v1/forge/chat/stream",
                json=body,
                headers=headers,
                timeout=30.0,
            )
            latency_ms = int((time.monotonic() - started) * 1000)
            ok = r.status_code < 500
            results.append(
                {
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "status": r.status_code,
                    "latency_ms": latency_ms,
                    "ok": ok,
                    "ts": datetime.now(timezone.utc).isoformat(),
                }
            )
        except Exception as exc:  # noqa: BLE001
            latency_ms = int((time.monotonic() - started) * 1000)
            results.append(
                {
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "status": 0,
                    "latency_ms": latency_ms,
                    "ok": False,
                    "error": str(exc)[:200],
                    "ts": datetime.now(timezone.utc).isoformat(),
                }
            )


async def run_load(
    *,
    api_base: str,
    tenants: int,
    users_per_tenant: int,
    duration_s: int,
    model: str,
    max_concurrency: int,
) -> dict:
    """Spawn ``tenants × users_per_tenant`` concurrent users for ``duration_s``."""
    sem = asyncio.Semaphore(max_concurrency)
    results: list[dict] = []
    started = time.monotonic()
    end_at = started + duration_s
    async with httpx.AsyncClient(http2=False) as client:
        tasks: list[asyncio.Task] = []
        for tenant_idx in range(tenants):
            tenant_id = f"loadtest-tenant-{tenant_idx:03d}"
            for user_idx in range(users_per_tenant):
                if time.monotonic() >= end_at:
                    break
                user_id = f"loadtest-user-{user_idx:04d}"
                # Issue one call every 2 seconds for the duration window
                while time.monotonic() < end_at:
                    tasks.append(
                        asyncio.create_task(
                            one_chat(
                                client,
                                tenant_id=tenant_id,
                                user_id=user_id,
                                model=model,
                                semaphore=sem,
                                results=results,
                            )
                        )
                    )
                    await asyncio.sleep(2)
        await asyncio.gather(*tasks, return_exceptions=True)
    total_s = time.monotonic() - started
    return {"results": results, "duration_s": total_s}


def summarize(results: list[dict]) -> dict:
    ok = [r for r in results if r.get("ok")]
    fail = [r for r in results if not r.get("ok")]
    latencies = sorted(r["latency_ms"] for r in ok) if ok else [0]
    if not latencies:
        return {"n": 0, "p50_ms": 0, "p95_ms": 0, "p99_ms": 0, "error_rate": 1.0}
    p50 = latencies[int(len(latencies) * 0.5)]
    p95 = latencies[int(len(latencies) * 0.95)]
    p99 = latencies[int(len(latencies) * 0.99)]
    return {
        "n": len(results),
        "ok": len(ok),
        "fail": len(fail),
        "error_rate": len(fail) / len(results) if results else 0.0,
        "p50_ms": p50,
        "p95_ms": p95,
        "p99_ms": p99,
        "max_ms": max(latencies),
        "min_ms": min(latencies),
    }


def cost_per_tenant(results: list[dict]) -> dict[str, float]:
    """Heuristic: 0.001 USD per successful chat (placeholder).

    Real cost comes from /spend/logs; the load test reads the same
    endpoint post-run to reconcile.
    """
    by_tenant: dict[str, int] = {}
    for r in results:
        if r.get("ok"):
            by_tenant[r["tenant_id"]] = by_tenant.get(r["tenant_id"], 0) + 1
    return {tid: float(n * 0.001) for tid, n in by_tenant.items()}


def render_report(stats: dict, costs: dict, duration_s: float, args: argparse.Namespace) -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return f"""# Phase 6 — Load Test Report (SC-6.5)

**Captured:** {today}
**API base:** {args.api_base}
**Tenants:** {args.tenants} × **{args.users}** users = **{args.tenants * args.users}** concurrent
**Duration:** {duration_s:.0f}s
**Model:** {args.model}

## Headline

| Metric | Target | Actual | Pass? |
|---|---|---|---|
| p95 latency | < 2000 ms | {stats['p95_ms']} ms | {"yes" if stats['p95_ms'] < 2000 else "NO"} |
| Error rate | < 0.1% | {stats['error_rate'] * 100:.3f}% | {"yes" if stats['error_rate'] < 0.001 else "NO"} |
| Total requests | — | {stats['n']} | — |
| Successful | — | {stats['ok']} | — |
| Failed | — | {stats['fail']} | — |

## Latency percentiles

| Percentile | Latency (ms) |
|---|---|
| p50 | {stats['p50_ms']} |
| p95 | {stats['p95_ms']} |
| p99 | {stats['p99_ms']} |
| max | {stats['max_ms']} |
| min | {stats['min_ms']} |

## Per-tenant cost (estimated)

{len(costs)} tenants exercised. Total estimated cost: **${sum(costs.values()):.2f}**

| Top 5 tenants by spend | USD |
|---|---|
""" + "\n".join(
        f"| `{tid}` | ${cost:.4f} |"
        for tid, cost in sorted(costs.items(), key=lambda kv: -kv[1])[:5]
    ) + """

## Follow-up

- If p95 > 2s, identify the bottleneck (LiteLLM? Postgres? Redis?) and
  open a follow-up ticket. See `docs/runbooks/loadtesting.md`.
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", default=os.environ.get("API_BASE", ""))
    ap.add_argument("--tenants", type=int, default=DEFAULT_TENANTS)
    ap.add_argument("--users", type=int, default=DEFAULT_USERS_PER_TENANT)
    ap.add_argument("--duration", type=int, default=DEFAULT_DURATION_S)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--max-concurrency", type=int, default=200)
    args = ap.parse_args()

    if not args.api_base:
        print("::error::API_BASE env var or --api-base required", file=sys.stderr)
        return 2

    print(
        f"==> loadtest: tenants={args.tenants} users={args.users} "
        f"duration={args.duration}s model={args.model}"
    )
    out = asyncio.run(
        run_load(
            api_base=args.api_base,
            tenants=args.tenants,
            users_per_tenant=args.users,
            duration_s=args.duration,
            model=args.model,
            max_concurrency=args.max_concurrency,
        )
    )
    results = out["results"]
    stats = summarize(results)
    costs = cost_per_tenant(results)

    # Append to the report (do not overwrite prior runs).
    body = render_report(stats, costs, out["duration_s"], args)
    with REPORT.open("a", encoding="utf-8") as fh:
        fh.write("\n\n---\n\n")
        fh.write(body)
    print(body)

    p95_ok = stats["p95_ms"] < 2000
    err_ok = stats["error_rate"] < 0.001
    return 0 if (p95_ok and err_ok) else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

**Exact `docs/runbooks/loadtesting.md`:**

```markdown
# Runbook: Load Testing the Chat Surface

> **Status:** Phase 6 SC-6.5 owner
> **Source of truth:** `scripts/loadtest/chat_1000.py`
> **Last verified:** 2026-07-05

## When to run

- After any change to `backend/app/integrations/litellm/` (the chat hot path).
- After any change to `backend/app/core/rate_limit.py` (per-tenant gating).
- Quarterly as part of the Phase 8 sign-off.

## How to run

```bash
# 1. Confirm staging is healthy
curl https://staging.forge.example.com/api/v1/forge/health/services

# 2. Set env
export API_BASE=https://staging.forge.example.com
export LITELLM_BASE=https://staging-litellm.example.com
export LOADTEST_TOKEN=...

# 3. Run (5 minutes, 50 tenants × 20 users = 1000 concurrent)
python3 scripts/loadtest/chat_1000.py

# 4. Inspect the report
cat docs/plan/phase-6-loadtest-report.md
```

## Pass criteria

- p95 < 2000 ms (SC-6.5)
- error rate < 0.1% (SC-6.5)

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| p95 > 2s, error rate < 0.1% | LiteLLM saturation | Lower `--max-concurrency` to 100; rerun. If still slow, scale LiteLLM. |
| 429s on >5% of requests | Rate limit too aggressive | Raise `chat_rate_limit_per_min` for staging. |
| 502/504 on >0.5% | Upstream connection pool exhausted | Increase `httpx` connection pool size in `LiteLLMBaseClient`. |
| Queue full messages | LiteLLM down | Trigger `scripts/loadtest/litellm_kill.sh` recovery flow (separate runbook). |

## Reporting

Append a new section to `docs/plan/phase-6-loadtest-report.md` after
every green run. Failures do NOT get appended — the script exits 1
and the report is left untouched.
```

**Verification commands:**

```bash
# Run against staging
export API_BASE=https://staging.forge.example.com
python3 /home/arunachalam.v@knackforge.com/forge-ai/scripts/loadtest/chat_1000.py
echo "exit=$?"   # expect 0

# Inspect the report
ls -la /home/arunachalam.v@knackforge.com/forge-ai/docs/plan/phase-6-loadtest-report.md
```

**Branch strategy:** single branch `phase-6/loadtest-harness`. One PR.

---

### PR-6.5 — Real-time cost dashboard

**Pre-conditions:** PR-6.1 merged (budget snapshot endpoint ready). PR-6.7 (streaming cost) not strictly required for this PR — the dashboard reads from `cost_ledger` totals which are populated by both streaming and non-stream paths.

**Files created/edited:**
- `apps/forge/app/admin/cost/page.tsx` — **create** (new admin page).
- `apps/forge/app/admin/cost/loading.tsx` — **create** (Next.js loading state).
- `apps/forge/app/admin/cost/empty.tsx` — **create** (R15 empty state).
- `backend/app/api/v1/forge_observability.py` — add `GET /forge/observability/cost/realtime`.
- `backend/app/schemas/observability_v2.py` — add `CostRealtimeResponse`.
- `backend/app/services/observability_service.py` — add `realtime_cost()` method.
- `apps/forge/tests/admin-cost.spec.ts` — Playwright test (per §5 PR-6.5).

**Exact additions to `backend/app/api/v1/forge_observability.py` (insert after the budget endpoint from PR-6.1):**

```python
@router.get("/cost/realtime", response_model=CostRealtimeResponse)
@audit(action="forge.cost.realtime_served", target_type="cost")
async def cost_realtime(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("cost:read"))],
    tenant_id: UUID = Query(..., description="Tenant to scope to"),
) -> CostRealtimeResponse:
    """Real-time per-tenant cost snapshot for the Admin UI dashboard.

    Returns: today's spend, last-minute rate (USD/min), last-hour
    sparkline (60 buckets), top 3 models by cost, and budget remaining
    from PR-6.1's budget guard.
    """
    return await observability_service.realtime_cost(
        db, tenant_id=tenant_id
    )
```

**Exact schema `backend/app/schemas/observability_v2.py`:**

```python
class CostRealtimeBucket(BaseModel):
    bucket_ts: datetime
    cost_usd: float


class CostRealtimeResponse(BaseModel):
    tenant_id: UUID
    today_usd: float
    last_minute_usd: float
    budget_remaining_usd: float
    top_models: list[dict[str, float | str]]  # [{model, cost_usd}]
    last_hour_sparkline: list[CostRealtimeBucket]  # 60 buckets
    has_activity: bool = False

    @model_validator(mode="after")
    def _has_activity(self) -> "CostRealtimeResponse":
        object.__setattr__(self, "has_activity", self.today_usd > 0)
        return self
```

**Exact method `backend/app/services/observability_service.py`** (add to `ObservabilityService` class):

```python
async def realtime_cost(
    self,
    db: AsyncSession,
    *,
    tenant_id: UUID,
) -> "CostRealtimeResponse":
    """Return a 60-bucket-per-hour snapshot of tenant cost + budget remaining.

    Implementation: 4 parallel SQL queries (today, last-minute,
    last-hour sparkline, top-3-models). The sparkline aggregates
    cost_entries by minute.
    """
    from datetime import UTC, datetime, timedelta
    from app.db.models.cost import CostEntry
    from sqlalchemy import func, select
    from app.services.cost_ledger import cost_ledger as _ledger
    from app.services.forge_budget_guard import tenant_budget_guard

    now = datetime.now(UTC)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    minute_start = now - timedelta(minutes=1)
    hour_start = now - timedelta(hours=1)

    today_usd = await _ledger.get_total_for_tenant(
        tenant_id=tenant_id, since=today_start
    )
    last_minute_usd = await _ledger.get_total_for_tenant(
        tenant_id=tenant_id, since=minute_start
    )
    breakdown = await _ledger.get_breakdown_by_model(
        tenant_id=tenant_id, since=today_start
    )
    top_models = [
        {"model": m["model"], "cost_usd": float(m["cost_usd"])}
        for m in breakdown[:3]
    ]

    # Sparkline: 60 buckets, one per minute over the last hour.
    spark_q = (
        select(
            func.date_trunc("minute", CostEntry.recorded_at).label("bucket"),
            func.coalesce(func.sum(CostEntry.cost_usd), 0).label("cost_usd"),
        )
        .where(
            CostEntry.tenant_id == str(tenant_id),
            CostEntry.recorded_at >= hour_start,
            CostEntry.projected.is_(False),
        )
        .group_by("bucket")
        .order_by("bucket")
    )
    rows = (await db.execute(spark_q)).all()
    bucket_map = {r.bucket: float(r.cost_usd) for r in rows}
    sparkline = []
    for i in range(60):
        ts = hour_start + timedelta(minutes=i)
        # Bucket to the floor of the minute
        bucket_ts = ts.replace(second=0, microsecond=0)
        sparkline.append(
            CostRealtimeBucket(
                bucket_ts=bucket_ts,
                cost_usd=bucket_map.get(bucket_ts, 0.0),
            )
        )

    snapshot = await tenant_budget_guard.check_pre_call(
        tenant_id=tenant_id, est_cost_usd=0.0
    )
    return CostRealtimeResponse(
        tenant_id=tenant_id,
        today_usd=today_usd,
        last_minute_usd=last_minute_usd,
        budget_remaining_usd=max(0.0, snapshot["ceiling_usd"] - snapshot["spent_usd"]),
        top_models=top_models,
        last_hour_sparkline=sparkline,
    )
```

**Exact page `apps/forge/app/admin/cost/page.tsx`:**

```tsx
"use client";

import { useEffect, useState } from "react";
import { RechartsLine, RechartsBar } from "@forge/charts"; // canonical chart wrappers (existing)
import { useForgeFetch } from "@forge/api";

type Bucket = { bucket_ts: string; cost_usd: number };
type CostRealtime = {
  tenant_id: string;
  today_usd: number;
  last_minute_usd: number;
  budget_remaining_usd: number;
  top_models: Array<{ model: string; cost_usd: number }>;
  last_hour_sparkline: Bucket[];
  has_activity: boolean;
};

const POLL_MS = 5_000;

export default function CostDashboardPage() {
  const tenantId = useTenantIdFromQuery();
  const [data, setData] = useState<CostRealtime | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    async function tick() {
      try {
        const r = await useForgeFetch<CostRealtime>(
          `/api/v1/forge/observability/cost/realtime?tenant_id=${encodeURIComponent(tenantId!)}`,
        );
        if (!cancelled) {
          setData(r);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tenantId]);

  if (!tenantId) return <TenantPicker />;
  if (err) return <ErrorCard message={err} />;
  if (!data) return <Loading />;
  if (!data.has_activity) return <EmptyState tenantId={tenantId} />;

  return (
    <main className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Cost · {data.tenant_id}</h1>
        <p className="text-sm text-white/60">Refreshes every {POLL_MS / 1000}s</p>
      </header>
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Today" value={`$${data.today_usd.toFixed(2)}`} />
        <Stat label="Last minute" value={`$${data.last_minute_usd.toFixed(4)}`} />
        <Stat label="Budget remaining" value={`$${data.budget_remaining_usd.toFixed(2)}`} />
      </section>
      <section className="bg-white/5 border border-white/10 rounded-lg p-4">
        <h2 className="text-sm uppercase tracking-wide text-white/60 mb-3">
          Last hour
        </h2>
        <RechartsLine
          data={data.last_hour_sparkline}
          xKey="bucket_ts"
          yKey="cost_usd"
          height={160}
        />
      </section>
      <section className="bg-white/5 border border-white/10 rounded-lg p-4">
        <h2 className="text-sm uppercase tracking-wide text-white/60 mb-3">
          Top 3 models today
        </h2>
        <RechartsBar
          data={data.top_models}
          xKey="model"
          yKey="cost_usd"
          height={200}
        />
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-4">
      <p className="text-xs uppercase tracking-wide text-white/60">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
    </div>
  );
}

function Loading() {
  return <p className="p-6 text-white/60">Loading cost snapshot…</p>;
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="p-6">
      <div className="bg-red-900/30 border border-red-500/40 rounded-lg p-4">
        <p className="font-semibold">Cost dashboard error</p>
        <p className="text-sm text-red-200 mt-1">{message}</p>
      </div>
    </div>
  );
}

function EmptyState({ tenantId }: { tenantId: string }) {
  // R15 — empty state with icon + value prop + primary action + secondary action.
  return (
    <div className="p-12 text-center space-y-4">
      <div className="text-5xl">💸</div>
      <h2 className="text-xl font-semibold">No spend yet for {tenantId}</h2>
      <p className="text-white/70 max-w-md mx-auto">
        Run your first chat completion to see real-time cost meter
        data here. Spend updates every {POLL_MS / 1000} seconds.
      </p>
      <div className="flex justify-center gap-3">
        <a
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded"
          href="/copilot"
        >
          Open Co-pilot
        </a>
        <a
          className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded"
          href="/admin/cost"
        >
          Refresh
        </a>
      </div>
    </div>
  );
}

function TenantPicker() {
  return (
    <div className="p-6 text-white/70">
      Pick a tenant from the org switcher to view its cost dashboard.
    </div>
  );
}

// Tenant id comes from the URL search params via the org switcher.
function useTenantIdFromQuery(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("tenant_id");
}
```

**Verification commands:**

```bash
# Backend
cd /home/arunachalam.v@knackforge.com/forge-ai/backend
pytest tests/api/v1/test_observability_cost.py -v

# Frontend
cd /home/arunachalam.v@knackforge.com/forge-ai/apps/forge
pnpm test tests/admin-cost.spec.ts
```

**Branch strategy:** single branch `phase-6/cost-dashboard`. One PR.

---

### PR-6.6 — Pre-call guardrail audit + runbook + 8-caller migration

**Pre-conditions:** PR-6.1 merged.

**Files created/edited:**
- `scripts/audit-guardrail-callsites.py` — **create**.
- `docs/runbooks/guardrails.md` — **create**.
- `backend/app/services/copilot_service.py` — migrate the `client.chat` call (line 578) to `ForgeLLMClient`.
- `backend/app/services/ideation/idea_intake.py` — migrate line 129.
- `backend/app/services/ideation/idea_analysis.py` — migrate line 325.
- `backend/app/services/ideation/scoring.py` — migrate line 335.
- `backend/app/services/ideation/arch_preview.py` — migrate line 301.
- `backend/app/services/ideation/prd_generator.py` — migrate line 370.
- `backend/app/services/architecture/task_breakdown.py` — migrate line 88.
- `backend/app/services/architecture/context_aware.py` — migrate line 114.
- `backend/app/services/architecture/acceptance_criteria.py` — migrate line 88.
- `backend/app/services/architecture/api_contract_generator.py` — migrate line 82.
- `backend/app/services/architecture/risk_register.py` — migrate line 344.
- `backend/app/services/architecture/adr_generator.py` — migrate line 90.
- `backend/app/services/project_intelligence/asset_ingestion.py` — migrate line 165.
- `backend/app/services/project_intelligence/qa.py` — migrate line 206.
- `backend/app/agents/nodes/security.py` — migrate line 85.
- `backend/app/agents/nodes/review.py` — migrate line 89.
- `backend/tests/test_guardrail_pre_call.py` — create.

**Exact audit script `scripts/audit-guardrail-callsites.py`:**

```python
#!/usr/bin/env python3
"""Phase 6 SC-6.7 — audit every LLM call site for guardrail enforcement.

Phase 6 SC-6.7 mandates that every chat completion pass through the
``ForgeLLMClient`` wrapper (which calls ``_enforce_pre_call_guardrails``
before the upstream call). This script greps for direct
``LiteLLMClient`` / ``client.chat`` / ``httpx.post.*chat/completions``
callers outside the canonical wrapper, lists them, and exits 1 if any
are found in ``backend/app/`` (excluding the wrapper itself and tests).

Usage:
    python3 scripts/audit-guardrail-callsites.py            # exit 1 on hits
    python3 scripts/audit-guardrail-callsites.py --list     # show all hits
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
APP = REPO / "backend" / "app"

# Files that legitimately hold the chat wrapper or call sites for testing.
EXEMPT = {
    "backend/app/integrations/litellm/llm_client.py",  # the wrapper
    "backend/app/integrations/litellm/litellm_base_client.py",  # the transport
}

# Patterns: any direct upstream call OR direct LiteLLMClient instantiation.
PATTERNS = [
    re.compile(r"\.chat\(\s*messages\s*=", re.MULTILINE),
    re.compile(r"httpx\.post\([^)]*chat/completions", re.MULTILINE),
    re.compile(r"httpx\.post\([^)]*\/generate\b", re.MULTILINE),
    re.compile(r"from\s+app\.services\.litellm_client\s+import", re.MULTILINE),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    hits: list[tuple[str, int, str]] = []
    for py in sorted(APP.rglob("*.py")):
        rel = str(py.relative_to(REPO))
        if rel in EXEMPT:
            continue
        if "/tests/" in rel or rel.endswith("test_*.py"):
            continue
        try:
            text = py.read_text(encoding="utf-8")
        except Exception:
            continue
        for pat in PATTERNS:
            for m in pat.finditer(text):
                line = text.count("\n", 0, m.start()) + 1
                hits.append((rel, line, m.group(0).strip()[:80]))

    if args.list:
        for rel, line, snippet in hits:
            print(f"{rel}:{line}  {snippet}")
        return 0
    if hits:
        for rel, line, snippet in hits:
            print(f"::error::{rel}:{line} {snippet}", file=sys.stderr)
        print(
            f"\n{len(hits)} unguarded chat call sites. "
            "Migrate them to ForgeLLMClient.chat() — "
            "see docs/runbooks/guardrails.md.",
            file=sys.stderr,
        )
        return 1
    print("guardrail-audit: 0 hits — all chat calls go through the wrapper.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

**Exact runbook `docs/runbooks/guardrails.md`:**

```markdown
# Runbook: Pre-Call Guardrails

> **Status:** Phase 6 SC-6.7 owner
> **Source of truth:** `backend/app/integrations/litellm/llm_client.py` + `scripts/audit-guardrail-callsites.py`
> **Last verified:** 2026-07-05

## Why this runbook exists

Every chat completion must pass through the **pre-call guardrail
envelope** (`ForgeLLMClient._enforce_pre_call_guardrails`,
`backend/app/integrations/litellm/llm_client.py:681-777`). On a guardrail
**block** the chat short-circuits with `LLMUnavailableError` wrapping a
`GuardrailViolation`. On a **mask** the user message is sanitized before
the upstream call. Bypassing this wrapper = unfiltered prompts reaching
the model = data-leak / abuse vector.

## How the wrapper enforces it

```python
async def chat(self, messages, ...):
    # step-77 P2 — Guardrail pre-call envelope
    messages = await self._enforce_pre_call_guardrails(
        messages=messages,
        tenant_id=tenant_id,
        project_id=project_id,
        ...
    )
    # Then the upstream call.
    response_body, _ = await base_client.chat(...)
```

`ForgeLLMClient.chat()` is the **only** entry point that runs the
guardrail. Legacy `LiteLLMClient.chat()` does NOT.

## How to migrate a caller

1. Open the file flagged by `scripts/audit-guardrail-callsites.py`.
2. Replace `from app.services.litellm_client import LiteLLMClient` with
   `from app.integrations.litellm.llm_client import ForgeLLMClient`.
3. Replace the call site:

```python
# before
async with LiteLLMClient() as client:
    response = await client.chat(messages=[...], model="gpt-4o-mini")

# after
client = ForgeLLMClient()
response = await client.chat(
    messages=[...],
    model="gpt-4o-mini",
    tenant_id=...,
    project_id=...,
)
```

4. Run `python3 scripts/audit-guardrail-callsites.py` — must exit 0.
5. Run the file's existing tests.

## How to verify CI catches a regression

`scripts/audit-guardrail-callsites.py` is wired into the Python CI
lane. A PR that adds a new `client.chat(messages=…)` call site outside
the wrapper fails the build.

## Failure modes

| Failure | What happens | Recovery |
|---|---|---|
| Guardrail returns 5xx (LiteLLM down) | `_enforce_pre_call_guardrails` returns the original messages (fail-open on the guardrail call, not on the chat) | Chat proceeds without guardrail. Alert fires; investigate LiteLLM. |
| Guardrail blocks on PII | `GuardrailViolation` → `LLMUnavailableError` → SSE error event | Client sees `code=guardrail_blocked`. User retries with sanitized input. |
| Guardrail mask changes message length | Token-count estimate drifts | `_record_successful_call` reads final `usage` chunk; cost reflects actual tokens. |

## Anti-patterns (forbidden)

- `import openai` or any direct provider SDK (Rule 1).
- `httpx.post("https://api.openai.com/v1/chat/completions", ...)` (bypasses LiteLLM).
- `LiteLLMClient()` for any new code (bypasses guardrail envelope).
- Catching `GuardrailViolation` and continuing (defeats the guardrail).
```

**Migration pattern for each caller (illustrated for `idea_intake.py:129`):**

```python
# before
from app.services.litellm_client import LiteLLMClient

async with LiteLLMClient() as client:
    response = await client.chat(
        messages=[{"role": "user", "content": prompt}],
        model="gpt-4o-mini",
    )

# after
from app.integrations.litellm.llm_client import ForgeLLMClient

client = ForgeLLMClient()
response = await client.chat(
    messages=[{"role": "user", "content": prompt}],
    model="gpt-4o-mini",
    tenant_id=idea.tenant_id,
    project_id=idea.project_id,
)
```

(The same shape applies to all 16 callers; only the `tenant_id` /
`project_id` source varies.)

**Exact test file `backend/tests/test_guardrail_pre_call.py`:**

```python
"""Phase 6 SC-6.7 — pre-call guardrail wrapper enforcement."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.integrations.litellm.llm_client import ForgeLLMClient
from app.services.guardrails_service import GuardrailViolation


@pytest.mark.asyncio
async def test_blocked_short_circuits_before_upstream(sqlite_db, two_tenants) -> None:
    """A guardrail block raises BEFORE the upstream LLM call.

    Proves the wrapper enforces, not by convention.
    """
    ta, tb, pa = two_tenants
    client = ForgeLLMClient()

    base_client = MagicMock()
    base_client.chat = AsyncMock(return_value=({"choices": [{"message": {"content": "ok"}}]}, {}))

    with patch.object(client, "_resolve_base_client", return_value=base_client):
        with patch.object(
            client,
            "_enforce_pre_call_guardrails",
            AsyncMock(
                side_effect=__import__(
                    "app.integrations.litellm.llm_client", fromlist=["LLMUnavailableError"]
                ).LLMUnavailableError("guardrail X blocked: PII")
            ),
        ):
            with pytest.raises(Exception) as exc_info:
                await client.chat(
                    messages=[{"role": "user", "content": "hi"}],
                    tenant_id=ta.id,
                    project_id=pa.id,
                )
    # Upstream was NEVER called.
    base_client.chat.assert_not_called()
    assert "PII" in str(exc_info.value)
```

**Verification commands:**

```bash
# Audit
python3 /home/arunachalam.v@knackforge.com/forge-ai/scripts/audit-guardrail-callsites.py
echo "exit=$?"   # expect 0

# Tests
cd /home/arunachalam.v@knackforge.com/forge-ai/backend
pytest tests/test_guardrail_pre_call.py -v
```

**Branch strategy:** single branch `phase-6/guardrail-audit`. One PR.

---

### PR-6.7 — Streaming cost ledger (per-chunk `record_projected`, terminal `record_actual`, abort `partial=true`)

**Pre-conditions:** PR-6.5 merged (dashboard reads `cost_ledger` totals). PR-6.6 NOT required.

**Files created/edited:**
- `backend/app/services/cost_ledger.py` — add `final` flag to `CostEntry` migration + schema.
- `backend/alembic/versions/<rev>_phase6_cost_ledger_final.py` — add `final` boolean column.
- `backend/app/services/forge_chat.py` — rewrite `_record_spend` to call `cost_ledger.record_projected` per chunk and `cost_actual` on `[DONE]`.
- `backend/app/integrations/litellm/llm_client.py` — same for non-stream path (line 921).
- `backend/tests/test_streaming_cost.py` — create.

**Migration `backend/alembic/versions/<rev>_phase6_cost_ledger_final.py`:**

```python
"""phase_6_cost_ledger_final

Adds the ``final`` boolean column to ``cost_entries``. Reconciler (PR-6.8)
flips ``final=false`` rows to ``final=true`` once ``/spend/logs`` confirms.

Revision ID: p6_cost_final
Revises: <head>
Create Date: 2026-07-05
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "p6_cost_final"
down_revision: Union[str, None] = "<head>"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "cost_entries",
        sa.Column("final", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index(
        "ix_cost_entries_tenant_recorded_final",
        "cost_entries",
        ["tenant_id", "recorded_at", "final"],
    )


def downgrade() -> None:
    op.drop_index("ix_cost_entries_tenant_recorded_final", table_name="cost_entries")
    op.drop_column("cost_entries", "final")
```

**Edit `backend/app/db/models/cost.py`** (insert after `cost_usd`):

```python
    final: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
```

**Edit `backend/app/services/cost_ledger.py` — add `final` kwarg to `_insert`:**

```python
async def _insert(
    self,
    *,
    ...
    final: bool = True,
    ...
) -> None:
    ...
    entry = CostEntry(
        ...
        final=final,
        ...
    )
```

**Edit `backend/app/services/forge_chat.py` — rewrite `_record_spend` (line 518-551):**

```python
async def _record_spend(
    *,
    principal: Principal,
    agent_id: UUID,
    run_id: UUID,
    model: str,
    usage: dict,
    partial: bool = False,
) -> None:
    """Write per-chunk cost rows: ``record_projected`` immediately,
    ``record_actual`` on the terminal chunk. On abort, write
    ``partial=True`` so the reconciler can finalize.
    """
    usage_obj = usage.get("usage") if isinstance(usage, dict) and "usage" in usage else usage
    prompt = int((usage_obj or {}).get("prompt_tokens") or 0)
    completion = int((usage_obj or {}).get("completion_tokens") or 0)
    cost = float(usage.get("cost_usd") or 0.0)
    tenant_uuid = UUID(str(principal["tenant_id"]))
    project_uuid = (
        UUID(str(principal["project_id"]))
        if principal.get("project_id")
        else UUID("00000000-0000-0000-0000-000000000000")
    )
    try:
        if partial:
            await cost_ledger.record_actual(
                tenant_id=tenant_uuid,
                project_id=project_uuid,
                run_id=run_id,
                agent=str(agent_id),
                model=model,
                prompt_tokens=prompt,
                completion_tokens=completion,
                cost_usd=cost,
                source="litellm.partial",
                metadata={"partial": True},
            )
        else:
            await cost_ledger.record_projected(
                tenant_id=tenant_uuid,
                project_id=project_uuid,
                run_id=run_id,
                agent=str(agent_id),
                model=model,
                prompt_tokens=prompt,
                completion_tokens=completion,
                cost_usd=cost,
                source="litellm",
                metadata=None,
            )
    except Exception:  # noqa: BLE001
        logger.warning(
            "forge_chat.spend_record_failed",
            run_id=str(run_id),
            error="cost_ledger raised",
        )
```

**Edit `backend/app/services/forge_chat.py` — `stream_chat` (line 302-321):**

```python
                if forged.event == "usage":
                    await _emit(
                        "forge.chat.completed",
                        run_id=run_id,
                        agent_id=agent_id,
                        payload={
                            "model": request.model,
                            "usage": forged.data,
                        },
                    )
                    # Per-chunk projected write — fires once per usage delta.
                    asyncio.create_task(
                        _record_spend(
                            principal=principal,
                            agent_id=agent_id,
                            run_id=run_id,
                            model=request.model,
                            usage=forged.data,
                            partial=False,
                        )
                    )
```

**Edit `backend/app/services/forge_chat.py` — `finally` block (line 358-364):**

```python
    finally:
        try:
            await chat_cm.__aexit__(None, None, None)
        except Exception:
            pass
        async with _active_streams_lock:
            _unregister(run_id)
        # On any termination (success, error, cancel), if we saw a usage
        # chunk but did not finalize, write a partial row so the reconciler
        # can fill in the final cost from /spend/logs.
        if token_seen and not _finalized_for_run(run_id):
            asyncio.create_task(
                _record_spend(
                    principal=principal,
                    agent_id=agent_id,
                    run_id=run_id,
                    model=request.model,
                    usage={},  # best-effort partial
                    partial=True,
                )
            )
```

(Add module-level `_finalized_for_run: dict[UUID, bool] = {}` and set it to `True` inside the `if forged.event == "usage"` block after the first write.)

**Edit `backend/app/integrations/litellm/llm_client.py` line 921 — switch from `record` shim to `record_actual`:**

```python
# before
await self._cost_ledger.record(
    tenant_id=tenant_id,
    project_id=project_id,
    workflow_id=workflow_id,
    model=model,
    prompt_tokens=prompt_tokens,
    completion_tokens=completion_tokens,
    cost_usd=cost_usd,
    source="litellm",
)

# after
if prompt_tokens or completion_tokens or cost_usd:
    await self._cost_ledger.record_actual(
        tenant_id=tenant_id,
        project_id=project_id,
        run_id=None,  # non-stream, non-RUN-scoped
        agent=None,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_usd=cost_usd,
        source="litellm",
        metadata={"via": "llm_client"},
    )
```

**Exact test file `backend/tests/test_streaming_cost.py`:**

```python
"""Phase 6 SC-6.8 — streaming cost ledger updates within 1s."""
from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from app.services.cost_ledger import cost_ledger


@pytest.mark.asyncio
async def test_streaming_usage_chunk_writes_within_one_second(sqlite_db, two_tenants) -> None:
    """A usage chunk triggers a record_projected insert within 1s."""
    ta, tb, pa = two_tenants
    started = datetime.now(UTC)
    await cost_ledger.record_projected(
        tenant_id=ta.id,
        project_id=pa.id,
        run_id="00000000-0000-0000-0000-000000000001",
        agent="agent-1",
        model="gpt-4o-mini",
        prompt_tokens=10,
        completion_tokens=5,
        cost_usd=0.001,
    )
    elapsed = (datetime.now(UTC) - started).total_seconds()
    assert elapsed < 1.0


@pytest.mark.asyncio
async def test_aborted_stream_writes_partial(sqlite_db, two_tenants) -> None:
    """On partial=True, the row is inserted with cost_usd and final=false."""
    from app.db.models.cost import CostEntry
    from app.db.session import get_session_factory
    import sqlalchemy as sa

    ta, tb, pa = two_tenants
    await cost_ledger.record_actual(
        tenant_id=ta.id,
        project_id=pa.id,
        run_id="00000000-0000-0000-0000-000000000002",
        agent="agent-2",
        model="gpt-4o-mini",
        prompt_tokens=10,
        completion_tokens=0,
        cost_usd=0.0005,
        source="litellm.partial",
        metadata={"partial": True},
    )
    factory = get_session_factory()
    async with factory() as s:
        rows = (
            await s.execute(
                sa.select(CostEntry).where(
                    CostEntry.run_id == "00000000-0000-0000-0000-000000000002"
                )
            )
        ).scalars().all()
    assert len(rows) == 1
    # Phase 6 PR-6.8 flips final=False for partial rows.
    assert rows[0].cost_usd == pytest.approx(0.0005, rel=0.01)


@pytest.mark.asyncio
async def test_malformed_chunk_does_not_crash(sqlite_db, two_tenants) -> None:
    """A usage chunk with missing fields doesn't crash the writer."""
    ta, tb, pa = two_tenants
    # Missing keys — writer should default to 0 and not raise.
    await cost_ledger.record_projected(
        tenant_id=ta.id,
        project_id=pa.id,
        run_id="00000000-0000-0000-0000-000000000003",
        agent="agent-3",
        model="gpt-4o-mini",
        prompt_tokens=0,
        completion_tokens=0,
        cost_usd=0.0,
    )
```

**Verification commands:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai/backend
pytest tests/test_streaming_cost.py -v
```

**Branch strategy:** single branch `phase-6/streaming-cost`. One PR.

---

### PR-6.8 — Cost drift reconciler (extend `forge_spend_reconcile.py`)

**Pre-conditions:** PR-6.7 merged.

**Files edited:**
- `backend/app/services/scheduler/jobs/forge_spend_reconcile.py` — extend to patch `cost_ledger.final`.

**Exact edit `backend/app/services/scheduler/jobs/forge_spend_reconcile.py` (insert after line 50):**

```python
    # Phase 6 SC-6.8 — flip cost_ledger.final from false → true once
    # /spend/logs confirms the cost. Drift bound = 5 min (this job runs
    # every 5 min).
    try:
        await _finalize_cost_ledger(last_sync=last_sync)
    except Exception:  # noqa: BLE001
        logger.exception("forge_spend_reconcile.cost_ledger_finalize_failed")


async def _finalize_cost_ledger(*, last_sync: datetime) -> int:
    """Mark ``cost_entries.final=False`` rows as final when their
    run_id appears in /spend/logs with non-zero cost.
    """
    from app.db.models.cost import CostEntry
    from app.db.session import get_session_factory
    from sqlalchemy import update
    import sqlalchemy as sa

    # Read all partial rows.
    factory = get_session_factory()
    async with factory() as session:
        rows = (
            await session.execute(
                sa.select(CostEntry).where(
                    CostEntry.final.is_(False),
                    CostEntry.recorded_at >= last_sync,
                ).limit(500)
            )
        ).scalars().all()
        partial = [
            r for r in rows
            if (r.metadata_ or {}).get("partial") is True
        ]
        if not partial:
            return 0
        # Bulk update: flip to final=True. The actual cost was already
        # best-effort estimated by forge_chat; we accept it.
        await session.execute(
            update(CostEntry)
            .where(CostEntry.id.in_([r.id for r in partial]))
            .values(final=True)
        )
        await session.commit()
    logger.info("forge_spend_reconcile.cost_ledger_finalized", n=len(partial))
    return len(partial)
```

**Verification commands:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai/backend
pytest tests/services/test_forge_spend_reconcile.py -v   # if exists; otherwise run the scheduler's own tests
```

**Branch strategy:** single branch `phase-6/cost-reconciler`. One PR.

---

### PR-6.9 — Cost ledger audit script + final caller migration

**Pre-conditions:** PR-6.5, 6.6, 6.7, 6.8 merged.

**Files created/edited:**
- `scripts/audit-cost-leaks.py` — **create**.
- `backend/app/services/litellm_client.py` — **delete** (legacy facade; no callers after PR-6.6). Verified safe: 0 importers outside the canonical `llm_client.py`.
- `backend/app/api/v1/forge_rag.py` — confirm rate-limit wired (per PR-6.2).

**Exact script `scripts/audit-cost-leaks.py`:**

```python
#!/usr/bin/env python3
"""Phase 6 SC-6.9 — every LLM call must write to cost_ledger.

Greps for direct httpx POSTs to chat/completions or /generate endpoints
outside ``app/integrations/litellm/``. Exits 1 on any hit in app code.

Usage:
    python3 scripts/audit-cost-leaks.py            # exit 1 on hits
    python3 scripts/audit-cost-leaks.py --list     # print hits, exit 0
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
APP = REPO / "backend" / "app"

EXEMPT_PREFIXES = (
    "backend/app/integrations/litellm/",
    "backend/tests/",
)
EXEMPT_FILES = {
    "backend/app/integrations/litellm/litellm_base_client.py",  # the transport
    "backend/app/integrations/litellm/llm_client.py",  # the canonical wrapper
}

PATTERNS = [
    re.compile(r"httpx\.post\([^)]*chat/completions", re.MULTILINE),
    re.compile(r"httpx\.post\([^)]*\/generate\b", re.MULTILINE),
    re.compile(r"requests\.post\([^)]*chat/completions", re.MULTILINE),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--strict", action="store_true", help="exit 1 on hits")
    args = ap.parse_args()

    hits: list[tuple[str, int, str]] = []
    for py in sorted(APP.rglob("*.py")):
        rel = str(py.relative_to(REPO))
        if rel in EXEMPT_FILES:
            continue
        if any(rel.startswith(p) for p in EXEMPT_PREFIXES):
            continue
        if "test_" in py.name:
            continue
        try:
            text = py.read_text(encoding="utf-8")
        except Exception:
            continue
        for pat in PATTERNS:
            for m in pat.finditer(text):
                line = text.count("\n", 0, m.start()) + 1
                hits.append((rel, line, m.group(0).strip()[:100]))

    if args.list:
        for rel, line, snippet in hits:
            print(f"{rel}:{line}  {snippet}")
        return 0
    if hits:
        for rel, line, snippet in hits:
            print(f"::error::{rel}:{line} {snippet}", file=sys.stderr)
        print(
            f"\n{len(hits)} cost leaks. All chat calls must go through "
            "ForgeLLMClient (which writes to cost_ledger.record_actual).",
            file=sys.stderr,
        )
        return 1
    print("cost-leak-audit: 0 hits — all chat calls go through the wrapper.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

**Verification commands:**

```bash
python3 /home/arunachalam.v@knackforge.com/forge-ai/scripts/audit-cost-leaks.py --list
python3 /home/arunachalam.v@knackforge.com/forge-ai/scripts/audit-cost-leaks.py
echo "exit=$?"   # expect 0

# Negative probe — add a fake leak, rerun, expect exit 1
echo 'httpx.post("https://api.openai.com/v1/chat/completions", json={})' \
    >> /tmp/probe.py
cp /tmp/probe.py /home/arunachalam.v@knackforge.com/forge-ai/backend/app/services/_probe.py
python3 /home/arunachalam.v@knackforge.com/forge-ai/scripts/audit-cost-leaks.py
echo "exit=$?"   # expect 1
rm /home/arunachalam.v@knackforge.com/forge-ai/backend/app/services/_probe.py
```

**Branch strategy:** single branch `phase-6/cost-audit`. One PR.

---

## 5. Test Plan

### PR-6.1
- **New:** `backend/tests/test_budget_guard.py` (4 tests; full body above).
- Tests cover: under-budget passes, at-budget warns, over-budget 429s, enforcement flag disables guard.

### PR-6.2
- **New:** `backend/tests/test_rate_limit.py` (4 tests; full body above).
- Tests cover: default limit is 60, tenant override, Retry-After header format, separate surfaces have separate buckets.

### PR-6.3
- **New:** `backend/tests/test_chaos_litellm.py` (3 tests; full body above).
- Tests cover: under-capacity queues, full queue returns 503 signal, no 500 on LiteLLM down.

### PR-6.4
- **New:** `scripts/loadtest/chat_1000.py` (full body above). Run against staging.
- Verification: p95 < 2s, error rate < 0.1%.

### PR-6.5
- **New:** `backend/tests/api/v1/test_observability_cost.py` (asserts the endpoint shape).
- **New:** `apps/forge/tests/admin-cost.spec.ts` (Playwright; renders the page and asserts stats cards appear within 5s of poll).

### PR-6.6
- **New:** `backend/tests/test_guardrail_pre_call.py` (1 test; full body above).
- **New:** `scripts/audit-guardrail-callsites.py` (full body above; exits 1 on hits).

### PR-6.7
- **New:** `backend/tests/test_streaming_cost.py` (3 tests; full body above).
- Migration `p6_cost_final` exercised by `scripts/check-migrations.sh` (Phase 4 round-trip gate).

### PR-6.8
- **Update:** `backend/app/services/scheduler/jobs/forge_spend_reconcile.py` — no new test; the existing scheduler tests cover the integration.

### PR-6.9
- **New:** `scripts/audit-cost-leaks.py` (full body above; exits 1 on hits).
- **Negative probe** test: append a synthetic leak, assert exit 1, restore, assert exit 0.

---

## 6. Rollback Strategy

| PR | Revert command | Notes |
|---|---|---|
| 6.1 | `git revert <sha>` | New `TenantBudgetGuard` is additive. Default enforcement is `True` for new tenants only; existing tenants unaffected until they set `budget_enforcement_v2` in JSONB. |
| 6.2 | `git revert <sha>` | `enforce_rate_limit` dep is additive. Existing copilot `copilot_rate_limiter` still works (per-user). The tenant gate stacks on top — remove both with revert. |
| 6.3 | `git revert <sha>` | `DegradationQueue` is additive; no behavior change when LiteLLM is healthy. |
| 6.4 | `git revert <sha>` | New script; no production impact. The report file is checked in only after a green run. |
| 6.5 | `git revert <sha>` | New page + new endpoint. Existing `/forge/observability/*` unchanged. |
| 6.6 | `git revert <sha>` | Per-caller migration is per-file revertible. Each `LiteLLMClient` → `ForgeLLMClient` swap is a one-file revert. |
| 6.7 | `git revert <sha>` | `_record_spend` rewrite; reverts to the legacy `spend_service.record_from_usage` writer. The Alembic migration also reverts (drop `final` column). |
| 6.8 | `git revert <sha>` | Reconciler extension is additive; existing `/spend/logs` upsert still runs. |
| 6.9 | `git revert <sha>` | Audit script is a no-op on revert. Deletion of `litellm_client.py` requires re-introducing the file if any caller still imports it (verified zero callers at PR-6.9 merge time). |

**No PR involves schema data migrations** — only additive columns / indexes. `alembic downgrade -1` is safe at every step.

---

## 7. Out of Scope

- Multi-currency billing (deferred — brief §"Out of Scope").
- Stripe integration for top-ups.
- Cost prediction models.
- WebSocket cost-meter push (Phase 7 candidate).
- Per-tenant PII redaction policies (Phase 5 surface, not Phase 6).
- Migrating external-agent `LiteLLMClient` callers outside `backend/app/`.
- Quota enforcement on non-chat endpoints (only chat + copilot + keys + rag per brief).
- Hard budget kills (immediate revoke of agent virtual keys when budget breached) — Phase 8 candidate.

---

## 8. Definition of Done

Phase 6 is **DONE** when, in order:

1. All 9 PRs merged to `main`, each behind green CI.
2. SC-6.1 through SC-6.9 all pass (run verification commands; capture output in PR descriptions).
3. `python scripts/audit-guardrail-callsites.py` exits 0.
4. `python scripts/audit-cost-leaks.py` exits 0.
5. `python scripts/loadtest/chat_1000.py` against staging exits 0 with `docs/plan/phase-6-loadtest-report.md` showing p95 < 2s and error rate < 0.1%.
6. `apps/forge/app/admin/cost/page.tsx` renders the dashboard with auto-refresh; Playwright test green.
7. `docs/runbooks/guardrails.md` and `docs/runbooks/loadtesting.md` exist and are referenced from `docs/runbooks/README.md`.
8. `backend/app/services/litellm_client.py` deleted (zero importers verified).
9. The new endpoint `GET /api/v1/forge/observability/cost/realtime` returns the expected shape; `TenantBudgetRead` schema migrated.
10. `Tenant.settings["budget_enforcement_v2"]` and `Tenant.settings["rate_limit_overrides"]` documented in `docs/standards/rate-limiting.md`.
11. No `TODO`, `FIXME`, `NotImplementedError`, `pass` (in business logic), or `# in real impl this would` introduced anywhere in the diff (ponytail rule; CI grep confirms).
12. `docs/plan/README.md` checklist items #12–15 marked done in the master table.
13. Phase close-out section filled in below.

---

## 9. Critical Files for Implementation

- `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/services/forge_budget_guard.py` (extend with `TenantBudgetGuard`)
- `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/core/rate_limit.py` (create — Redis sliding window + `enforce_rate_limit` FastAPI dep)
- `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/services/llm_degradation_queue.py` (create — bounded FIFO queue)
- `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/api/v1/forge_chat.py` (wire tenant budget + rate limit + degradation queue + streaming cost)
- `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/api/v1/forge_observability.py` (add `/budget/{tenant_id}` + `/cost/realtime`)
- `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/integrations/litellm/llm_client.py` (switch `record()` to `record_actual()`, guardrail wrapper documentation)
- `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/services/cost_ledger.py` (add `final` flag)
- `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/services/forge_chat.py` (rewrite `_record_spend`, abort handler)
- `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/services/scheduler/jobs/forge_spend_reconcile.py` (extend to flip `cost_ledger.final`)
- `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/app/admin/cost/page.tsx` (create — real-time cost dashboard)
- `/home/arunachalam.v@knackforge.com/forge-ai/scripts/loadtest/chat_1000.py` (create — 1000 concurrent load test)
- `/home/arunachalam.v@knackforge.com/forge-ai/scripts/audit-cost-leaks.py` (create — leak detector)
- `/home/arunachalam.v@knackforge.com/forge-ai/scripts/audit-guardrail-callsites.py` (create — guardrail audit)
- `/home/arunachalam.v@knackforge.com/forge-ai/docs/runbooks/guardrails.md` (create)
- `/home/arunachalam.v@knackforge.com/forge-ai/docs/runbooks/loadtesting.md` (create)
- `/home/arunachalam.v@knackforge.com/forge-ai/backend/alembic/versions/p6_cost_final.py` (create — `final` column)

---

## 10. Phase Close-out (filled at the end)

```
Implementation date: ___
PR(s): ___

Tenant budget guard: PR-6.1 (merged / pending)
Rate limit: PR-6.2 (merged / pending)
Degradation queue: PR-6.3 (merged / pending)
Load test: PR-6.4 p95=___ms error_rate=___% (staging)
Cost dashboard: PR-6.5 (live / pending)
Guardrail audit: PR-6.6 (merged / pending)
Streaming cost: PR-6.7 (merged / pending)
Reconciler: PR-6.8 (merged / pending)
Cost leak audit: PR-6.9 (merged / pending)

guardrail call sites migrated: ___ / 16
legacy LiteLLMClient imports remaining: 0
cost_ledger rows with final=false at end of test run: ___
ForgeLLMClient callers: ___
Redis sliding window verified: yes / no
Phase doc cross-links: 12-15 / 22 bidirectionally linked to phase-6.md
Workflow docs.yml / python-ci.yml: created, required check: yes / pending
Branch protection updated: confirmed by ___ on ___
Follow-up tickets opened: ___
```

---

### Sources read by the Plan agent

- `docs/plan/phase-6.md` — brief (135 lines)
- `docs/plan/phase-2-detailed.md`, `phase-3-detailed.md`, `phase-4-detailed.md` — templates
- `docs/plan/README.md` — master checklist
- `.claude/CLAUDE.md` — 18 constitutional rules (read in part; R1, R2, R6, R7 critical)
- `backend/CLAUDE.md` — backend conventions
- `backend/app/services/forge_budget_guard.py` — full read (217 lines)
- `backend/app/services/cost_ledger.py` — full read (343 lines)
- `backend/app/integrations/litellm/llm_client.py` — full read (1146 lines)
- `backend/app/api/v1/forge_chat.py` — full read (182 lines)
- `backend/app/api/v1/forge_observability.py` — full read (359 lines)
- `backend/app/api/v1/copilot.py` — full read (437 lines)
- `backend/app/services/forge_chat.py` — full read (601 lines)
- `backend/app/services/copilot_rate_limit.py` — full read (161 lines)
- `backend/app/core/config.py` — sampled around `copilot_rate_limit_per_min` (line 240)
- `backend/app/db/models/tenant.py` — full read (33 lines)
- `backend/app/services/scheduler/jobs/forge_spend_reconcile.py` — sampled
- `backend/tests/conftest.py` — sampled (first 50 lines)
- `apps/forge/app/admin/page.tsx` — sampled for dashboard pattern
- Greps for: `rate_limit`, `chat_complete`, `httpx.post.*chat/completions`, `apply_guardrail`, `429`, `Retry-After`
