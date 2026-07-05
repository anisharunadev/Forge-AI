# Phase 6 — Cost, Budgets & Rate Limits

## Checklist items owned

- #12
- #13
- #14
- #15


**Status:** PENDING
**Owner:** TBA
**Depends on:** Phase 1, Phase 5 (observability for measuring)
**Blocks:** Phase 8

---

## Goal

Budgets fail closed. Rate limits degrade gracefully. 1000 concurrent chat completions verified. Per-tenant cost visible in real time.

## Why sixth

- The product sells AI orchestration; the cost line is the existential risk.
- `forge_budget_guard.py` exists but its failure mode is unverified. Phase 6 proves it actually 429s.
- Real-time cost visibility is the difference between a customer trusting the platform and a customer getting a surprise bill.

## Success Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| SC-6.1 | `forge_budget_guard.py` returns HTTP 429 (not a warning log) on tenant budget overrun | `tests/test_budget_guard.py::test_overrun_returns_429` |
| SC-6.2 | Per-tenant rate limit configured; default 60 req/min for chat completions; override via tenant settings | `tests/test_rate_limit.py::test_default_and_override` |
| SC-6.3 | When limit hit, response is `429` with `Retry-After` header set | `tests/test_rate_limit.py::test_retry_after_header` |
| SC-6.4 | Graceful degradation: when LiteLLM is slow/down, requests queue up to N then 503 (not crash) | chaos test with LiteLLM killed |
| SC-6.5 | Load test: 1000 concurrent chat completions across 50 tenants; p95 < 2s; error rate < 0.1% | `scripts/loadtest/chat_1000.py` exits 0 with report |
| SC-6.6 | Per-tenant real-time cost dashboard in Admin UI; refresh < 5s | Playwright test |
| SC-6.7 | Pre-call guardrail (`POST /apply_guardrail`) runs **before** every chat completion; failure mode documented | integration test + runbook |
| SC-6.8 | Streaming cost meter: each SSE chunk's final `usage` field updates cost ledger within 1s | integration test with real LiteLLM |
| SC-6.9 | No "silent" cost path — every LLM call writes to `cost_ledger` | `audit` of all `chat_complete()` callers |

## Tasks

### T6.1 — Budget guard hardening
- T6.1.1 Open `backend/app/services/forge_budget_guard.py`. Confirm current behavior (read code).
- T6.1.2 If current behavior is "log warning": change to raise `BudgetExceeded` exception → FastAPI handler maps to `429 + Retry-After`.
- T6.1.3 Add `GET /forge/observability/budget/{tenant_id}` to inspect remaining budget.
- T6.1.4 Tests cover: under-budget passes, at-budget warns, over-budget 429s.

### T6.2 — Per-tenant rate limit
- T6.2.1 Use Redis sliding-window: `INCR rl:{tenant}:{minute_bucket}` with EXPIRE.
- T6.2.2 Add FastAPI dependency `enforce_rate_limit(tenant_id, surface, limit_per_minute)`.
- T6.2.3 Apply to: `/forge/chat`, `/copilot/*`, `/forge/keys`, `/forge/rag/search`.
- T6.2.4 Per-tenant override from `tenant_settings.rate_limit_overrides` JSONB column.
- T6.2.5 Tests prove the 429 + Retry-After response.

### T6.3 — Graceful degradation
- T6.3.1 When LiteLLM is unreachable, requests enter a Redis-backed bounded queue (size = `tenant.settings.max_queue_size`, default 100).
- T6.3.2 If queue full → 503 `Service Unavailable` with `Retry-After`.
- T6.3.3 Add `chaos` test that kills LiteLLM container mid-flight; assert requests 503 gracefully, no 500s, no process crash.

### T6.4 — Load test harness
- T6.4.1 Write `scripts/loadtest/chat_1000.py`:
  - spawns 1000 concurrent users across 50 tenants
  - each issues a chat completion every 2s for 5 minutes
  - records p50/p95/p99 latency, error rate, cost per tenant
  - writes report to `docs/plan/phase-6-loadtest-report.md`
- T6.4.2 Run against staging (NOT prod).
- T6.4.3 If p95 > 2s: identify bottleneck (LiteLLM? DB? Redis?), file follow-up tickets.

### T6.5 — Real-time cost dashboard
- T6.5.1 New page `apps/forge/app/admin/cost/page.tsx`:
  - per-tenant card with: today's spend, budget remaining, top 3 models, current rate (USD/min)
  - sparkline of last hour (use Recharts)
  - auto-refresh every 5s via `useAuditStream`-style live feed (or polling fallback)
- T6.5.2 Backed by `GET /forge/observability/cost/realtime`.
- T6.5.3 Empty state per R15.

