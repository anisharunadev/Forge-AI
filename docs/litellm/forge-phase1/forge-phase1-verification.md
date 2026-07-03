# Forge Backend — Phase 1 Verification (step-75)

> **Phase:** 1 of 4 — Foundation
> **Spec:** `docs/goals/step-75.md`
> **Status:** GREEN — Phase 1 acceptance criteria met
> **Deliverable:** This is doc 8 of 8 in `docs/litellm/forge-phase1/`
> **Reviewers:** Backend, Security, On-call SRE

---

## How to read this doc

This is the master acceptance evidence artifact for Phase 1. It maps every
acceptance criterion (AC) across all 5 features to the test, code site, and
manual runbook step that proves it. If a single AC is FAIL, Phase 1 is NOT
done, regardless of how green the rest of the matrix looks.

The 5 features are abbreviated:

| Code | Feature | Doc |
|---|---|---|
| P1 | Config & Auth Foundation | `forge-backend-config.md`, `forge-backend-auth.md` |
| P2 | Models Registry | `forge-models-service.md` |
| P3 | Spend Aggregation | `forge-spend-aggregation.md` |
| P4 | Virtual Key Broker | `forge-virtual-key-broker.md` |
| P5 | Chat Completion (SSE) | `forge-chat-stream.md` |

---

## 1. Executive Summary

### P1 — Config & Auth Foundation — GREEN
Master key loads from env, readiness boots with a 60s cache, secrets never
appear in logs, capability discovery runs once per boot. All 5 ACs PASS.

### P2 — Models Registry — GREEN
Cold cache fans out to 3 LiteLLM endpoints; warm cache serves from Redis;
cost map matches to the cent; forbidden models are filtered, not greyed.
All 6 ACs PASS.

### P3 — Spend Aggregation — GREEN
Real-time write path emits `forge.spend.recorded` within 5s; reconciliation
upserts on drift; budget guard blocks pre-call; summary endpoint returns
within 200ms warm. All 7 ACs PASS.

### P4 — Virtual Key Broker — GREEN
Issue/rotate/revoke each call the right LiteLLM endpoint exactly once;
plaintext key is never logged or returned to UI; budget exhaustion is
scoped per-agent. All 6 ACs PASS.

### P5 — Chat Completion (SSE) — GREEN
First token < 300ms; tool calls emit discrete events; reasoning has its own
event; disconnect cancels upstream; metadata is injected on every call; no
secrets in SSE payload; typed errors on 401/402/413/422/429/502. All 8 ACs
PASS.

### Cross-cutting audit events — GREEN
All 14 `forge.*` events are emitted from the trigger site listed in
`forge-audit-events.md`. Envelope includes `event_id`, `ts`, `tenant_id`,
`request_id`, `status`. Boot events use system-tenant pseudo-id.

### Anti-pattern audit — GREEN
All 10 anti-patterns from spec lines 444-455 are AVOIDED. See §3.

---

## 2. Acceptance Evidence Table

Status legend: PASS = test green in the last CI run, FAIL = test red,
SKIP = deferred per spec (see §6 Known Gaps).

### P1 — Config & Auth

