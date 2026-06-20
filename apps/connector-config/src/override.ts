/**
 * @fora/connector-config — override rules + divergence logic.
 *
 * Implements the override rules from Plan 4 (FORA-391.3):
 *
 *   * Must inherit `auth_method` unless the Architect role
 *     explicitly diverges (logged with `diverged_fields:
 *     ["auth_method"]`).
 *   * Never inherits `credential_ref` — overrides must supply
 *     their own.
 *   * Revoking the tenant default does NOT auto-revoke overrides;
 *     orphaned overrides emit `connector.binding.orphan_risk`
 *     daily.
 *   * Overrides older than 90 days require Architect re-
 *     attestation.
 *
 * Sub-task: FORA-485. Spec source: Plan 4 (FORA-391.3).
 *
 * ---- Why the override layer is its own module --------------------------------
 *
 * The repo owns the SQL; the resolver owns the read path; the
 * onboarding flow owns tenant-default creation. Override creation
 * sits between them — it composes the repo + audit emitter +
 * divergence check + inheritance walk — and the policy is dense
 * enough that a dedicated module keeps the rule set auditable.
 *
 * The rule set is pinned by the plan and is the only place the
 * "auth_method inherits unless Architect diverges" rule lives.
 * Tests in `./test/override.test.ts` assert each rule.
 */

import type { ScopedClient, TenantId, ActorId } from '@fora/db-pool';
import { ConnectorBindingRepo } from './repo.js';
import {
  buildEvent,
  mintEventId,
  userActor,
  systemActor,
  type ConnectorBindingAuditSink,
  type ConnectorBindingEvent,
} from './audit.js';
import type {
  AuthMethod,
  ConnectorBinding,
  ConnectorId,
  CreateBindingInput,
  DivergedField,
  RealAuthMethod,
  ResolverActor,
} from './types.js';
import { OverrideDivergenceError } from './types.js';

// ---------------------------------------------------------------------------
// Override creation input
// ---------------------------------------------------------------------------

/**
 * The override-creation input. Distinct from `CreateBindingInput`
 * because the divergence check needs the inherited `auth_method`
 * (for the rule "must inherit unless Architect diverges") and the
 * actor (for the role check).
 */
export interface CreateProjectOverrideInput {
  readonly tenant_id: TenantId;
  readonly project_id: string;
  readonly connector_id: ConnectorId;
  /** The override's auth_method. Must equal the inherited one unless Architect. */
  readonly auth_method: RealAuthMethod;
  /** Required. credential_ref is NEVER inherited. */
  readonly credential_ref: string;
  readonly scopes?: ReadonlyArray<string>;
  readonly actor: ResolverActor;
  /** Optional pre-existing binding_id (Keycloak client UUID). */
  readonly binding_id?: string;
}

// ---------------------------------------------------------------------------
// Inheritance probe
// ---------------------------------------------------------------------------

/**
 * Probe the inheritance chain for the auth_method the override
 * would inherit. Walks the same five steps as the resolver,
 * but returns the first match (no cache, no MISS audit) — the
 * override-creation path needs the inherited auth_method to
 * apply the divergence rule.
 *
 * Returns `null` if the chain has no active binding for this
 * `(tenant, project, connector)` tuple. The caller decides
 * whether to fail the override creation or fall back to
 * creating a brand-new chain.
 */
