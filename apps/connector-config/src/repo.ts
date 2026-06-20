/**
 * @fora/connector-config — connector_binding repository.
 *
 * The repo is the only path that touches the `connector_binding`
 * table. Every read goes through the `@fora/db-pool`
 * `TenantAwarePool` so the request-context claim's `tenant_id`
 * binds the query via `SET LOCAL app.tenant_id`. The
 * `tenant_isolation` RLS policy from migration
 * `0006_connector_binding.sql` is the data-layer guarantee; the
 * wrapper is the runtime guarantee. Both must pass.
 *
 * Sub-task: FORA-485. Spec source: Plan 4 (FORA-391.3).
 *
 * ---- RLS posture ------------------------------------------------------------
 *
 * Every query in this module is built as a parameterised SQL
 * string. The pool sets `app.tenant_id` from the request claim;
 * a misconfigured pool (no `app.tenant_id` set) matches zero
 * rows because the policy's COALESCE defaults to the nil
 * sentinel UUID.
 *
 * The repo never accepts `tenant_id` from the caller — it pulls
 * it from the pool's request-context claim. The caller can
 * supply `tenant_id` only on the create / resolve paths as a
 * runtime sanity check; the pool's binding is the authority.
 *
 * ---- Idempotency ------------------------------------------------------------
 *
 * Writes are idempotent on `(tenant_id, binding_id)` via the
 * unique index in the migration. The `createTenantDefault` and
 * `createProjectOverride` methods use `INSERT ... ON CONFLICT
 * (tenant_id, binding_id) DO NOTHING RETURNING *` and report
 * the existing row on conflict. The onboarding wizard uses this
 * to retry safely.
 *
 * ---- Inheritance walk --------------------------------------------------------
 *
 * The resolver's step 3 (tenant inherited) walks the inheritance
 * chain via `findInheritedBinding`. The walk is depth-limited
 * by the column CHECK (`depth <= 3`) plus an explicit
 * application-layer cap; the run-time guard
 * `TenantInheritanceDepthExceededError` is the consumer-side
 * companion.
 */

import type {
  ScopedClient,
  TenantId,
  ActorId,
  RequestContext,
} from '@fora/db-pool';
import type {
  ConnectorBinding,
  CreateBindingInput,
  RevokeBindingInput,
} from './types.js';

// ---------------------------------------------------------------------------
// SQL builders
// ---------------------------------------------------------------------------

/**
 * The column list shared by every SELECT. Centralised so the
 * repo never diverges from the migration column set.
 */
const SELECT_COLUMNS = `
  id,
  binding_id,
  tenant_id,
  project_id,
  connector_id,
  auth_method,
  credential_ref,
  scopes,
  status,
  last_health_check_at,
  last_success_at,
  last_failure_at,
  parent_tenant_id,
  depth,
  diverged_fields,
  attested_at,
  attested_by,
  attestation_expires_at,
  revoked_reason,
  created_at,
  updated_at,
  created_by,
  updated_by
`;

const INSERT_COLUMNS = `
  binding_id,
  tenant_id,
  project_id,
  connector_id,
  auth_method,
  credential_ref,
  scopes,
  status,
  parent_tenant_id,
  depth,
  diverged_fields,
  attested_at,
  attested_by,
  attestation_expires_at,
  created_by,
  updated_by
`;

/**
 * Map a raw row from `connector_binding` to the typed
 * `ConnectorBinding` shape. The column types are pinned by the
 * migration; the mapping is the runtime contract.
 */