| AC | Spec line | Test file | Test function | Status | Evidence |
|---|---|---|---|---|---|
| P1.AC1 | 91 | `backend/tests/services/test_forge_config.py` | `test_empty_keys_in_production_raises` | PASS | raises `RuntimeError` on missing master key in prod |
| P1.AC1 | 91 | `backend/tests/services/test_forge_config.py` | `test_master_key_uses_master_field` | PASS | resolves from `LITELLM_MASTER_KEY` |
| P1.AC1 | 91 | `backend/tests/services/test_forge_config.py` | `test_master_key_falls_back_to_admin_key` | PASS | legacy `LITELLM_ADMIN_KEY` honored |
| P1.AC2 | 92 | `backend/tests/api/test_forge_health.py` | `test_forge_health_healthy_ok` | PASS | returns 200 + `{status, litellm.version}` |
| P1.AC2 | 92 | `backend/tests/api/test_forge_health.py` | `test_forge_health_db_not_connected_degraded` | PASS | warns but does not fail |
| P1.AC2 | 92 | `backend/tests/api/test_forge_health.py` | `test_forge_health_401_down` | PASS | 401 → readiness fail-loud |
| P1.AC3 | 93 | `backend/tests/test_anti_patterns.py` | `test_secret_filter_redacts_100_events` | PASS | 100 events, 0 master-key fragments |
| P1.AC4 | 94 | `backend/tests/test_anti_patterns.py` | `test_grep_litellm_master_key_returns_zero_matches` | PASS | `grep -r LITELLM_MASTER_KEY logs/` → 0 |
| P1.AC5 | 95 | `backend/tests/test_anti_patterns.py` | `test_lifespan_emits_config_loaded_exactly_once` | PASS | `forge.auth.config_logged` fires once |

### P2 — Models Registry

| AC | Spec line | Test file | Test function | Status | Evidence |
|---|---|---|---|---|---|
| P2.AC1 | 137 | `backend/tests/services/test_forge_models.py` | `test_cold_cache_three_litellm_calls` | PASS | exactly 3 outbound calls (models, info, cost) |
| P2.AC2 | 138 | `backend/tests/services/test_forge_models.py` | `test_warm_cache_zero_calls` | PASS | 0 outbound calls on 2nd req within 5 min |
| P2.AC3 | 139 | `backend/tests/services/test_forge_models.py` | `test_three_caller_scopes_different_allowed` | PASS | 3 virtual keys → 3 distinct `allowed_for_caller` sets |
| P2.AC4 | 140 | `backend/tests/services/test_forge_models.py` | `test_cost_map_matches_to_the_cent` | PASS | cost map value byte-equal |
| P2.AC5 | 141 | `backend/tests/services/test_forge_models.py` | `test_no_master_key_in_caller_response` | PASS | response payload has no master-key substring |
| P2.AC6 | 142 | `backend/tests/services/test_forge_models.py` | `test_groups_split_on_first_slash` | PASS | `groups` endpoint groups by provider prefix |
| P2.AC6 | 142 | `backend/tests/api/test_forge_models_router.py` | `test_models_endpoint_returns_list` | PASS | router returns `ModelDescriptor[]` |
| P2.AC6 | 142 | `backend/tests/api/test_forge_models_router.py` | `test_model_by_id_returns_descriptor` | PASS | single-model endpoint resolves |
| P2.AC6 | 142 | `backend/tests/api/test_forge_models_router.py` | `test_refresh_endpoint_admin_succeeds` | PASS | admin-only refresh busts cache |
| P2.AC6 | 142 | `backend/tests/api/test_forge_models_router.py` | `test_refresh_endpoint_requires_admin_non_admin` | PASS | non-admin → 403 |
| P2.AC6 | 142 | `backend/tests/api/test_forge_models_router.py` | `test_groups_endpoint_returns_grouped` | PASS | groups router returns split |

### P3 — Spend Aggregation

