-- 0004_agent_run_approvals.sql
--
-- Approval store (FORA-50 §3.4 + ADR-0008 §3).
--
-- Every gate transition writes a row here BEFORE issuing the
-- Paperclip interaction. The unique (run_id, gate_kind) makes a
-- stale-target re-issue land as a NEW row (with `:rev{N}` stamped on
-- the idempotency key in the Paperclip card), while a retry of the
-- same gate hits the unique index and is rejected. The row carries:
--
--   - `paperclip_interaction_id` — the id of the card the human acts
--     on. The router re-issues and stamps a new id on stale-target
--     recovery; the previous id is kept in `superseded_interaction_id`.
--   - `decided_by` and `decision` — accept / reject / request_changes.
--     `request_changes` rows are NOT terminal — the run loops back
--     and a fresh row is inserted for the new gate; the old row's
--     status stays `rejected` per ADR-0008 §6.
--   - `expires_at` — sweeper window. 50% pages once, 100% expires and
--     pauses the run.
--   - `paged_at_50_percent` — sweeper dedupe flag.
--   - `deleted_at` — ADR-0009 §6 soft-delete.
--
-- The 50% / 100% sweeper queries index by (status, expires_at) where
-- status = 'pending' so the sweeper does not scan terminal rows.
--
-- Sub-task: FORA-137 (0.1.4 — Human-approval router). Owner: CTO.
-- Spec source: FORA-50 §3.4 + ADR-0008.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_run_approvals (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id                      uuid        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,

  -- The stage that owns the row. NULL only for the launch gate (the
  -- board approval runs against the run header, not a stage row).
  -- `stage` is checked against the seven canonical stages; the launch
  -- gate's NULL is allowed because the unique constraint (run_id,
  -- gate_kind) handles the disambiguation.
  stage                       text        CHECK (stage IS NULL OR stage IN (
                                  'ideation', 'architect', 'dev', 'qa',
                                  'security', 'devops', 'docs'
                                )),

  -- The gate that wrote the row. Mirrors the typed gate table in
  -- apps/orchestrator/src/gates.ts (FORA-50 §6.1). Storing the kind
  -- as text keeps the audit trail readable; an unexpected value
  -- fails at the JS layer (router.ts throws `unknown gate`).
  gate_kind                   text        NOT NULL CHECK (gate_kind IN (
                                  'ideation->architect', 'architect->dev',
                                  'dev->qa', 'qa->security',
                                  'security->devops', 'devops->docs',
                                  'docs->done', 'launch'
                                )),

  -- The role of record per the gate table (qa / security / devops /
  -- cto / ceo / board). Stored so the sweeper can page the right
  -- role without a join.
  required_role               text        NOT NULL CHECK (required_role IN (
                                  'pm', 'cto', 'ceo', 'qa',
                                  'security', 'devops', 'docs',
                                  'engineer', 'board'
                                )),

  -- Lifecycle status. `pending` is the only state the sweeper acts on.
  status                      text        NOT NULL CHECK (status IN (
                                  'pending', 'approved', 'rejected', 'expired'
                                )),

  -- The id of the Paperclip interaction the human acts on. The
  -- stale-target recovery (ADR-0008 §5) re-issues and stamps a new
  -- id; the previous id moves to `superseded_interaction_id`.
  paperclip_interaction_id    text,

  -- Artefacts the human is being asked to approve (PR url, ADR path,
  -- scan report). jsonb; the JS layer validates the shape via zod.
  artefact_refs               jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- Free-form reason recorded on the row at insertion.
  reason                      text,

  requested_at                timestamptz NOT NULL DEFAULT now(),
  decided_at                  timestamptz,
  -- jsonb: { actor: string; role: RoleOfRecord | 'board' }
  decided_by                  jsonb,
  decision                    text        CHECK (decision IS NULL OR decision IN (
                                  'accept', 'reject', 'request_changes'
                                )),

  -- Sweeper window. Indexed for the 50% / 100% tick.
  expires_at                  timestamptz NOT NULL,

  -- Sweeper dedupe flag (ADR-0008 §4 step 7 — "page once").
  paged_at_50_percent         boolean     NOT NULL DEFAULT false,

  -- Audit chain. Set by stale-target recovery (ADR-0008 §5); NULL on
  -- the original issue. A re-recovery would chain again (rev2's
  -- superseded is rev1's id, etc.).
  superseded_interaction_id   text,

  deleted_at                  timestamptz,

  -- One open row per (run, gate). Re-issue of a different revision
  -- bumps `paperclip_interaction_id` on the SAME row (the row is the
  -- durable handle); re-issue on the same revision is rejected by
  -- the unique index and the JS layer recognises it as a no-op.
  -- A terminal row (approved/rejected/expired) is NOT deleted, so
  -- the unique applies only to non-terminal rows.
  CONSTRAINT agent_run_approvals_run_gate_pending_unique
    EXCLUDE (run_id WITH =, gate_kind WITH =)
    WHERE (status = 'pending' AND deleted_at IS NULL)
);

-- Sweeper hot loop: every pending row for a tenant whose TTL is due.
-- Partial WHERE on status='pending' keeps the index small.
CREATE INDEX IF NOT EXISTS agent_run_approvals_sweep_idx
  ON agent_run_approvals (tenant_id, expires_at)
  WHERE status = 'pending' AND deleted_at IS NULL;

-- Lookup by run for the audit trail ("which approvals were raised
-- for this run?"). Soft-delete-invariant per ADR-0009 §6.
CREATE INDEX IF NOT EXISTS agent_run_approvals_run_id_idx
  ON agent_run_approvals (run_id)
  WHERE deleted_at IS NULL;

-- Lookup by interaction id. The router uses this on wake to find the
-- row when Paperclip hands back `paperclip_interaction_id` instead of
-- an approval id (rare; the wake payload should carry the approval id,
-- but the interaction id is the durable handle).
CREATE INDEX IF NOT EXISTS agent_run_approvals_interaction_id_idx
  ON agent_run_approvals (paperclip_interaction_id)
  WHERE paperclip_interaction_id IS NOT NULL AND deleted_at IS NULL;

COMMIT;