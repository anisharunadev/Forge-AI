-- Migration 0006 — connector_binding (FORA-485 / FORA-391.3 — Plan 4)
--
-- The connector_binding table is the current-state store for
-- tenant-scoped connector configuration per Plan 4 (FORA-391.3).
-- The audit chain lives in connector_binding_audit (materialised
-- from `connector.binding.*` events via the FORA-36 forwarder).
--
-- The table holds ONE row per (tenant_id, binding_id) — the
-- binding_id is a Keycloak client UUID; the unique index
-- `(tenant_id, binding_id)` enforces that constraint at the DB
-- layer. project_id is NULL for tenant defaults, set for project
-- overrides.
--
-- The five-step resolver (apps/connector-config/src/resolver.ts)
-- reads this table via the @fora/db-pool `TenantAwarePool`. The
-- `SET LOCAL app.tenant_id` GUC binds every read to the request
-- claim's tenant; the FORCE'd RLS policy below is the
-- defence-in-depth gate.
--
-- ---- Column notes ----------------------------------------------------------
--
--   * `auth_method` is the closed enum from types.ts AuthMethod
--     plus the Auditor-only `forge_operator_fallback` sentinel.
--     The runtime narrows step 4 of the resolver to that method
--     regardless of the request actor.
--
--   * `status` is the closed lifecycle enum (pending, active,
--     attesting, revoked, orphaned). The resolver only accepts
--     `active`; `attesting` is set by the 90-day re-attestation
--     sweeper and is refused until re-attested.
--
--   * `depth` is the inheritance distance for tenant chains:
--       0 = project-owned (the project holds its own config)
--       1..3 = inherited from a parent tenant at this depth
--     The CHECK caps depth at 3 per Plan 4. The Keycloak
--     admin layer should reject admin-time creations past the
--     cap; the runtime CHECK is defence in depth.
--
--   * `parent_tenant_id` is the tenant whose chain this row
--     belongs to. NULL for tenant defaults + project overrides.
--     The resolver's step 3 walks parent_tenant_id from depth 1
--     to 3 to find an inherited binding.
--
--   * `diverged_fields` is the closed set Plan 4 permits the
--     Architect to diverge (`auth_method` only). The CHECK
--     pins the closed set; a drift cannot leak at the data
--     layer.
--
--   * `credential_ref` is NEVER inherited — overrides must
--     supply their own. The runtime enforces this in
--     `checkDivergenceRules` (override.ts); the column is
--     plain text because the secret value is in `@fora/secrets-mcp`
--     (FORA-128) keyed off this ref.
--
--   * `attested_at` + `attestation_expires_at` carry the 90-day
--     re-attestation cadence. The nightly sweeper in
--     `detectExpiredAttestations` (override.ts) marks overdue
--     rows as `attesting` and emits
--     `connector.binding.attestation_expired`.
--
-- Per-tenant isolation (FORA-126 / 0.7.2a):
--   - `tenant_id` is the first column of the PRIMARY KEY so the
--     `TenantAwarePool` (FORA-163) + `SET LOCAL app.tenant_id`
--     binds every read to the verified broker claim.
--   - FORCE ROW LEVEL SECURITY + a per-table policy mirrors the
--     pattern from migration 0005 / 0008. The migration role
--     holds BYPASSRLS (granted in 0001); the runtime role does
--     not.
--
-- Forward-only per architecture.md §6 / coding.md §2. Inverse
-- operations are documented as comments; DROP is a DBA action
-- per ADR-0009 §6 and uses 1Password-held credentials.
--
-- Sub-task: FORA-485 (FORA-391.3 — Tenant-scoped connector
-- config service). Owner: SeniorEngineer. Spec source: Plan 4
-- (FORA-391) + FORA-399 (Multi-Tenancy) + FORA-407 (Foundation).

BEGIN;

