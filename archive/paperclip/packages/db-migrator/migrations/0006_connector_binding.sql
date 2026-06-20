-- 0006_connector_binding.sql
--
-- Tenant-scoped connector configuration storage + audit materialisation.
--
-- Implements Plan 4 (Tenant-Scoped Connector Config) on FORA-391.
-- Sub-task: FORA-485 (FORA-391.3). Owner: SeniorEngineer.
--
-- Two artifacts ship in this migration:
--
--   1. `connector_binding` — the current-state table every connector
--      resolution reads from. RLS is the canonical `tenant_isolation`
--      policy from 0.7.2a; the wrapper sets `app.tenant_id` per
--      request so a request for tenant A can never read tenant B's
--      rows.
--
--   2. `connector_binding_audit` — a regular table (NOT a Postgres
--      MATERIALIZED VIEW; see "Audit materialisation model" below)
--      populated from `connector.binding.*` events written by the
--      FORA-36 audit forwarder. The current-state table is never
--      used to derive audit history; the two are decoupled so the
--      audit chain survives any current-state mutation.
--
-- ---- Plan 4 invariants this migration encodes --------------------------------
--
--   * `binding_id` is the Keycloak client UUID that issued the binding.
--     The resolver key is (tenant_id, project_id?, connector_id), and
--     the cache key adds `auth_method`. The `(binding_id)` primary key
--     means we can never have two rows for the same Keycloak client in
--     the same tenant.
--
--   * `project_id IS NULL` means "tenant default" — applies to every
--     project in the tenant that does not have its own override. The
--     partial unique index `connector_binding_tenant_default_uidx`
--     guarantees at most one tenant default per (tenant, connector).
--     Project overrides have the partial unique index
--     `connector_binding_project_override_uidx` — at most one override
--     per (tenant, project, connector).
--
--   * `parent_tenant_id` + `depth` encode the tenant-inheritance chain
--     for step 3 of the resolver. The Keycloak layer enforces depth ≤ 3
--     at admin time (the runtime CHECK caps depth at 3 as a defence in
--     depth so a misconfigured admin cannot blow past the cap).
--
--   * `auth_method` is `forge_operator_fallback` ONLY when the binding
--     is the operator fallback. The CHECK constraint lists the five
--     real auth methods plus the fallback sentinel. The runtime
--     resolver narrows step 4 to Auditor role only.
--
--   * `credential_ref` is NEVER inherited. The override-creation path
--     refuses a NULL credential_ref at runtime; the column itself is
--     NOT NULL so the constraint is data-layer enforced.
--
--   * `diverged_fields` is the closed set of fields an Architect may
--     diverge from the inherited value. Auth_method is the only field
--     the plan permits; the runtime logs `diverged_fields:
--     ["auth_method"]` when an override diverges. The CHECK constraint
--     here pins the closed set so a drift in the runtime never lands
--     an unknown field in the column.
--
--   * `attested_at` + `attestation_expires_at` enforce the 90-day
--     re-attestation rule. The nightly sweeper (FORA-485 follow-up)
--     PATCHes `status='attesting'` when `attestation_expires_at < now()`
--     and refuses resolution against an attesting binding until the
--     Architect re-attests.
--
--   * `revoked_reason` is non-NULL only when `status='revoked'` or
--     `status='orphaned'`. The CHECK constraint enforces the invariant
--     at the data layer.
--
-- ---- Audit materialisation model --------------------------------------------
--
-- Plan 4 says "connector_binding_audit materialized from
-- connector.binding.* audit events". We do NOT use a Postgres
-- MATERIALIZED VIEW because:
--
--   1. A mat view locks its refresh against the source table, which
--      would block the audit forwarder on every FORA-36 event during
--      a refresh.
--   2. Mat views have no `INSERT` privilege for app roles by default;
--      the FORA-36 forwarder would need elevated DDL to refresh them.
--   3. The audit chain must be append-only (ADR-0009 §5); a regular
--      table with `INSERT`-only privilege matches the audit model
--      and stays consistent with `agent_run_events`.
--
-- Instead `connector_binding_audit` is a regular table with the same
-- RLS policy as the current-state table, populated by the FORA-36
-- audit forwarder via `INSERT ... ON CONFLICT (event_id) DO NOTHING`.
-- The forwarder is the only writer; the resolver never reads from
-- it. The shape mirrors the FORA-50 §3.3 events table.
--
-- ---- Why this is a raw SQL migration, not a registry model --------------------
--
-- The FORA-124 / 0.7.2a registry `ColumnSpec` cannot express CHECK
-- constraints, partial unique indexes, composite uniques, or
-- default expressions referencing other columns. Every model in the
-- registry that needs CHECK / partial indexes carries a follow-up
-- migration (see `0002_*` for agent_runs / agent_run_stages); this
-- migration is the same pattern, applied at a later number.
--
-- Forward-only per architecture.md §6 / coding.md §2. Inverse
-- operations are documented in comments; no DROP statements.

