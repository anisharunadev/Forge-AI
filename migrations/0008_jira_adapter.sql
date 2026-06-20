-- Migration 0008 — jira-adapter (FORA-200.5 / Epic 11.2a — Idempotency spine)
--
-- The idempotency spine is the dedupe primitive every downstream
-- Jira adapter operation depends on. Two tables:
--
--   sync_op — every (outbound + inbound) adapter operation lands
--             here BEFORE it runs the side effect. The PRIMARY KEY
--             `(tenant_id, external_id, op_kind)` is the dedupe
--             index; `INSERT ... ON CONFLICT DO NOTHING` is the
--             at-most-once primitive.
--
--             `external_id` is the platform-native identifier
--             (`paperclip:<issueId>`, `jira:<issueKey>`,
--             `webhookEvent:<id>`). `op_kind` is one of the six
--             FORA-200 v0.1 operations:
--               - 'issue.create'
--               - 'issue.update'
--               - 'comment.create'
--               - 'comment.update'
--               - 'stage.transition'
--               - 'webhook.received'
--
--             The first successful claim inserts a row carrying
--             `claimed_at`, the actor (FORA-253 envelope), and
--             the source/target reference (e.g.
--             `source='paperclip:issue/123'`,
--             `target='jira:issue/PROJ-456'`). The replay
--             of the same key fails the unique constraint and
--             the adapter skips the side effect.
--
--   webhook_dedupe — the FIRST gate on every inbound Jira
--                    webhook. Jira Cloud provides a globally
--                    unique `webhookEvent.id` per delivery; the
--                    adapter checks `(tenant_id, webhook_event_id)`
--                    BEFORE the HMAC-SHA256 signature even gets
--                    evaluated. A replay of the same delivery id
--                    short-circuits with `200 OK` and emits
--                    `sync.source.webhook.fail` with `reason=duplicate`.
--
--                    The PRIMARY KEY is `(tenant_id, webhook_event_id)`
--                    and `received_at` is the wall-clock time the
--                    adapter first saw the delivery (kept for
--                    FORA-204 audit-trail purposes — see §6 risk
--                    "Webhook secret rotation").
--
-- Per-tenant isolation (FORA-126 / 0.7.2a):
--   - `tenant_id` is the first column of every PRIMARY KEY so the
--     `TenantAwarePool` (FORA-163) plus `SET LOCAL app.tenant_id`
--     binds every read/write to the verified broker claim.
--   - FORCE ROW LEVEL SECURITY + a per-table policy mirrors the
--     pattern from migration 0005. The migration role holds
--     BYPASSRLS (granted in 0001); the runtime role does not.
--
-- Forward-only per architecture.md §6 / coding.md §2. Inverse
-- operations are documented as comments; DROP is a DBA action per
-- ADR-0009 §6 and uses 1Password-held credentials.
--
-- Sub-task: FORA-401 (FORA-200.5 — Idempotency spine). Owner:
-- IntegrationEngineer. Spec source: FORA-200 v0.1 plan §3
-- "Idempotency spine" + §4 "Verification bar".

BEGIN;

-- ---------------------------------------------------------------------------
-- sync_op — one row per (tenant, external_id, op_kind) op application.
-- ---------------------------------------------------------------------------
--
-- The `op_kind` enum is closed in v0.1 (six values from FORA-200 §3
-- "Idempotency spine"); a new op_kind is a forward migration. The
-- CHECK constraint rejects typos at the DB layer — defence in depth
-- on top of the JS-level zod enum.
--
-- `outcome` is set when the op completes ('ok' | 'fail'); NULL while
-- the op is in flight. The adapter emits a `sync.{source,target}.{ok,fail}`
-- audit event exactly once per successful `claim()` (audit.ts).
--
-- `claimed_by` is the FORA-253 author-envelope actor that ran the
-- claim (`user:<idp-id>` or `agent:<type>:<run-id>`); `claimed_at`
-- is the wall-clock time the claim was first taken.
CREATE TABLE IF NOT EXISTS sync_op (
  tenant_id     TEXT        NOT NULL,
  external_id   TEXT        NOT NULL,
  op_kind       TEXT        NOT NULL
                CHECK (op_kind IN (
                  'issue.create',
                  'issue.update',
                  'comment.create',
                  'comment.update',
                  'stage.transition',
                  'webhook.received'
                )),
  outcome       TEXT        CHECK (outcome IS NULL OR outcome IN ('ok', 'fail')),
  source        TEXT        NOT NULL DEFAULT '',
  target        TEXT        NOT NULL DEFAULT '',
  claimed_by    TEXT        NOT NULL DEFAULT '',
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, external_id, op_kind)
);

