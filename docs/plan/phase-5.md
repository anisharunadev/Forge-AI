# Phase 5 — Observability & SLOs

**Status:** PENDING
**Owner:** TBA
**Depends on:** Phase 1, Phase 3 (auto-generated route catalog)
**Blocks:** Phase 6, Phase 8

---

## Goal

Every public surface has an SLO. Operators see what's happening *now*, not what happened. Per-tenant OTel sampling protects noisy-neighbor effects.

## Why fifth

- OpenTelemetry auto-instrumentation already exists (per `backend/CLAUDE.md` Rule 7). The work is turning on the right knobs and surfacing the data in-product.
- The Audit Center UI exists as a page; making the audit *live* (websocket feed) is the highest-leverage observability win.
- Without SLOs, "is it fast enough?" is a vibes question. With SLOs, it's a number.

## Success Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| SC-5.1 | SLO definition file `docs/standards/slos.md` lists availability + latency target per public surface (chat, KG, ideation, forge-models, terminal, copilot) | file committed |
| SC-5.2 | For each SLO, an alert rule is wired in `backend/app/services/observability/alerts.py` | `pytest tests/observability/test_alerts.py` green |
| SC-5.3 | Per-tenant OTel sampling rate configurable; noisy tenant capped at 1% without affecting others | `tests/observability/test_sampling.py` proves isolation |
| SC-5.4 | Live audit stream over WebSocket at `/ws/audit/stream` (auth via `api.ws`) | `tests/api/test_audit_stream.py` proves end-to-end push |
| SC-5.5 | Admin UI (`apps/forge/app/admin/`) shows live audit events without page refresh | Playwright E2E test confirms |
| SC-5.6 | Cost observability: per-tenant-per-model-per-minute aggregation query in `backend/app/services/observability/cost_aggregator.py` | `pytest tests/observability/test_cost_aggregator.py` green |
| SC-5.7 | OpenTelemetry collector config committed (`infra/otel-collector.yaml`) with tenant_id as a resource attribute | config file present, validated |
| SC-5.8 | Structured logs include `tenant_id`, `project_id`, `request_id`, `actor_id` on every request | sample log line in test asserts presence |

## Tasks

### T5.1 — SLO definitions
- T5.1.1 Author `docs/standards/slos.md` with one row per public surface:
  - surface name
  - availability target (e.g. 99.9% / 30d)
  - latency p95 / p99 target
  - error rate target
  - how it's measured (which OTel span attribute, which Prometheus metric)
- T5.1.2 For each row, link to the implementing alert in T5.2.

### T5.2 — Alert rules
- T5.2.1 Write `backend/app/services/observability/alerts.py` with one alert class per SLO:
  - `ChatLatencyP95Alert(threshold_ms=2000)`
  - `KgQueryErrorRateAlert(threshold=0.01)`
  - etc.
- T5.2.2 Each alert reads from OTel metric export; emits to configured webhook (Slack/email/pagerduty).
- T5.2.3 Tests assert the alert fires when threshold breached and is silent otherwise (use `freezegun` + metric stubs).

### T5.3 — Per-tenant sampling
- T5.3.1 Configure OTel SDK `ParentBased(TraceIdRatioBased)` sampler with a custom `should_sample` that:
  - reads tenant_id from current span's attributes (or context)
  - looks up tenant's configured rate from a `tenant_settings` table (Redis-cached)
  - returns `DROP` if tenant is over its log/trace quota for the hour
- T5.3.2 Default rate: 100%. Per-tenant override via Admin UI.
- T5.3.3 Tests: two tenants; cap one at 1%; verify trace counts.

### T5.4 — Live audit stream
- T5.4.1 New WebSocket route `/ws/audit/stream` in `backend/app/api/v1/audit_stream.py`:
  - auth via JWT (use the same dependency as REST audit endpoints)
  - on connect, subscribe to Redis channel `audit:{tenant_id}`
  - each audit insert publishes to that channel
- T5.4.2 `backend/app/services/audit_service.py` extended: after `INSERT INTO audit_log`, `redis.publish(audit:{tenant_id}, json)`.
- T5.4.3 Frontend hook `apps/forge/lib/hooks/useAuditStream.ts` connects via `api.ws('/ws/audit/stream')`.
- T5.4.4 Audit Center UI replaces polling with the live feed.