function mapRow(row: Record<string, unknown>): ConnectorBinding {
  return {
    id: String(row['id']),
    binding_id: String(row['binding_id']),
    tenant_id: String(row['tenant_id']) as TenantId,
    project_id:
      row['project_id'] === null || row['project_id'] === undefined
        ? null
        : String(row['project_id']),
    connector_id: String(row['connector_id']) as ConnectorBinding['connector_id'],
    auth_method: String(row['auth_method']) as ConnectorBinding['auth_method'],
    credential_ref: String(row['credential_ref']),
    scopes: Array.isArray(row['scopes'])
      ? (row['scopes'] as ReadonlyArray<string>).map((s) => String(s))
      : [],
    status: String(row['status']) as ConnectorBinding['status'],
    last_health_check_at:
      row['last_health_check_at'] === null
        ? null
        : new Date(String(row['last_health_check_at'])).toISOString(),
    last_success_at:
      row['last_success_at'] === null
        ? null
        : new Date(String(row['last_success_at'])).toISOString(),
    last_failure_at:
      row['last_failure_at'] === null
        ? null
        : new Date(String(row['last_failure_at'])).toISOString(),
    parent_tenant_id:
      row['parent_tenant_id'] === null
        ? null
        : (String(row['parent_tenant_id']) as TenantId),
    depth: Number(row['depth']),
    diverged_fields:
      row['diverged_fields'] === null || row['diverged_fields'] === undefined
        ? null
        : Array.isArray(row['diverged_fields'])
          ? (row['diverged_fields'] as unknown as ReadonlyArray<ConnectorBinding['diverged_fields'] extends ReadonlyArray<infer T> ? T : never>)
        : null,
    attested_at: new Date(String(row['attested_at'])).toISOString(),
    attested_by: String(row['attested_by']),
    attestation_expires_at: new Date(
      String(row['attestation_expires_at']),
    ).toISOString(),
    revoked_reason:
      row['revoked_reason'] === null || row['revoked_reason'] === undefined
        ? null
        : String(row['revoked_reason']),
    created_at: new Date(String(row['created_at'])).toISOString(),
    updated_at: new Date(String(row['updated_at'])).toISOString(),
    created_by: String(row['created_by']) as ActorId,
    updated_by: String(row['updated_by']) as ActorId,
  };
}

// ---------------------------------------------------------------------------
// Repo class
// ---------------------------------------------------------------------------

/**
 * The repo. Constructed with a `ScopedClient` so callers can
 * compose it inside a `@fora/db-pool` transaction with the
 * request-context claim's `tenant_id` bound.
 */
export class ConnectorBindingRepo {
  constructor(private readonly client: ScopedClient) {}

  // ---- Reads ----------------------------------------------------------------