-- Hot lookup: list every op applied to a given (tenant, source)
-- reference for the audit-trail view. The `source` reference is
-- the Paperclip-issued identifier (`paperclip:<scope>:<id>`) per
-- FORA-200 §3; the partial WHERE keeps the index narrow when
-- source is populated (the common case for outbound ops).
CREATE INDEX IF NOT EXISTS sync_op_source_idx
  ON sync_op (tenant_id, source)
  WHERE source <> '';

-- Hot lookup: every op whose target is a given Jira-side
-- identifier (e.g. `jira:issue/PROJ-123`). Used by the inbound
-- replay path when the webhook dedupe table misses but the
-- sync_op dedupe catches a re-applied outbound write.
CREATE INDEX IF NOT EXISTS sync_op_target_idx
  ON sync_op (tenant_id, target)
  WHERE target <> '';

-- Stuck-op sweeper hot loop: ops that are still in-flight
-- past the SLA. The adapter updates `outcome` + `completed_at`
-- on completion; ops that crash mid-flight are surfaced here
-- for the FORA-406 nightly divergence cron.
CREATE INDEX IF NOT EXISTS sync_op_pending_idx
  ON sync_op (tenant_id, claimed_at)
  WHERE outcome IS NULL;

-- ---------------------------------------------------------------------------
-- webhook_dedupe — Jira inbound delivery dedupe (FORA-200.5).
-- ---------------------------------------------------------------------------
--
-- One row per (tenant, webhook_event_id). The PRIMARY KEY is the
-- dedupe index; the adapter's `webhook.received` claim path checks
-- here BEFORE evaluating the HMAC signature, so a replay of a
-- legitimately-signed but already-applied delivery short-circuits
-- with `200 OK` and no side effect.
--
-- `received_at` is the wall-clock first-seen time (kept for the
-- FORA-204 audit-trail view). `source_event` is the canonical
-- `webhookEvent.id` string we received verbatim from Jira; we
-- keep it on the row so a future secret-rotation routine can
-- reconcile deliveries against the upstream audit log without
-- a separate JOIN.
--
-- The `processed_at` column is set when the adapter finishes
-- applying the delivery (after the sync_op `webhook.received`
-- row is committed). NULL means "seen but not yet applied" —
-- these rows are the FORA-204 §6 risk "Webhook secret rotation"
-- stuck-delivery view.
CREATE TABLE IF NOT EXISTS webhook_dedupe (
  tenant_id        TEXT        NOT NULL,
  webhook_event_id TEXT        NOT NULL,
  source_event     TEXT        NOT NULL DEFAULT '',
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at     TIMESTAMPTZ,
  outcome          TEXT        CHECK (outcome IS NULL OR outcome IN ('ok', 'fail')),
  PRIMARY KEY (tenant_id, webhook_event_id)
);

-- Stuck-webhook sweeper hot loop: deliveries that are seen but
-- not yet processed (e.g. adapter crashed mid-application).
-- Partial WHERE matches the FORA-406 nightly cron read pattern.
CREATE INDEX IF NOT EXISTS webhook_dedupe_pending_idx
  ON webhook_dedupe (tenant_id, received_at)
  WHERE processed_at IS NULL;

-- ---------------------------------------------------------------------------
-- Row-Level Security (FORA-126 / 0.7.2a tenancy pattern).
-- ---------------------------------------------------------------------------
--
-- Per the FORA-126 / 0.7.2a tenancy pattern, both tables are
-- FORCE'd to RLS and the policy binds reads + writes to
-- `current_setting('app.tenant_id')`. The `TenantAwarePool`
-- (packages/db-pool) sets the GUC on every checkout, so a stray
-- cross-tenant query is rejected at the DB layer (defence in
-- depth on top of the application-level tenant_id check in the
-- adapter).
--
-- The migration role (0001) holds BYPASSRLS so it can create the
-- table; the application role (the runtime) does not. Per
-- ADR-0003 §4.2 this is the runtime gate; the application-level
-- check in the adapter is the first gate.
ALTER TABLE sync_op        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_op        FORCE  ROW LEVEL SECURITY;
ALTER TABLE webhook_dedupe ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_dedupe FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_op_tenant_isolation ON sync_op;
CREATE POLICY sync_op_tenant_isolation ON sync_op
  USING       (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', TRUE));

DROP POLICY IF EXISTS webhook_dedupe_tenant_isolation ON webhook_dedupe;
CREATE POLICY webhook_dedupe_tenant_isolation ON webhook_dedupe
  USING       (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', TRUE));

COMMIT;