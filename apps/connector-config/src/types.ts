/**
 * @fora/connector-config — domain types.
 *
 * Implements Plan 4 (Tenant-Scoped Connector Config) on FORA-391.
 * Sub-task: FORA-485. Owner: SeniorEngineer.
 *
 * The types here are the public contract for the connector-config
 * service. The runtime types mirror the columns in migration
 * `0006_connector_binding.sql`; the resolver and onboarding flow
 * consume them via the repo (`./repo`) and the audit emitter
 * (`./audit`).
 *
 * ---- Conventions ------------------------------------------------------------
 *
 *   * `ConnectorId` is the canonical connector name (jira, github,
 *     slack, teams, sonarqube, figma, aws, azdo, zendesk, databricks,
 *     ...). The set is open at the data layer (text column) but the
 *     resolver only knows Tier-1 connectors per Plan 4.
 *
 *   * `AuthMethod` is the closed set of supported auth methods plus
 *     `forge_operator_fallback`, the Auditor-only sentinel for step 4
 *     of the resolver. The plan permits no other value; the runtime
 *     and the column CHECK constraint share the same enum.
 *
 *   * `BindingStatus` is the closed lifecycle enum. The resolver
 *     only accepts `active`; `attesting` is rejected until re-
 *     attested; `pending` / `revoked` / `orphaned` never resolve.
 *
 *   * `BindingId` is the Keycloak client UUID that backs the binding.
 *     One Keycloak client has at most one binding row per tenant;
 *     the unique index `(tenant_id, binding_id)` enforces that.
 *
 *   * `TenantId` / `ActorId` reuse the `@fora/db-pool` exports so
 *     request-context claims are typed end-to-end.
 */

import type { TenantId, ActorId } from '@fora/db-pool';

// ---------------------------------------------------------------------------
// Connector identity
// ---------------------------------------------------------------------------

/**
 * The closed enum of connector identifiers the runtime knows how
 * to resolve. Tier-1 per Plan 4 §2. The data layer accepts any
 * text; the resolver only short-circuits to MISS for unknown
 * connectors (never to a stale Tier-1 binding).
 */
export type ConnectorId =
  | 'jira'
  | 'github'
  | 'gitlab'
  | 'slack'
  | 'teams'
  | 'sonarqube'
  | 'figma'
  | 'aws'
  | 'azdo'
  | 'zendesk'
  | 'databricks';

/** Set of Tier-1 connector ids, exported for resolvers and tests. */
export const TIER_1_CONNECTORS: ReadonlyArray<ConnectorId> = [
  'jira',
  'github',
  'gitlab',
  'slack',
  'teams',
  'sonarqube',
  'figma',
  'aws',
  'azdo',
  'zendesk',
  'databricks',
] as const;

// ---------------------------------------------------------------------------
// Auth methods
// ---------------------------------------------------------------------------

/**
 * The closed enum of auth methods. Mirrors the column CHECK in
 * `0006_connector_binding.sql`. `forge_operator_fallback` is the
 * Auditor-only sentinel for step 4 of the resolver; the runtime
 * narrows step 4 to that method regardless of who the request actor
 * is.
 */
export type AuthMethod =
  | 'oidc'
  | 'pat'
  | 'oauth2'
  | 'service_account'
  | 'api_key'
  | 'forge_operator_fallback';

/** The five real auth methods (excludes the Auditor fallback). */
export type RealAuthMethod = Exclude<AuthMethod, 'forge_operator_fallback'>;

/**
 * The closed set of fields an Architect may diverge from the
 * inherited value. Plan 4 permits ONLY `auth_method`; the runtime
 * logs `diverged_fields: ["auth_method"]` on divergence and the
 * column CHECK pins the closed set so a drift cannot leak.
 */
export type DivergedField = 'auth_method';

/**
 * Non-null helper for the closed set. Used at the repo ↔ row
 * boundary where the column is non-null.
 */
export type DivergedFieldArray = ReadonlyArray<DivergedField>;
export const DIVERGED_FIELDS_CLOSED_SET: ReadonlyArray<DivergedField> = [
  'auth_method',
] as const;

// ---------------------------------------------------------------------------
// Lifecycle status
// ---------------------------------------------------------------------------

/**
 * The closed lifecycle enum. Mirrors the column CHECK in
 * `0006_connector_binding.sql`.
 *
 *   pending     — onboarding wizard's transient state; never resolves
 *   active      — the only state that resolves
 *   attesting   — set by the nightly sweeper 90 days after attested_at;
 *                 the resolver refuses it
 *   revoked     — terminal; revoked_reason is required
 *   orphaned    — set when a tenant default is revoked but overrides
 *                 still reference its auth_method
 */
