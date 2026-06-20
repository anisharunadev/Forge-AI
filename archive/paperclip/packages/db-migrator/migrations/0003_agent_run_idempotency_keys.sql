-- 0003_agent_run_idempotency_keys.sql
--
-- Idempotency-key store (FORA-50 §4.1 + architecture.md §7).
--
-- Every mutating endpoint accepts an `Idempotency-Key` header (UUID v4
-- per rev 2 editorial). The store is the dedupe index: the unique
-- (tenant_id, key) makes a duplicate write surface as a constraint
-- violation, which the Orchestrator maps to a replay-or-conflict
-- decision.
--
-- The record holds the response status + body that was returned on
-- the first call, plus a SHA-256 fingerprint of the canonical request
-- body. A replay with the same key + same fingerprint returns the
-- cached response; a replay with the same key + a different
-- fingerprint returns HTTP 409 IDEMPOTENCY_CONFLICT.
--
-- The table is NOT tenant-scoped through the standard registry because
-- it has no `created_at` semantics that match the lifecycle (a
-- retention job will TTL the rows after 7 days in v1; see ADR-0009
-- retention defaults for the run tables).
--
-- Sub-task: FORA-134 (0.1.1 — Session lifecycle). Owner: CTO.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_run_idempotency_keys (
  key                  text        NOT NULL,
  tenant_id            uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- run_id is nullable: a request can be idempotent-tracked before
  -- the run exists (e.g. a retry of POST /v1/runs after the first
  -- call already committed). ON DELETE SET NULL — soft-deleting the
  -- run keeps the idempotency record for replay; hard-deleting the
  -- tenant cascades.
  run_id               uuid        REFERENCES agent_runs(id) ON DELETE SET NULL,
  -- request_fingerprint is a SHA-256 hex digest of the canonical
  -- request body (sorted keys, no whitespace). Computed in JS.
  request_fingerprint  text        NOT NULL,
  response_status      integer     NOT NULL,
  response_body        jsonb       NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

-- Lookup by run id for the audit trail ("which idempotency keys
-- were used to mutate this run?"). Partial WHERE matches the
-- soft-delete-invariant read pattern (run id is set).
CREATE INDEX IF NOT EXISTS agent_run_idempotency_keys_run_id_idx
  ON agent_run_idempotency_keys (run_id)
  WHERE run_id IS NOT NULL;

COMMIT;
