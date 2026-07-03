# Forge Backend — Config & Auth Foundation (Phase 1, step-75)

> **Feature:** F1 — Config & Auth
> **Spec:** `docs/goals/step-75.md` lines 46-95
> **Status:** Phase 1 ship target
> **Substrate:** `LiteLLMBaseClient` + `forge_config.ForgeConfig` + `secret_filter.secret_filter`

---

## Env vars (Phase 1)

| Env var | Default | Notes |
|---|---|---|
| `LITELLM_PROXY_URL` | required | Base URL for the LiteLLM Proxy (no trailing slash). Inherits from pre-step-75 settings. |
| `LITELLM_API_KEY` | required | Bearer token used by the legacy chat surface (F-800). Distinct from the master key. |
| `LITELLM_ADMIN_KEY` | `""` | **Legacy** alias. Phase 2 retires. |
| `LITELLM_MASTER_KEY` | `""` | Preferred name (spec line 54). **Takes precedence over `LITELLM_ADMIN_KEY` when set.** Phase 1 keeps both. |
| `LITELLM_INTEGRATION_ENABLED` | `true` | Master toggle for the LiteLLM integration layer. |
| `FORGE_HEALTH_CACHE_TTL_SECONDS` | `60` | TTL for the in-process readiness cache behind `/api/forge/health`. Spec line 70. |
| `FORGE_TENANT_HEADER` | `X-Forge-Tenant` | Tenant header injected on outgoing admin/chat calls (Phase 2+). |
| `FORGE_RUN_HEADER` | `X-Forge-Run-Id` | Run header injected on outgoing chat calls (Phase 5). |
| `FORGE_ROUTE_DISCOVERY_ENABLED` | `true` | One-shot `GET /routes` capability discovery at boot (spec line 95). |
| `LITELLM_BUDGET_DEFAULT_USD` | `500.00` | Default tenant-level budget applied at tenant creation. |
| `LITELLM_HEALTH_CHECK_INTERVAL_SECONDS` | `30` | How often `LiteLLMHealthMonitor` pings the proxy (kept for non-forge health surface). |

## Boot validation (spec lines 60-67)

At `app.main.lifespan`:

1. `configure_logging()`, `init_telemetry()`, `bus.start()` — pre-existing wiring.
2. `forge_route_discovery_enabled` gate. If True:
   - Open `LiteLLMBaseClient` async context.
   - `await litellm.readiness()` → typed state dict.
   - **`status_code == 401` → `raise SystemExit(2)`** (spec line 65).
   - **`reachable == False` → log warning, continue** (proxy may be down for dev).
   - **`db == "Not connected"` → log warning, continue** (DB-less LiteLLM in dev, spec line 66).
   - Else → `log("forge.startup.litellm_ready", version=…)`.
   - `await litellm.list_routes()` → `route_count`.
3. `log("forge.auth.config_loaded", route_count=…)` — the audit event (spec line 374).
4. Yield to the app, then on shutdown: `bus.stop()`.

ponytail: no extra abstraction layer over `LiteLLMBaseClient` — the lifespan calls the same method as `/api/forge/health`. Two callers, one method.

## Auth chain (spec lines 70-72)

| Endpoint family | Header | Source |
|---|---|---|
| `/key/*`, `/spend/*`, `/model/*`, `/budget/*`, `/user/*`, `/team/*`, `/organization/*`, `/project/*`, `/guardrails/*`, `/policies/*`, `/global/*`, `/audit`, `/health/*` | `Authorization: Bearer <master_key>` | `forge_config.get_forge_config().master_key` → `settings.litellm_master_key or settings.litellm_admin_key` |
| `/v1/chat/completions`, `/v1/embeddings`, `/v1/audio/*`, `/v1/images/*`, `/v1/files/*`, `/v1/responses`, `/v1/batches/*`, `/v1/vector_stores/*`, `/v1/mcp/*`, `/v1/skills`, `/v1/agents`, `/v1beta/interactions`, `/rerank`, `/ocr`, `/search_tools/*` | `Authorization: Bearer <virtual_key>` | Per-agent, stored encrypted in `agent_virtual_key` (Phase 4) |