export type BindingStatus =
  | 'pending'
  | 'active'
  | 'attesting'
  | 'revoked'
  | 'orphaned';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/**
 * A binding row. The runtime shape; the repo maps this 1:1 from
 * the `connector_binding` table. `project_id` is `null` for tenant
 * defaults.
 */
export interface ConnectorBinding {
  readonly id: string;
  readonly binding_id: string;
  readonly tenant_id: TenantId;
  readonly project_id: string | null;
  readonly connector_id: ConnectorId;
  readonly auth_method: AuthMethod;
  readonly credential_ref: string;
  readonly scopes: ReadonlyArray<string>;
  readonly status: BindingStatus;
  readonly last_health_check_at: string | null;
  readonly last_success_at: string | null;
  readonly last_failure_at: string | null;
  readonly parent_tenant_id: TenantId | null;
  readonly depth: number;
  readonly diverged_fields: ReadonlyArray<DivergedField> | null;
  readonly attested_at: string;
  readonly attested_by: string;
  readonly attestation_expires_at: string;
  readonly revoked_reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_by: ActorId;
  readonly updated_by: ActorId;
}

/**
 * The input for creating a binding. The repo infers `attested_at`,
 * `attestation_expires_at`, `id`, `created_at`, `updated_at` from
 * server defaults; the caller supplies identity + config.
 *
 * For tenant defaults, pass `project_id: null`. For project
 * overrides, pass the project UUID. The runtime rejects an
 * override with `auth_method='forge_operator_fallback'` because
 * the fallback is Auditor-only and never inherits.
 */
export interface CreateBindingInput {
  readonly binding_id: string;
  readonly tenant_id: TenantId;
  readonly project_id: string | null;
  readonly connector_id: ConnectorId;
  readonly auth_method: RealAuthMethod;
  readonly credential_ref: string;
  readonly scopes?: ReadonlyArray<string>;
  readonly parent_tenant_id?: TenantId | null;
  readonly depth?: number;
  readonly diverged_fields?: ReadonlyArray<DivergedField> | null;
  readonly attested_by: ActorId;
  readonly created_by: ActorId;
}

/**
 * The input for revoking a binding. `revoked_reason` is required
 * at the runtime API and the column CHECK constraint enforces it.
 */
export interface RevokeBindingInput {
  readonly tenant_id: TenantId;
  readonly binding_id: string;
  readonly revoked_reason: string;
  readonly revoked_by: ActorId;
}

// ---------------------------------------------------------------------------
// Resolver types
// ---------------------------------------------------------------------------

/**
 * The resolver input. `auth_method` is the method the request wants
 * to use; the resolver still enforces inheritance rules per Plan 4.
 * The actor carries the role so step 4 (forge_operator_fallback)
 * can be gated to Auditor role only.
 */
export interface ResolveBindingInput {
  readonly tenant_id: TenantId;
  readonly project_id: string | null;
  readonly connector_id: ConnectorId;
  readonly auth_method: RealAuthMethod;
  readonly actor: ResolverActor;
}

/**
 * The actor envelope the resolver consumes. The role is the
 * IdP-asserted role on the request claim; the resolver narrows
 * step 4 to `role === 'auditor'` and refuses any other role for
 * `auth_method='forge_operator_fallback'`.
 */
export interface ResolverActor {
  readonly actor_id: ActorId;
  readonly role: ResolverRole;
  readonly trace_id: string;
}

/**
 * The closed set of resolver roles. Mirrors the FORA-50 §2.4
 * role table. The Architect role is the only role that can
 * diverge an override's `auth_method` from the inherited value.
 */
export type ResolverRole =
  | 'admin'
  | 'engineer'
  | 'architect'
  | 'qa'
  | 'security'
  | 'devops'
  | 'docs'
  | 'pm'
  | 'auditor'
  | 'cto'
  | 'ceo'
  | 'board';

/**
 * The five steps the resolver walks in order. Mirrors the plan:
 * 1. Project override
 * 2. Tenant default
 * 3. Tenant inherited (depth ≤ 3)
 * 4. forge_operator fallback (Auditor only)
 * 5. MISS
 */
export type ResolverStep =
  | 'project_override'
  | 'tenant_default'
  | 'tenant_inherited'
  | 'forge_operator_fallback'
  | 'miss';

/**
 * The resolver result. `step` is the step that produced the
 * binding; `miss` is `true` iff the resolver fell through to
 * step 5 (and emitted a `connector.binding.missing` audit event).
 */
export type ResolveBindingResult =
  | {
      readonly binding: ConnectorBinding;
      readonly step: Exclude<ResolverStep, 'miss'>;
      readonly cache_hit: boolean;
    }
  | {
      readonly binding: null;
      readonly step: 'miss';
      readonly cache_hit: boolean;
      readonly miss_event_id: string;
    };