-- ---------------------------------------------------------------------------
-- connector_binding — one row per (tenant, Keycloak binding_id) tuple.
-- ---------------------------------------------------------------------------
--
-- The `auth_method` enum is the closed set Plan 4 permits plus
-- the Auditor-only `forge_operator_fallback` sentinel for step
-- 4 of the resolver. The runtime narrows step 4 to that method;
-- the DB CHECK rejects typos at the data layer.
--
-- The `status` enum is the closed lifecycle set:
--   pending      — onboarding wizard's transient state
--   active       — the only state the resolver accepts
--   attesting    — set by the 90-day sweeper; resolver refuses
--   revoked      — terminal; revoked_reason is required (set at
--                  the runtime API and validated here)
--   orphaned     — set when a tenant default is revoked but
--                  overrides still reference its auth_method
--
-- The `diverged_fields` column is the closed set Plan 4 permits
-- the Architect to diverge: `auth_method` only. The CHECK pins
-- the closed set so a drift cannot leak at the data layer.
--
-- The `depth` column caps at 3 (Plan 4 + Keycloak admin gate);
-- the runtime `TenantInheritanceDepthExceededError` is the
-- consumer-side companion.
CREATE TABLE IF NOT EXISTS connector_binding (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id               TEXT        NOT NULL,   -- Keycloak client UUID
  tenant_id                TEXT        NOT NULL,
  project_id               TEXT,                  -- NULL = tenant default
  connector_id             TEXT        NOT NULL,
  auth_method              TEXT        NOT NULL
                           CHECK (auth_method IN (
                             'oidc',
                             'pat',
                             'oauth2',
                             'service_account',
                             'api_key',
                             'forge_operator_fallback'
                           )),
  credential_ref           TEXT        NOT NULL,   -- secrets-mcp ref
  scopes                   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  status                   TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN (
                             'pending',
                             'active',
                             'attesting',
                             'revoked',
                             'orphaned'
                           )),
  last_health_check_at     TIMESTAMPTZ,
  last_success_at          TIMESTAMPTZ,
  last_failure_at          TIMESTAMPTZ,
  parent_tenant_id         TEXT,                  -- chain source tenant
  depth                    INTEGER     NOT NULL DEFAULT 0
                           CHECK (depth >= 0 AND depth <= 3),
  diverged_fields          JSONB                 -- closed set: ['auth_method']
                           CHECK (
                             diverged_fields IS NULL
                             OR jsonb_typeof(diverged_fields) = 'array'
                           ),
  attested_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  attested_by              TEXT        NOT NULL,
  attestation_expires_at   TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '90 days',
  revoked_reason           TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               TEXT        NOT NULL,
  updated_by               TEXT        NOT NULL
);

-- Idempotent create: one row per (tenant, Keycloak binding_id).
-- The onboarding wizard's retry path relies on this.
CREATE UNIQUE INDEX IF NOT EXISTS connector_binding_natural_key
  ON connector_binding (tenant_id, binding_id);

-- Resolver step 1: project override hot lookup.
-- `project_id IS NOT NULL` keeps the index narrow to override rows.
CREATE INDEX IF NOT EXISTS connector_binding_project_override_idx
  ON connector_binding (tenant_id, project_id, connector_id, auth_method)
  WHERE project_id IS NOT NULL
    AND status IN ('pending', 'active', 'attesting');

-- Resolver step 2: tenant default hot lookup.
-- `project_id IS NULL` keeps the index narrow to default rows.
CREATE INDEX IF NOT EXISTS connector_binding_tenant_default_idx
  ON connector_binding (tenant_id, connector_id, auth_method)
  WHERE project_id IS NULL
    AND status IN ('pending', 'active', 'attesting');

-- Resolver step 3: tenant inherited hot lookup.
-- `depth > 0` keeps the index narrow to chain rows; depth 1..3.
CREATE INDEX IF NOT EXISTS connector_binding_inherited_idx
  ON connector_binding (depth, connector_id, auth_method)
  WHERE depth > 0
    AND status = 'active';

-- Resolver step 4: forge_operator_fallback hot lookup.
-- The single-row-per-tenant expected shape; partial WHERE pins
-- the Auditor-only auth_method.
CREATE INDEX IF NOT EXISTS connector_binding_forge_operator_idx
  ON connector_binding (tenant_id)
  WHERE auth_method = 'forge_operator_fallback'
    AND status = 'active';

-- Orphan-risk sweeper: list active project overrides per
-- (tenant, connector, auth_method).
CREATE INDEX IF NOT EXISTS connector_binding_active_overrides_idx
  ON connector_binding (tenant_id, connector_id, auth_method)
  WHERE project_id IS NOT NULL
    AND status = 'active';