Phase 1 ships the **namespacing** (`forge_config` accessor + `LiteLLMBaseClient.admin_client` / `chat_client(api_key)` split already existed pre-step-75). Cross-key calls are not currently caught at runtime — that lands in Phase 4 when per-agent virtual keys actually flow into chat.

## Secrets hygiene (spec lines 75-77, 93-94)

`app.core.secret_filter.secret_filter` is the **first** structlog processor (see `app/core/logging.py:50-66`). It walks the top-level `event_dict` and applies:

- `Authorization: Bearer <key>` → replaced with `Authorization: [REDACTED]` (matched by header name).
- `Authorization` value matching `^Bearer <token>` → `Bearer [REDACTED]` (regex).
- Any string matching `^sk[_-][A-Za-z0-9_-]{12,}` → `sk-[REDACTED]` (LiteLLM key format).
- Any string equal to the resolved master key → `[REDACTED]` (catches raw env-var redacted output).

Fields are walked one level deep (list values, dict values). Anything deeper is the caller's responsibility — Phase 1 keeps secrets at the boundary by convention.

**Proof:** `grep -r LITELLM_MASTER_KEY backend/logs/` returns 0 matches after a 100-request load test. Auto-verified by `tests/core/test_secret_filter.py::test_no_master_key_in_logs_smoke` and `tests/test_anti_patterns.py::test_no_master_key_in_logs`.

## `/api/forge/health` shape (spec line 88)

```json
{
  "status": "ok | degraded | down",
  "litellm": {
    "version": "1.82.6",
    "reachable": true,
    "db": "ok",
    "cache": "Redis",
    "callbacks": ["langfuse", "slack"]
  }
}
```

- `200 + status=healthy + db=ok` → `ok`
- `200 + status=healthy + db=Not connected` → `degraded` (warn-but-allow, spec line 66)
- `401` or unreachable → `down` (warn at log level; `/api/forge/health` still returns 200 with the state — the router never refuses the caller; only `main.lifespan` aborts boot on 401)

Endpoint path: `GET /api/v1/forge/health` (mounted at `app/api/v1/forge_health.py:router`). Response model: `app.schemas.forge.ForgeHealth`.

**Latency:** ≤ 1 s warm cache, ≤ 2 s cold cache (5 s upstream timeout). The cache key is `int(time.time() // ttl_seconds)` with `lru_cache(maxsize=4)` so bursty refreshes don't evict aggressively. ponytail ceiling: **single-process cache**; upgrade to Redis when a second replica lands.

## Acceptance evidence (Phase 1 mapping to spec lines 91-95)

| Spec AC | Verified by | Test file |
|---|---|---|
| AC1 — Boot fails fast when `LITELLM_MASTER_KEY` missing | `LITELLM_MASTER_KEY="" uvicorn app.main:app` raises `SystemExit(2)` on 401 (or non-empty + non-rejected key still triggers readiness). Production guard via `forge_config.get_forge_config()` raises `RuntimeError` if `environment` is non-dev/non-test. | `tests/api/test_forge_health.py`, `tests/services/test_forge_config.py` |
| AC2 — `/api/forge/health` returns typed payload + LiteLLM version within 1 s warm | `tests/api/test_forge_health.py::test_health_returns_typed_payload_warm_cache` | same |
| AC3 — Master key never in any log line at any level | `tests/core/test_secret_filter.py` + `tests/test_anti_patterns.py::test_no_master_key_in_logs` | both |
| AC4 — `grep LITELLM_MASTER_KEY logs/` returns 0 after 100 req | `tests/test_anti_patterns.py::test_no_master_key_in_logs` | same |
| AC5 — `GET /routes` logged once at boot with route counts | `tests/api/test_forge_health.py::test_boot_logs_route_count` (asserts the log line is emitted exactly once) | same |

## Out of Phase 1 scope

- Runtime cross-key enforcement (admin call with virtual key, or chat call with master key) — Phase 4.
- KMS-backed CMK rotation for `ENV_VAR_ENCRYPTION_KEY` — Phase 4 (per ADR-011).
- Multi-region readiness probes — Phase 4.
