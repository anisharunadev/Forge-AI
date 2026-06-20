-- 0005_sync_plane.sql
--
-- Sync Plane canonical state tables (FORA-252 / Epic 11.1).
--
-- Per ADR-0010 §3 the Sync Plane owns four `sync.*` tables for
-- canonical state. Per-tenant partitioning is enforced at the
-- PRIMARY KEY (every table is keyed on tenant_id first) so a
-- `SET LOCAL app.tenant_id = '<claim.tenant_id>'` from the
-- `TenantAwarePool` (FORA-126) plus the FORCE ROW LEVEL
-- SECURITY migration (forthcoming in 0006) give us the
-- per-tenant boundary.
--
-- The four tables:
--
--   sync.entity              — one row per synced logical entity
--   sync.canonical_comment   — the §6.1 canonical comment envelope
--   sync.hlc_clock           — last HLC per (tenant, consumer) for
--                              boot-time hydration
--   sync.divergence_queue    — Tier-3 unresolved candidates for
--                              the human workbench (11.5)
--
-- Migration is forward-only per architecture.md §6 / coding.md §2.
-- The inverse operations are documented as comments — DROP
-- statements are DBA actions per ADR-0009 §6 and are alerted
-- through 1Password-held credentials.
--
-- Sub-task: FORA-252 (11.1). Spec source: ADR-0010 §3 / §4 /
-- §7.1 / §8.1. Migration location follows the pattern in
-- `packages/db-migrator/migrations/0001_migration_role.sql`.

BEGIN;

-- ---------------------------------------------------------------------------
-- sync.entity — one row per synced logical entity (FORA-252 AC #3)
-- ---------------------------------------------------------------------------
--
-- Per-tenant partitioning key: (tenant_id, entity_id).
-- `entity_id` is Paperclip-issued and stable across platforms
-- (ADR-0010 §6.1).
--
-- `last_hlc` is the HLC of the most recent accepted write. The
-- §4 Tier 2 invariant — the store refuses to overwrite a
-- forward-progressed row with a stale HLC — is enforced at the
-- application layer; the unique index on (tenant_id, entity_id)
-- is the dedupe boundary.
--
-- `remote_refs` carries the per-platform id map (e.g.
-- {"jira": "10001", "github": "ic_kdoiw", "clickup": "abc"}).
-- Kept as JSONB for v0.1 — a normalised per-platform table is
-- a v0.2 conversation once we know the query shape.
--
-- `kind` is the EntityKind enum (issue / run_status /
-- interaction / comment). Closed enum in v1; a new kind is a
-- forward migration.
CREATE TABLE IF NOT EXISTS sync.entity (
  tenant_id        TEXT        NOT NULL,
  entity_id        TEXT        NOT NULL,
  kind             TEXT        NOT NULL
                   CHECK (kind IN ('issue', 'run_status',
                                   'interaction', 'comment')),
  remote_refs      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  last_hlc         TEXT        NOT NULL DEFAULT '',
  last_event_id    TEXT        NOT NULL DEFAULT '',
  created_hlc      TEXT        NOT NULL DEFAULT '',
  updated_hlc      TEXT        NOT NULL DEFAULT '',
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity_id)
);

-- Partial index used by the daily divergence job (11.7) to
-- enumerate entities per tenant.
CREATE INDEX IF NOT EXISTS sync_entity_tenant_updated_idx
  ON sync.entity (tenant_id, updated_at DESC);

