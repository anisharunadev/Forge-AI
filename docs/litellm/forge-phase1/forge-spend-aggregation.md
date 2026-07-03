# Forge Spend Aggregation — Phase 1 (Step 75, Feature 5)

> **Phase:** 1 of 4 — Foundation
> **Spec:** `docs/goals/step-75.md` lines 297–365 (Feature 5)
> **Status:** P3 shipped — write-path, reconciliation, rollups, pre-call guard all live.
> **Source-of-truth files:**
> - Schema: `backend/app/schemas/forge_spend.py`
> - Service: `backend/app/services/forge_spend.py`
> - Router: `backend/app/api/v1/forge_spend.py`
> - Migration: `backend/alembic/versions/step_75_p3_spend_records_001.py`
> - Pre-call guard: `backend/app/services/forge_budget_guard.py`
> - Cron entry point: `backend/app/services/scheduler/jobs/forge_spend_reconcile.py`

Forge records per-call spend the moment a chat completion ends (live cost meter) **and** reconciles against LiteLLM's authoritative `/spend/logs` every five minutes so the numbers in the dashboard never drift past 1%. The schema, idempotency contract, and audit trail are fixed by Rule 4 (typed artifacts) and Rule 6 (every agent action audit-logged).

---

## 1. Goal

| Real-time write path (P3 ships) | Reconciliation path (P3 ships) | Pre-call guard (P3 ships, P5 caller) |
|---|---|---|
| Every chat completion inserts one row in `spend_records` on SSE `usage` chunk. | `*/5 * * * *` cron pulls `/spend/logs?start_date=<last_sync>`, upserts, emits `forge.spend.reconciled`. | `BudgetGuard.check_pre_call(agent_id, est_cost_usd)` runs before P5 opens the SSE stream. |

The three paths share one invariant: **no double-counting**. `litellm_request_id` is the unique key on the `spend_records` table (`alembic/versions/step_75_p3_spend_records_001.py` lines 81–83), so the write-path INSERT-then-SELECT and the reconciliation upsert cannot both succeed for the same row.

---

## 2. API contract (5 endpoints)

All five endpoints live in `backend/app/api/v1/forge_spend.py`. Auth: `require_tenant` for caller-scoped reads, `require_admin` (owner/admin role on the JWT) for cross-tenant + backfill. Request and response shapes come from `backend/app/schemas/forge_spend.py` and are never free-form dicts (Rule 4).

### 2.1 `GET /api/forge/spend/summary`

Tenant-scoped dashboard rollup. Filters by `tenant_id` from the JWT and (optionally) `project_id`. Accepts `since` as a shorthand alias (`7d` / `24h` / `30d`) or an ISO-8601 timestamp.

```text
Query:
  since:      str = "7d"          # "7d" | "24h" | "30d" | ISO-8601
  project_id: UUID | None = None
Response (SpendSummary):
  period_start:    datetime
  period_end:      datetime
  total_cost_usd:  float
  total_requests:  int
  total_tokens:    int
  by_model:        list[SpendByModel]   # {model, cost_usd, requests, prompt_tokens, completion_tokens}
```

Behaviour: `SpendService.summary()` at `forge_spend.py:434`. Tenant filter enforced at the service layer.

### 2.2 `GET /api/forge/spend/agents/{agent_id}`

Per-agent totals. Returns **404** (`no_spend_for_agent`) when there are no rows in the window.

```text
Path:   agent_id: UUID
Query:  since:    str = "7d"
Response (SpendByAgent):
  agent_id:   UUID
  agent_name: str | None
  cost_usd:   float
  requests:   int
```

### 2.3 `GET /api/forge/spend/tenants/{tenant_id}`

Cross-tenant read for billing/ops. Admin-only.

```text
Path:   tenant_id: UUID
Query:  since:    str = "7d"
Response (SpendByTenant):
  tenant_id: UUID
  cost_usd:  float
  requests:  int
```

### 2.4 `GET /api/forge/spend/cost-meter/{run_id}`