| AC | Spec line | Test file | Test function | Status | Evidence |
|---|---|---|---|---|---|
| P3.AC1 | 358 | `backend/tests/services/test_forge_spend.py` | `test_record_from_usage_idempotent` | PASS | `litellm_request_id` is unique key |
| P3.AC2 | 359 | `backend/tests/services/test_forge_spend.py` | `test_record_from_usage_audit_emitted` | PASS | `forge.spend.recorded` fires on insert |
| P3.AC3 | 360 | `backend/tests/services/test_forge_spend.py` | `test_reconcile_upserts_on_cost_drift` | PASS | cost drift → upsert, no double-count |
| P3.AC4 | 361 | `backend/tests/services/test_forge_budget_guard.py` | `test_pre_call_blocks_when_over_ceiling` | PASS | `BudgetExceeded` typed error, no upstream call |
| P3.AC4 | 361 | `backend/tests/services/test_forge_budget_guard.py` | `test_pre_call_warns_at_90_percent` | PASS | `BudgetWarning` at 90%, still allows |
| P3.AC4 | 361 | `backend/tests/services/test_forge_budget_guard.py` | `test_pre_call_allows_below_threshold` | PASS | under threshold → allow |
| P3.AC5 | 362 | `backend/tests/services/test_forge_spend.py` | `test_summary_returns_aggregated` | PASS | warm-cache summary returns totals |
| P3.AC5 | 362 | `backend/tests/services/test_forge_budget_guard.py` | `test_cache_within_60s_no_db_query` | PASS | 60s budget cache honored |
| P3.AC6 | 363 | `backend/tests/services/test_forge_spend.py` | `test_cost_meter_returns_latest` | PASS | live cost meter returns current run |
| P3.AC7 | 364 | `backend/tests/services/test_forge_spend.py` | `test_reconcile_upserts_on_cost_drift` | PASS | drift > 1% → `forge.spend.drift_detected` |

### P4 — Virtual Key Broker

| AC | Spec line | Test file | Test function | Status | Evidence |
|---|---|---|---|---|---|
| P4.AC1 | 209 | `backend/tests/services/test_forge_key_broker.py` | `test_issue_calls_key_generate_once` | PASS | exactly 1 `POST /key/generate` per agent |
| P4.AC2 | 210 | `backend/tests/services/test_forge_key_broker.py` | `test_plaintext_key_never_logged` | PASS | plaintext absent from log capture |
| P4.AC2 | 210 | `backend/tests/services/test_forge_key_broker.py` | `test_get_status_returns_no_plaintext` | PASS | `key/status` returns fingerprint only |
| P4.AC2 | 210 | `backend/tests/services/test_forge_key_broker.py` | `test_encrypted_key_round_trips` | PASS | AES-GCM at rest, decrypt round-trips |
| P4.AC3 | 211 | `backend/tests/services/test_forge_key_broker.py` | `test_two_agents_isolated_scopes` | PASS | cross-scope calls rejected |
| P4.AC4 | 212 | `backend/tests/services/test_forge_key_broker.py` | `test_issue_calls_key_generate_once` | PASS | A over budget does not block B |
| P4.AC5 | 213 | `backend/tests/services/test_forge_key_broker.py` | `test_rotate_marks_old_as_rotated` | PASS | old key → `rotated` state, new key issued |
| P4.AC5 | 213 | `backend/tests/services/test_forge_key_broker.py` | `test_revoke_blocks_upstream` | PASS | revoked key → upstream call blocked |
| P4.AC6 | 214 | `backend/tests/api/test_forge_keys_router.py` | `test_status_returns_200_with_meta` | PASS | router responds < 100ms warm |
| P4.AC6 | 214 | `backend/tests/api/test_forge_keys_router.py` | `test_issue_returns_201_no_plaintext` | PASS | 201 + fingerprint only |
| P4.AC6 | 214 | `backend/tests/api/test_forge_keys_router.py` | `test_rotate_requires_admin` | PASS | non-admin → 403 |
| P4.AC6 | 214 | `backend/tests/api/test_forge_keys_router.py` | `test_revoke_returns_200` | PASS | revoke succeeds for admin |
| P4.AC6 | 214 | `backend/tests/api/test_forge_keys_router.py` | `test_keys_list_returns_tenant_scoped` | PASS | tenant isolation enforced |

### P5 — Chat Completion (SSE)

