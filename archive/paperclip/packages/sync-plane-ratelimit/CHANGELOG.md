# Changelog

All notable changes to `@fora/sync-plane-ratelimit` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.3.0 — 2026-06-20 (FORA-487.2 / FORA-516)

### Added

- **Three-layer rate limiter + per-actor burst control** replacing the
  v0.1 4-layer orchestrator. Layer order in `enqueue()`:
  1. Per-actor burst — `(actor_id, connector_id)` token bucket,
     size=10, refill=5/s (FORA-487 Layer 4 / per-actor burst).
  2. Layer 1 — provider ceiling — `(connector_id, auth_method, scope)`
     token bucket keyed off `X-RateLimit-Limit`/`X-RateLimit-Remaining`
     headers and `Retry-After`, with a static ceilings registry
     (GitHub 5000/hr, Jira 100/min, Slack 1/sec/channel-tier).
  3. Layer 2 — per-tenant quota — `TierTable` with Trial / Standard /
     Enterprise defaults (30/300/3000 RPM, 4/16/64 concurrent). Project
     overrides may **lower** the cap but never raise.
  4. Layer 3 — circuit breaker — per `(connector_id, tenant_id)` with
     `mode: 'both'` (consecutive-failure + failure-ratio) and
     exponential backoff on repeated half-open failures
     (30s → 60s → 120s → 240s → 300s cap).
- **`ActorBucketRegistry`** — per-actor burst control primitive with
  per-actor capacity and refill.
- **Half-open probe bypass for tenant quota**: when the breaker has
  just transitioned `open → half_open` (cooldown elapsed), the probe
  bypasses tenant RPM/max_concurrent so a tripped connector can be
  health-checked even when its tenant is rate-limited. Without this
  bypass a back-logged tenant would indefinitely block recovery.
- **Failure-ratio breaker mode** (50% over 20 calls default). Combined
  with consecutive-failure mode under `mode: 'both'` for the default
  defensive posture.
- **Three new audit event types**: `connector.circuit.opened`,
  `connector.circuit.half_open`, `connector.circuit.closed`. The v0.2
  audit taxonomy (FORA-487.1) is preserved on `connector.rate_limit.*`.

### Changed

- **Default tier for unknown tenants is now Enterprise** (was Trial in
  v0.1). Callers must explicitly `setTenantTier(tenant, 'trial' | 'standard')`
  to apply a stricter quota. Rationale: FORA-487 charter treats
  Enterprise as the default operating tier; Trial is opt-in for new
  connectors; v0.1's strict Trial default was incompatible with the
  Layer 3 failure-ratio detection path (a tripped connector needs to
  observe enough outcomes to trip on ratio, which Trial's capacity=1
  per-minute prevented).

### Tests

- `src/__tests__/outbound.test.ts` — 11 ACs covering provider ceiling,
  trial tier, project override, failure_ratio trip, exp backoff,
  per-actor burst, consumed emission, coalescer, tenant isolation,
  half_open audit, legacy platform pause.
- `src/__tests__/circuit_breaker.test.ts` — 5 ACs including v0.3 exp
  backoff on repeated probe failures.
- `src/__tests__/tier_table.test.ts` — updated default-tenant test to
  reflect Enterprise fallback.

## Unreleased

### Added (Forge AI-487.3 / Forge AI-517)

- **`BackoffPolicy`** — pure retry-policy calculator. Honors a
  `Retry-After` header (RFC 7231: delta-seconds OR HTTP-date) clamped
  to [floor_ms, ceiling_ms], or falls back to exponential-with-jitter:
  `min(ceiling_ms, base_ms * 2^attempt) + uniform(0, jitter_ms)` with
  defaults `base=500ms`, `jitter=250ms`, `ceiling=60s`, `floor=1ms`.
  RNG is injectable for deterministic tests.
- **`BackoffScheduler`** — retry orchestrator. Runs the platform call
  through the retry loop, persisting `(connector_id, idempotency_key) →
  {result, status}` in the `SyncOpStore` (the Forge AI-401 `sync_op` seam).
  Max attempts: 5 for idempotent verbs (GET), 1 for non-idempotent
  (POST/PUT/PATCH/DELETE). Audit events `connector.backoff.retried`
  and `connector.backoff.exhausted` are emitted with the per-attempt
  `backoff_ms` and the Idempotency-Key.
- **`TenantWeightedFifo<T>`** — per-tenant FIFO with round-robin drain.
  The "weighted" name is the charter's wording; the implementation is
  strict round-robin (each tenant gets one pull per cycle) — the
  simplest fairness guarantee that satisfies "high-retry tenant must
  not starve a quiet one".
- **`InMemorySyncOpStore`** — Forge AI-401 `sync_op` dedupe store (test
  seam). Production wires a `PgSyncOpStore` against the `sync_op`
  table from `migrations/0008_jira_adapter.sql`.
- **`uuidV7`** — RFC 9562 §5.7 UUID v7 generator. The 48-bit
  unix_ts_ms prefix gives natural FIFO ordering in B-tree indexes;
  the Forge AI-401 `sync_op` PRIMARY KEY `(tenant_id, idempotency_key)`
  benefits from this on replay lookups. No new transitive deps
  (uses `crypto.getRandomValues`).
- **Two new audit event types** in `SyncAuditEventType`:
  `connector.backoff.retried` and `connector.backoff.exhausted`. The
  per-attempt `backoff_ms` is on the retried payload; `attempts`,
  `final_status`, and the Idempotency-Key are on the exhausted
  payload.

### Reference

- Forge AI-487 charter: backoff scheduler.
- Forge AI-401 sync_op schema (`migrations/0008_jira_adapter.sql`).
- RFC 7231 §7.1.3 (`Retry-After`).
- RFC 9562 §5.7 (UUID v7).