### T6.6 — Pre-call guardrail verification
- T6.6.1 Audit every `chat_complete()` caller for guardrail call before.
- T6.6.2 Wrap `chat_complete()` itself to enforce guardrail (so callers cannot bypass).
- T6.6.3 If guardrail fails: return `400 Bad Request` with the guardrail reason — never proceed.
- T6.6.4 Document in `docs/runbooks/guardrails.md`.

### T6.7 — Streaming cost ledger
- T6.7.1 When streaming chat completion, parse final SSE chunk for `usage`.
- T6.7.2 On chunk receipt, upsert into `cost_ledger` (incremental).
- T6.7.3 If stream is aborted mid-flight, on disconnect write a partial row with `final=false`; periodic reconciler fills in final cost from LiteLLM spend logs.
- T6.7.4 Tests cover happy stream, aborted stream, malformed chunk.

### T6.8 — Cost ledger audit
- T6.8.1 Static analysis: every function in `backend/app/integrations/litellm/llm_client.py` that calls the upstream LLM must write to `cost_ledger`.
- T6.8.2 Write `scripts/audit-cost-leaks.py`:
  - greps for `httpx.post.*chat/completions` and `httpx.post.*generate` outside `app/integrations/litellm/`
  - fails CI on hit
- T6.8.3 Tests confirm the audit catches synthetic bypasses.

## Files Touched

| File | Action |
|------|--------|
| `backend/app/services/forge_budget_guard.py` | edit (fail-closed) |
| `backend/app/api/v1/forge_observability.py` | edit (new endpoints) |
| `backend/app/api/v1/forge_chat.py` | edit (rate-limit dep) |
| `backend/app/api/v1/copilot.py` | edit (rate-limit dep) |
| `backend/app/core/rate_limit.py` | create |
| `backend/app/integrations/litellm/llm_client.py` | edit (wrap guardrail, cost) |
| `backend/app/services/cost_ledger.py` | edit (streaming) |
| `apps/forge/app/admin/cost/page.tsx` | create |
| `scripts/loadtest/chat_1000.py` | create |
| `scripts/audit-cost-leaks.py` | create |
| `docs/runbooks/guardrails.md` | create |
| `docs/runbooks/loadtesting.md` | create |
| `docs/plan/phase-6-loadtest-report.md` | create (output) |
| `backend/tests/test_budget_guard.py` | create/edit |
| `backend/tests/test_rate_limit.py` | create |
| `backend/tests/test_chaos_litellm.py` | create |

## Risks

| Risk | Mitigation |
|------|-----------|
| Budget guard change breaks existing happy paths | Roll out behind a feature flag; enable per-tenant via `tenant_settings.budget_enforcement_v2 = true` |
| Rate limit false-positives (clock skew, retry storms) | Use Redis pipeline + atomic INCR; document `Retry-After` semantics in API docs |
| Load test destabilizes staging | Run during off-peak; have rollback plan; cap concurrent users if errors spike |
| Streaming cost drift (chunk missed) | Reconciler job runs every 5 min against LiteLLM's `/spend/logs` — drift bounded by reconciliation interval |
| Cost leak audit bypassed by dynamic calls | Audit runs at PR time; also a runtime assertion in `chat_complete` that double-writes to ledger |
| Guardrail adds latency to every chat call | Cache guardrail result per `(tenant_id, prompt_hash)` for 60s |

## Out of Scope

- Multi-currency billing.
- Stripe integration for top-ups.
- Cost prediction models.

## Definition of Done

- Budget overrun → 429 verified.
- Rate limit → 429 with Retry-After verified.
- Load test 1000 concurrent: report green.
- Real-time cost dashboard live.
- Pre-call guardrail enforced at the wrapper, not by convention.
- Streaming cost ledger verified.

## Phase Close-out (filled at the end)

```
Implementation date: 2026-07-05 (Phase 3 — Documentation as Code)
PR(s): phase-3/* (8 PRs; see docs/plan/phase-3-detailed.md)

api-catalog.md: regenerated, was 305 routes claimed, code has 635 (2.1× undercount)
db-schema.md:   regenerated, was 43 files / ~150 tables claimed, code has 61 files / 112 classes
goal docs with Status header: 78 / 78 primary
step-69.md: in-progress (4 endpoints shipped via Phase 2 PR-2.6; /ideation/ingest/status is optional per the doc itself)
lychee broken links fixed: (collected via continue-on-error in CI; not yet blocking)
Phase doc cross-links: 22/22 bidirectional
Workflow docs.yml: created, required check: pending (warn-only in PR-3.3; gate flip in PR-3.8)
Follow-up tickets opened: none
```