// ---------------------------------------------------------------------------
// Onboarding types
// ---------------------------------------------------------------------------

/**
 * The onboarding wizard's input per Tier-1 connector. The wizard
 * creates one binding per connector (typically the tenant default,
 * no project override) and emits `connector.binding.created` per
 * binding. On success the tenant is activated and the
 * `forge_operator_fallback` (if any) is auto-revoked.
 */
export interface OnboardTenantInput {
  readonly tenant_id: TenantId;
  readonly connectors: ReadonlyArray<Tier1OnboardConnector>;
  readonly actor: ResolverActor;
}

/**
 * One Tier-1 connector entry in the onboarding wizard. The
 * wizard creates a tenant-default binding (project_id=null) for
 * each entry; project overrides are created later via the
 * override-creation path, never during onboarding.
 */
export interface Tier1OnboardConnector {
  readonly connector_id: ConnectorId;
  readonly auth_method: RealAuthMethod;
  readonly credential_ref: string;
  readonly scopes?: ReadonlyArray<string>;
}

/**
 * The onboarding result. `created` lists the new binding ids
 * (in submission order); `forge_operator_revoked` lists any
 * `forge_operator_fallback` bindings that were auto-revoked on
 * successful activation.
 */
export interface OnboardTenantResult {
  readonly created: ReadonlyArray<string>;
  readonly forge_operator_revoked: ReadonlyArray<string>;
  readonly tenant_activated: boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the resolver falls through to step 5 (MISS). The
 * resolver has already emitted `connector.binding.missing`; the
 * caller surfaces the message to the request and the audit chain
 * is the durable record.
 */
export class ConnectorBindingMissingError extends Error {
  readonly tenant_id: TenantId;
  readonly project_id: string | null;
  readonly connector_id: ConnectorId;
  readonly auth_method: AuthMethod;
  readonly miss_event_id: string;

  constructor(args: {
    tenant_id: TenantId;
    project_id: string | null;
    connector_id: ConnectorId;
    auth_method: AuthMethod;
    miss_event_id: string;
  }) {
    super(
      `connector binding missing for tenant=${args.tenant_id} ` +
        `project=${args.project_id ?? '<tenant-default>'} ` +
        `connector=${args.connector_id} ` +
        `auth_method=${args.auth_method} ` +
        `(miss_event_id=${args.miss_event_id})`,
    );
    this.name = 'ConnectorBindingMissingError';
    this.tenant_id = args.tenant_id;
    this.project_id = args.project_id;
    this.connector_id = args.connector_id;
    this.auth_method = args.auth_method;
    this.miss_event_id = args.miss_event_id;
  }
}

/**
 * Thrown when an override-creation or mutation request violates
 * the divergence rule (e.g. non-Architect attempting to diverge
 * `auth_method`, or override without explicit `credential_ref`).
 */
export class OverrideDivergenceError extends Error {
  readonly rule: 'auth_method' | 'credential_ref' | 'role' | 'depth';
  constructor(rule: OverrideDivergenceError['rule'], detail: string) {
    super(`override divergence: ${rule} — ${detail}`);
    this.name = 'OverrideDivergenceError';
    this.rule = rule;
  }
}

/**
 * Thrown when the resolver reaches depth > 3 in the inheritance
 * walk. The Keycloak layer should reject this at admin time; the
 * runtime CHECK is a defence in depth so a misconfigured admin
 * cannot blow past the cap.
 */
export class TenantInheritanceDepthExceededError extends Error {
  readonly tenant_id: TenantId;
  readonly attempted_depth: number;
  constructor(args: { tenant_id: TenantId; attempted_depth: number }) {
    super(
      `tenant inheritance depth cap exceeded for tenant=${args.tenant_id} ` +
        `(attempted=${args.attempted_depth}, cap=3)`,
    );
    this.name = 'TenantInheritanceDepthExceededError';
    this.tenant_id = args.tenant_id;
    this.attempted_depth = args.attempted_depth;
  }
}

/**
 * Thrown when an actor that is not an Auditor attempts to use
 * the `forge_operator_fallback` binding. Step 4 of the resolver
 * is gated to Auditor role only.
 */
export class ForgeOperatorFallbackForbiddenError extends Error {
  readonly actor_id: ActorId;
  readonly actor_role: ResolverRole;
  constructor(actor_id: ActorId, actor_role: ResolverRole) {
    super(
      `forge_operator_fallback requires Auditor role (actor=${actor_id}, ` +
        `role=${actor_role})`,
    );
    this.name = 'ForgeOperatorFallbackForbiddenError';
    this.actor_id = actor_id;
    this.actor_role = actor_role;
  }
}