-- 90-day re-attestation sweeper: list active rows whose
-- attestation_expires_at is past due.
CREATE INDEX IF NOT EXISTS connector_binding_attestation_due_idx
  ON connector_binding (tenant_id, connector_id, attestation_expires_at)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- connector_binding_audit — append-only materialised view of
-- `connector.binding.*` events.
-- ---------------------------------------------------------------------------
--
-- The runtime audit emitter (apps/connector-config/src/audit.ts)
-- writes to this table via the FORA-36 forwarder. The table is
-- append-only — no UPDATE / DELETE — and per ADR-0009 §5 a
-- tamper check is the FORA-204 nightly divergence cron.
--
-- The closed event_type set mirrors the CHECK in
-- apps/connector-config/src/audit.ts. New event types are a
-- forward migration; the column CHECK rejects typos at the DB
-- layer.
--
-- Per the FORA-126 / 0.7.2a pattern, `tenant_id` is the first
-- column of the PRIMARY KEY so the `TenantAwarePool` binds every
-- read to the request claim. The audit sink is tenant-scoped:
-- a cross-tenant read is rejected at the DB layer even before
-- the application-level tenant check.
CREATE TABLE IF NOT EXISTS connector_binding_audit (
  tenant_id      TEXT        NOT NULL,
  event_id       UUID        NOT NULL,
  event_type     TEXT        NOT NULL
                 CHECK (event_type IN (
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
  binding_id     TEXT,                          -- NULL on miss events
  connector_id   TEXT        NOT NULL,
  project_id     TEXT,                          -- NULL on tenant-default
  auth_method    TEXT,                          -- NULL on system events
  actor_id       TEXT        NOT NULL,
  actor_role     TEXT        NOT NULL,
  trace_id       TEXT        NOT NULL,
  emitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  prev_event_id  UUID,                          -- hash-chain link
  chain_hash     TEXT,                          -- tamper check
  PRIMARY KEY (tenant_id, event_id)
);

-- Hot lookup: events for a single (tenant, binding_id) ordered
-- by emitted_at. The resolver's invalidation hook + the
-- FORA-36 forwarder both use this view.
CREATE INDEX IF NOT EXISTS connector_binding_audit_binding_idx
  ON connector_binding_audit (tenant_id, binding_id, emitted_at);

-- Hot lookup: per-(tenant, connector) event stream for the
-- FORA-204 nightly divergence cron.
CREATE INDEX IF NOT EXISTS connector_binding_audit_connector_idx
  ON connector_binding_audit (tenant_id, connector_id, emitted_at);

-- ---------------------------------------------------------------------------
-- Row-Level Security (FORA-126 / 0.7.2a tenancy pattern).
-- ---------------------------------------------------------------------------
--
-- Per the FORA-126 / 0.7.2a tenancy pattern, both tables are
-- FORCE'd to RLS and the policy binds reads + writes to
-- `current_setting('app.tenant_id')`. The `TenantAwarePool`
-- (packages/db-pool) sets the GUC on every checkout, so a stray
-- cross-tenant query is rejected at the DB layer (defence in
-- depth on top of the application-level tenant_id check in
-- ConnectorBindingRepo).
--
-- The migration role (0001) holds BYPASSRLS so it can create
-- the tables; the application role (the runtime) does not. Per
-- ADR-0003 §4.2 this is the runtime gate; the application-level
-- check in the repo is the first gate.
--
-- `connector_binding_audit` is append-only; the RLS policy
-- blocks UPDATE / DELETE (no WITH CHECK that allows mutation
-- of the immutable columns). The runtime path that writes to
-- it is the FORA-36 forwarder, which uses the migration role.
ALTER TABLE connector_binding       ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_binding       FORCE  ROW LEVEL SECURITY;
ALTER TABLE connector_binding_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_binding_audit FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connector_binding_tenant_isolation ON connector_binding;
CREATE POLICY connector_binding_tenant_isolation ON connector_binding
  USING       (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', TRUE));

DROP POLICY IF EXISTS connector_binding_audit_tenant_isolation
  ON connector_binding_audit;
CREATE POLICY connector_binding_audit_tenant_isolation
  ON connector_binding_audit
  USING       (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', TRUE));

COMMIT;