export async function probeInheritedAuthMethod(args: {
  client: ScopedClient;
  tenant_id: TenantId;
  project_id: string;
  connector_id: ConnectorId;
}): Promise<AuthMethod | null> {
  const repo = new ConnectorBindingRepo(args.client);

  // Step 1: project override (existing) — the override would
  // inherit from a prior project override at the same connector.
  // Skip this for a brand-new override; the resolver steps 1/2/3
  // are the source of truth for "what would this binding inherit".
  // For a new override, the chain starts at step 2.
  const tenantDefault = await repo.findTenantDefaultAnyAuthMethod({
    tenant_id: args.tenant_id,
    connector_id: args.connector_id,
  });
  if (tenantDefault) return tenantDefault.auth_method;

  // Step 3: walk parent tenants.
  for (let depth = 1; depth <= 3; depth++) {
    const inherited = await repo.findInheritedBindingAnyAuthMethod({
      parent_tenant_id: args.tenant_id,
      depth,
      connector_id: args.connector_id,
    });
    if (inherited) return inherited.auth_method;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Divergence check
// ---------------------------------------------------------------------------

/**
 * The closed divergence rule set. Encoded as a single function
 * so the rule surface is auditable in one place.
 *
 *   1. credential_ref is NEVER inherited — overrides must supply
 *      a non-empty credential_ref. (Plan 4 invariant.)
 *   2. auth_method MUST equal the inherited value unless the
 *      actor is an Architect. (Plan 4 invariant.)
 *   3. depth + parent_tenant_id, when supplied, must satisfy
 *      1 <= depth <= 3. (Plan 4 + migration CHECK.)
 *   4. diverged_fields is closed — only `auth_method` is
 *      permitted. (Migration CHECK + plan invariant.)
 *
 * On violation the function throws `OverrideDivergenceError`;
 * the onboarding / admin path catches and surfaces the reason.
 */
export function checkDivergenceRules(args: {
  input: CreateProjectOverrideInput;
  inherited_auth_method: AuthMethod | null;
  /** Resolved tenant depth (1..3) when the override is inherited. */
  resolved_depth?: number;
}): void {
  // Rule 1: credential_ref is NEVER inherited.
  if (
    !args.input.credential_ref ||
    args.input.credential_ref.trim().length === 0
  ) {
    throw new OverrideDivergenceError(
      'credential_ref',
      'override must supply a non-empty credential_ref (never inherited)',
    );
  }

  // Rule 2: auth_method must inherit unless Architect diverges.
  if (
    args.inherited_auth_method !== null &&
    args.input.auth_method !== args.inherited_auth_method &&
    args.input.actor.role !== 'architect'
  ) {
    throw new OverrideDivergenceError(
      'role',
      `auth_method=${args.input.auth_method} diverges from inherited ` +
        `auth_method=${args.inherited_auth_method}; only the Architect ` +
        `role may diverge (actor role=${args.input.actor.role})`,
    );
  }

  // Rule 3: depth must be 0 (project-owned) or 1..3 (inherited).
  if (args.resolved_depth !== undefined) {
    if (args.resolved_depth < 0 || args.resolved_depth > 3) {
      throw new OverrideDivergenceError(
        'depth',
        `depth=${args.resolved_depth} outside the 0..3 cap`,
      );
    }
  }

  // Rule 4: diverged_fields is closed to 'auth_method' only.
  // (Implicit — CreateProjectOverrideInput does not accept
  // diverged_fields; the repo's create() pins the column.)
}

// ---------------------------------------------------------------------------
// Divergence record
// ---------------------------------------------------------------------------

/**
 * The shape of the divergence record emitted to
 * `connector.binding.diverged` when an Architect diverges an
 * override's auth_method from the inherited value.
 */
export interface DivergenceRecord {
  readonly tenant_id: TenantId;
  readonly binding_id: string;
  readonly connector_id: ConnectorId;
  readonly project_id: string;
  readonly diverged_fields: ReadonlyArray<DivergedField>;
  readonly inherited_auth_method: AuthMethod;
  readonly override_auth_method: AuthMethod;
}

/**
 * Compute the divergence record for an override that has just
 * been created. Returns `null` if no divergence occurred
 * (the override's auth_method equals the inherited value).
 */
export function buildDivergenceRecord(args: {
  tenant_id: TenantId;
  binding_id: string;
  connector_id: ConnectorId;
  project_id: string;
  override_auth_method: AuthMethod;
  inherited_auth_method: AuthMethod | null;
}): DivergenceRecord | null {
  if (
    args.inherited_auth_method === null ||
    args.override_auth_method === args.inherited_auth_method
  ) {
    return null;
  }
  return {
    tenant_id: args.tenant_id,
    binding_id: args.binding_id,
    connector_id: args.connector_id,
    project_id: args.project_id,
    diverged_fields: ['auth_method'],
    inherited_auth_method: args.inherited_auth_method,
    override_auth_method: args.override_auth_method,
  };
}

/**
 * Emit the `connector.binding.diverged` audit event for an
 * Architect-diverged override. No-op when the divergence
 * record is `null` (the override's auth_method matched the
 * inherited value).
 */
export async function emitDivergence(
  audit: ConnectorBindingAuditSink,
  actor: ResolverActor,
  record: DivergenceRecord | null,
): Promise<void> {
  if (record === null) return;
  const now = new Date().toISOString();
  const event: ConnectorBindingEvent = buildEvent({
    event_id: mintEventId(),
    event_type: 'connector.binding.diverged',
    tenant_id: record.tenant_id,
    binding_id: record.binding_id,
    connector_id: record.connector_id,
    project_id: record.project_id,
    auth_method: record.override_auth_method,
    actor: userActor(actor.actor_id, actor.role, actor.trace_id),
    emitted_at: now,
    metadata: {
      diverged_fields: record.diverged_fields,
      inherited_auth_method: record.inherited_auth_method,
    },
  });
  await audit.append(event);
}

// ---------------------------------------------------------------------------
// Orphan-risk detection
// ---------------------------------------------------------------------------

/**
 * Detect orphan-risk overrides: project overrides whose parent
 * tenant default has been revoked (or is missing) but the
 * override itself is still `active`. Plan 4 calls for a daily
 * `connector.binding.orphan_risk` audit event per override.
 *
 * The function is idempotent; the audit forwarder is the
 * durable record. The sweeper calls this daily.
 */
export async function detectOrphanRisk(args: {
  client: ScopedClient;
  audit: ConnectorBindingAuditSink;
  tenant_id: TenantId;
  connector_id: ConnectorId;
  auth_method: AuthMethod;
  now?: () => string;
}): Promise<ReadonlyArray<string>> {
  const repo = new ConnectorBindingRepo(args.client);
  const overrides = await repo.listActiveProjectOverrides({
    tenant_id: args.tenant_id,
    connector_id: args.connector_id,
    auth_method: args.auth_method,
  });
  const tenantDefault = await repo.findTenantDefault({
    tenant_id: args.tenant_id,
    connector_id: args.connector_id,
    auth_method: args.auth_method,
  });
  if (tenantDefault !== null && tenantDefault.status === 'active') return [];

  const emitted: string[] = [];
  const now = (args.now ?? (() => new Date().toISOString()))();
  for (const override of overrides) {
    const event_id = mintEventId();
    const event: ConnectorBindingEvent = buildEvent({
      event_id,
      event_type: 'connector.binding.orphan_risk',
      tenant_id: args.tenant_id,
      binding_id: override.binding_id,
      connector_id: args.connector_id,
      project_id: override.project_id,
      auth_method: args.auth_method,
      actor: systemActor('orphan_sweeper'),
      emitted_at: now,
      metadata: {
        parent_default_revoked_reason:
          tenantDefault?.revoked_reason ?? '<no parent default>',
        parent_default_revoked_at:
          tenantDefault?.updated_at ?? new Date(0).toISOString(),
      },
    });
    await args.audit.append(event);
    emitted.push(event_id);
  }
  return emitted;
}

// ---------------------------------------------------------------------------
// 90-day re-attestation
// ---------------------------------------------------------------------------

/**
 * Detect overrides whose `attestation_expires_at` is past due.
 * The resolver refuses such rows; the sweeper calls this to
 * flip them to `status='attesting'` and emit
 * `connector.binding.attestation_expired`.
 *
 * Returns the list of binding_ids that were marked attesting.
 */
export async function detectExpiredAttestations(args: {
  client: ScopedClient;
  audit: ConnectorBindingAuditSink;
  tenant_id: TenantId;
  connector_id: ConnectorId;
  now?: () => string;
}): Promise<ReadonlyArray<string>> {
  const repo = new ConnectorBindingRepo(args.client);
  // Query by connector + tenant; the repo does not have a
  // "list by expiry" primitive, so we inline the SQL here via
  // a tenant-scoped read.
  // (Implementation note: a `listExpiredByConnector` repo method
  //  would be cleaner; for v0.1 we use the same SQL pattern as
  //  the attestation sweeper in the migration.)
  // The sweeper is run by the connector-config worker, not the
  // hot resolver path, so an extra read is acceptable.
  const client = args.client;
  const result = await client.query<{
    binding_id: string;
    attestation_expires_at: string;
  }>(
    `SELECT binding_id, attestation_expires_at
       FROM connector_binding
      WHERE tenant_id = $1
        AND connector_id = $2
        AND status = 'active'
        AND attestation_expires_at < now()`,
    [args.tenant_id, args.connector_id],
  );

  const emitted: string[] = [];
  const now = (args.now ?? (() => new Date().toISOString()))();
  for (const row of result.rows) {
    await repo.markAttesting({
      tenant_id: args.tenant_id,
      binding_id: row.binding_id,
      actor: 'system:attestation_sweeper' as ActorId,
    });
    const overdue_ms = Date.now() - new Date(row.attestation_expires_at).getTime();
    const days_overdue = Math.max(0, Math.floor(overdue_ms / (1000 * 60 * 60 * 24)));
    const event_id = mintEventId();
    const event: ConnectorBindingEvent = buildEvent({
      event_id,
      event_type: 'connector.binding.attestation_expired',
      tenant_id: args.tenant_id,
      binding_id: row.binding_id,
      connector_id: args.connector_id,
      project_id: null,
      auth_method: null,
      actor: systemActor('attestation_sweeper'),
      emitted_at: now,
      metadata: {
        attestation_expires_at: row.attestation_expires_at,
        days_overdue,
      },
    });
    await args.audit.append(event);
    emitted.push(row.binding_id);
  }
  return emitted;
}

// ---------------------------------------------------------------------------
// Override creation orchestrator
// ---------------------------------------------------------------------------

/**
 * Create a project override. Composes:
 *   - probeInheritedAuthMethod (read path)
 *   - checkDivergenceRules (rule enforcement)
 *   - ConnectorBindingRepo.create (write path)
 *   - emitDivergence (audit emission on Architect divergence)
 *
 * Returns the created binding. Throws `OverrideDivergenceError`
 * on rule violation; the onboarding / admin path surfaces the
 * reason.
 */
export async function createProjectOverride(args: {
  client: ScopedClient;
  audit: ConnectorBindingAuditSink;
  input: CreateProjectOverrideInput;
}): Promise<ConnectorBinding> {
  const inherited = await probeInheritedAuthMethod({
    client: args.client,
    tenant_id: args.input.tenant_id,
    project_id: args.input.project_id,
    connector_id: args.input.connector_id,
  });

  checkDivergenceRules({
    input: args.input,
    inherited_auth_method: inherited,
  });

  const repo = new ConnectorBindingRepo(args.client);
  const binding_id =
    args.input.binding_id ??
    // Mint a v4 UUID for the binding_id when the caller did not
    // supply one. Production wires this to a Keycloak client
    // UUID minted by the IdP broker.
    crypto.randomUUID();

  const createInput: CreateBindingInput = {
    binding_id,
    tenant_id: args.input.tenant_id,
    project_id: args.input.project_id,
    connector_id: args.input.connector_id,
    auth_method: args.input.auth_method,
    credential_ref: args.input.credential_ref,
    scopes: args.input.scopes ?? [],
    parent_tenant_id: null,
    depth: 0,
    diverged_fields:
      inherited !== null && args.input.auth_method !== inherited
        ? ['auth_method']
        : null,
    attested_by: args.input.actor.actor_id,
    created_by: args.input.actor.actor_id,
  };

  const binding = await repo.create(createInput);

  // Emit the divergence audit event when Architect diverged.
  const record = buildDivergenceRecord({
    tenant_id: args.input.tenant_id,
    binding_id,
    connector_id: args.input.connector_id,
    project_id: args.input.project_id,
    override_auth_method: args.input.auth_method,
    inherited_auth_method: inherited,
  });
  await emitDivergence(args.audit, args.input.actor, record);

  return binding;
}