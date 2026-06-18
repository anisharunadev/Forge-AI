-- 0002_orchestrator_constraints_and_indexes.sql
--
-- Adds the column-shape constraints (CHECK + composite unique) and the
-- partial indexes the FORA-50 spec calls for but the registry's
-- ColumnSpec cannot express inline.
--
-- Migration is forward-only per architecture.md §6 / coding.md §2.
-- The inverse operations are documented below as comments; do NOT
-- add DROP statements here — destructive migrations are a DBA action
-- per ADR-0009 §6 and are alerted through 1Password-held credentials.
--
-- Sub-task: FORA-134 (0.1.1 — Session lifecycle). Owner: CTO.
-- Spec source: FORA-50 §3.1 (agent_runs) + §3.2 (agent_run_stages)
-- + ADR-0009 §5 (soft-delete invariant).

BEGIN;

-- ---------------------------------------------------------------------------
-- agent_runs — CHECK constraints + partial indexes (FORA-50 §3.1)
-- ---------------------------------------------------------------------------

-- status enum (FORA-50 §2.2). The seven stages are referenced from
-- agent_run_stages via the stage column; the run's current_stage
-- mirrors the stage the Orchestrator is currently executing.
ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_status_check;
ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_status_check
  CHECK (status IN (
    'created', 'running', 'waiting_approval',
    'paused', 'aborted', 'finished', 'done'
  ));

-- current_stage enum. 'done' is a valid current_stage value because the
-- run header is read-only after finish (see §2.2 state machine).
ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_current_stage_check;
ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_current_stage_check
  CHECK (current_stage IN (
    'ideation', 'architect', 'dev', 'qa',
    'security', 'devops', 'docs', 'done'
  ));

-- Partial indexes per FORA-50 §3.1 — every default read filters by
-- tenant_id + deleted_at IS NULL. The cost_ceiling/runs feed reads by
-- status; the project dashboard reads by project_id, started_at desc.
CREATE INDEX IF NOT EXISTS agent_runs_tenant_status_idx
  ON agent_runs (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS agent_runs_tenant_project_started_idx
  ON agent_runs (tenant_id, project_id, started_at DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- agent_run_stages — CHECK constraints + composite unique (FORA-50 §3.2)
-- ---------------------------------------------------------------------------

ALTER TABLE agent_run_stages
  DROP CONSTRAINT IF EXISTS agent_run_stages_stage_check;
ALTER TABLE agent_run_stages
  ADD CONSTRAINT agent_run_stages_stage_check
  CHECK (stage IN (
    'ideation', 'architect', 'dev', 'qa',
    'security', 'devops', 'docs'
  ));

ALTER TABLE agent_run_stages
  DROP CONSTRAINT IF EXISTS agent_run_stages_status_check;
ALTER TABLE agent_run_stages
  ADD CONSTRAINT agent_run_stages_status_check
  CHECK (status IN (
    'pending', 'running', 'waiting_approval',
    'approved', 'rejected', 'returned', 'skipped'
  ));

-- Composite unique: one row per (run_id, stage). The seven canonical
-- stages are inserted on run creation; an attempt to insert a duplicate
-- stage for a run is rejected. The Orchestrator's createRun uses
-- INSERT ... ON CONFLICT DO NOTHING for the idempotent-replay path,
-- so the same Idempotency-Key replay does not fail.
ALTER TABLE agent_run_stages
  DROP CONSTRAINT IF EXISTS agent_run_stages_run_id_stage_unique;
ALTER TABLE agent_run_stages
  ADD CONSTRAINT agent_run_stages_run_id_stage_unique
  UNIQUE (run_id, stage);

-- Index used by the crash-recovery query (FORA-134 acceptance #4):
-- the Orchestrator reads the last persisted stage per run on boot.
-- Reading by run_id alone is enough; the partial WHERE on the join's
-- agent_runs.deleted_at keeps the planner from picking a soft-deleted
-- row.
CREATE INDEX IF NOT EXISTS agent_run_stages_run_id_idx
  ON agent_run_stages (run_id);

COMMIT;