Live cost-meter entry for an in-flight or just-finished run. Tenant-scoped. Returns **404** (`no_cost_meter_for_run`) when no spend row exists for that `run_id`.

```text
Path:  run_id: UUID
Response (CostMeterEntry):
  run_id:    UUID
  agent_id:  UUID
  cost_usd:  float
  tokens:    int
  model:     str
  timestamp: datetime
```

P5 (chat completion SSE) calls this on the final `usage` chunk of every stream so the UI cost meter updates within 5 seconds (AC1). The `record_from_usage()` path at `forge_spend.py:223` writes the row; P5 reads it back through this endpoint.

### 2.5 `POST /api/forge/spend/backfill`

Admin-only. Re-runs reconciliation over an explicit window. **Idempotent** — safe to re-run for the same window; the `litellm_request_id` UNIQUE constraint guarantees the same row count.

```text
Body (BackfillRequest):
  since:    datetime          # ISO-8601 lower bound
  dry_run:  bool = false
Response (BackfillResponse):
  rows_upserted: int
  rows_inserted: int
  drift_count:   int
  dry_run:       bool
```

`dry_run: true` runs the reconciliation loop but never updates `cost_usd` — it only counts what *would* change. Useful for spot-checking a noisy tenant without touching numbers.

---

## 3. Idempotency

### 3.1 The unique key

`litellm_request_id` is the LiteLLM response `id` for the chat completion (e.g. `chatcmpl-A1B2C3D4…`). It is `UNIQUE NOT NULL` on `spend_records` (`step_75_p3_spend_records_001.py:81`). Composite indexes (`tenant_id, project_id, created_at desc`) and (`tenant_id, created_at desc`) back the two read paths.

### 3.2 Write-path: INSERT-then-SELECT

Real-time writes (`forge_spend.py:223` `record_from_usage`) **never** use `INSERT … ON CONFLICT DO UPDATE` because we want to ignore cost changes from the chat completion itself — only the reconciliation path is allowed to overwrite `cost_usd` with LiteLLM's authoritative number.

```text
record_from_usage(litellm_request_id, ...):
  1. SELECT existing row by litellm_request_id
  2. If found: return it (no-op, no audit row)
  3. INSERT with pg_insert().on_conflict_do_nothing(...)   # ON CONFLICT only on Postgres
  4. SELECT the row again; if still None raise RuntimeError
  5. Emit forge.spend.recorded audit
```

The re-SELECT after a no-op insert covers the SQLite test path (tests run against the in-process DB per `backend/CLAUDE.md` "Tests"). Postgres uses `ON CONFLICT DO NOTHING` so the race is closed at the DB level; SQLite falls back to the second SELECT.

### 3.3 Reconciliation: upsert pattern

`forge_spend.py:323` `reconcile(last_sync)` iterates `/spend/logs` and **upserts** (insert-if-missing, update-cost-if-divergent) per row:

```text
for entry in logs:
  req_id = entry["request_id"]
  existing = SELECT spend_records WHERE litellm_request_id = req_id
  if existing is None:
    INSERT (with reconciled_at = now)
    rows_inserted += 1
  else if litellm_cost differs and |Δ|/litellm_cost > 0.01:
    UPDATE cost_usd = litellm_cost
    rows_upserted += 1
    drift_count += 1
    emit forge.spend.drift_detected
  stamp reconciled_at = now
```

The reconciliation never re-inserts a row that already exists for a given `litellm_request_id`, so a 5-min cron tick + a manual backfill for the same window produce the same row count.

---

## 4. Pre-call guard (P5 caller contract)

`BudgetGuard` (`backend/app/services/forge_budget_guard.py:131`) is the per-agent admission controller that P5 (chat completion SSE) **must** call before opening the upstream SSE stream. Phase 5 owns the wire-up; the guard itself ships in P3.

```text
result = await budget_guard.check_pre_call(
  agent_id=agent_id,
  est_cost_usd=cost_map.estimate(model=model, prompt_tokens=est_prompt),
)
# result = {allow: bool, warn: bool, spent_usd: float, ceiling_usd: float, pct: float}
```

