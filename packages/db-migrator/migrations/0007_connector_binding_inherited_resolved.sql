-- Migration 0007 — connector_binding_audit: add inherited_resolved
-- event_type (FORA-546 / FORA-391.3 — Plan 4 §5).
--
-- The resolver emits `connector.binding.inherited_resolved` on
-- every step-3 success (a child tenant's request used a parent
-- tenant's binding). The event is stamped with the requesting
-- child's tenant_id per Plan 4 §5 + FORA-546 AC #2 so the
-- FORA-36 forwarder can reconstruct the chain at audit time.
--
-- This is a forward-only additive migration: the existing
-- column CHECK on `event_type` is dropped and re-created with
-- the new member. The migration role (0001) holds BYPASSRLS
-- so the CHECK swap is non-blocking; the application role
-- (the runtime) does not. Per ADR-0003 §4.2 the runtime role
-- is the only authority on production writes.
--
-- The migration is idempotent: it locates the auto-generated
-- CHECK constraint by column + table via pg_constraint and
-- drops it if present, then re-creates it with the closed
-- event_type set. The closed set is mirrored in
-- apps/connector-config/src/audit.ts
-- `CONNECTOR_BINDING_EVENT_TYPES`; both must agree.
--
-- Sub-task: FORA-546 (FORA-391.3d — inheritance + onboarding).
-- Owner: SeniorEngineer. Spec source: Plan 4 §5 on FORA-391.

BEGIN;

-- Drop the auto-named CHECK on connector_binding_audit.event_type
-- if it exists. Postgres auto-names inline CHECK constraints
-- `<table>_<column>_check`, so we look the constraint up
-- dynamically and drop the first match.
DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'connector_binding_audit'
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%event_type%IN%'
  LOOP
    EXECUTE format(
      'ALTER TABLE connector_binding_audit DROP CONSTRAINT %I',
      constraint_record.conname
    );
  END LOOP;
END $$;

-- Re-create the CHECK with the inherited_resolved member
-- added. The closed set is mirrored in
-- apps/connector-config/src/audit.ts
-- `CONNECTOR_BINDING_EVENT_TYPES`; both must agree.
ALTER TABLE connector_binding_audit
  ADD CONSTRAINT connector_binding_audit_event_type_check
  CHECK (event_type IN (
    'connector.binding.created',
    'connector.binding.activated',
    'connector.binding.revoked',
    'connector.binding.diverged',
    'connector.binding.attested',
    'connector.binding.attestation_expired',
    'connector.binding.orphan_risk',
    'connector.binding.missing',
    'connector.binding.inherited_resolved',
    'connector.binding.health_check.ok',
    'connector.binding.health_check.fail'
  ));

COMMIT;