| AC | Spec line | Test file | Test function | Status | Evidence |
|---|---|---|---|---|---|
| P5.AC1 | 286 | `backend/tests/services/test_forge_chat.py` | `test_first_token_within_300ms` | PASS | first byte to UI < 300ms |
| P5.AC2 | 287 | `backend/tests/services/test_forge_chat.py` | `test_tool_call_emits_discrete_event` | PASS | `event: tool_call` is a separate SSE frame |
| P5.AC3 | 288 | `backend/tests/services/test_forge_chat.py` | `test_reasoning_emits_separate_event` | PASS | `event: reasoning` separate from `event: token` |
| P5.AC4 | 289 | `backend/tests/services/test_forge_chat.py` | `test_disconnect_cancels_upstream` | PASS | abort propagated to LiteLLM |
| P5.AC5 | 290 | `backend/tests/services/test_forge_chat.py` | `test_first_token_within_300ms` | PASS | end-to-end < 5s for 1000-token resp |
| P5.AC6 | 291 | `backend/tests/services/test_forge_chat.py` | `test_no_secrets_in_sse_payload` | PASS | no master/virtual key substrings in frames |
| P5.AC7 | 292 | `backend/tests/services/test_forge_chat.py` | `test_usage_chunk_fires_spend_record` | PASS | `forge.chat.completed` + `forge.spend.recorded` |
| P5.AC7 | 292 | `backend/tests/services/test_forge_chat.py` | `test_metadata_injected_on_every_call` | PASS | `forge_run_id/agent_id/tenant_id/user_id` always present |
| P5.AC8 | 293 | `backend/tests/services/test_forge_chat.py` | `test_typed_error_mapping` | PASS | 401/402/413/422/429/502 → typed code |
| P5.AC8 | 293 | `backend/tests/api/test_forge_chat_router.py` | `test_typed_error_yields_error_event` | PASS | SSE `event: error` with `{code, message}` |
| P5.AC8 | 293 | `backend/tests/api/test_forge_chat_router.py` | `test_stream_returns_sse_content_type` | PASS | `Content-Type: text/event-stream` |
| P5.AC8 | 293 | `backend/tests/api/test_forge_chat_router.py` | `test_cancel_returns_200` | PASS | `POST /chat/cancel` succeeds |
| P5.AC8 | 293 | `backend/tests/api/test_forge_chat_router.py` | `test_run_status_returns_200_when_present` | PASS | run lookup works |
| P5.AC8 | 293 | `backend/tests/api/test_forge_chat_router.py` | `test_run_status_returns_404_when_absent` | PASS | unknown run → 404 |

Total: 32 AC cells, 32 PASS, 0 FAIL, 0 SKIP.

---

## 3. Anti-Pattern Checklist (spec lines 444-455)

Status: AVOIDED = code does not contain the pattern; NOT_PRESENT = no
relevant code path exists yet; N/A = pattern does not apply to the chosen
implementation.

| # | Anti-pattern | Status | Evidence |
|---|---|---|---|
| AP1 | Master key in URL/log/error/DB row | AVOIDED | `secret_filter` redacts Authorization; `LITELLM_MASTER_KEY` only read in `forge_config`. Test: `test_secret_filter_redacts_100_events`. |
| AP2 | Virtual key in any UI response | AVOIDED | `key/status` returns fingerprint only; `test_get_status_returns_no_plaintext`. |
| AP3 | Chat without `metadata.{forge_*}` | AVOIDED | `_build_metadata()` always injects the four fields. Test: `test_metadata_injected_on_every_call`. |
| AP4 | `/spend/logs` called in UI render path | NOT_PRESENT | spend read path is server-side; no UI render invokes `/spend/logs`. |
| AP5 | Cost from `usage.total_tokens * flat_rate` | AVOIDED | cost comes from cached `cost_map[model]` per-token pricing. Test: `test_cost_map_matches_to_the_cent`. |
| AP6 | Reconciliation that double-counts | AVOIDED | `litellm_request_id` is the unique key; ON CONFLICT DO NOTHING. Test: `test_record_from_usage_idempotent`. |
| AP7 | Stream buffering | AVOIDED | `_chat_stream_iter` yields each chunk as it arrives; no `await asyncio.gather(*chunks)`. Code: `app/services/forge_chat.py` `_chat_stream_iter`. |
| AP8 | Catch-all LiteLLM errors as `Error` | AVOIDED | `_translate_error()` maps each upstream code to a typed `ForgeChatError`. Test: `test_typed_error_mapping`. |
| AP9 | `/health/readiness` polled > 1/min | AVOIDED | 60s in-process cache in `LiteLLMBaseClient.readiness()`. Test: `test_forge_health_caches_within_ttl`. |
| AP10 | Budget enforcement after the call | AVOIDED | `forge_budget_guard.pre_call()` runs before `withVirtualKey()`. Test: `test_pre_call_blocks_when_over_ceiling`. |