BEGIN;

-- ---------------------------------------------------------------------------
-- connector_binding — current-state tenant-scoped connector config
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS connector_binding (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- binding_id is the Keycloak client UUID that backs this binding.
  -- One Keycloak client can have at most one binding row per tenant;
  -- the unique index on (tenant_id, binding_id) enforces that and the
  -- resolver keys off it for O(1) audit joins.
  binding_id                  uuid        NOT NULL,
  tenant_id                   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- NULL = tenant default (applies to every project in the tenant
  -- that does not carry its own override). Non-NULL = project override.
  project_id                  uuid,

  -- Connector identifier (jira, github, gitlab, slack, teams, sonarqube,
  -- figma, aws, azdo, zendesk, databricks, ...). The set is open but
  -- the resolver only knows Tier-1 connectors per the plan; unknown
  -- connector_id values are allowed in the column for forward-compat
  -- but the resolver falls through to MISS.
  connector_id                text        NOT NULL,

  -- The auth method this binding presents. `forge_operator_fallback`
  -- is the Auditor-only sentinel for step 4 of the resolver; the
  -- other five are real auth methods. The CHECK pins the closed set
  -- so a new auth method requires a follow-up migration.
  auth_method                 text        NOT NULL CHECK (auth_method IN (
                                  'oidc',
                                  'pat',
                                  'oauth2',
                                  'service_account',
                                  'api_key',
                                  'forge_operator_fallback'
                                )),

  -- credential_ref is a stable pointer to the secret in the secrets
  -- broker (FORA-128). NEVER inherited — the resolver refuses step 3
  -- when the inherited row has credential_ref, and the override-
  -- creation path requires a non-NULL credential_ref at runtime.
  credential_ref              text        NOT NULL,

  -- OAuth/OIDC scopes the binding presents. Free-form jsonb because
  -- the shape is provider-specific; the resolver does not parse it
  -- except for the cache key, which adds (connector_id + tenant_id +
  -- project_id + auth_method) — scopes are not part of the cache key
  -- because they are presented at request time, not resolved at
  -- config-load time.
  scopes                      jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- status lifecycle. `active` is the only state that resolves.
  -- `pending` is the onboarding wizard's transient state (no
  -- resolution). `attesting` is set by the nightly sweeper 90 days
  -- after attested_at; the resolver refuses it. `revoked` and
  -- `orphaned` are terminal — orphaned is set when a tenant default
  -- is revoked but overrides still reference its auth_method.
  status                      text        NOT NULL CHECK (status IN (
                                  'pending', 'active', 'attesting',
                                  'revoked', 'orphaned'
                                )),

  -- Health-check timestamps. The health-check worker PATCHes these
  -- every 5 minutes; the resolver's cache TTL is independent.
  last_health_check_at        timestamptz,
  last_success_at             timestamptz,
  last_failure_at             timestamptz,

  -- Tenant-inheritance chain. parent_tenant_id points at the parent
  -- tenant whose binding is the source of inheritance (step 3 of the
  -- resolver). depth is 0 for tenant-owned rows and 1..3 for
  -- inherited rows. depth > 3 is rejected by the CHECK so a
  -- misconfigured admin cannot exceed the Keycloak-layer cap.
  parent_tenant_id            uuid        REFERENCES tenants(id),
  depth                       integer     NOT NULL DEFAULT 0
                                            CHECK (depth >= 0 AND depth <= 3),

  -- Divergence tracking. `diverged_fields` is the closed set of
  -- fields the Architect explicitly diverged from the inherited
  -- value. The plan permits ONLY `auth_method`; the CHECK pins the
  -- closed set so a runtime drift cannot leak an unknown field.
  -- `NULL` means "no divergence" (i.e. this binding is an exact
  -- inheritance of the parent).
  diverged_fields             jsonb       CHECK (
                                  diverged_fields IS NULL
                                  OR jsonb_typeof(diverged_fields) = 'array'
                                ),

  -- Attestation tracking for the 90-day re-attestation rule. The
  -- nightly sweeper sets status='attesting' when
  -- attestation_expires_at < now(); the resolver refuses attesting
  -- rows. attestation_expires_at is set on creation to
  -- attested_at + 90 days and refreshed on Architect re-attestation.
  attested_at                 timestamptz NOT NULL DEFAULT now(),
  attested_by                 text        NOT NULL,
  attestation_expires_at      timestamptz NOT NULL,

  -- Revocation reason. Required when status is revoked/orphaned; NULL
  -- otherwise. The CHECK enforces the invariant at the data layer so
  -- a runtime bug cannot leave an unexplained terminal row.
  revoked_reason              text        CHECK (
                                  (status IN ('revoked', 'orphaned')
                                    AND revoked_reason IS NOT NULL)
                                  OR (status NOT IN ('revoked', 'orphaned')
                                    AND revoked_reason IS NULL)
                                ),

  -- Audit columns. created_by / updated_by are Keycloak subject ids.
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  text        NOT NULL,
  updated_by                  text        NOT NULL,

  -- system-supplied tenant_id (FK + RLS targets); the resolver does
  -- NOT add an extra FK from project_id to a projects table because
  -- the tenant-scoped project identity is owned by FORA-399 (the
  -- spine plan) and may live in Keycloak. The application layer is
  -- the source of truth for project membership.
  CONSTRAINT connector_binding_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- ---- Indexes ----------------------------------------------------------------