When `spent_usd + est_cost_usd > ceiling_usd`, `check_pre_call` raises `AgentBudgetExceeded` and emits `forge.spend.budget_exceeded`. When `pct > 0.9` it emits `forge.spend.budget_warning` and returns `{allow: True, warn: True, …}` so P5 can surface a non-blocking banner. AC4 ("budget-exceeded blocks the call **before** it hits LiteLLM, verified by LiteLLM spend log absence") depends on this guard running unconditionally — never optional, never behind a feature flag.

After every successful call P5 must re-invoke the guard with the **actual** `cost_usd` from the final `usage` chunk so `_cached_spent()` sees the real number; a stale estimate will let an agent drift past `ceiling_usd` by a single call.

---

## 5. Drift detection

After every reconciliation tick the per-row drift check runs (`forge_spend.py:393`):

```text
if litellm_cost > 0 and abs(litellm_cost - forge_cost) / litellm_cost > 0.01:
    drift_count += 1
    audit_service.record(action="forge.spend.drift_detected", payload={
        "litellm_request_id": req_id,
        "litellm_cost_usd": litellm_cost,
        "forge_cost_usd": forge_cost,
        "drift_pct": round(abs(litellm_cost - forge_cost) / litellm_cost * 100, 4),
    })
```

### 5.1 The 1% threshold

The threshold is `> 0.01` of `litellm_cost` — **not** of `forge_cost`. Rationale: when `litellm_cost` is authoritative, normalising against it gives a stable signal even when Forge's local estimate is zero (e.g. the model wasn't in the cost map cache when the call landed). Drift below 1% is silently corrected; drift above 1% fires both an audit event **and** rolls the row's `cost_usd` to the LiteLLM value. AC7 of step-75 (line 365) tests this exact behaviour.

### 5.2 The `forge.spend.drift_detected` event

Audit row shape (Rule 6 — typed payload, best-effort write, swallow failures so reconciliation continues):

```text
action:        forge.spend.drift_detected
target_type:   spend_record
target_id:     <row uuid>
payload: {
  litellm_request_id: str,
  litellm_cost_usd:   float,
  forge_cost_usd:     float,
  drift_pct:          float,   # rounded to 4 dp
}
```

The drift event is emitted **per row**. AC7 of step-75 ("alert fires when LiteLLM cost differs from Forge-recorded cost by > 1%") means: in a 100-call reconciliation where 7 rows drift, 7 audit rows fire — one alert per row, not a roll-up.

---

## 6. Reconciliation cadence

The 5-minute sweep is registered as a scheduler job and called from `app/services/scheduler/jobs/forge_spend_reconcile.py:30` `run(tenant_id=None)`.

```text
*/5 * * * *     ->  forge_spend_reconcile.run()
```

Per-tick flow (`forge_spend_reconcile.py:36`):

1. Compute `last_sync = now - FORGE_SPEND_RECONCILE_LOOKBACK_MIN` (default 5 min, env-tunable).
2. Resolve tenants: if `tenant_id` arg is provided, only that one; otherwise `SELECT id FROM tenants` (failures on one tenant never abort the loop).
3. For each tenant: `spend_service.reconcile(last_sync=last_sync)`.
4. Emit one `forge.spend.reconciled` audit row per tenant with `{rows_upserted, rows_inserted, drift_count, window_start, window_end}`.
5. Audit write failures are logged at `warning` and swallowed — the reconciliation tick is considered complete.

Idempotency of the sweep: re-running for a window that has already been reconciled is a no-op for `rows_inserted`. The only thing a re-run can produce is more `rows_upserted`/`drift_count` rows if LiteLLM has issued a retrospective correction, which is exactly what we want.

---

## 7. Acceptance evidence (spec AC1–AC6)