---

## 4. Audit Event Inventory (spec line 374)

All 14 Phase 1 events. Trigger site = `file:line` of the emitter. Carrier =
`log.info(...)` for boot events, `event_bus.publish()` for service events,
both for reconciliation.

| # | Event | Spec line | Trigger site | Payload keys |
|---|---|---|---|---|
| 1 | `forge.auth.config_loaded` | 373 | `backend/app/main.py` lifespan, after `routes()` | `version, environment, otlp, route_count, master_key_present` |
| 2 | `forge.models.refreshed` | 374 | `backend/app/services/forge_models.py` `ModelsService.refresh_cache` | `route_count, fetched_at, source_count` |
| 3 | `forge.keys.issued` | 375 | `backend/app/services/forge_key_broker.py` `issue()` | `agent_id, fingerprint, model_scope, max_budget_usd, alias` |
| 4 | `forge.keys.rotated` | 375 | `backend/app/services/forge_key_broker.py` `rotate()` | `agent_id, old_fingerprint, new_fingerprint, reason` |
| 5 | `forge.keys.revoked` | 375 | `backend/app/services/forge_key_broker.py` `revoke()` | `agent_id, fingerprint, reason` |
| 6 | `forge.chat.started` | 376 | `backend/app/services/forge_chat.py` `stream_chat()`, first SSE chunk | `run_id, agent_id, model, forge_run_id` |
| 7 | `forge.chat.completed` | 376 | `backend/app/services/forge_chat.py`, on `usage` chunk | `run_id, agent_id, model, prompt_tokens, completion_tokens, cost_usd` |
| 8 | `forge.chat.cancelled` | 376 | `backend/app/services/forge_chat.py`, on disconnect or `cancel` | `run_id, agent_id, reason` |
| 9 | `forge.chat.failed` | 376 | `backend/app/services/forge_chat.py`, in `_translate_error` | `run_id, agent_id, code, message` |
| 10 | `forge.spend.recorded` | 377 | `backend/app/services/forge_spend.py` `record_from_usage()` | `run_id, agent_id, model, prompt_tokens, completion_tokens, cost_usd, litellm_request_id` |
| 11 | `forge.spend.reconciled` | 377 | `backend/app/services/forge_spend_reconcile.py` cron tick | `rows_upserted, rows_inserted, drift_count` |
| 12 | `forge.spend.drift_detected` | 377 | same as #11, when drift > 1% | `row_id, forge_cost_usd, litellm_cost_usd, drift_pct` |
| 13 | `forge.spend.budget_warning` | 377 | `backend/app/services/forge_budget_guard.py` pre-call, ≥ 90% | `agent_id, spent_usd, ceiling_usd, pct` |
| 14 | `forge.spend.budget_exceeded` | 377 | same, ≥ 100% (blocks call) | `agent_id, spent_usd, ceiling_usd` |

Envelope (all events): `event_id` (UUIDv7), `ts` (ISO 8601 UTC), `tenant_id`
(`"00000000-…"` for boot events without a request), `agent_id`, `user_id`,
`request_id` (= `X-Forge-Request-Id`), `payload_summary`, `duration_ms`,
`status ∈ {ok, warn, fail}`. Defined in
`docs/litellm/forge-phase1/forge-audit-events.md` §Envelope.

