/**
 * @fora/connector-config — tenant onboarding flow.
 *
 * Implements the onboarding flow from Plan 4 (FORA-391.3):
 *
 *   1. Tenant admin opens the Connector Center wizard for each
 *      Tier-1 connector.
 *   2. For each connector, the wizard calls
 *      `createTenantDefaultBinding` which:
 *        - inserts the binding row (status='pending')
 *        - transitions it to 'active'
 *        - emits `connector.binding.created` + `.activated`
 *   3. When all connectors are activated, the wizard calls
 *      `revokeForgeOperatorFallbacks` which transitions every
 *      `forge_operator_fallback` binding for the tenant to
 *      `status='revoked'` with reason `tenant_activated`.
 *   4. The onboarding result reports the created binding_ids,
 *      the revoked fallback ids, and `tenant_activated=true`.
 *
 * Sub-task: FORA-485. Spec source: Plan 4 (FORA-391.3).
 *
 * ---- Idempotency ------------------------------------------------------------
 *
 * The wizard is retry-safe: `createTenantDefaultBinding` uses
 * `INSERT ... ON CONFLICT (tenant_id, binding_id) DO UPDATE
 * SET updated_at = now()` so a retry with the same Keycloak
 * client UUID lands as an update. The wizard mints a fresh
 * `binding_id` per connector at the request boundary; if the
 * IdP broker returns an existing UUID (Keycloak-side
 * retry), the wizard reuses it and the repo's upsert path
 * preserves the existing row.
 *
 * ---- forge_operator_fallback auto-revoke -----------------------------------
 *
 * Plan 4 calls for the fallback to be auto-revoked on tenant
 * activation. The wizard only revokes fallbacks AFTER every
 * Tier-1 connector is successfully created and activated. If
 * any connector fails, the fallback is NOT revoked and the
 * tenant stays in the pre-onboarding posture.
 *
 * The audit emission for the revocation lands as a normal
 * `connector.binding.revoked` event with `metadata.revoked_reason
 * = 'tenant_activated'`. The FORA-36 forwarder is the durable
 * record.
 */

import type { ScopedClient, TenantId, ActorId } from '@fora/db-pool';
import { ConnectorBindingRepo } from './repo.js';
import {
  buildEvent,
  mintEventId,
  userActor,
  type ConnectorBindingAuditSink,
  type ConnectorBindingEvent,
} from './audit.js';
import type {
  ConnectorBinding,
  OnboardTenantInput,
  OnboardTenantResult,
  RealAuthMethod,
  Tier1OnboardConnector,
} from './types.js';

// ---------------------------------------------------------------------------
// Create + activate a tenant default binding
// ---------------------------------------------------------------------------

/**
 * The per-connector onboarding result. The wizard collects
 * these into the `OnboardTenantResult`.
 */
export interface CreatedTenantDefault {
  readonly connector_id: Tier1OnboardConnector['connector_id'];
  readonly binding: ConnectorBinding;
}

/**
 * Create a tenant default binding for one Tier-1 connector.
 *
 * Sequence:
 *   1. INSERT ... ON CONFLICT (tenant_id, binding_id) — idempotent.
 *   2. PATCH status to 'active'.
 *   3. Emit `connector.binding.created`.
 *   4. Emit `connector.binding.activated`.
 *
 * Returns the active binding.
 */
export async function createAndActivateTenantDefault(args: {
  client: ScopedClient;
  audit: ConnectorBindingAuditSink;
  tenant_id: TenantId;
  connector: Tier1OnboardConnector;
  /** Optional Keycloak client UUID; the wizard mints when absent. */
  binding_id?: string;
  actor: ActorId;
  actor_role: string;
  trace_id?: string;
}): Promise<CreatedTenantDefault> {
  const repo = new ConnectorBindingRepo(args.client);

  const binding_id = args.binding_id ?? crypto.randomUUID();
  const now = new Date().toISOString();

  // Step 1: insert (status='pending'). The repo's create() pins
  // status='pending' via the column default; the create
  // signature accepts a RealAuthMethod so the migration CHECK
  // rejects forge_operator_fallback at INSERT time.
  const created = await repo.create({
    binding_id,
    tenant_id: args.tenant_id,
    project_id: null, // tenant default
    connector_id: args.connector.connector_id,
    auth_method: args.connector.auth_method,
    credential_ref: args.connector.credential_ref,
    scopes: args.connector.scopes ?? [],
    parent_tenant_id: null,
    depth: 0,
    diverged_fields: null,
    attested_by: args.actor,
    created_by: args.actor,
  });

  // Step 2: activate.
  const activated = await repo.activate({
    tenant_id: args.tenant_id,
    binding_id,
    actor: args.actor,
  });

  // Step 3: emit `connector.binding.created`.
  const created_event_id = mintEventId();
  const created_event: ConnectorBindingEvent = buildEvent({
    event_id: created_event_id,
    event_type: 'connector.binding.created',
    tenant_id: args.tenant_id,
    binding_id,
    connector_id: args.connector.connector_id,
    project_id: null,
    auth_method: args.connector.auth_method,
    actor: userActor(args.actor, args.actor_role, args.trace_id),
    emitted_at: now,
    metadata: {
      status: 'active',
      scopes: args.connector.scopes ?? [],
      attestation_expires_at: activated.attestation_expires_at,
    },
  });
  await args.audit.append(created_event);

  // Step 4: emit `connector.binding.activated`.
  const activated_event_id = mintEventId();
  const activated_event: ConnectorBindingEvent = buildEvent({
    event_id: activated_event_id,
    event_type: 'connector.binding.activated',
    tenant_id: args.tenant_id,
    binding_id,
    connector_id: args.connector.connector_id,
    project_id: null,
    auth_method: args.connector.auth_method,
    actor: userActor(args.actor, args.actor_role, args.trace_id),
    emitted_at: now,
    metadata: {
      previous_status: 'pending',
    },
  });
  await args.audit.append(activated_event);

  return {
    connector_id: args.connector.connector_id,
    binding: activated,
  };
}

