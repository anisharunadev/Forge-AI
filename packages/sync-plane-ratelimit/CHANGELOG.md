# Changelog

All notable changes to `@fora/sync-plane-ratelimit` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added (FORA-487.3 / FORA-517)

- **`BackoffPolicy`** — pure retry-policy calculator. Honors a
  `Retry-After` header (RFC 7231: delta-seconds OR HTTP-date) clamped
  to [floor_ms, ceiling_ms], or falls back to exponential-with-jitter:
  `min(ceiling_ms, base_ms * 2^attempt) + uniform(0, jitter_ms)` with
  defaults `base=500ms`, `jitter=250ms`, `ceiling=60s`, `floor=1ms`.
  RNG is injectable for deterministic tests.
- **`BackoffScheduler`** — retry orchestrator. Runs the platform call
  through the retry loop, persisting `(connector_id, idempotency_key) →
  {result, status}` in the `SyncOpStore` (the FORA-401 `sync_op` seam).
  Max attempts: 5 for idempotent verbs (GET), 1 for non-idempotent
  (POST/PUT/PATCH/DELETE). Audit events `connector.backoff.retried`
  and `connector.backoff.exhausted` are emitted with the per-attempt
  `backoff_ms` and the Idempotency-Key.
- **`TenantWeightedFifo<T>`** — per-tenant FIFO with round-robin drain.
  The "weighted" name is the charter's wording; the implementation is
  strict round-robin (each tenant gets one pull per cycle) — the
  simplest fairness guarantee that satisfies "high-retry tenant must
  not starve a quiet one".
- **`InMemorySyncOpStore`** — FORA-401 `sync_op` dedupe store (test
  seam). Production wires a `PgSyncOpStore` against the `sync_op`
  table from `migrations/0008_jira_adapter.sql`.
- **`uuidV7`** — RFC 9562 §5.7 UUID v7 generator. The 48-bit
  unix_ts_ms prefix gives natural FIFO ordering in B-tree indexes;
  the FORA-401 `sync_op` PRIMARY KEY `(tenant_id, idempotency_key)`
  benefits from this on replay lookups. No new transitive deps
  (uses `crypto.getRandomValues`).
- **Two new audit event types** in `SyncAuditEventType`:
  `connector.backoff.retried` and `connector.backoff.exhausted`. The
  per-attempt `backoff_ms` is on the retried payload; `attempts`,
  `final_status`, and the Idempotency-Key are on the exhausted
  payload.

### Reference

- FORA-487 charter: backoff scheduler.
- FORA-401 sync_op schema (`migrations/0008_jira_adapter.sql`).
- RFC 7231 §7.1.3 (`Retry-After`).
- RFC 9562 §5.7 (UUID v7).