-- Resolver hot path: step 1 (project override). The resolver reads
-- this on every request that names a project, so the partial index
-- keeps the rows small (one row per (tenant, project, connector)
-- where the project_id is non-NULL).
CREATE INDEX IF NOT EXISTS connector_binding_project_override_idx
  ON connector_binding (tenant_id, project_id, connector_id)
  WHERE project_id IS NOT NULL
    AND status IN ('pending', 'active', 'attesting');

-- Step 2 (tenant default). One row per (tenant, connector) where
-- project_id is NULL and status is active. The partial WHERE keeps
-- revoked/orphaned rows out of the resolver hot path.
CREATE INDEX IF NOT EXISTS connector_binding_tenant_default_idx
  ON connector_binding (tenant_id, connector_id)
  WHERE project_id IS NULL
    AND status IN ('pending', 'active', 'attesting');

-- Step 3 (tenant inherited). The resolver walks parent_tenant_id
-- with depth+1 until it finds a match or hits the depth cap.
CREATE INDEX IF NOT EXISTS connector_binding_inherit_idx
  ON connector_binding (tenant_id, parent_tenant_id, depth)
  WHERE status = 'active';

-- Cache invalidation: the resolver invalidates on PATCH/UPDATE that
-- touches any of (tenant_id, project_id, connector_id, auth_method).
CREATE INDEX IF NOT EXISTS connector_binding_cache_key_idx
  ON connector_binding (tenant_id, connector_id, auth_method, status);

-- Nightly sweeper hot loop: every row whose attestation_expires_at is
-- due. The sweeper reads with WHERE status='active' AND
-- attestation_expires_at < now(); the partial index is small.
CREATE INDEX IF NOT EXISTS connector_binding_attestation_sweep_idx
  ON connector_binding (attestation_expires_at)
  WHERE status = 'active';

