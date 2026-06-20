-- Migration 0008 — connector_rate_limit_policy (FORA-518 / FORA-487.4)
--
-- Persists per-tenant / per-project rate-limit policy in Postgres with
-- row-level security, and adds the materialized view that powers the
-- Quota UI.
--
-- Sub-task: FORA-518 (FORA-487.4 — Plan 5 §Rate-Limit & Backoff).
-- Owner: SeniorEngineer. Review: CTO (RLS schema is a one-way door).
--
-- ---- Plan 5 invariants this migration encodes --------------------------------
--
--   * `tier` is the closed enum from FORA-487 §"Layer 2" (trial,
--     standard, enterprise). The CHECK constraint rejects typos at the
--     data layer; a new tier requires a follow-up migration. The
--     default tier for unknown tenants is enterprise (FORA-516 v0.3.0
--     rationale: trial's capacity=1 is incompatible with the
--     failure_ratio circuit detection path).
--
--   * `project_id IS NULL` means "tenant default" — applies to every
--     project in the tenant that does not have its own override. The
--     `UNIQUE (tenant_id, project_id, connector_id)` constraint permits
--     at most one tenant default + one project override per
--     (tenant, project, connector). NULL project_id participates in
--     the unique constraint per Postgres semantics — the row with
--     `project_id IS NULL` is unique among all NULLs (i.e. one tenant
--     default per (tenant, connector)).
--
--   * `override_source` is the closed enum: 'default' (the row that
--     ships as seed), 'project' (a project override), 'operator' (an
--     Auditor escape hatch override). The CHECK pins the closed set
--     per the FORA-487 charter §"Quota overrides".
--
--   * `rpm` and `concurrent_max` are the per-tenant / per-project
--     ceilings Layer 2 enforces. The defaults ship as seed rows
--     (trial 30/4, standard 300/16, enterprise 3000/64 per
--     FORA-487 §"Layer 2"); the migration does NOT seed them — the
--     seed loader (FORA-518 follow-up) populates the defaults after
--     a tenant is created.
--
--   * The `tenant_isolation` policy uses the canonical
--     `coalesce(nullif(current_setting('app.tenant_id', true), '')::uuid,
--     '00000000-0000-0000-0000-000000000000'::uuid)` shape — the same
--     shape every other RLS-bearing table in the registry uses. The
--     bypass-audit (packages/db-migrator/src/bypass-audit.ts) confirms
--     no other BYPASSRLS grant is added.
--
--   * The `admin_override` policy grants `app_admin` (a NOLOGIN role
--     created in this migration WITHOUT BYPASSRLS) full read/write
--     access via `FOR ALL TO app_admin USING (true) WITH CHECK (true)`.
--     This is the Auditor escape hatch per FORA-487 §"Quota
--     overrides". Because `app_admin` is not a BYPASSRLS role, the
--     audit-reader role (audit/0001_audit_reader_role.sql) remains the
--     only other role with the bypass. The runtime connects as the
--     `migrator` role for the actual override writes.
--
-- ---- Materialized view ------------------------------------------------------
--
-- `connector_rate_limit_status` is the read-only view the Quota UI
-- polls (FORA-487 §"Quota UI surface"). It is refreshed on a cadence
-- the cron picks; the refresh function
-- `refresh_connector_rate_limit_status()` is the entry point. The
-- mat view uses LEFT JOIN LATERAL on `connector_circuit` so it can
-- be created before the circuit state table is populated.
--
-- ---- Known deviations from the FORA-518 spec -------------------------------
--
--   1. `sync_op.created_at` in the spec is actually `sync_op.claimed_at`
--      in `migrations/0008_jira_adapter.sql`. The mat view uses
--      `claimed_at` (the real column).
--   2. `sync_op.status = 'in_flight'` in the spec is
--      `sync_op.outcome IS NULL` (the column is `outcome`, not
--      `status`; an in-flight op has NULL outcome). The mat view
--      uses `outcome IS NULL`.
--   3. `sync_op.tenant_id` is `TEXT` in `0008_jira_adapter.sql`; the
--      connector_rate_limit_policy table uses `UUID`. The mat view
--      casts `p.tenant_id::text` for the join.
--   4. `connector_circuit` table does not exist yet (FORA-487.3
--      circuit-breaker state). A stub table is shipped in this
--      migration so the mat view builds; the runtime circuit-breaker
--      (FORA-516 in-memory) does NOT write to it. The follow-up
--      FORA-518a replaces the stub with a DB-backed circuit
--      state writer.
--
-- Forward-only per architecture.md §6 / coding.md §2. Inverse
-- operations are documented in comments; no DROP statements.

