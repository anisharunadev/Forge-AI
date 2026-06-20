-- 0001_migration_role.sql
-- Defines the migration role. This is the *only* non-audit role that holds
-- BYPASSRLS, and it is the role the runner uses to apply migrations.
-- The audit/0001_audit_reader_role.sql file defines the second and last role
-- with BYPASSRLS. The BYPASSRLS audit in src/bypass-audit.ts scans this
-- directory and audit/ and refuses to run if a BYPASSRLS grant is added
-- anywhere else.
--
-- Per FORA-124 / 0.7.2a: "An application role cannot BYPASSRLS; the only
-- roles with BYPASSRLS are the migration role and the audit-reader role,
-- both defined in migrations/ and audit/ respectively."

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrator') THEN
    CREATE ROLE migrator NOLOGIN;
  END IF;
END
$$;

-- The migration role needs BYPASSRLS so the runner can create tables, RLS
-- policies, and FORCE ROW LEVEL SECURITY. Application roles (broker,
-- runtime, future services) connect with NOINHERIT, NOBYPASSRLS.
ALTER ROLE migrator BYPASSRLS;
