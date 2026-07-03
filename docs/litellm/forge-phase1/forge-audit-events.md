# Forge Audit Events — Phase 1 (step-75)

> **Spec:** `docs/goals/step-75.md` lines 372-379
> **Status:** Phase 1 ship target

---

## Phase 1 event catalog (spec line 374-377)

| Event | Source service | Trigger | Payload (summary) |
|---|---|---|---|
| `forge.auth.config_loaded` | `app.main.lifespan` | Once per boot, after readiness + routes discovery | `{ version, environment, otlp, route_count, master_key_present }` |
| `forge.models.refreshed` | P2 (`forge_models.ModelsService.refresh_cache`) | Admin POST or cache TTL eviction | `{ route_count, fetched_at, source_count }` |
| `forge.keys.issued` | P4 (`forge_key_broker.issue`) | Agent created or rotated | `{ agent_id, fingerprint, model_scope, max_budget_usd, alias }` |
| `forge.keys.rotated` | P4 (`forge_key_broker.rotate`) | 7-day scheduler or 80% budget threshold | `{ agent_id, old_fingerprint, new_fingerprint, reason }` |
| `forge.keys.revoked` | P4 (`forge_key_broker.revoke`) | Agent deleted or tenant offboard | `{ agent_id, fingerprint, reason }` |
| `forge.chat.started` | P5 (`forge_chat.stream_chat`) | First SSE chunk served | `{ run_id, agent_id, model, forge_run_id }` |
| `forge.chat.completed` | P5 | Final `usage` chunk served | `{ run_id, agent_id, model, prompt_tokens, completion_tokens, cost_usd }` |
| `forge.chat.cancelled` | P5 | Client disconnect or POST `/forge/chat/cancel` | `{ run_id, agent_id, reason }` |
| `forge.chat.failed` | P5 | Typed error (401/402/413/422/429/502) | `{ run_id, agent_id, code, message }` |
| `forge.spend.recorded` | P3 (`forge_spend.record_from_usage`) | Stream end within 5 s | `{ run_id, agent_id, model, prompt_tokens, completion_tokens, cost_usd, litellm_request_id }` |
| `forge.spend.reconciled` | P3 (`forge_spend_reconcile` job) | Every 5 min cron tick | `{ rows_upserted, rows_inserted, drift_count }` |
| `forge.spend.drift_detected` | P3 reconciliation | `(litellm_cost - forge_cost)/litellm_cost > 0.01` | `{ row_id, forge_cost_usd, litellm_cost_usd, drift_pct }` |
| `forge.spend.budget_warning` | P3 (`forge_budget_guard`) | Pre-call, agent at 90% budget | `{ agent_id, spent_usd, ceiling_usd, pct }` |
| `forge.spend.budget_exceeded` | P3 (`forge_budget_guard`) | Pre-call, agent at 100% budget | `{ agent_id, spent_usd, ceiling_usd }` (blocks call) |

## Transport (Phase 1)

- **Boot events** (auth, route discovery) → `logger.info("forge.auth.config_loaded", ...)` at boot. The `secret_filter` ensures no keys leak.
- **Service events** (chat, spend, keys, models) → `event_bus.publish()` once each new `EventType` enum member is added in its phase. Phase 1 ships the enum member for `FORGE_AUTH_CONFIG_LOADED` only; Phases 2-5 add their own.
- **Reconciliation events** → log + event_bus (so cron jobs are observable from both the log feed and the event bus feed).

ponytail: Phase 1 does NOT add all 12 enum members upfront. Each phase adds its own members when it introduces the emitter site. This keeps the diff per phase small and the enum member co-located with its source.

## Envelope

Every event (logging or bus) carries:

```json
{
  "event_id": "uuid-v7",
  "ts": "2026-07-02T12:34:56.789Z",
  "tenant_id": "<uuid>",
  "agent_id": "<uuid or null>",
  "user_id": "<uuid or null>",
  "request_id": "uuid-v7 (X-Forge-Request-Id)",
  "payload_summary": "<1-line>",
  "duration_ms": 0,
  "status": "ok | warn | fail"
}
```

Boot events use a system-tenant pseudo-id (`"00000000-0000-0000-0000-000000000000"`) since there's no request context yet.

## Audit retention

Phase 1 ships log-based retention. The `audit_log` SQL table (existing pre-step-75) is populated by `audit_service.record()`. Phase 2 adds the `forge.auth.config_loaded` event to the typed bus + audit_log dual-write path.
