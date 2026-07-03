# Forge Backend — Models Registry (Phase 1, step-75)

> **Feature:** F2 — Models Registry
> **Spec:** `docs/goals/step-75.md` lines 99-145
> **Status:** Phase 1 ship target
> **Substrate:** `backend/app/services/forge_models.py::ModelsService` (new) + `backend/app/schemas/forge_models.py` (new) + `backend/app/api/v1/forge_models.py` (new router)

---

## Goal (spec line 102)

Give Forge UI a **fast, cached, scoped model picker**. UI never asks LiteLLM
directly; Forge Backend filters by what the calling user's virtual key is
allowed to use, augments with master-key-known metadata (tier, context window,
cost), and groups by provider for the picker UI.

---

## API contract

Four endpoints, all under `GET|POST /api/v1/forge/models*`. Mounted from
`backend/app/api/v1/forge_models.py:router`. Pydantic v2 request/response
shapes live in `backend/app/schemas/forge_models.py`. Error envelope follows
`{ok: false, error: {code, message, details}}` per spec line 384-386.

### 1. `GET /api/forge/models` — list models for the caller

Lists every model the calling user is permitted to use, augmented with
metadata + cost, marked `allowed_for_caller`, sorted by provider.

| Aspect | Value |
|---|---|
| Auth | Forge session JWT (resolves caller → virtual key) |
| Response model | `schemas/forge_models.py::ModelsListResponse` |
| Cache | 5 min in-process LRU (see [Cache layer](#cache-layer)) |
| Side effects | None |

**Response shape** (`ModelsListResponse`):
```
{
  "models": [ModelDescriptor],
  "groups": [ModelGroup],
  "fetched_at": "2026-07-02T12:34:56.789Z"
}
```

`ModelDescriptor` carries `id`, `provider`, `tier`, `context_window`,
`supports: {tools, vision, audio, streaming, json_mode}`,
`cost: {input_per_1k, output_per_1k}`, `allowed_for_caller: bool`,
and `unavailable_until_next_refresh: bool` (see spec line 124).

### 2. `GET /api/forge/models/:id` — single model detail

Returns one `ModelDescriptor`. Same cache as endpoint 1 (keyed on model id).
Returns `404 ModelNotFound` when the id is unknown to the registry.

| Aspect | Value |
|---|---|
| Auth | Forge session JWT |
| Response model | `schemas/forge_models.py::ModelDescriptor` |
| Cache | 5 min in-process LRU |
| Side effects | None |

### 3. `POST /api/forge/models/refresh` — admin: bust cache

Admin-only (RBAC role `forge.admin`). Drops the in-process LRU entries for
the three cache buckets and emits `forge.models.refreshed` (spec line 13).

| Aspect | Value |
|---|---|
| Auth | Forge session JWT + `forge.admin` role |
| Response model | `schemas/forge_models.py::RefreshResponse` |
| Cache | N/A — invalidates |
| Side effects | `event_bus.publish("forge.models.refreshed", ...)` |

**Response shape**: `{ "ok": true, "data": { "fetched_at": ..., "source_count": <int> } }`.

### 4. `GET /api/forge/models/groups` — group models by provider

Provider-bucketed view used by the picker UI (spec line 123).
Returns `groups: [ModelGroup]` where `ModelGroup = {provider, models: [ModelDescriptor]}`.
Grouping rule: split `model_id` on the **first** `/`, see [Grouping rule](#grouping-rule).

| Aspect | Value |
|---|---|
| Auth | Forge session JWT |
| Response model | `schemas/forge_models.py::ModelsGroupedResponse` |
| Cache | 5 min in-process LRU |
| Side effects | None |

---

## Cache layer

Three cache buckets, all in-process, all keyed by TTL bucketed timestamp
(`int(time.time() // ttl_seconds)`) wrapped in `functools.lru_cache(maxsize=…)`
over an async fetch helper. **ponytail ceiling**: single-process. Upgrade to
Redis when a second replica lands (see [Out of scope](#out-of-scope)).

| Bucket | TTL | Source | LRU maxsize | Spec line |
|---|---|---|---|---|
| `models_list` (per virtual key) | **5 min** | `GET /v1/models` with virtual key | 256 | 115 |
| `model_info` (master key) | **1 hour** | `GET /model/info` + `GET /model_group/info` with master key | 1024 | 116 |
| `cost_map` (no auth) | **24 hours** | `GET /public/litellm_model_cost_map` | 1 | 118 |

`lru_cache` is the **stdlib answer** (spec ceiling: per-process). No custom
cache class, no Redis client import, no message bus hop. The fetch helpers
live in `forge_models.py`:

- `ModelsService.fetch_models_list(virtual_key: str) -> list[ModelDescriptor]`
- `ModelsService.fetch_model_info() -> dict[str, ModelInfo]`
- `ModelsService.fetch_cost_map() -> dict[str, CostEntry]`

Each call sites a `try`/`except httpx.HTTPError`, marks the bucket
`stale_until_next_refresh: True` on error, and returns the last known value
**if and only if** the bucket has been warmed at least once. Cold-cache
failures propagate as `UpstreamUnavailable` (typed Forge error, spec line 264).

**ponytail ceiling** (in `forge_models.py`): "global lock, per-account locks
if throughput matters". The LRU pattern is read-mostly; one writer per bucket
on TTL expiry; collision risk on the same virtual key is bounded by maxsize.
No need for `asyncio.Lock` in Phase 1.

---

## `allowed_for_caller` computation (spec line 117)

`allowed_for_caller` is a **set intersection** of two upstream lists, computed
once per `models_list` fetch:

1. **Caller's allowed models** — `GET /v1/models` with the user's virtual key.
   Returns `{"data": [{"id": "openai/gpt-4o", ...}, ...]}` (LiteLLM 1.82.6
   shape). The virtual key itself enforces `models=[...]` at the LiteLLM
   layer; this list is what the user could ever see.

2. **Master-key-known registry** — `GET /model/info` with the master key.
   Returns every model the proxy knows about, with tier + context window +
   supports flags. Models absent from this list cannot be priced, scoped,
   or audited, so they must be filtered even if the virtual key lists them.

`allowed_for_caller = set(caller_models).intersection(master_registry)`.
Models in the caller set but absent from the master registry are **dropped**
(spec line 144 — "Disallowed models are filtered out, not just greyed out").

Implementation note: the intersection happens once during the per-key fetch
and the result is cached. We do **not** re-intersect on every read — that
would defeat the 5-min cache. Cache key is the caller's virtual key (or a
hash thereof), so two users with different scopes do not pollute each other.

Cost is then joined from the 24-hour `cost_map` bucket. Models missing cost
are still returned (cost fields default to `null`); the UI shows
"cost unknown" rather than hiding the model.

---

## Cost map source (spec line 118)

Single endpoint: `GET /public/litellm_model_cost_map` — **no auth required**,
hence safe to cache aggressively.

- TTL: **24 hours** (spec line 118). Cost data moves on a multi-day cadence;
  no point hammering the endpoint.
- Storage: `dict[str, CostEntry]` where `CostEntry = {input_cost_per_token,
  output_cost_per_token, ...}`. The service divides by 1000 to produce
  `input_per_1k` / `output_per_1k` for the picker UI.
- Refresh: the cost map never invalidates mid-TTL. `POST /forge/models/refresh`
  busts the bucket if an admin needs a force-fetch.
- **Anti-pattern guard** (spec line 450): never derive cost from
  `usage.total_tokens * flat_rate`. Always read the per-model cost map entry.

---

## Grouping rule (spec line 123)

`provider` is derived from the model id by **splitting on the first `/`**.
Examples:

| Model id | provider |
|---|---|
| `openai/gpt-4o` | `openai` |
| `anthropic/claude-sonnet-4-6` | `anthropic` |
| `bedrock/anthropic.claude-3-sonnet` | `bedrock` |
| `gpt-4o` (no slash) | `unknown` |

The provider split is the **first** slash only — `bedrock/anthropic.claude-3-sonnet`
groups under `bedrock`, not `anthropic`. This matches the LiteLLM upstream
model id convention (`<provider>/<model_name>`) and the picker UI grouping
expectation (spec line 123 — "Group by provider (OpenAI, Anthropic, Bedrock,
etc.)").

If `provider` is `unknown`, the model still appears in the picker, but under
an "Other" group at the end of the list. We do not silently drop ungrouped
models.

---

## Stale-on-disappear (spec line 124)

If a model disappears from `GET /v1/models` but is in the cache, it is
marked `unavailable_until_next_refresh: True` and **kept** in the picker
for 24 hours. This prevents thrash during brief LiteLLM provider outages.
The picker UI renders unavailable models greyed with a tooltip; users can
still see historical cost + supports flags.

After 24 hours (next cost-map refresh window), the stale entry is dropped.

---

## Acceptance evidence (spec lines 139-145)

| Spec AC | Verified by | Test file |
|---|---|---|
| AC1 — Cold cache: 3 upstream calls (models, info, cost map) | `tests/services/test_forge_models.py::test_cold_cache_makes_three_calls` (asserts httpx called exactly 3 times across the three endpoints on first request) | new |
| AC2 — Warm cache: zero upstream calls within 5 min | `tests/services/test_forge_models.py::test_warm_cache_no_calls` (second request within 300s asserts 0 outbound httpx calls) | new |
| AC3 — `allowed_for_caller` chip correct for 3 distinct scopes | `tests/services/test_forge_models.py::test_allowed_for_caller_intersection` (3 virtual keys with disjoint scopes, asserts intersection matches expected set per caller) | new |
| AC4 — New model visible in UI within 5 min | `tests/services/test_forge_models.py::test_ttl_eviction` (monkey-patches `time.time`, asserts entry re-fetched at TTL boundary) | new |
| AC5 — Cost numbers match `/public/litellm_model_cost_map` to the cent | `tests/services/test_forge_models.py::test_cost_map_join_matches_upstream` (mock returns fixed cost map; asserts `cost.input_per_1k` == upstream value × 1000) | new |
| AC6 — Disallowed models filtered, not greyed | `tests/api/test_forge_models_router.py::test_disallowed_models_absent_from_response` (asserts `model.id not in response.models`) | new |

Audit hook: each successful list fetch emits `forge.models.refreshed` with
`source_count` payload (spec line 13, `forge-audit-events.md` row 2).

---

## Anti-patterns (auto-reject)

- Computing cost from a flat per-token rate. (spec line 450)
- Calling LiteLLM directly from a UI component to list models. (Rule 1)
- Returning a model the caller's virtual key does not allow. (spec line 144)
- Caching across users without keying on the caller's identity. (Rule 2)
- Emitting the master key in any model-descriptor payload. (Rule 1 + secret_filter)

---

## Out of scope

- **WebSocket variants** of the four endpoints (e.g. `/ws/forge/models/stream`).
  Phase 1 is HTTP only; the picker does not need a push channel.
- **Multi-replica Redis cache.** Phase 1 runs Forge Backend as a single
  process per tenant; `lru_cache` is sufficient. When the second replica
  ships (horizontal scale-out), the `lru_cache` callsites in
  `forge_models.py` migrate to a Redis-backed `Cache` protocol — the
  signature on `ModelsService` stays the same. **ponytail ceiling** comment
  in `forge_models.py` will name the upgrade path before that PR lands.
- **Live cost updates** during a 24-hour TTL window. Cost map drift within
  a day is rare and not worth the cache invalidation complexity.
- **Pinning a default model per agent.** That is P4 (virtual key broker)
  territory — agent spawn picks the default, model picker just lists.
- **Per-tenant model overrides.** Org-level overrides (e.g. disabling
  OpenAI for one tenant) are Phase 2 governance.

---

## Related deliverables

- F1 (`forge-backend-config.md`, `forge-backend-auth.md`) — env vars + master
  key plumbing this feature depends on.
- F3 (`forge-spend-aggregation.md`, P3) — reads the same cost map to compute
  per-call `cost_usd` after a stream ends.
- F4 (`forge-virtual-key-broker.md`, P4) — the agent spawner that creates
  the virtual keys whose `models` scope feeds endpoint 1 above.
- Audit catalog (`forge-audit-events.md` row 2) — `forge.models.refreshed`
  event definition + payload.