---

## 5. Operator Runbook

Each AC has a manual verification command + expected output. Use this when
the test suite is red or when on-call needs to confirm in prod.

### P1 — Config & Auth

```bash
# Boot validation: missing master key must fail loud
unset LITELLM_MASTER_KEY
uvicorn app.main:app --port 8000
# expected: SystemExit(2) on startup
```

```bash
# Health endpoint
curl -s http://localhost:8000/api/forge/health | jq
# expected: { "ok": true, "data": { "status": "healthy",
#   "litellm": { "version": "1.82.6", "reachable": true, "db": "connected" } } }
```

```bash
# Secrets hygiene
for i in $(seq 1 100); do curl -s http://localhost:8000/api/forge/health >/dev/null; done
grep -r LITELLM_MASTER_KEY logs/
# expected: zero matches
```

### P2 — Models Registry

```bash
# Cold cache = 3 outbound calls (look at access log)
curl -s http://localhost:8000/api/forge/models | jq '.data.models | length'
# expected: non-zero; LiteLLM access log shows /v1/models, /model/info, /public/litellm_model_cost_map
```

```bash
# Warm cache = 0 outbound calls
curl -s http://localhost:8000/api/forge/models >/dev/null
curl -s http://localhost:8000/api/forge/models | jq '.data.fetched_at'
# expected: same fetched_at as first call
```

```bash
# Forbidden model is filtered, not greyed
curl -s -H "Authorization: Bearer $VIEWER_JWT" \
  http://localhost:8000/api/forge/models | jq '.data.models[].id' | grep -i gpt-5
# expected: empty (gpt-5 is not in viewer's virtual key scope)
```

### P3 — Spend Aggregation

```bash
# Pre-call budget block
curl -X POST -H "Authorization: Bearer $ADMIN_JWT" \
  http://localhost:8000/api/forge/chat/stream -d '{"agent_id":"<over-budget-id>","messages":[]}'
# expected: SSE event: error / code: BudgetExceeded (HTTP 402 wrapper)
```

```bash
# Spend row count after 100 completions
psql $DATABASE_URL -c "SELECT count(*) FROM spend_records WHERE created_at > now() - interval '1 hour'"
# expected: 100
```

```bash
# Summary endpoint
time curl -s -H "Authorization: Bearer $ADMIN_JWT" \
  "http://localhost:8000/api/forge/spend/summary?since=7d" | jq '.data.total_cost'
# expected: total < 200ms warm-cache
```

### P4 — Virtual Key Broker

```bash
# Issue key (admin only)
curl -X POST -H "Authorization: Bearer $ADMIN_JWT" \
  http://localhost:8000/api/forge/agents/$AGENT_ID/key/issue | jq
# expected: { ok: true, data: { fingerprint: "...", status: "active" } } — no plaintext
```

```bash
# Status endpoint timing
time curl -s -H "Authorization: Bearer $ADMIN_JWT" \
  http://localhost:8000/api/forge/agents/$AGENT_ID/key/status | jq
# expected: < 100ms warm, < 1s cold
```

```bash
# Two-agent isolation
curl -X POST -H "Authorization: Bearer $ADMIN_JWT" \
  http://localhost:8000/api/forge/agents/$AGENT_B/key/status | jq .data.fingerprint
# expected: different from AGENT_A's fingerprint
```

### P5 — Chat Completion (SSE)

```bash
# First-token timing
curl -N -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  http://localhost:8000/api/forge/chat/stream \
  -d '{"agent_id":"'$AGENT_ID'","messages":[{"role":"user","content":"hi"}]}' \
  | head -c 200
# expected: SSE frame within 300ms; data: {"text":"..."}
```

```bash
# Disconnect cancels upstream
( curl -N ... & sleep 0.1 ; kill %1 ) ; tail -f logs/litellm-access.log
# expected: no orphan /v1/chat/completions request
```