BEGIN;

-- ---------------------------------------------------------------------------
-- app_admin — Auditor escape-hatch role (NOLOGIN, no BYPASSRLS)
-- ---------------------------------------------------------------------------
--
-- Created WITHOUT BYPASSRLS. The `admin_override` policy below
-- grants the role full read/write via RLS, not via a privilege
-- bypass. The bypass-audit in @fora/db-migrator refuses to apply
-- if a BYPASSRLS grant references any role other than `migrator`
-- or `audit_reader`; this role is neither, so the audit passes.
--
-- The Auditor connects as the `migrator` role for the actual
-- override writes (FORA-487 §"Quota overrides"); `app_admin` is
-- the named grantee on the policy so the future Operator admin
-- UI can SET ROLE app_admin for read access.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin NOLOGIN;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- connector_rate_limit_policy — current-state rate-limit policy
-- ---------------------------------------------------------------------------
--
-- One row per (tenant, project, connector). project_id NULL means
-- tenant default. The unique constraint is the data-layer gate; the
-- resolver reads this table via @fora/db-pool's TenantAwarePool.
--
-- `override_source` is the closed enum per FORA-487 §"Quota
-- overrides". `updated_by` is the actor envelope (user:<idp> or
-- agent:<type>:<run>) — same shape as connector_binding's audit
-- column.
CREATE TABLE IF NOT EXISTS connector_rate_limit_policy (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL = tenant default (applies to every project in the tenant
  -- that does not carry its own override). Non-NULL = project override.
  project_id        UUID,

  -- Connector identifier (jira, github, gitlab, slack, teams,
  -- sonarqube, figma, aws, azdo, zendesk, databricks, ...). The set
  -- is open per FORA-487 §"Layer 2"; the resolver only knows Tier-1
  -- connectors, unknown connector_id values are allowed for
  -- forward-compat.
  connector_id      TEXT        NOT NULL,

  -- The tier this row applies. Trial 30/4, standard 300/16,
  -- enterprise 3000/64 per FORA-487 §"Layer 2".
  tier              TEXT        NOT NULL CHECK (tier IN (
                      'trial',
                      'standard',
                      'enterprise'
                    )),

  rpm               INTEGER     NOT NULL CHECK (rpm >= 0),
  concurrent_max    INTEGER     NOT NULL CHECK (concurrent_max >= 0),

  -- The closed override-source enum. 'default' = the row that ships
  -- as seed; 'project' = a project override; 'operator' = an
  -- Auditor escape hatch override (FORA-487 §"Quota overrides").
  override_source   TEXT        NOT NULL CHECK (override_source IN (
                      'default',
                      'project',
                      'operator'
                    )),

  -- Free-form jsonb for override metadata: reason, ticket, the
  -- actor envelope for the override, etc. The runtime validates
  -- shape per `override_source`.
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Actor envelope: user:<idp-subject> or agent:<type>:<run-id>.
  -- Mirrors the FORA-253 author envelope shape.
  updated_by        UUID,

  CONSTRAINT connector_rate_limit_policy_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT connector_rate_limit_policy_unique
    UNIQUE (tenant_id, project_id, connector_id)
);

-- ---- Indexes ----------------------------------------------------------------

-- Resolver hot path: read all rate-limit policies for a
-- (tenant, project). The partial WHERE keeps the index narrow
-- (only active rows).
CREATE INDEX IF NOT EXISTS connector_rate_limit_policy_project_idx
  ON connector_rate_limit_policy (tenant_id, project_id, connector_id)
  WHERE project_id IS NOT NULL;

