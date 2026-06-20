-- 0001_audit_reader_role.sql
-- Defines the audit-reader role. This is the second and last role that
-- holds BYPASSRLS — needed for the audit log reader to query across all
-- tenants when producing the SOC 2 / GDPR audit response.
--
-- The BYPASSRLS grant is in this file (audit/) on purpose: the audit
-- reader is the only non-migration role that may read across tenants,
-- and its grant is auditable in the same folder as the rest of the
-- audit trail.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_reader') THEN
    CREATE ROLE audit_reader NOLOGIN;
  END IF;
END
$$;

-- The audit-reader role needs BYPASSRLS to query tenant-scoped tables
-- across all tenants for compliance reporting. The role is granted SELECT
-- on the audit schema in a separate migration; this file only establishes
-- the role and the BYPASSRLS attribute.
ALTER ROLE audit_reader BYPASSRLS;