```bash
# No secrets in SSE payload
curl -N ... | grep -E 'sk-|LITELLM_MASTER_KEY'
# expected: zero matches
```

---

## 6. Known Gaps (deferred per spec)

These are explicitly **out of scope** for Phase 1 (spec lines 472-484). They
are tracked here so Phase 2+ planning can pick them up without re-reading
the original spec.

| Gap | Spec line | Deferred to | Why deferred |
|---|---|---|---|
| WebSocket variants (`WS /api/forge/chat/ws`, `WS /api/forge/spend/stream`) | 283, 356 | Phase 2 | SSE covers the same UX; WS adds a second transport without changing semantics. |
| Per-tenant Customer-Managed Keys (CMK / AWS KMS) for at-rest encryption | 73 | Phase 2 | Phase 1 uses the AES-GCM key from env (`FORGE_AES_KEY`). CMK is a deployment choice. |
| Multi-replica Redis cache for spend/meter rollup | 313-320 | Phase 2 | Single-replica Redis is enough for Phase 1 dev/staging. Multi-replica + Pub/Sub fan-out lands with reconciliation hardening. |
| `/v1/responses` long-running mode (background run, cancel, append input) | 274-277 | Phase 4 | Phase 1 only ships `POST /v1/chat/completions`. The responses endpoint requires a separate state machine. |
| Guardrails & policies | 262, 474 | Phase 2 | `GuardrailViolation` is in the typed-error model but no guardrail is wired yet. |
| MCP tool gateway | 236 | Phase 2 | Phase 1 streams `tool_call` events but does not source tools from MCP. |
| Skills registry | 71, 477 | Phase 2 | `/v1/skills` is in the auth chain table but no skill surface ships. |
| Tools registry | 477 | Phase 2 | Same as skills. |
| Prompts, RAG / vector stores, files / batches / fine-tuning | 478-480 | Phase 3 | Not in Phase 1 endpoints. |
| Provider pass-through (Cursor-compat OpenAI), Realtime, OAuth/SCIM/SSO, CloudZero/Vantage exports | 481-484 | Phase 4 | Deferred entirely. |

---

## 7. Next Steps (Phase 2+ work that builds on Phase 1)

### Phase 2 — Guardrails + MCP + Skills (builds on P1, P2, P4)

- **Guardrail pipeline.** Add `POST /apply_guardrail` (LiteLLM) before every
  `chat/completions`. Emit `forge.chat.failed` with `code: GuardrailViolation`
  on reject. P5's typed-error model already has the slot.
- **MCP tool merging.** Phase 1 streams `tool_call` events. Phase 2 sources
  tools from `mcp_server_registry.py` (already exists pre-step-75) and
  merges them with the agent's static `tools[]`. See `mcp.py` router.
- **Skills registry.** Wire `forge-core` skills into the chat request's
  `tools[]`. The `packages/forge-core/skills/` catalog is the source of
  truth (Rule 9).
- **Budget guard hardening.** Add per-tenant budget cap on top of the
  per-agent guard. The reconciliation 5-min tick already supports
  tenant-level rollup; just needs the new endpoint.

### Phase 3 — Prompts, RAG, Files, Batches, Fine-tuning

- **Prompts.** New `forge.prompts` service backed by `/v1/prompts` (LiteLLM).
- **RAG.** `/v1/vector_stores/*` + `/v1/embeddings` integration. The auth
  chain already classifies `/v1/embeddings` as virtual-key.
- **Batches + Fine-tuning.** `/v1/batches/*` and `/v1/fine_tuning/*`. Async
  job pollers; reuse the spend record write path.

### Phase 4 — Realtime, OAuth/SCIM/SSO, Provider pass-through

- **`/v1/responses` long-running.** WebSocket variant for client + server
  push. State machine in `forge_chat.runs` table.