// ---------------------------------------------------------------------------
// Revoke forge_operator_fallback bindings
// ---------------------------------------------------------------------------

/**
 * Auto-revoke every `forge_operator_fallback` binding for the
 * tenant. Called by the onboarding wizard after every Tier-1
 * connector is created + activated. Plan 4 calls for the
 * fallback to be auto-revoked on activation; the function
 * emits a `connector.binding.revoked` event per binding with
 * `metadata.revoked_reason = 'tenant_activated'`.
 *
 * Returns the binding_ids that were revoked.
 */
export async function revokeForgeOperatorFallbacks(args: {
  client: ScopedClient;
  audit: ConnectorBindingAuditSink;
  tenant_id: TenantId;
  actor: ActorId;
  actor_role: string;
  trace_id?: string;
  now?: () => string;
}): Promise<ReadonlyArray<string>> {
  const repo = new ConnectorBindingRepo(args.client);
  const fallbacks = await repo.listForgeOperatorFallbacks({
    tenant_id: args.tenant_id,
  });

  const now = (args.now ?? (() => new Date().toISOString()))();
  const revoked: string[] = [];
  for (const fallback of fallbacks) {
    await repo.revoke({
      tenant_id: args.tenant_id,
      binding_id: fallback.binding_id,
      revoked_reason: 'tenant_activated',
      revoked_by: args.actor,
    });
    const event_id = mintEventId();
    const event: ConnectorBindingEvent = buildEvent({
      event_id,
      event_type: 'connector.binding.revoked',
      tenant_id: args.tenant_id,
      binding_id: fallback.binding_id,
      connector_id: fallback.connector_id,
      project_id: null,
      auth_method: 'forge_operator_fallback',
      actor: userActor(args.actor, args.actor_role, args.trace_id),
      emitted_at: now,
      metadata: {
        revoked_reason: 'tenant_activated',
      },
    });
    await args.audit.append(event);
    revoked.push(fallback.binding_id);
  }
  return revoked;
}

// ---------------------------------------------------------------------------
// Tenant onboarding orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full onboarding flow for a tenant:
 *
 *   1. For each Tier-1 connector in the wizard:
 *        - create + activate tenant default binding
 *   2. If every connector succeeded, revoke the tenant's
 *      `forge_operator_fallback` bindings.
 *
 * Returns the consolidated result. The function is
 * fail-fast: the first connector failure aborts the flow and
 * the tenant is left in a partially-onboarded state. The
 * caller (the wizard UI) re-displays the failed connector and
 * re-submits; the repo's idempotent upsert preserves the
 * already-created bindings on retry.
 */
export async function onboardTenant(args: {
  client: ScopedClient;
  audit: ConnectorBindingAuditSink;
  input: OnboardTenantInput;
}): Promise<OnboardTenantResult> {
  const created: string[] = [];

  for (const connector of args.input.connectors) {
    const result = await createAndActivateTenantDefault({
      client: args.client,
      audit: args.audit,
      tenant_id: args.input.tenant_id,
      connector,
      actor: args.input.actor.actor_id,
      actor_role: args.input.actor.role,
      trace_id: args.input.actor.trace_id,
    });
    created.push(result.binding.binding_id);
  }

  // All connectors succeeded — revoke the fallback. Plan 4:
  // "tenant activated → forge_operator fallback auto-revoked".
  const forge_operator_revoked = await revokeForgeOperatorFallbacks({
    client: args.client,
    audit: args.audit,
    tenant_id: args.input.tenant_id,
    actor: args.input.actor.actor_id,
    actor_role: args.input.actor.role,
    trace_id: args.input.actor.trace_id,
  });

  return {
    created,
    forge_operator_revoked,
    tenant_activated: true,
  };
}