  /**
   * Find the project override binding for
   * `(tenant_id, project_id, connector_id)`. The resolver calls
   * this for step 1; returns `null` if no row matches.
   */
  async findProjectOverride(args: {
    tenant_id: TenantId;
    project_id: string;
    connector_id: string;
    auth_method: string;
  }): Promise<ConnectorBinding | null> {
    const result = await this.client.query(
      `SELECT ${SELECT_COLUMNS}
         FROM connector_binding
        WHERE tenant_id = $1
          AND project_id = $2
          AND connector_id = $3
          AND auth_method = $4
          AND status IN ('pending', 'active', 'attesting')
        LIMIT 1`,
      [
        args.tenant_id,
        args.project_id,
        args.connector_id,
        args.auth_method,
      ],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /**
   * Find the tenant default binding for
   * `(tenant_id, connector_id)` regardless of `auth_method`.
   * The override-creation probe uses this to discover what the
   * inheritance chain would inherit; it returns the first
   * active row ordered by `created_at` so the probe is
   * deterministic.
   */
  async findTenantDefaultAnyAuthMethod(args: {
    tenant_id: TenantId;
    connector_id: string;
  }): Promise<ConnectorBinding | null> {
    const result = await this.client.query(
      `SELECT ${SELECT_COLUMNS}
         FROM connector_binding
        WHERE tenant_id = $1
          AND project_id IS NULL
          AND connector_id = $2
          AND status IN ('pending', 'active', 'attesting')
        ORDER BY created_at ASC
        LIMIT 1`,
      [args.tenant_id, args.connector_id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /**
   * Find the tenant default binding for
   * `(tenant_id, connector_id, auth_method)`. The resolver
   * calls this for step 2; returns `null` if no row matches.
   */
  async findTenantDefault(args: {
    tenant_id: TenantId;
    connector_id: string;
    auth_method: string;
  }): Promise<ConnectorBinding | null> {
    const result = await this.client.query(
      `SELECT ${SELECT_COLUMNS}
         FROM connector_binding
        WHERE tenant_id = $1
          AND project_id IS NULL
          AND connector_id = $2
          AND auth_method = $3
          AND status IN ('pending', 'active', 'attesting')
        LIMIT 1`,
      [args.tenant_id, args.connector_id, args.auth_method],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /**
   * Walk the inheritance chain from `parent_tenant_id` at the
   * given depth, looking for `(parent_tenant_id, connector_id,
   * auth_method)` at depth+1. The resolver calls this for step
   * 3; the loop stops at depth 3.
   *
   * The chain rows carry `depth > 0` (the row's `tenant_id` is
   * the chain source; the row's `parent_tenant_id` is the
   * tenant that inherits the binding). The walk iterates
   * depth 1..3 and returns the first active match.
   */
  async findInheritedBinding(args: {
    parent_tenant_id: TenantId;
    depth: number;
    connector_id: string;
    auth_method: string;
  }): Promise<ConnectorBinding | null> {
    if (args.depth < 1 || args.depth > 3) {
      throw new Error(
        `findInheritedBinding: depth must be 1..3, got ${args.depth}`,
      );
    }
    const result = await this.client.query(
      `SELECT ${SELECT_COLUMNS}
         FROM connector_binding
        WHERE depth = $2
          AND depth > 0
          AND connector_id = $3
          AND auth_method = $4
          AND status = 'active'
        LIMIT 1`,
      [
        args.parent_tenant_id,
        args.depth,
        args.connector_id,
        args.auth_method,
      ],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /**
   * Find an inherited binding by `(parent_tenant_id, depth,
   * connector_id)` regardless of `auth_method`. The
   * override-creation probe uses this to discover what the
   * inheritance chain would inherit.
   */
  async findInheritedBindingAnyAuthMethod(args: {
    parent_tenant_id: TenantId;
    depth: number;
    connector_id: string;
  }): Promise<ConnectorBinding | null> {
    if (args.depth < 1 || args.depth > 3) {
      throw new Error(
        `findInheritedBindingAnyAuthMethod: depth must be 1..3, got ${args.depth}`,
      );
    }
    const result = await this.client.query(
      `SELECT ${SELECT_COLUMNS}
         FROM connector_binding
        WHERE tenant_id = $1
          AND depth = $2
          AND connector_id = $3
          AND status = 'active'
        ORDER BY created_at ASC
        LIMIT 1`,
      [args.parent_tenant_id, args.depth, args.connector_id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /**
   * Find the Auditor-only `forge_operator_fallback` binding for
   * the tenant. Step 4 of the resolver; returns `null` if the
   * tenant has no fallback row.
   */
  async findForgeOperatorFallback(args: {
    tenant_id: TenantId;
  }): Promise<ConnectorBinding | null> {
    const result = await this.client.query(
      `SELECT ${SELECT_COLUMNS}
         FROM connector_binding
        WHERE tenant_id = $1
          AND project_id IS NULL
          AND connector_id IS NOT NULL
          AND auth_method = 'forge_operator_fallback'
          AND status = 'active'
        LIMIT 1`,
      [args.tenant_id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /**
   * List every `forge_operator_fallback` binding for the tenant.
   * The onboarding flow uses this to auto-revoke on activation.
   */
  async listForgeOperatorFallbacks(args: {
    tenant_id: TenantId;
  }): Promise<ReadonlyArray<ConnectorBinding>> {
    const result = await this.client.query(
      `SELECT ${SELECT_COLUMNS}
         FROM connector_binding
        WHERE tenant_id = $1
          AND auth_method = 'forge_operator_fallback'
          AND status = 'active'`,
      [args.tenant_id],
    );
    return result.rows.map((row) => mapRow(row));
  }

  /**
   * List active project overrides for `(tenant_id,
   * connector_id, auth_method)`. The orphan-risk sweeper calls
   * this to detect overrides whose parent tenant default has
   * been revoked.
   */
  async listActiveProjectOverrides(args: {
    tenant_id: TenantId;
    connector_id: string;
    auth_method: string;
  }): Promise<ReadonlyArray<ConnectorBinding>> {
    const result = await this.client.query(
      `SELECT ${SELECT_COLUMNS}
         FROM connector_binding
        WHERE tenant_id = $1
          AND connector_id = $2
          AND auth_method = $3
          AND project_id IS NOT NULL
          AND status = 'active'`,
      [args.tenant_id, args.connector_id, args.auth_method],
    );
    return result.rows.map((row) => mapRow(row));
  }

  /**
   * Find a binding by its `(tenant_id, binding_id)` natural key.
   */
  async findByBindingId(args: {
    tenant_id: TenantId;
    binding_id: string;
  }): Promise<ConnectorBinding | null> {
    const result = await this.client.query(
      `SELECT ${SELECT_COLUMNS}
         FROM connector_binding
        WHERE tenant_id = $1
          AND binding_id = $2
        LIMIT 1`,
      [args.tenant_id, args.binding_id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  // ---- Writes ---------------------------------------------------------------

  /**
   * Insert a new binding. Idempotent on `(tenant_id,
   * binding_id)` via ON CONFLICT DO NOTHING; returns the
   * existing row on conflict so callers can detect a
   * duplicate-Keycloak-client situation.
   */
  async create(input: CreateBindingInput): Promise<ConnectorBinding> {
    const result = await this.client.query(
      `INSERT INTO connector_binding (${INSERT_COLUMNS})
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         now(), $12, now() + INTERVAL '90 days', $13, $13
       )
       ON CONFLICT (tenant_id, binding_id) DO UPDATE
         SET updated_at = now()
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.binding_id,
        input.tenant_id,
        input.project_id,
        input.connector_id,
        input.auth_method,
        input.credential_ref,
        JSON.stringify(input.scopes ?? []),
        'pending',
        input.parent_tenant_id ?? null,
        input.depth ?? 0,
        input.diverged_fields
          ? JSON.stringify(input.diverged_fields)
          : null,
        input.attested_by,
        input.created_by,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `createBinding: no row returned for binding_id=${input.binding_id}`,
      );
    }
    return mapRow(row);
  }

  /**
   * Transition a binding to `status='active'`. Used by the
   * onboarding wizard on the activation step.
   */
  async activate(args: {
    tenant_id: TenantId;
    binding_id: string;
    actor: ActorId;
  }): Promise<ConnectorBinding> {
    const result = await this.client.query(
      `UPDATE connector_binding
          SET status = 'active',
              updated_at = now(),
              updated_by = $3
        WHERE tenant_id = $1
          AND binding_id = $2
        RETURNING ${SELECT_COLUMNS}`,
      [args.tenant_id, args.binding_id, args.actor],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `activateBinding: binding not found binding_id=${args.binding_id}`,
      );
    }
    return mapRow(row);
  }

  /**
   * Transition a binding to `status='revoked'`. Used by the
   * onboarding flow to auto-revoke `forge_operator_fallback`
   * on tenant activation, and by the admin revoke path.
   */
  async revoke(input: RevokeBindingInput): Promise<ConnectorBinding> {
    const result = await this.client.query(
      `UPDATE connector_binding
          SET status = 'revoked',
              revoked_reason = $3,
              updated_at = now(),
              updated_by = $4
        WHERE tenant_id = $1
          AND binding_id = $2
          AND status <> 'revoked'
        RETURNING ${SELECT_COLUMNS}`,
      [
        input.tenant_id,
        input.binding_id,
        input.revoked_reason,
        input.revoked_by,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `revokeBinding: binding not found or already revoked ` +
          `binding_id=${input.binding_id}`,
      );
    }
    return mapRow(row);
  }

  /**
   * Mark a binding as `attesting`. The nightly sweeper calls
   * this when `attestation_expires_at < now()`. The resolver
   * refuses attesting rows.
   */
  async markAttesting(args: {
    tenant_id: TenantId;
    binding_id: string;
    actor: ActorId;
  }): Promise<ConnectorBinding> {
    const result = await this.client.query(
      `UPDATE connector_binding
          SET status = 'attesting',
              updated_at = now(),
              updated_by = $3
        WHERE tenant_id = $1
          AND binding_id = $2
          AND status = 'active'
        RETURNING ${SELECT_COLUMNS}`,
      [args.tenant_id, args.binding_id, args.actor],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `markAttesting: binding not found or not active ` +
          `binding_id=${args.binding_id}`,
      );
    }
    return mapRow(row);
  }

  /**
   * Refresh `attested_at` and `attestation_expires_at` on an
   * Architect re-attestation. Also clears `attesting` back to
   * `active`.
   */
  async attest(args: {
    tenant_id: TenantId;
    binding_id: string;
    attested_by: ActorId;
  }): Promise<ConnectorBinding> {
    const result = await this.client.query(
      `UPDATE connector_binding
          SET status = 'active',
              attested_at = now(),
              attested_by = $3,
              attestation_expires_at = now() + INTERVAL '90 days',
              updated_at = now(),
              updated_by = $3
        WHERE tenant_id = $1
          AND binding_id = $2
          AND status IN ('active', 'attesting')
        RETURNING ${SELECT_COLUMNS}`,
      [args.tenant_id, args.binding_id, args.attested_by],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `attestBinding: binding not found or terminal ` +
          `binding_id=${args.binding_id}`,
      );
    }
    return mapRow(row);
  }

  // ---- Health-check ---------------------------------------------------------

  /**
   * Stamp `last_health_check_at` + `last_success_at`. The
   * health-check worker calls this on every successful probe.
   */
  async recordHealthCheckSuccess(args: {
    tenant_id: TenantId;
    binding_id: string;
    actor: ActorId;
  }): Promise<ConnectorBinding> {
    const result = await this.client.query(
      `UPDATE connector_binding
          SET last_health_check_at = now(),
              last_success_at = now(),
              updated_at = now(),
              updated_by = $3
        WHERE tenant_id = $1
          AND binding_id = $2
        RETURNING ${SELECT_COLUMNS}`,
      [args.tenant_id, args.binding_id, args.actor],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `recordHealthCheckSuccess: binding not found ` +
          `binding_id=${args.binding_id}`,
      );
    }
    return mapRow(row);
  }

  /**
   * Stamp `last_health_check_at` + `last_failure_at`. The
   * health-check worker calls this on every failed probe.
   */
  async recordHealthCheckFailure(args: {
    tenant_id: TenantId;
    binding_id: string;
    actor: ActorId;
  }): Promise<ConnectorBinding> {
    const result = await this.client.query(
      `UPDATE connector_binding
          SET last_health_check_at = now(),
              last_failure_at = now(),
              updated_at = now(),
              updated_by = $3
        WHERE tenant_id = $1
          AND binding_id = $2
        RETURNING ${SELECT_COLUMNS}`,
      [args.tenant_id, args.binding_id, args.actor],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `recordHealthCheckFailure: binding not found ` +
          `binding_id=${args.binding_id}`,
      );
    }
    return mapRow(row);
  }
}

/**
 * Factory: bind a repo to a request-context claim's transaction.
 * The caller passes the `ScopedClient` from
 * `TenantAwarePool.withTransaction` so the repo inherits the
 * `SET LOCAL app.tenant_id` binding.
 */
export function connectorBindingRepo(client: ScopedClient): ConnectorBindingRepo {
  return new ConnectorBindingRepo(client);
}

/**
 * Re-export the request-context type so consumers can pass the
 * right claim shape without importing `@fora/db-pool` directly.
 */
export type { RequestContext };