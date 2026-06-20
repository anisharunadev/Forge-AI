-- 0005_agent_run_stages_unique_constraint.sql
--
-- Adds the composite UNIQUE (run_id, stage) constraint on
-- agent_run_stages that migration 0002 documents in its header but
-- did not actually apply to the running DB. The constraint is
-- required for the demo-run seed in scripts/dev-up.sh (FORA-378)
-- and for the Orchestrator's createRun replay-safety contract
-- (FORA-50 §3.2 + §10 acceptance bar #4).
--
-- Forward-only per architecture.md §6 / coding.md §2.
--
-- Sub-task: FORA-382 (clean-laptop verification). Owner: CTO.
-- Spec source: packages/db-migrator/migrations/0002 header
-- ("agent_run_stages — CHECK constraints + composite unique").

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'agent_run_stages_run_id_stage_unique'
       AND conrelid = 'public.agent_run_stages'::regclass
  ) THEN
    ALTER TABLE agent_run_stages
      ADD CONSTRAINT agent_run_stages_run_id_stage_unique
      UNIQUE (run_id, stage);
  END IF;
END$$;

COMMIT;