-- Orphan-risk detection (FORA-485 acceptance #3): overrides whose
-- parent (tenant default) is revoked. The sweeper emits
-- `connector.binding.orphan_risk` for rows that satisfy this query.
CREATE INDEX IF NOT EXISTS connector_binding_orphan_risk_idx
  ON connector_binding (tenant_id, connector_id, auth_method)
  WHERE project_id IS NOT NULL AND status = 'active';

-- ---- Uniqueness --------------------------------------------------------------

-- One binding per Keycloak client per tenant. The Keycloak client UUID
-- is the natural key; a duplicate means a Keycloak-side mistake and
-- the migration rejects it.
CREATE UNIQUE INDEX IF NOT EXISTS connector_binding_tenant_binding_uidx
  ON connector_binding (tenant_id, binding_id);

-- At most one tenant default per (tenant, connector). Partial unique
-- because multiple revoked/orphaned rows can share the same key.
CREATE UNIQUE INDEX IF NOT EXISTS connector_binding_tenant_default_uidx
  ON connector_binding (tenant_id, connector_id)
  WHERE project_id IS NULL AND status IN ('pending', 'active', 'attesting');

-- At most one project override per (tenant, project, connector).
CREATE UNIQUE INDEX IF NOT EXISTS connector_binding_project_override_uidx
  ON connector_binding (tenant_id, project_id, connector_id)
  WHERE project_id IS NOT NULL AND status IN ('pending', 'active', 'attesting');

-- ---- RLS ---------------------------------------------------------------------

-- Belt-and-braces: drop and recreate so this migration is idempotent.
-- The canonical policy expr lives in @fora/db-migrator/rls.ts and the
-- property-based test asserts the exact substring.
DROP POLICY IF EXISTS tenant_isolation ON connector_binding;

ALTER TABLE connector_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_binding FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON connector_binding
  USING (tenant_id = coalesce(
    nullif(current_setting('app.tenant_id', true), '')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  ));

-- ---------------------------------------------------------------------------
-- connector_binding_audit — append-only audit chain
-- ---------------------------------------------------------------------------

-- Populated by the FORA-36 audit forwarder from `connector.binding.*`
-- events. Append-only; UPDATE/DELETE is forbidden by trigger (mirrors
-- ADR-0009 §5 agent_run_events). The current-state connector_binding
-- table is NEVER the source of audit history; the two are decoupled so
-- the audit chain survives current-state mutations.
--
-- The table is tenant-scoped RLS-wise so a request that can read
-- connector_binding can also read its own audit history. The forwarder
-- runs as the migrator role (BYPASSRLS) when inserting.
CREATE TABLE IF NOT EXISTS connector_binding_audit (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- event_id is the FORA-36 event UUID; INSERT ... ON CONFLICT
  -- (event_id) DO NOTHING makes the forwarder idempotent on retry.
  event_id                    uuid        NOT NULL,

  tenant_id                   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- The binding row this event references. Nullable for
  -- `connector.binding.missing` events because there is no row.
  binding_id                  uuid,

  -- Connector identity at event time. Redundant with binding_id for
  -- join speed; the resolver audit queries by (tenant, connector_id).
  connector_id                text        NOT NULL,
  project_id                  uuid,
  auth_method                 text,

  -- Closed event-type enum per Plan 3 §6. The list pins every
  -- connector.binding.* event the runtime emits. Any new event type
  -- requires a follow-up migration.
  event_type                  text        NOT NULL CHECK (event_type IN (
                                  'connector.binding.created',
                                  'connector.binding.activated',
                                  'connector.binding.revoked',
                                  'connector.binding.diverged',
                                  'connector.binding.attested',
                                  'connector.binding.attestation_expired',
                                  'connector.binding.orphan_risk',
                                  'connector.binding.missing',
                                  'connector.binding.health_check.ok',
                                  'connector.binding.health_check.fail'
                                )),

  -- Actor envelope. Free-form jsonb: {actor_type, actor_id, role, ...}.
  actor                       jsonb       NOT NULL,

  -- Free-form structured context: diverged_fields, error, override
  -- source, attestation reason, etc. The runtime validates shape per
  -- event_type.
  metadata                    jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Wall-clock event time as reported by the forwarder.
  emitted_at                  timestamptz NOT NULL,

  created_at                  timestamptz NOT NULL DEFAULT now()
);

-- ---- Audit indexes -----------------------------------------------------------

-- Resolver audit queries by (tenant, connector_id, emitted_at DESC)
-- for the most recent N events on a binding. Composite index covers
-- the prefix and the trailing ORDER BY.
CREATE INDEX IF NOT EXISTS connector_binding_audit_lookup_idx
  ON connector_binding_audit (tenant_id, connector_id, emitted_at DESC);

-- Orphan-risk sweep reads by event_type and emitted_at; the partial
-- index keeps the rows small (only orphan_risk / attestation_expired
-- / missing events feed the daily digest).
CREATE INDEX IF NOT EXISTS connector_binding_audit_sweep_idx
  ON connector_binding_audit (tenant_id, event_type, emitted_at DESC)
  WHERE event_type IN (
    'connector.binding.orphan_risk',
    'connector.binding.attestation_expired',
    'connector.binding.missing'
  );

-- Forwarder idempotency: INSERT ON CONFLICT (event_id) DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS connector_binding_audit_event_uidx
  ON connector_binding_audit (event_id);

-- ---- Audit append-only enforcement ------------------------------------------

-- Mirrors the ADR-0009 §5 trigger on agent_run_events. The audit
-- chain is append-only; UPDATE and DELETE are forbidden at the data
-- layer so a misbehaving caller cannot rewrite history.
CREATE OR REPLACE FUNCTION connector_binding_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'connector_binding_audit is append-only (ADR-0009 §5)';
END;
$$;

DROP TRIGGER IF EXISTS connector_binding_audit_no_update ON connector_binding_audit;
CREATE TRIGGER connector_binding_audit_no_update
  BEFORE UPDATE OR DELETE ON connector_binding_audit
  FOR EACH ROW EXECUTE FUNCTION connector_binding_audit_append_only();

-- ---- Audit RLS ---------------------------------------------------------------

DROP POLICY IF EXISTS tenant_isolation ON connector_binding_audit;

ALTER TABLE connector_binding_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_binding_audit FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON connector_binding_audit
  USING (tenant_id = coalesce(
    nullif(current_setting('app.tenant_id', true), '')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  ));

COMMIT;