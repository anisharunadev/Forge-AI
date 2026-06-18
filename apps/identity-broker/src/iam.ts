/**
 * Agent IAM — role registry, tenant policy, and broker enforcement.
 *
 * FORA-125 / 0.7.3. Implements ADR-0003 §5: deny-by-default, per-role,
 * per-tenant. The `ToolCall` envelope is the only path to invoke an MCP;
 * the broker checks every envelope against (1) the role→MCP binding, (2)
 * the tenant policy grant, and (3) the claim scope set. Failures return
 * `403 unbound_mcp` (no role binding) or `403 denied` (binding exists
 * but the tenant policy or scope check failed). Every check emits an
 * `iam.granted` / `iam.denied` / `iam.unbound_mcp` audit event.
 *
 * The role registry and tenant policy live on disk; the broker loads
 * them at boot and keeps them in memory. v1 is static; a future ADR
 * (ADR-0003 §10 sub-decision 2) covers dynamic role creation.
 */

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Audit action types — extend the broker's audit vocabulary with iam.*
// events. The `iam.*` namespace is the broker's policy outcome; the
// `auth.*` namespace is the session lifecycle. Both share the same event
// shape (ADR-0003 §8.1) so the audit sink contract is unchanged.
// ---------------------------------------------------------------------------

export const IAM_ACTIONS = ['iam.granted', 'iam.denied', 'iam.unbound_mcp'] as const;
export type IamAction = (typeof IAM_ACTIONS)[number];

// ---------------------------------------------------------------------------
// ToolCall envelope. The broker is the only path that materialises one;
// direct calls from a sub-agent's code are rejected at the broker. The
// envelope is the unit of audit, the unit of trace correlation, and the
// unit of scope assertion.
// ---------------------------------------------------------------------------

export type ToolPrincipal = 'board_user' | 'agent' | 'cloud_operator';

export interface ToolCall {
  trace_id: string;
  tenant_id: string;
  principal: ToolPrincipal;
  /** The agent type / role name (e.g. "developer"). Required when principal === "agent". */
  agent_type: string;
  mcp: string;
  action: string;
  args: unknown;
  /** Scopes the caller asserts it needs; the broker validates against the role+policy. */
  scopes_used: string[];
}

export const ToolCallSchema = z.object({
  trace_id: z.string().min(1),
  tenant_id: z.string().min(1),
  principal: z.enum(['board_user', 'agent', 'cloud_operator']),
  agent_type: z.string().min(1),
  mcp: z.string().min(1),
  action: z.string().min(1),
  args: z.unknown(),
  scopes_used: z.array(z.string()),
});
export type ParsedToolCall = z.infer<typeof ToolCallSchema>;

// ---------------------------------------------------------------------------
// Role registry shape — the platform surface. See config/agent-iam/roles.yaml.
// ---------------------------------------------------------------------------

const RoleRegistrySchema = z
  .object({
    version: z.literal(1),
    mcps: z.array(z.string().min(1)).default([]),
    scopes: z.array(z.string().min(1)).default([]),
    roles: z.record(
      z.string().min(1),
      z.object({
        description: z.string().optional(),
        mcps: z.array(z.string().min(1)).default([]),
        scopes: z.array(z.string().min(1)).default([]),
        deny_scopes: z.array(z.string().min(1)).default([]),
      }),
    ),
  })
  .strict();
export type RoleRegistry = z.infer<typeof RoleRegistrySchema>;

// ---------------------------------------------------------------------------
// Tenant policy shape — the per-tenant narrowing surface.
// ---------------------------------------------------------------------------