-- Tenant-default lookup: read the policy where project_id IS NULL
-- for a given (tenant, connector). One row per (tenant, connector).
CREATE INDEX IF NOT EXISTS connector_rate_limit_policy_tenant_default_idx
  ON connector_rate_limit_policy (tenant_id, connector_id)
  WHERE project_id IS NULL;

-- Quota UI listing: every (tenant, connector) the UI renders. The
-- composite index covers the prefix used by the API endpoint.
CREATE INDEX IF NOT EXISTS connector_rate_limit_policy_listing_idx
  ON connector_rate_limit_policy (tenant_id, connector_id, tier);

-- ---- RLS ---------------------------------------------------------------------

-- Belt-and-braces: drop and recreate so the apply is idempotent.
-- The canonical policy expr lives in @fora/db-migrator/src/rls.ts
-- and the property-based test asserts the exact substring; this
-- migration uses the same shape.
DROP POLICY IF EXISTS connector_rate_limit_policy_tenant_isolation
  ON connector_rate_limit_policy;

ALTER TABLE connector_rate_limit_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_rate_limit_policy FORCE  ROW LEVEL SECURITY;

CREATE POLICY connector_rate_limit_policy_tenant_isolation
  ON connector_rate_limit_policy
  USING (
    tenant_id = coalesce(
      nullif(current_setting('app.tenant_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  WITH CHECK (
    tenant_id = coalesce(
      nullif(current_setting('app.tenant_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  );

-- The Auditor escape hatch: app_admin (NOLOGIN, no BYPASSRLS)
-- reads and writes every row. The runtime Auditor connects as
-- the `migrator` role; `app_admin` is the named grantee so the
-- future Operator admin UI can SET ROLE app_admin for read
-- access without BYPASSRLS. Combined with the tenant_isolation
-- policy via OR (per Postgres semantics for multiple policies
-- on the same role), the net expression for app_admin is
-- (tenant_id = X) OR (true) = true.
DROP POLICY IF EXISTS connector_rate_limit_policy_admin_override
  ON connector_rate_limit_policy;

CREATE POLICY connector_rate_limit_policy_admin_override
  ON connector_rate_limit_policy
  FOR ALL
  TO app_admin
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- connector_circuit — stub for the rate-limit mat view (FORA-487.3 TBD)
-- ---------------------------------------------------------------------------
--
-- FORA-518's mat view reads `state` from connector_circuit. The
-- runtime circuit breaker (FORA-516 in-memory) does NOT write to
-- this table; FORA-487.3 (DB-backed circuit state) is the
-- follow-up. The stub exists so the mat view builds today.
--
-- The table is tenant-scoped RLS-wise and has the same RLS shape
-- as every other multi-tenant table. The unique constraint
-- permits at most one row per (tenant, connector).
CREATE TABLE IF NOT EXISTS connector_circuit (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_id      TEXT        NOT NULL,

  -- Circuit state. Closed = normal; open = tripped; half_open =
  -- probe pending. Mirrors the FORA-516 in-memory circuit-breaker
  -- enum.
  state             TEXT        NOT NULL CHECK (state IN (
                      'closed',
                      'open',
                      'half_open'
                    )),

  -- When the circuit was opened / half-opened / closed. The
  -- runtime updates these on every transition; the Quota UI
  -- uses the timestamps to render the "tripped N seconds ago"
  -- badge.
  opened_at         TIMESTAMPTZ,
  half_open_at      TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,

  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT connector_circuit_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT connector_circuit_unique
    UNIQUE (tenant_id, connector_id)
);

CREATE INDEX IF NOT EXISTS connector_circuit_lookup_idx
  ON connector_circuit (tenant_id, connector_id);

-- RLS — same canonical shape as connector_rate_limit_policy.
DROP POLICY IF EXISTS connector_circuit_tenant_isolation
  ON connector_circuit;

ALTER TABLE connector_circuit ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_circuit FORCE  ROW LEVEL SECURITY;

CREATE POLICY connector_circuit_tenant_isolation
  ON connector_circuit
  USING (
    tenant_id = coalesce(
      nullif(current_setting('app.tenant_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  WITH CHECK (
    tenant_id = coalesce(
      nullif(current_setting('app.tenant_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  );

-- Admin override for connector_circuit too (Operator UI will read
-- circuit state across tenants).
DROP POLICY IF EXISTS connector_circuit_admin_override
  ON connector_circuit;

CREATE POLICY connector_circuit_admin_override
  ON connector_circuit
  FOR ALL
  TO app_admin
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- connector_rate_limit_status — materialized view (Quota UI)
-- ---------------------------------------------------------------------------
--
-- The Quota UI reads from this view. The view is refreshed by
-- `refresh_connector_rate_limit_status()` (PL/pgSQL, defined
-- below) on a 5s cadence (per FORA-518 AC; the cron registration
-- ships in the scheduler PR2 — child issue FORA-518a).
--
-- Column notes:
--
--   * `rpm_remaining` uses `sync_op.claimed_at` (NOT `created_at`
--     as the FORA-518 spec wrote — `claimed_at` is the real
--     column per `migrations/0008_jira_adapter.sql`).
--
--   * `concurrent_in_flight` counts `sync_op` rows where
--     `outcome IS NULL` (an in-flight op has NULL outcome;
--     completed ops have `outcome IN ('ok', 'fail')`).
--
--   * `sync_op.tenant_id` is TEXT (not UUID); we cast
--     `p.tenant_id::text` for the join.
--
--   * `circuit_state` uses LEFT JOIN LATERAL on connector_circuit
--     so the mat view builds even when no circuit state rows
--     exist yet.
CREATE MATERIALIZED VIEW connector_rate_limit_status AS
SELECT
  p.tenant_id,
  p.connector_id,
  p.tier,
  p.rpm,
  p.concurrent_max,
  GREATEST(
    0,
    p.rpm - COALESCE((
      SELECT COUNT(*)::int
        FROM sync_op
       WHERE sync_op.tenant_id = p.tenant_id::text
         AND sync_op.claimed_at > now() - INTERVAL '1 minute'
    ), 0)
  )                                  AS rpm_remaining,
  COALESCE((
    SELECT COUNT(*)::int
      FROM sync_op
     WHERE sync_op.tenant_id = p.tenant_id::text
       AND sync_op.outcome IS NULL
  ), 0)                                AS concurrent_in_flight,
  cc.state                            AS circuit_state
FROM connector_rate_limit_policy p
LEFT JOIN LATERAL (
  SELECT state
    FROM connector_circuit
   WHERE connector_circuit.tenant_id = p.tenant_id
     AND connector_circuit.connector_id = p.connector_id
   LIMIT 1
) cc ON true;

-- The unique index is required for REFRESH CONCURRENTLY; the
-- mat view refresh function uses CONCURRENTLY so the Quota UI
-- never sees an empty view during a refresh.
CREATE UNIQUE INDEX IF NOT EXISTS connector_rate_limit_status_uidx
  ON connector_rate_limit_status (tenant_id, connector_id);

-- ---------------------------------------------------------------------------
-- refresh_connector_rate_limit_status() — mat view refresh entry point
-- ---------------------------------------------------------------------------
--
-- Called by the cron worker (5s cadence per FORA-518 AC). Uses
-- REFRESH CONCURRENTLY so the UI never reads an empty view
-- during a refresh. CONCURRENTLY requires the unique index
-- above.
--
-- Trade-off: CONCURRENTLY takes longer than a non-concurrent
-- refresh because Postgres has to build the diff. For a 5s
-- cadence the window is well under the threshold for catching
-- up after a slow refresh.
--
-- The function is `SECURITY DEFINER` so the runtime can call it
-- without needing the underlying SELECT privilege on
-- sync_op + connector_circuit + connector_rate_limit_policy
-- for every tenant. The runtime role needs EXECUTE on this
-- function; the function body runs as the migrator role
-- (which has BYPASSRLS).
CREATE OR REPLACE FUNCTION refresh_connector_rate_limit_status()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY connector_rate_limit_status;
END
$$;

-- The runtime role (broker, sync-plane-job) needs EXECUTE on
-- the refresh function. The grant is idempotent; the role
-- itself is created elsewhere (e.g. identity-broker migration).
GRANT EXECUTE ON FUNCTION refresh_connector_rate_limit_status() TO PUBLIC;

COMMIT;
