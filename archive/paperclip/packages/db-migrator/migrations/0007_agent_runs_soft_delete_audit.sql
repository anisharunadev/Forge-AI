-- 0007_agent_runs_soft_delete_audit.sql
--
-- FORA-527 (0.1.9) — operator-action audit columns for ADR-0009 §6
-- soft-delete / restore. The four columns are written by the new
-- `POST /v1/runs/{id}/soft-delete` and `POST /v1/runs/{id}/restore`
-- endpoints; they are nullable so:
--
--   - a soft-delete / restore that predates the v0.1.9 deployment
--     leaves the columns NULL on the audit account (no backfill).
--   - the v0.1 row-update path that pre-dates FORA-527 is unchanged.
--
-- `*_by_agent_id` is the acting Paperclip agent (per `agents.id`,
-- supplied by the upstream gateway / Paperclip tenancy layer).
-- `*_by_run_id` is the operator's own Paperclip run id
-- (`X-Paperclip-Run-Id` header) for forensic correlation — a
-- soft-delete issued by agent A on agent B's run is recoverable by
-- joining the run id to the `agent_runs` history.
--
-- Migration is forward-only per architecture.md §6 / coding.md §2.
-- The inverse operations are documented as comments; do NOT add
-- DROP statements here — destructive migrations are a DBA action
-- per ADR-0009 §6 and are alerted through 1Password-held credentials.
--
-- Sub-task: FORA-527 (0.1.9 — soft-delete + restore endpoints).
-- Owner: CTO. Spec source: ADR-0009 §6 + FORA-527 AC.

BEGIN;

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS deleted_by_agent_id   uuid,
  ADD COLUMN IF NOT EXISTS deleted_by_run_id     uuid,
  ADD COLUMN IF NOT EXISTS restored_by_agent_id  uuid,
  ADD COLUMN IF NOT EXISTS restored_by_run_id    uuid;

COMMIT;