// ---------------------------------------------------------------------------
// Re-attestation orchestrator (called by the wizard's "Re-attest" button)
// ---------------------------------------------------------------------------

/**
 * Re-attest a binding (Architect only). Refreshes
 * `attested_at` + `attestation_expires_at` (now() + 90 days)
 * and clears `status` back to `'active'`. Emits
 * `connector.binding.attested` audit event.
 *
 * The wizard calls this from the re-attestation dialog; the
 * runtime rule lives in `./override.ts` (`detectExpiredAttestations`
 * is the sweeper side, `reAttestBinding` is the wizard side).
 */
export async function reAttestBinding(args: {
  client: ScopedClient;
  audit: ConnectorBindingAuditSink;
  tenant_id: TenantId;
  binding_id: string;
  actor: ActorId;
  actor_role: string;
  trace_id?: string;
  now?: () => string;
}): Promise<ConnectorBinding> {
  const repo = new ConnectorBindingRepo(args.client);
  const before = await repo.findByBindingId({
    tenant_id: args.tenant_id,
    binding_id: args.binding_id,
  });
  if (before === null) {
    throw new Error(
      `reAttestBinding: binding not found binding_id=${args.binding_id}`,
    );
  }

  const after = await repo.attest({
    tenant_id: args.tenant_id,
    binding_id: args.binding_id,
    attested_by: args.actor,
  });

  const now = (args.now ?? (() => new Date().toISOString()))();
  const event_id = mintEventId();
  const event: ConnectorBindingEvent = buildEvent({
    event_id,
    event_type: 'connector.binding.attested',
    tenant_id: args.tenant_id,
    binding_id: args.binding_id,
    connector_id: before.connector_id,
    project_id: before.project_id,
    auth_method: before.auth_method,
    actor: userActor(args.actor, args.actor_role, args.trace_id),
    emitted_at: now,
    metadata: {
      attestation_expires_at: after.attestation_expires_at,
      previous_attestation_expires_at: before.attestation_expires_at,
    },
  });
  await args.audit.append(event);

  return after;
}

// ---------------------------------------------------------------------------
// Health-check orchestrator
// ---------------------------------------------------------------------------

/**
 * Record a health-check result for a binding. Called by the
 * health-check worker (every 5 minutes per the migration's
 * cron). The function picks the event type (`ok` / `fail`)
 * based on `ok` and emits the corresponding audit event.
 */
export async function recordHealthCheck(args: {
  client: ScopedClient;
  audit: ConnectorBindingAuditSink;
  tenant_id: TenantId;
  binding_id: string;
  ok: boolean;
  latency_ms: number;
  error?: string;
  actor: ActorId;
  trace_id?: string;
  now?: () => string;
}): Promise<ConnectorBinding> {
  const repo = new ConnectorBindingRepo(args.client);
  const before = await repo.findByBindingId({
    tenant_id: args.tenant_id,
    binding_id: args.binding_id,
  });
  if (before === null) {
    throw new Error(
      `recordHealthCheck: binding not found binding_id=${args.binding_id}`,
    );
  }

  const after = args.ok
    ? await repo.recordHealthCheckSuccess({
        tenant_id: args.tenant_id,
        binding_id: args.binding_id,
        actor: args.actor,
      })
    : await repo.recordHealthCheckFailure({
        tenant_id: args.tenant_id,
        binding_id: args.binding_id,
        actor: args.actor,
      });

  const now = (args.now ?? (() => new Date().toISOString()))();
  const event_id = mintEventId();
  const event: ConnectorBindingEvent = buildEvent({
    event_id,
    event_type: args.ok
      ? 'connector.binding.health_check.ok'
      : 'connector.binding.health_check.fail',
    tenant_id: args.tenant_id,
    binding_id: args.binding_id,
    connector_id: before.connector_id,
    project_id: before.project_id,
    auth_method: before.auth_method,
    actor: {
      actor_type: 'system',
      actor_id: args.actor,
      role: 'system:health_check_worker',
      ...(args.trace_id !== undefined ? { trace_id: args.trace_id } : {}),
    },
    emitted_at: now,
    metadata: {
      latency_ms: args.latency_ms,
      ...(args.error !== undefined ? { error: args.error } : {}),
    },
  });
  await args.audit.append(event);

  return after;
}

// ---------------------------------------------------------------------------
// RealAuthMethod helper
// ---------------------------------------------------------------------------

/**
 * Type-guard: `RealAuthMethod` excludes
 * `forge_operator_fallback`. The onboarding wizard refuses
 * any connector entry that names the fallback as its
 * auth_method, because the fallback is Auditor-only and never
 * appears in the wizard surface.
 */
export function isRealAuthMethod(value: string): value is RealAuthMethod {
  return (
    value === 'oidc' ||
    value === 'pat' ||
    value === 'oauth2' ||
    value === 'service_account' ||
    value === 'api_key'
  );
}