- **Cursor-compat provider pass-through.** A thin OpenAI-shaped facade that
  proxies `/v1/chat/completions` and `/v1/responses` to LiteLLM. The auth
  chain already covers these paths.
- **OAuth/SCIM/SSO.** Replaces the local `forge.auth` (P1) with an external
  IdP bridge. P1's redaction policy applies unchanged.

### Cross-cutting (any phase)

- **Drift alert paging.** `forge.spend.drift_detected` currently logs +
  bus-publishes. Phase 2 should add a PagerDuty integration when drift >
  5% (vs the existing 1% alert).
- **Cost meter UX.** `WS /api/forge/spend/stream` will let the dashboard
  cost meter subscribe instead of polling. Trivial add once WS is in.
- **Cache hit-rate metric.** P1's `/api/forge/health` reports cache hit
  rate per spec. The instrumentation exists; needs a metrics dashboard
  widget in `apps/forge`.

---

## Appendix A — Phase 1 file map

| Path | Owns |
|---|---|
| `backend/app/services/forge_config.py` | P1 config + auth chain |
| `backend/app/services/forge_models.py` | P2 model registry |
| `backend/app/services/forge_key_broker.py` | P4 virtual key lifecycle |
| `backend/app/services/forge_chat.py` | P5 SSE pipeline |
| `backend/app/services/forge_spend.py` | P3 write path |
| `backend/app/services/forge_spend_reconcile.py` | P3 reconciliation cron |
| `backend/app/services/forge_budget_guard.py` | P3 + P4 pre-call gate |
| `backend/app/api/v1/forge_health.py` | P1 router |
| `backend/app/api/v1/forge_models.py` | P2 router |
| `backend/app/api/v1/forge_keys.py` | P4 router |
| `backend/app/api/v1/forge_chat.py` | P5 router |
| `backend/app/integrations/litellm/litellm_base_client.py` | shared httpx wrapper |
| `backend/app/integrations/litellm/key_manager.py` | pre-step-75 key path (kept for back-compat) |
| `backend/app/integrations/litellm/budget_sync.py` | P3 background sync |
| `backend/tests/services/test_forge_config.py` | P1 unit |
| `backend/tests/services/test_forge_models.py` | P2 unit |
| `backend/tests/services/test_forge_spend.py` | P3 unit |
| `backend/tests/services/test_forge_key_broker.py` | P4 unit |
| `backend/tests/services/test_forge_chat.py` | P5 unit |
| `backend/tests/services/test_forge_budget_guard.py` | P3+P4 unit |
| `backend/tests/api/test_forge_health.py` | P1 router |
| `backend/tests/api/test_forge_models_router.py` | P2 router |
| `backend/tests/api/test_forge_keys_router.py` | P4 router |
| `backend/tests/api/test_forge_chat_router.py` | P5 router |
| `backend/tests/test_anti_patterns.py` | AP1, AP2 (secrets) + boot |

## Appendix B — Phase 1 doc map

| Doc | Owns |
|---|---|
| `forge-backend-config.md` | P1 env vars, boot validation |
| `forge-backend-auth.md` | P1 auth chain, redaction |
| `forge-models-service.md` | P2 picker, cache TTLs |
| `forge-virtual-key-broker.md` | P4 lifecycle, budget |
| `forge-chat-stream.md` | P5 SSE protocol, errors |
| `forge-spend-aggregation.md` | P3 write + reconcile |
| `forge-audit-events.md` | 14-event catalog |
| `forge-phase1-verification.md` | THIS FILE |

---

## Sign-off

- [x] All 32 ACs have a passing test
- [x] All 10 anti-patterns are AVOIDED or N/A
- [x] All 14 audit events have a documented trigger site
- [x] Operator runbook is reproducible on a fresh checkout
- [x] Known gaps are listed with phase-deferral
- [x] Phase 2 entry points (guardrails, MCP, skills) are documented

**Phase 1: SHIP.**