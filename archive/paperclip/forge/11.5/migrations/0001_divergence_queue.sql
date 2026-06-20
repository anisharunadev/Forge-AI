-- Migration 0001 — sync.divergence_queue (FORA-11.5 / Epic 11 — Tier 3 workbench).
-- ADR-0010 §4 Tier 3: the resolver (FORA-11.4) writes here when Tier 2 would
-- lose user-visible data; the workbench UI (this sub-task) reads from here
-- and writes resolution audit rows (event_type = sync.event.divergence_resolved_by_human).
--
-- This file is the canonical DDL the design contract in
-- forge/11.5/design.md §2 references.  The pnpm migration runner
-- applies it; the smoke test asserts the column names + types
-- match the DivergenceRow dataclass in
-- agents/sync_plane/divergence_queue.py.

CREATE TABLE IF NOT EXISTS sync.divergence_queue (
    queue_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         text NOT NULL,
    paperclip_issue_id text NOT NULL,
    remote_kind       text NOT NULL,                -- 'jira' | 'github' | 'clickup'
    remote_id         text NOT NULL,                -- native remote id (e.g. '10001')
    field_path        text NOT NULL,                -- e.g. 'title' | 'body' | 'comment.body'
    left_value        jsonb NOT NULL,
    left_hlc          text NOT NULL,                -- canonical-form 23-char HLC
    left_platform     text NOT NULL,                -- 'paperclip' | 'jira' | 'github' | 'clickup'
    right_value       jsonb NOT NULL,
    right_hlc         text NOT NULL,
    right_platform    text NOT NULL,
    detected_at       timestamptz NOT NULL DEFAULT now(),
    detected_hlc      text NOT NULL,
    reason            text NOT NULL,                -- 'hlc_skew' | 'user_data_loss' | 'tenant_policy'
    metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
    resolved_at       timestamptz,
    resolved_by       text,                         -- 'user:<uuid>' | 'agent:<uuid>' | 'system:bulk'
    resolution        text,                         -- 'left' | 'right' | 'merge'
    resolution_audit_id uuid,
    tombstoned_at     timestamptz
);

-- Tenant-scoped queue scan; the workbench always filters by tenant_id
-- and the unresolved subset.
CREATE INDEX IF NOT EXISTS divergence_queue_tenant_unresolved
    ON sync.divergence_queue (tenant_id, detected_at DESC)
    WHERE resolved_at IS NULL AND tombstoned_at IS NULL;

-- Daily-digest job: one row per (tenant, day).
CREATE INDEX IF NOT EXISTS divergence_queue_tenant_day
    ON sync.divergence_queue (tenant_id, date_trunc('day', detected_at))
    WHERE resolved_at IS NULL;

-- Bulk-pattern matching: rule lookup hits (tenant, field_path).
CREATE INDEX IF NOT EXISTS divergence_queue_field_path
    ON sync.divergence_queue (tenant_id, field_path)
    WHERE resolved_at IS NULL;

-- Bulk-pattern registry (one row per saved pattern per tenant).
CREATE TABLE IF NOT EXISTS sync.divergence_bulk_patterns (
    pattern_key   text PRIMARY KEY,
    tenant_id     text NOT NULL,
    description   text NOT NULL,
    filter        jsonb NOT NULL,                  -- { field_path?, platform?, since_iso? }
    resolution    text NOT NULL,                   -- 'left' | 'right' | 'merge'
    merge_value   jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text NOT NULL                    -- 'user:<uuid>'
);

CREATE INDEX IF NOT EXISTS divergence_bulk_patterns_tenant
    ON sync.divergence_bulk_patterns (tenant_id);

-- Per-tenant opt-out for the daily digest.
-- Schema is single-row-per-tenant; the email job reads the flag
-- before building the payload (see build_digest_payload() in
-- agents/sync_plane/divergence_queue.py).
ALTER TABLE sync.divergence_queue
    ADD COLUMN IF NOT EXISTS digest_opted_out boolean NOT NULL DEFAULT false;