const TenantPolicySchema = z
  .object({
    version: z.literal(1),
    description: z.string().optional(),
    mcp_grants: z
      .record(
        z.string().min(1),
        z.record(z.string().min(1), z.boolean()),
      )
      .default({}),
    scope_overrides: z.record(z.string().min(1), z.array(z.string().min(1))).default({}),
    deny: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type TenantPolicy = z.infer<typeof TenantPolicySchema>;

// ---------------------------------------------------------------------------
// Loaders. Both throw on schema violation — load-time failures are louder
// than runtime ones and easier to attribute.
// ---------------------------------------------------------------------------

export interface LoadOptions {
  /** The directory the YAML files are relative to. Defaults to process.cwd(). */
  baseDir?: string;
}

export function loadRoleRegistry(source: string, opts: LoadOptions = {}): RoleRegistry {
  const raw = readFileSync(resolvePath(source, opts.baseDir), 'utf-8');
  const data = parseYaml(raw);
  const parsed = RoleRegistrySchema.parse(data);
  // Cross-field invariants the schema alone can't express.
  const mcpSet = new Set(parsed.mcps);
  const scopeSet = new Set(parsed.scopes);
  for (const [roleName, role] of Object.entries(parsed.roles)) {
    for (const m of role.mcps) {
      if (!mcpSet.has(m)) {
        throw new Error(
          `role registry: role "${roleName}" references unknown MCP "${m}" (not in top-level mcps list)`,
        );
      }
    }
    for (const s of [...role.scopes, ...role.deny_scopes]) {
      if (!scopeSet.has(s)) {
        throw new Error(
          `role registry: role "${roleName}" references unknown scope "${s}" (not in top-level scopes list)`,
        );
      }
    }
  }
  return parsed;
}

export function loadTenantPolicy(source: string, opts: LoadOptions = {}): TenantPolicy {
  const raw = readFileSync(resolvePath(source, opts.baseDir), 'utf-8');
  const data = parseYaml(raw);
  return TenantPolicySchema.parse(data);
}

function resolvePath(source: string, baseDir?: string): string {
  if (isAbsolute(source)) return source;
  return resolve(baseDir ?? process.cwd(), source);
}

// ---------------------------------------------------------------------------
// Policy store. Holds the platform role registry plus per-tenant policies.
// The broker reads from one of these on every ToolCall. v1 is fully
// in-memory; a future dynamic-policy ADR will add hot reload.
// ---------------------------------------------------------------------------

export interface PolicyStore {
  roles: RoleRegistry;
  /** Map<tenant_id, TenantPolicy>. A tenant with no entry gets the platform default: deny everything. */
  tenantPolicies: Map<string, TenantPolicy>;
}

export class InMemoryPolicyStore implements PolicyStore {
  roles: RoleRegistry;
  tenantPolicies: Map<string, TenantPolicy>;

  constructor(init: { roles: RoleRegistry; tenantPolicies?: Map<string, TenantPolicy> }) {
    this.roles = init.roles;
    this.tenantPolicies = init.tenantPolicies ?? new Map();
  }

  /**
   * Set (or replace) a tenant's policy. Validates that the policy does
   * not widen beyond the platform default — a tenant cannot grant an
   * MCP that no role in the platform registry has, and cannot grant a
   * scope that the role's `scopes` list does not include.
   */
  setTenantPolicy(tenant_id: string, policy: TenantPolicy): void {
    for (const [roleName, grants] of Object.entries(policy.mcp_grants ?? {})) {
      const role = this.roles.roles[roleName];
      if (!role) {
        throw new Error(
          `tenant policy: tenant "${tenant_id}" grants for unknown role "${roleName}"`,
        );
      }
      for (const mcp of Object.keys(grants)) {
        if (!this.roles.mcps.includes(mcp)) {
          throw new Error(
            `tenant policy: tenant "${tenant_id}" grants unknown MCP "${mcp}" (not in platform registry)`,
          );
        }
        if (!role.mcps.includes(mcp)) {
          throw new Error(
            `tenant policy: tenant "${tenant_id}" grants MCP "${mcp}" to role "${roleName}" but the platform role does not bind to that MCP`,
          );
        }
      }
    }
    for (const [roleName, scopeList] of Object.entries(policy.scope_overrides ?? {})) {
      const role = this.roles.roles[roleName];
      if (!role) {
        throw new Error(
          `tenant policy: tenant "${tenant_id}" narrows scopes for unknown role "${roleName}"`,
        );
      }
      for (const s of scopeList) {
        if (!role.scopes.includes(s)) {
          throw new Error(
            `tenant policy: tenant "${tenant_id}" keeps scope "${s}" for role "${roleName}" but the platform role does not include that scope`,
          );
          }
      }
    }
    this.tenantPolicies.set(tenant_id, policy);
  }
}

// ---------------------------------------------------------------------------
// Broker check. The single chokepoint for every MCP invocation. The
// sequence is intentional and matches ADR-0003 §5.3: role binding →
// tenant policy → claim scope. A failure at any stage short-circuits and
// emits a single audit event with the reason.
// ---------------------------------------------------------------------------

export type IamDecision =
  | { kind: 'granted'; scopes: string[]; role: string }
  | { kind: 'unbound_mcp'; reason: 'role_mcp_unbound' | 'mcp_unknown' | 'tenant_deny_list'; role: string | null; mcp: string }
  | { kind: 'denied'; reason: 'role_unknown' | 'tenant_no_grant' | 'scope_not_in_role' | 'scope_denied' | 'scope_not_in_tenant_override' | 'principal_not_agent'; role: string | null; mcp: string };

export interface IamCheckInput {
  call: ToolCall;
  /** The role name resolved from the call's `agent_type` (e.g. "developer"). The broker may also resolve this from the JWT. */
  role: string | null;
  store: PolicyStore;
}

export function checkToolCall(input: IamCheckInput): IamDecision {
  const { call, role: requestedRole, store } = input;

  // Stage 0: the envelope itself must be coherent. The schema parse is
  // the caller's job, but we re-check the principal here.
  if (call.principal === 'agent' && !requestedRole) {
    return { kind: 'denied', reason: 'principal_not_agent', role: null, mcp: call.mcp };
  }
  // From here on, `role` is non-null. We rebind to a narrowed const so the
  // rest of the function (which uses `role` as an index key, in audit
  // payloads, etc.) sees `role: string`.
  const role: string = requestedRole as string;

  // Stage 1: role→MCP binding. A role that does not exist, or does not
  // bind the requested MCP, fails here with `unbound_mcp` — there is no
  // grant path that can recover.
  const roleDef = role ? store.roles.roles[role] : null;
  if (!roleDef) {
    return { kind: 'denied', reason: 'role_unknown', role, mcp: call.mcp };
  }
  if (!store.roles.mcps.includes(call.mcp)) {
    return { kind: 'unbound_mcp', reason: 'mcp_unknown', role, mcp: call.mcp };
  }
  if (!roleDef.mcps.includes(call.mcp)) {
    return { kind: 'unbound_mcp', reason: 'role_mcp_unbound', role, mcp: call.mcp };
  }

  // Stage 2: tenant policy. The tenant may narrow (deny list, missing
  // grant) but never widen.
  const policy = store.tenantPolicies.get(call.tenant_id);
  if (policy) {
    if ((policy.deny ?? []).includes(call.mcp)) {
      return { kind: 'unbound_mcp', reason: 'tenant_deny_list', role, mcp: call.mcp };
    }
    const grants = policy.mcp_grants?.[role];
    if (!grants || grants[call.mcp] !== true) {
      return { kind: 'denied', reason: 'tenant_no_grant', role, mcp: call.mcp };
    }
  } else {
    // No tenant policy: default deny. The role's binding is a *platform*
    // eligibility signal, not a tenant grant.
    return { kind: 'denied', reason: 'tenant_no_grant', role, mcp: call.mcp };
  }

  // Stage 3: scope check. The asserted scopes must be a subset of the
  // role's `scopes` (intersected with the tenant's `scope_overrides`),
  // and must not be in the role's `deny_scopes`.
  const roleScopes = new Set(roleDef.scopes);
  const tenantScopeOverride = policy?.scope_overrides?.[role];
  const effectiveScopes = tenantScopeOverride ? new Set(tenantScopeOverride) : roleScopes;
  for (const s of call.scopes_used) {
    if (!roleScopes.has(s)) {
      return { kind: 'denied', reason: 'scope_not_in_role', role, mcp: call.mcp };
    }
    if (roleDef.deny_scopes.includes(s)) {
      return { kind: 'denied', reason: 'scope_denied', role, mcp: call.mcp };
    }
    if (!effectiveScopes.has(s)) {
      return { kind: 'denied', reason: 'scope_not_in_tenant_override', role, mcp: call.mcp };
    }
  }
  // Effective scopes are the role's `scopes` (or the tenant's narrowed override).
  const grantedScopes = tenantScopeOverride ? [...tenantScopeOverride] : [...roleDef.scopes];
  return { kind: 'granted', scopes: grantedScopes, role };
}

// ---------------------------------------------------------------------------
// Audit event factory. The broker passes one of these to the audit sink
// on every check. Keeps the audit event shape in lock-step with the
// existing `AuthAuditEvent` so the sink contract is unchanged
// (ADR-0003 §8.1).
// ---------------------------------------------------------------------------

import type { AuthAuditEvent } from './audit.js';

export function iamAuditEvent(input: {
  call: ToolCall;
  decision: IamDecision;
  actor: string;
  trace_id: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}): AuthAuditEvent {
  const { call, decision, actor, trace_id, metadata } = input;
  const timestamp = input.timestamp ?? new Date().toISOString();
  if (decision.kind === 'granted') {
    return {
      actor,
      tenant_id: call.tenant_id,
      principal: 'agent',
      action: 'iam.granted',
      scopes_used: decision.scopes,
      decision: 'allow',
      trace_id,
      timestamp,
      metadata: {
        mcp: call.mcp,
        agent_type: call.agent_type,
        mcp_action: call.action,
        role: decision.role,
        ...(metadata ?? {}),
      },
    };
  }
  if (decision.kind === 'unbound_mcp') {
    return {
      actor,
      tenant_id: call.tenant_id,
      principal: 'agent',
      action: 'iam.unbound_mcp',
      scopes_used: call.scopes_used,
      decision: 'deny',
      trace_id,
      timestamp,
      metadata: {
        mcp: call.mcp,
        agent_type: call.agent_type,
        mcp_action: call.action,
        role: decision.role,
        reason: decision.reason,
        ...(metadata ?? {}),
      },
    };
  }
  return {
    actor,
    tenant_id: call.tenant_id,
    principal: 'agent',
    action: 'iam.denied',
    scopes_used: call.scopes_used,
    decision: 'deny',
    trace_id,
    timestamp,
    metadata: {
      mcp: call.mcp,
      agent_type: call.agent_type,
      mcp_action: call.action,
      role: decision.role,
      reason: decision.reason,
      ...(metadata ?? {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience: load a complete PolicyStore from a directory layout. The
// boot path uses this; tests construct the store directly.
// ---------------------------------------------------------------------------

export interface PolicyStoreLayout {
  /** Path to the role registry YAML. */
  rolesFile: string;
  /** Map<tenant_id, path to that tenant's policy.yaml>. Tenants not present get the platform default. */
  tenantPolicies: Map<string, string>;
}

export function loadPolicyStore(layout: PolicyStoreLayout, opts: LoadOptions = {}): PolicyStore {
  const baseDir = opts.baseDir ?? dirname(resolvePath(layout.rolesFile, opts.baseDir));
  const roles = loadRoleRegistry(layout.rolesFile, opts);
  const store = new InMemoryPolicyStore({ roles });
  for (const [tid, path] of layout.tenantPolicies) {
    const policy = loadTenantPolicy(path, { baseDir });
    store.setTenantPolicy(tid, policy);
  }
  return store;
}

// ---------------------------------------------------------------------------
// Stub MCP dispatcher. The actual MCP forwarding (and the customer-cloud
// broker behind aws-deploy) is a future epic. The ToolCall broker is the
// gating layer; the dispatch is a placeholder that the tests can assert
// against. Keeping the seam here means FORA-125 can land without waiting
// on the MCP transport.
// ---------------------------------------------------------------------------

export interface McpDispatchResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export interface McpDispatcher {
  dispatch(call: ToolCall, grantedScopes: string[]): Promise<McpDispatchResult>;
}

export class DenyAllDispatcher implements McpDispatcher {
  async dispatch(): Promise<McpDispatchResult> {
    return { ok: false, status: 501, body: { error: 'no dispatcher configured' } };
  }
}

export class ScriptedDispatcher implements McpDispatcher {
  private readonly responses: McpDispatchResult[];
  constructor(responses: McpDispatchResult[]) {
    this.responses = responses;
  }
  async dispatch(): Promise<McpDispatchResult> {
    return this.responses.shift() ?? { ok: true, status: 200, body: { echo: true } };
  }
}
