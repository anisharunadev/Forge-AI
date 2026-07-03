# Forge Backend — Auth Chain (Phase 1, step-75)

> **Feature:** F1 — Auth chain
> **Spec:** `docs/goals/step-75.md` lines 46-95
> **Substrate:** `LiteLLMBaseClient._admin_headers` + `_chat_headers` (pre-existing); `forge_config.get_forge_config().master_key` (new); `secret_filter.secret_filter` (new).

---

## Endpoint classification (spec lines 70-72, simplified)

| Class | Endpoints | Bearer |
|---|---|---|
| **Admin (master key)** | `/key/*`, `/spend/*`, `/budget/*`, `/model/*`, `/model_group/*`, `/user/*`, `/team/*`, `/organization/*`, `/project/*`, `/guardrails/*`, `/policies/*`, `/global/*`, `/audit`, `/health/*`, `/routes`, `/settings/*` | `Authorization: Bearer <master_key>` from `settings.litellm_master_key or settings.litellm_admin_key` |
| **Inference (virtual key)** | `/v1/chat/completions`, `/v1/embeddings`, `/v1/audio/*`, `/v1/images/*`, `/v1/files/*`, `/v1/responses`, `/v1/batches/*`, `/v1/vector_stores/*`, `/v1/mcp/*`, `/v1/skills`, `/v1/agents`, `/v1beta/interactions`, `/rerank`, `/ocr`, `/search_tools/*` | `Authorization: Bearer <virtual_key>` per-agent (Phase 4) |

## Enforcing the split (Phase 1 state)

Two layers:

1. **At the HTTP client level** — `app/integrations/litellm/litellm_base_client.py` already separates `_admin_headers()` (line 67-73) from `_chat_headers(api_key)` (line 76-90). The `LiteLLMBaseClient.admin_client` and `chat_client(api_key)` factories enforce the split.

2. **At boot** — `app.main.lifespan` validates the master key on first call to `/health/readiness`. Any 401 → `SystemExit(2)` so a misconfigured deploy never serves traffic.

3. **Missing layer** — runtime refusal of `chat_client(master_key)` or `admin_client(virtual_key)` is **not** enforced in Phase 1. The integration layer is small enough that a cross-key mistake would be loud (wrong auth header → 401 from LiteLLM), and per-agent virtual keys don't exist yet (Phase 4). The guard will land in Phase 4 alongside the per-agent key broker.

## Secrets redaction (spec lines 75-77)

`app.core.secret_filter.secret_filter` is the first structlog processor (see `app/core/logging.py:51`). It handles three shapes per event_dict key:

| Shape | Detection | Output |
|---|---|---|
| Header-named `Authorization` (any case) | `^authorization$` regex on key | value replaced with `[REDACTED]` |
| `Bearer <token>` substring | `(?i)bearer\s+([A-Za-z0-9._-]+)` regex on value | `Bearer [REDACTED]` |
| LiteLLM key prefix | `\b(sk[_-][A-Za-z0-9_-]{12,})` regex on value | `sk-[REDACTED]` |
| Full master key as a value | str equality vs `settings.litellm_master_key or settings.litellm_admin_key` | `[REDACTED]` |

Top-level keys + list values + dict values are walked. Deeper nesting is the caller's responsibility; the boundary convention is no secrets past one level.

**ponytail ceiling:** regex redaction is shallow. Anything that escapes this filter is by convention forbidden. If you need to log a complex object containing a key, redact at the boundary, not at the log call.

## Master key envelope (boot → module)

```
settings.litellm_master_key   ─┐
                                ├─► forge_config.get_forge_config().master_key  ──► LiteLLMBaseClient._admin_headers()
settings.litellm_admin_key    ─┘
       (legacy alias, deprecated)
```

Resolution order: `litellm_master_key` first, `litellm_admin_key` as fallback. Phase 2 retires the alias; Phase 1 keeps both so existing call sites stay green.

## Auth audit (spec line 374, 95)

| Event | When | Where |
|---|---|---|
| `forge.auth.config_loaded` (log line) | Boot, after readiness check + routes discovery | `app.main.lifespan` |
| `forge.startup.master_key_rejected` (log warning) | Boot, on 401 from `/health/readiness` | same |
| `forge.startup.litellm_unreachable` (log warning) | Boot, on connection error | same |
| `forge.startup.litellm_db_disconnected` (log warning) | Boot, on `db == "Not connected"` | same |
| `forge.startup.litellm_ready` (log info) | Boot, on healthy readiness | same |

Log-line "events" double as audit events: downstream log aggregators can promote them. Phase 2 adds an enum member for typed bus publishing.

## Operator runbook

| Symptom | Likely cause | Action |
|---|---|---|
| `forge.startup.master_key_rejected` on boot | `LITELLM_MASTER_KEY` (or `LITELLM_ADMIN_KEY`) is set but the proxy rejects it (rotated, copied wrong) | rotate the master key in LiteLLM (`POST /key/regenerate`), update env, redeploy |
| `forge.startup.litellm_unreachable` on boot but proxy is up | DNS / network policy / timeout too low | check `LITELLM_PROXY_URL`, set `LITELLM_TIMEOUT_MS` higher |
| `/api/forge/health` returns `status: degraded` | DB-less LiteLLM (dev) — expected | none |
| `Authorization: [REDACTED]` appearing in DEBUG logs everywhere | misconfiguration somewhere is logging raw headers | usually safe — log line is redacted. If you see actual `sk-` tokens, file a P1 bug |