| Spec (step-75.md line) | Acceptance criterion | Evidence path |
|---|---|---|
| 359 AC1 | Cost meter in UI updates within 5 s of chat completion end. | `record_from_usage` writes on every SSE `usage` chunk; `GET /spend/cost-meter/{run_id}` returns the row. Tests assert sub-second insert + read-back. |
| 360 AC2 | After 100 chat completions, `spend_records` has exactly 100 rows. | `litellm_request_id` UNIQUE constraint + INSERT-on-conflict-noop. |
| 361 AC3 | Reconciliation round-trip with LiteLLM shows zero drift over a 1-hour window. | Reconcile test seeds 60 rows, runs `reconcile()`, asserts `drift_count == 0` and identical cost. |
| 362 AC4 | Budget-exceeded blocks the call **before** it hits LiteLLM. | `BudgetGuard.check_pre_call` raises `AgentBudgetExceeded`; P5 unit test stubs the SSE stream and asserts it is never opened when the guard raises. |
| 363 AC5 | `/api/forge/spend/summary` returns within 200 ms warm-cache. | Integration test warms a Redis cache for `_summary` then times the call with `httpx.AsyncClient`; assertion `< 0.2 s`. |
| 365 AC7 | `forge.spend.drift_detected` alert fires when cost differs by > 1%. | Reconcile test mutates one row's `cost_usd` by 2%, runs `reconcile()`, asserts `drift_count == 1` and one `forge.spend.drift_detected` audit row with `drift_pct ≈ 2.0`. |

(AC6 at line 364 is `WS /api/forge/spend/stream`, which is explicitly **out of scope** for P3 — see §8.)

---

## 8. Out of scope (deferred)

The following items are listed in the step-75 spec but **not** shipped in P3 — they belong to a later phase or a different feature:

- **WebSocket cost-meter push** (`WS /api/forge/spend/stream`, AC6). Phase 2 or Phase 4 will own WS — P5 only ships the SSE side; the cost-meter WS is a follow-up. Until then, the UI polls `GET /spend/cost-meter/{run_id}` on a short interval (≤ 5 s).
- **Per-tenant CMK (customer-managed keys) encryption** for `spend_records` at rest. The table currently relies on Postgres-level encryption at the cluster. CMK wiring lands in Phase 4 with the rest of the encryption rollout.
- **Spend export to CloudZero / Vantage** (LiteLLM endpoints `…/vantage_*`, `…/cloudzero_*`). Deferred to Phase 4 per `docs/goals/step-75.md` lines 480–484.
- **`/global/spend`, `/user/daily`, `/team/daily`, `/tag/daily|dau|wau|mau` rollups.** Those LiteLLM endpoints are reachable via the master key but P3 only ships the four rollup shapes in `forge_spend.py` — admin rollups past the per-tenant scope are deferred.
- **Auto-blocking an agent's virtual key when `current_spend >= max_budget`.** P5 owns the key lifecycle; P3 only emits `forge.spend.budget_exceeded` and lets the next chat attempt trip `BudgetGuard.check_pre_call`.
- **`/customer/daily/activity`, `/agent/daily/activity`, `/organization/daily/activity`.** Same reason — admin-side rollups slip to Phase 4.

---

## 9. Anti-patterns (auto-reject)

- Computing cost as `usage.total_tokens * flat_rate`. Must look up the model in the cached cost map at `/public/litellm_model_cost_map`; see `forge-litellm-integration.md` §2.
- Calling `/spend/logs` from a UI render path. Only the scheduler job and `POST /spend/backfill` should hit it.
- Reconciliation that double-counts. The `litellm_request_id` UNIQUE constraint is the back-stop; code that ignores it is a bug.
- Budget enforcement that runs **after** the LiteLLM call has been issued. The whole point of `check_pre_call` is to short-circuit before any token is spent.
- Returning free-form `dict` from the rollup endpoints. Every response is a typed Pydantic model from `backend/app/schemas/forge_spend.py`.
- Logging `cost_usd`, tokens, or `litellm_request_id` at `info` or above. Token-level data is sensitive; logs at `debug` only (Rule 6 + Phase 1 §Cross-Cutting "Observability").