-- Index for the "find by remote_ref" query — the platform
-- adapter asks "do I already have a Paperclip-side entity for
-- this Jira id?". The GIN index on remote_refs is the cheap
-- path; the exact-match lookup is O(log n) on the GIN.
CREATE INDEX IF NOT EXISTS sync_entity_remote_refs_gin
  ON sync.entity USING GIN (remote_refs jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- sync.canonical_comment — the §6.1 canonical comment envelope
-- (FORA-252 AC #3)
-- ---------------------------------------------------------------------------
--
-- `comment_id` is Paperclip-issued and stable across all
-- platforms (ADR-0010 §6.1). The remote ids are in
-- `remote_refs` keyed by platform; the per-platform rendered
-- body (ADF / GFM / ClickUp MD) lives in `body_remote_rendered`
-- and is re-rendered on edit.
--
-- `created_hlc` / `edited_hlc` / `deleted_hlc` are the
-- canonical event timestamps; the §6.3 threading
-- reconstruction uses them to flatten/rebuild the remote
-- thread shape.
--
-- `in_reply_to` is the parent comment_id (the §6.3
-- `in_reply_to` cross-ref). Empty for top-level comments.
CREATE TABLE IF NOT EXISTS sync.canonical_comment (
  tenant_id              TEXT        NOT NULL,
  comment_id             TEXT        NOT NULL,
  paperclip_issue_id     TEXT        NOT NULL,
  author_kind            TEXT        NOT NULL
                         CHECK (author_kind IN
                                ('agent', 'user', 'board', 'system')),
  author_id              TEXT        NOT NULL,
  author_display_name    TEXT        NOT NULL DEFAULT '',
  body_md                TEXT        NOT NULL,
  remote_refs            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  body_remote_rendered   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_hlc            TEXT        NOT NULL DEFAULT '',
  edited_hlc             TEXT        NOT NULL DEFAULT '',
  deleted_hlc            TEXT        NOT NULL DEFAULT '',
  visibility             TEXT        NOT NULL DEFAULT 'tenant'
                         CHECK (visibility IN ('tenant', 'internal')),
  in_reply_to            TEXT        NOT NULL DEFAULT '',
  metadata               JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, comment_id)
);

-- Index for the §6.3 thread-reconstruction query: list every
-- canonical comment for a (tenant, issue) in HLC order.
CREATE INDEX IF NOT EXISTS sync_canonical_comment_issue_hlc_idx
  ON sync.canonical_comment
  (tenant_id, paperclip_issue_id, created_hlc);

-- ---------------------------------------------------------------------------
-- sync.hlc_clock — last HLC per (tenant, consumer) for
-- boot-time hydration (FORA-252 AC #4)
-- ---------------------------------------------------------------------------
--
-- One row per (tenant, consumer) pair. The `consumer` segment
-- names the downstream consumer (e.g.
-- `jira_mirror_writer`, `github_mirror_writer`); a service
-- restart hydrates the in-process HLC from this row to keep
-- the clock monotonic across processes.
--
-- The PRIMARY KEY on (tenant_id, consumer) is the dedupe
-- boundary; the `last_physical_ms` column is a denormalised
-- copy for the daily skew-monitor query (R-SYNC-06 from the
-- risk register).
CREATE TABLE IF NOT EXISTS sync.hlc_clock (
  tenant_id          TEXT        NOT NULL,
  consumer           TEXT        NOT NULL,
  last_hlc           TEXT        NOT NULL,
  last_physical_ms   BIGINT      NOT NULL DEFAULT 0,
  last_updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, consumer)
);

-- Partial index for the clock-monitor query (R-SYNC-06):
-- "show me every consumer whose last_physical_ms is more than
-- 5s behind wall-clock-now()". The query is hot in the
-- daily skew report; the index keeps it cheap.
CREATE INDEX IF NOT EXISTS sync_hlc_clock_tenant_phys_idx
  ON sync.hlc_clock (tenant_id, last_physical_ms);

-- ---------------------------------------------------------------------------
-- sync.divergence_queue — Tier-3 unresolved candidates
-- (FORA-252 AC #3)
-- ---------------------------------------------------------------------------
--
-- One row per unresolved Tier-3 conflict. The workbench
-- (sub-task 11.5) reads from this table to render the
-- resolution UI; the audit forwarder (sub-task 11.8) emits
-- `event.divergence_detected` on insert and
-- `event.divergence_resolved` on human resolution.
--
-- `winner_*` / `loser_*` is the LWW pair from the Tier 2
-- resolver; the workbench shows both values and lets the
-- human override the auto-resolution.
--
-- `resolved` defaults to FALSE; the partial index
-- `WHERE NOT resolved` is the workbench's read path.
CREATE TABLE IF NOT EXISTS sync.divergence_queue (
  tenant_id        TEXT        NOT NULL,
  entity_id        TEXT        NOT NULL,
  field            TEXT        NOT NULL,
  winner_platform  TEXT        NOT NULL,
  loser_platform   TEXT        NOT NULL,
  winner_value     JSONB       NOT NULL,
  loser_value      JSONB       NOT NULL,
  winner_hlc       TEXT        NOT NULL,
  loser_hlc        TEXT        NOT NULL,
  reason           TEXT        NOT NULL,
  detected_hlc     TEXT        NOT NULL DEFAULT '',
  detected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved         BOOLEAN     NOT NULL DEFAULT FALSE,
  resolution       TEXT        NOT NULL DEFAULT '',
  resolver         TEXT        NOT NULL DEFAULT '',
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, entity_id, field)
);

-- Partial index for the workbench's read path: list pending
-- divergences per tenant, newest first.
CREATE INDEX IF NOT EXISTS sync_divergence_queue_pending_idx
  ON sync.divergence_queue (tenant_id, detected_at DESC)
  WHERE NOT resolved;

-- ---------------------------------------------------------------------------
-- Row-Level Security (FORA-126 tenancy pattern)
-- ---------------------------------------------------------------------------
--
-- Per the FORA-126 / 0.7.2a tenancy pattern, every `sync.*`
-- table is FORCE'd to RLS and the policy binds reads + writes
-- to `current_setting('app.tenant_id')`. The
-- `TenantAwarePool` (packages/db-pool) sets the GUC on every
-- checkout, so a stray cross-tenant query is rejected at the
-- DB layer (defence in depth on top of the application-level
-- tenant_id check in the service).
--
-- The migration role (0001) holds BYPASSRLS so it can create
-- the table; the application role (the runtime) does not.
-- Per ADR-0003 §4.2 this is the runtime gate; the
-- application-level check in the service is the first gate.

ALTER TABLE sync.entity              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.entity              FORCE  ROW LEVEL SECURITY;
ALTER TABLE sync.canonical_comment   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.canonical_comment   FORCE  ROW LEVEL SECURITY;
ALTER TABLE sync.hlc_clock           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.hlc_clock           FORCE  ROW LEVEL SECURITY;
ALTER TABLE sync.divergence_queue    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.divergence_queue    FORCE  ROW LEVEL SECURITY;

-- The policy: every row must match the GUC `app.tenant_id`.
-- The sentinel (00000000-0000-0000-0000-000000000000) is
-- the unbound state; rows never carry that tenant_id, so
-- the policy is a deny-by-default on a missed GUC set.
DROP POLICY IF EXISTS sync_entity_tenant_isolation ON sync.entity;
CREATE POLICY sync_entity_tenant_isolation ON sync.entity
  USING       (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', TRUE));

DROP POLICY IF EXISTS sync_canonical_comment_tenant_isolation
  ON sync.canonical_comment;
CREATE POLICY sync_canonical_comment_tenant_isolation
  ON sync.canonical_comment
  USING       (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', TRUE));

DROP POLICY IF EXISTS sync_hlc_clock_tenant_isolation
  ON sync.hlc_clock;
CREATE POLICY sync_hlc_clock_tenant_isolation
  ON sync.hlc_clock
  USING       (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', TRUE));

DROP POLICY IF EXISTS sync_divergence_queue_tenant_isolation
  ON sync.divergence_queue;
CREATE POLICY sync_divergence_queue_tenant_isolation
  ON sync.divergence_queue
  USING       (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', TRUE));

COMMIT;
