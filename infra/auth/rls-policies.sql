-- ===========================================================================
-- Forge — PostgreSQL Row-Level Security (RLS) policy examples
--
-- The intent: every protected table has a `tenant_id uuid` column, and the
-- session variable `app.tenant_id` (set per-request by the FastAPI tenant
-- middleware — see tenant-middleware.md) is the only thing that can satisfy
-- the RLS policy. A query that runs without a `tenant_id` set in the session
-- returns ZERO rows, by design.
--
-- NFR-004a — every request carries tenant_id via JWT claims
-- ADR-0002 — PostgreSQL 17 is the system of record
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Sample schema (representative; the real DDL lives in backend migrations)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
    id          uuid        PRIMARY KEY,
    slug        text        NOT NULL UNIQUE,
    name        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- A representative tenant-scoped table. The same pattern applies to every
-- table that has a `tenant_id` column.
CREATE TABLE IF NOT EXISTS projects (
    id          uuid        PRIMARY KEY,
    tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_tenant_id_idx ON projects(tenant_id);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

-- Reads the current session's tenant_id. The second argument (`true`) makes
-- `current_setting` return NULL instead of raising if the GUC is unset —
-- important so that a missing tenant_id is a *silent* zero-row result
-- rather than a 500 error.
--
-- Always called inside RLS USING / WITH CHECK contexts, which never allow
-- the function to leak data to the caller.
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$;

-- Defensive guard. Use in stored procedures, scheduled jobs, or admin
-- scripts that explicitly want a hard error on a missing tenant_id (rather
-- than the silent-zero-rows behaviour of the RLS policy).
CREATE OR REPLACE FUNCTION assert_tenant_context()
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  t uuid;
BEGIN
  t := current_tenant_id();
  IF t IS NULL THEN
    RAISE EXCEPTION 'tenant context is not set (expected app.tenant_id GUC)'
      USING ERRCODE = 'insufficient_privilege',
            HINT    = 'SET app.tenant_id = ''<uuid>''; before calling this function';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Example: a super-admin / platform-admin role that may bypass RLS
-- ---------------------------------------------------------------------------
-- The application sets `app.bypass_rls = 'on'` for sessions running as
-- platform staff (forge-admin). The RLS policies below check for this GUC
-- FIRST and return TRUE, short-circuiting the tenant check.
--
-- The application must NEVER set this GUC for end-user requests; doing so
-- is a P0 audit event.
CREATE OR REPLACE FUNCTION current_user_bypasses_rls()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(current_setting('app.bypass_rls', true), 'off') = 'on';
$$;

-- ---------------------------------------------------------------------------
-- RLS on `tenants` — the tenants table itself
-- ---------------------------------------------------------------------------
-- The tenants table is global (no `tenant_id` column), so RLS here is a
-- special case: a non-platform user can only SEE their own tenant row.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_self_select ON tenants;
CREATE POLICY tenant_self_select ON tenants
  FOR SELECT
  USING (
    current_user_bypasses_rls()
    OR id = current_tenant_id()
  );

-- INSERT/UPDATE/DELETE on tenants is reserved for platform staff
-- (forge-admin). The application's RLS-bypassing DB role should be the
-- only one writing to this table; RLS gives a second line of defence.
DROP POLICY IF EXISTS tenant_admin_write ON tenants;
CREATE POLICY tenant_admin_write ON tenants
  FOR ALL
  USING      (current_user_bypasses_rls())
  WITH CHECK (current_user_bypasses_rls());

-- ---------------------------------------------------------------------------
-- RLS on a tenant-scoped table (`projects`)
-- ---------------------------------------------------------------------------
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE  ROW LEVEL SECURITY;

-- SELECT
DROP POLICY IF EXISTS tenant_isolation_select ON projects;
CREATE POLICY tenant_isolation_select ON projects
  FOR SELECT
  USING (
    current_user_bypasses_rls()
    OR tenant_id = current_tenant_id()
  );

-- INSERT
DROP POLICY IF EXISTS tenant_isolation_insert ON projects;
CREATE POLICY tenant_isolation_insert ON projects
  FOR INSERT
  WITH CHECK (
    current_user_bypasses_rls()
    OR tenant_id = current_tenant_id()
  );

-- UPDATE
DROP POLICY IF EXISTS tenant_isolation_update ON projects;
CREATE POLICY tenant_isolation_update ON projects
  FOR UPDATE
  USING (
    current_user_bypasses_rls()
    OR tenant_id = current_tenant_id()
  )
  WITH CHECK (
    current_user_bypasses_rls()
    OR tenant_id = current_tenant_id()
  );

-- DELETE
DROP POLICY IF EXISTS tenant_isolation_delete ON projects;
CREATE POLICY tenant_isolation_delete ON projects
  FOR DELETE
  USING (
    current_user_bypasses_rls()
    OR tenant_id = current_tenant_id()
  );

-- ---------------------------------------------------------------------------
-- Per-request pattern (called from the FastAPI middleware)
-- ---------------------------------------------------------------------------
--
-- For every API request, the middleware acquires a pooled connection from
-- pgbouncer (in transaction-pooling mode — see below) and immediately runs:
--
--   SET LOCAL app.tenant_id = '<uuid-from-jwt>';
--   SET LOCAL app.bypass_rls = 'off';   -- explicit; never trust the caller
--
-- `SET LOCAL` is scoped to the current transaction. When the connection is
-- returned to the pool, the GUC is reset. This is the ONLY safe way to use
-- GUCs as a request-scoped variable with pgbouncer in transaction mode.
--
-- If the JWT is invalid, or `tenant_id` is missing, the middleware MUST
-- close the connection (or at minimum run RESET ALL) before returning it
-- to the pool — otherwise the next request that grabs that connection will
-- inherit a stale tenant_id.

-- ---------------------------------------------------------------------------
-- Sample pgbouncer config (transaction-pooling for RLS)
-- ---------------------------------------------------------------------------
-- Save as infra/auth/pgbouncer.ini
--
--   [databases]
--   forge = host=postgres-primary.forge.internal port=5432 dbname=forge
--
--   [pgbouncer]
--   listen_addr = 0.0.0.0
--   listen_port = 6432
--   auth_type   = scram-sha-256
--   auth_file   = /etc/pgbouncer/userlist.txt
--   pool_mode   = transaction         # CRITICAL for SET LOCAL scoping
--   max_client_conn = 1000
--   default_pool_size = 20
--   server_reset_query = RESET ALL; SET ROLE forge_app  # see below
--   server_reset_query_always = 1
--
-- Notes:
--   * `pool_mode = transaction` is required for `SET LOCAL` to scope the
--     GUC to a single transaction. With `pool_mode = session`, SET LOCAL
--     survives until the connection is closed (and pgbouncer holds the
--     connection for a long time), so it works but doesn't scale.
--   * `server_reset_query = RESET ALL` is mandatory in transaction mode —
--     pgbouncer will run it when the client disconnects, and it strips any
--     GUCs that the client may have set.
--   * If you need connection-scoped state (rare), use `pool_mode = session`
--     for that specific pool and document the security trade-off.
--   * The application DB role should be a non-superuser named `forge_app`
--     with no BYPASSRLS attribute. Superusers bypass RLS by definition.
--
-- Sample /etc/pgbouncer/userlist.txt:
--   "forge_app" "<scram-sha-256:...>"

-- ---------------------------------------------------------------------------
-- End-to-end smoke test (run as a sanity check in CI)
-- ---------------------------------------------------------------------------
-- 1. SET ROLE forge_app;       -- app role, no BYPASSRLS
-- 2. SET LOCAL app.tenant_id = '9c3b1e2a-7d40-4f57-9b0e-3a55c1e6e2b1';
-- 3. SELECT count(*) FROM projects;            -- returns only Acme's projects
-- 4. SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000001';
-- 5. SELECT count(*) FROM projects;            -- returns 0 (different tenant)
-- 6. RESET app.tenant_id;
-- 7. SELECT count(*) FROM projects;            -- returns 0 (no tenant set)
-- 8. RESET ROLE;