### T5.5 — Admin UI live audit panel
- T5.5.1 New page `apps/forge/app/admin/audit-live/page.tsx` (or extend existing `audit/page.tsx`).
- T5.5.2 Renders the live stream with virtualization (`@tanstack/react-virtual`) — already in stack per `apps/forge/CLAUDE.md`.
- T5.5.3 Empty state explains (R15).
- T5.5.4 Playwright test: trigger an audit event via API, assert it appears in UI within 1s.

### T5.6 — Cost aggregation
- T5.6.1 Write `backend/app/services/observability/cost_aggregator.py`:
  - reads `spend_logs` (LiteLLM's table) on a 60s tick
  - groups by `(tenant_id, model, minute_bucket)`
  - upserts into `cost_minute_rollup` table
- T5.6.2 Expose `GET /forge/observability/cost?tenant_id=...&window=1h` returning minute buckets.
- T5.6.3 Tests against fixtures.

### T5.7 — OTel collector config
- T5.7.1 Author `infra/otel-collector.yaml`:
  - receivers: otlp (gRPC + HTTP)
  - processors: batch, resource (add `tenant_id`), tail_sampling
  - exporters: otlp/<backend>, logging
- T5.7.2 Validate config: `otelcol validate infra/otel-collector.yaml`.
- T5.7.3 Document in `docs/runbooks/observability.md`.

### T5.8 — Log enrichment verification
- T5.8.1 In `backend/app/core/logging.py`, verify the structlog middleware binds `tenant_id`, `project_id`, `request_id`, `actor_id`.
- T5.8.2 Add a test that issues a request, captures the log line, asserts all four fields present.

## Files Touched

| File | Action |
|------|--------|
| `docs/standards/slos.md` | create |
| `backend/app/services/observability/alerts.py` | create |
| `backend/app/services/observability/cost_aggregator.py` | create |
| `backend/app/services/observability/__init__.py` | edit (exports) |
| `backend/app/api/v1/audit_stream.py` | create |
| `backend/app/api/v1/router.py` | edit (register) |
| `backend/app/services/audit_service.py` | edit (publish to redis) |
| `backend/app/core/telemetry.py` | edit (per-tenant sampler) |
| `backend/app/core/logging.py` | edit (verify bindings) |
| `apps/forge/lib/hooks/useAuditStream.ts` | create |
| `apps/forge/app/admin/audit/page.tsx` (or audit-live/page.tsx) | edit |
| `apps/forge/tests/e2e/audit-live.spec.ts` | create |
| `infra/otel-collector.yaml` | create |
| `docs/runbooks/observability.md` | create |
| `backend/tests/observability/test_alerts.py` | create |
| `backend/tests/observability/test_sampling.py` | create |
| `backend/tests/observability/test_cost_aggregator.py` | create |
| `backend/tests/api/test_audit_stream.py` | create |

## Risks

| Risk | Mitigation |
|------|-----------|
| Live WS feed drops messages under load | Use Redis Streams (not Pub/Sub) — Streams have ack + replay; switch if Pub/Sub loses messages in load test |
| Per-tenant sampling interferes with debugging critical bugs | Add "force sample this trace" toggle via request header `x-debug-sample: true` (admin only) |
| Cost aggregator write hot-spot on `cost_minute_rollup` | Use `ON CONFLICT DO UPDATE` with proper unique index; partition by day if write rate warrants |
| SLO targets set too loose or too tight | Initial targets are conservative (99.5% / p95 3s); tune after 30d of real data |
| Alert noise floods on-call | Each alert requires a 5-minute sustained breach before firing; PagerDuty routing per severity |

## Out of Scope

- Distributed tracing UI (use existing Jaeger/Tempo backend; no UI build).
- Log search UI (use existing Loki/ES backend).
- Custom dashboards per tenant (admin-curated only at first).

## Definition of Done

- SLO doc committed.
- Alerts wired and tested.
- Live audit stream in UI.
- Per-tenant sampling proven.
- Cost aggregator live.