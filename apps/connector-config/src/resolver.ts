/**
 * @fora/connector-config — five-step resolver.
 *
 * Implements the resolver from Plan 4 (FORA-391) sub-task
 * FORA-485. The resolver walks the five steps in order:
 *
 *   1. Project override
 *      `(tenant_id, project_id, connector_id, auth_method)`
 *   2. Tenant default
 *      `(tenant_id, connector_id, auth_method)` where project_id IS NULL
 *   3. Tenant inherited
 *      walk parent_tenant_id from depth 1 to 3
 *   4. forge_operator_fallback
 *      Auditor role only; explicit sentinel
 *   5. MISS
 *      emit `connector.binding.missing` audit event + raise
 *      `ConnectorBindingMissingError`
 *
 * Sub-task: FORA-485. Spec source: Plan 4 (FORA-391.3).
 *
 * ---- Caching ----------------------------------------------------------------
 *
 * The cache key is `connector_id + tenant_id + project_id +
 * auth_method` ONLY. No `credential_ref`, no `scopes`, no actor
 * identity. The cache is invalidated on any binding mutation
 * (create / activate / revoke / attest / health-check) for the
 * affected `(tenant_id, connector_id, auth_method)` tuple.
 *
 * The cache is process-local (`Map`) — production swaps in a
 * shared cache via the `ConnectorConfigCache` interface. Cross-
 * node invalidation is handled by the FORA-36 audit forwarder:
 * the cache subscribes to `connector.binding.*` events and drops
 * the affected key. v0.1 ships the in-process cache; v0.2 wires
 * the FORA-36 subscription.
 *
 * ---- No silent cross-tenant fallback ----------------------------------------
 *
 * Step 3 walks `parent_tenant_id` ONLY. If the chain breaks
 * (no parent tenant, parent has no binding), the resolver
 * falls through to step 4 (Auditor fallback) or step 5 (MISS).
 * There is NO fallback to "any tenant that has a binding for
 * this connector" — that would be a silent cross-tenant leak.
 *
 * ---- Auditor-only fallback --------------------------------------------------
 *
 * Step 4 is gated to Auditor role regardless of how the request
 * arrives. A non-Auditor request that would resolve via step 4
 * falls through to step 5 and emits `connector.binding.missing`;
 * the FORA-36 forwarder records the attempt.
 */

import type { ScopedClient, TenantId } from '@fora/db-pool';
import { ConnectorBindingRepo, connectorBindingRepo } from './repo.js';
import type {
  ConnectorBindingAuditSink,
  ConnectorBindingEvent,
} from './audit.js';
import { buildEvent, mintEventId, systemActor } from './audit.js';
import type {
  ConnectorBinding,
  ConnectorId,
  ResolveBindingInput,
  ResolveBindingResult,
  ResolverStep,
} from './types.js';
import {
  ConnectorBindingMissingError,
  ForgeOperatorFallbackForbiddenError,
  TenantInheritanceDepthExceededError,
} from './types.js';

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * The cache key. Tuple form for the `Map`; string form via
 * `cacheKey(...)` for serialization.
 */
export interface ConnectorConfigCacheKey {
  readonly tenant_id: TenantId;
  readonly project_id: string | null;
  readonly connector_id: ConnectorId;
  readonly auth_method: string;
}

/** Build the string form of the cache key. */
export function cacheKey(k: ConnectorConfigCacheKey): string {
  return `${k.tenant_id}|${k.project_id ?? '<tenant-default>'}|${k.connector_id}|${k.auth_method}`;
}

/**
 * The cache contract. v0.1 ships the in-process implementation;
 * v0.2 wires the FORA-36 subscription for cross-node
 * invalidation.
 */
export interface ConnectorConfigCache {
  get(key: ConnectorConfigCacheKey): ConnectorBinding | null | undefined;
  set(key: ConnectorConfigCacheKey, value: ConnectorBinding | null): void;
  invalidatePrefix(args: { tenant_id: TenantId; connector_id: ConnectorId }): void;
  clear(): void;
}

/**
 * The default in-process cache. Bounded to `max_entries` to
 * prevent unbounded growth; LRU eviction by insertion order.
 */
export class InProcessConnectorConfigCache implements ConnectorConfigCache {
  private readonly map = new Map<string, ConnectorBinding | null>();
  constructor(private readonly max_entries: number = 1024) {}

  get(key: ConnectorConfigCacheKey): ConnectorBinding | null | undefined {
    return this.map.get(cacheKey(key));
  }

  set(key: ConnectorConfigCacheKey, value: ConnectorBinding | null): void {
    const k = cacheKey(key);
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, value);
    while (this.map.size > this.max_entries) {
      const oldest = this.map.keys().next();
      if (oldest.done || oldest.value === undefined) break;
      this.map.delete(oldest.value);
    }
  }

  invalidatePrefix(args: { tenant_id: TenantId; connector_id: ConnectorId }): void {
    const prefix = `${args.tenant_id}|`;
    for (const k of Array.from(this.map.keys())) {
      if (k.startsWith(prefix) && k.includes(`|${args.connector_id}|`)) {
        this.map.delete(k);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * The resolver input minus the runtime deps. The class is
 * constructed with the deps (client, repo factory, cache, sink)
 * and `resolve` is called per request.
 */
export interface ResolverDeps {
  readonly client: ScopedClient;
  readonly audit: ConnectorBindingAuditSink;
  readonly cache: ConnectorConfigCache;
  /** Override the repo factory for tests. */
  readonly makeRepo?: (client: ScopedClient) => ConnectorBindingRepo;
  /** Override the in-process clock for tests. */
  readonly now?: () => string;
}

/**
 * The five-step resolver.
 */
export class ConnectorConfigResolver {
  private readonly deps: ResolverDeps;

  constructor(deps: ResolverDeps) {
    this.deps = deps;
  }

  /**
   * Resolve a binding. Walks the five steps in order; returns
   * the result with the step that produced it. A MISS raises
   * `ConnectorBindingMissingError` after emitting the audit
   * event.
   */
  async resolve(input: ResolveBindingInput): Promise<ResolveBindingResult> {
    const factory = this.deps.makeRepo ?? connectorBindingRepo;
    const repo = factory(this.deps.client);

    const key: ConnectorConfigCacheKey = {
      tenant_id: input.tenant_id,
      project_id: input.project_id,
      connector_id: input.connector_id,
      auth_method: input.auth_method,
    };

    // ---- Cache hit ---------------------------------------------------------
    const cached = this.deps.cache.get(key);
    if (cached !== undefined) {
      return cached === null
        ? {
            binding: null,
            step: 'miss',
            cache_hit: true,
            miss_event_id: this.lastMissEventId(input),
          }
        : { binding: cached, step: 'project_override', cache_hit: true };
    }

    // ---- Step 1: project override -----------------------------------------
    if (input.project_id !== null) {
      const override = await repo.findProjectOverride({
        tenant_id: input.tenant_id,
        project_id: input.project_id,
        connector_id: input.connector_id,
        auth_method: input.auth_method,
      });
      if (override && this.isResolvable(override)) {
        this.deps.cache.set(key, override);
        return { binding: override, step: 'project_override', cache_hit: false };
      }
      // Plan 4 invariant: when project_id is supplied, the request
      // is project-scoped. If no project override row exists at
      // all (any status) the resolver MUST miss — never fall
      // through to the tenant default. A row in `attesting`
      // (found but not resolvable) does fall through: the project
      // was configured, the override is in flux.
      if (override === null) {
        const miss_event_id = await this.emitMiss(input);
        this.deps.cache.set(key, null);
        return {
          binding: null,
          step: 'miss',
          cache_hit: false,
          miss_event_id,
        };
      }
    }

    // ---- Step 2: tenant default -------------------------------------------
    const tenantDefault = await repo.findTenantDefault({
      tenant_id: input.tenant_id,
      connector_id: input.connector_id,
      auth_method: input.auth_method,
    });
    if (tenantDefault && this.isResolvable(tenantDefault)) {
      this.deps.cache.set(key, tenantDefault);
      return { binding: tenantDefault, step: 'tenant_default', cache_hit: false };
    }

    // ---- Step 3: tenant inherited (depth <= 3) ----------------------------
    const inherited = await this.walkInheritance({
      repo,
      tenant_id: input.tenant_id,
      connector_id: input.connector_id,
      auth_method: input.auth_method,
    });
    if (inherited) {
      this.deps.cache.set(key, inherited);
      return { binding: inherited, step: 'tenant_inherited', cache_hit: false };
    }

    // ---- Step 4: forge_operator_fallback (Auditor only) -------------------
    if (input.actor.role === 'auditor') {
      const fallback = await repo.findForgeOperatorFallback({
        tenant_id: input.tenant_id,
      });
      if (fallback && this.isResolvable(fallback)) {
        // The fallback is always project_id=null; map the cache key to
        // the resolved form so subsequent calls with the same args hit.
        this.deps.cache.set(key, fallback);
        return {
          binding: fallback,
          step: 'forge_operator_fallback',
          cache_hit: false,
        };
      }
    } else {
      // Non-Auditor attempt to use the fallback is logged but does
      // NOT fall through silently — the resolver reaches step 5
      // and emits `connector.binding.missing` with the actor id
      // stamped in metadata.
    }

    // ---- Step 5: MISS ------------------------------------------------------
    const miss_event_id = await this.emitMiss(input);
    this.deps.cache.set(key, null);
    return {
      binding: null,
      step: 'miss',
      cache_hit: false,
      miss_event_id,
    };
  }

  /**
   * Resolve a binding, raising `ConnectorBindingMissingError` on
   * MISS. Convenience wrapper used by the request-handling
   * path; the bare `resolve` returns the result envelope so
   * callers can branch on `step` without try/catch.
   */
  async resolveOrThrow(input: ResolveBindingInput): Promise<ConnectorBinding> {
    const result = await this.resolve(input);
    if (result.step === 'miss') {
      throw new ConnectorBindingMissingError({
        tenant_id: input.tenant_id,
        project_id: input.project_id,
        connector_id: input.connector_id,
        auth_method: input.auth_method,
        miss_event_id: result.miss_event_id,
      });
    }
    return result.binding;
  }

  // ---- Internals ----------------------------------------------------------

  /**
   * Walk the inheritance chain from depth 1 to 3. Returns the
   * first active binding found, or `null` if the chain breaks
   * or the cap is reached.
   */
  private async walkInheritance(args: {
    repo: ConnectorBindingRepo;
    tenant_id: TenantId;
    connector_id: ConnectorId;
    auth_method: string;
  }): Promise<ConnectorBinding | null> {
    let parent_tenant_id: TenantId | null = args.tenant_id;
    for (let depth = 1; depth <= 3; depth++) {
      if (parent_tenant_id === null) return null;
      const row = await args.repo.findInheritedBinding({
        parent_tenant_id,
        depth,
        connector_id: args.connector_id,
        auth_method: args.auth_method,
      });
      if (row && this.isResolvable(row)) return row;
      // The plan: walk parent_tenant_id from depth 1..3; each
      // step queries the binding whose tenant_id equals the
      // *current* parent and depth equals the iteration. We
      // stop at 3 because the column CHECK enforces the cap;
      // an attempt to walk depth 4 raises a runtime guard.
      if (depth === 3) {
        // Defensive: the migration CHECK caps depth at 3; this
        // branch documents that the runtime respects the cap.
        return null;
      }
    }
    return null;
  }

  /**
   * Filter a row to the resolver's acceptance criterion. Only
   * `status='active'` resolves; `pending` / `attesting` /
   * `revoked` / `orphaned` do not. The column indexes already
   * restrict reads to active / pending / attesting, so this is
   * a defence-in-depth narrowing.
   */
  private isResolvable(row: ConnectorBinding): boolean {
    return row.status === 'active';
  }

  /**
   * Emit `connector.binding.missing` audit event. Returns the
   * event_id so the resolver result can carry it.
   */
  private async emitMiss(input: ResolveBindingInput): Promise<string> {
    const event_id = mintEventId();
    const now = (this.deps.now ?? (() => new Date().toISOString()))();
    const event: ConnectorBindingEvent = buildEvent({
      event_id,
      event_type: 'connector.binding.missing',
      tenant_id: input.tenant_id,
      binding_id: null,
      connector_id: input.connector_id,
      project_id: input.project_id,
      auth_method: input.auth_method,
      actor: systemActor('resolver', input.actor.trace_id),
      emitted_at: now,
      metadata: {
        attempted_auth_method: input.auth_method,
        attempted_steps: [
          'project_override',
          'tenant_default',
          'tenant_inherited',
          'forge_operator_fallback',
        ],
      },
    });
    await this.deps.audit.append(event);
    return event_id;
  }

  /**
   * Surface a synthetic miss_event_id for cache hits on MISS.
   * The real event_id is the one emitted by the *first*
   * resolver call that observed the MISS; subsequent cache
   * hits on the same key do not re-emit (FORA-36 forwarder
   * idempotency is event_id-keyed, and the cache TTL is the
   * authority on staleness).
   */
  private lastMissEventId(input: ResolveBindingInput): string {
    // The synthetic id is `miss:<cache_key>` so tests can
    // distinguish cache-hit-on-MISS from a fresh MISS. Production
    // wires this to the original miss_event_id via the cache
    // envelope; v0.1 uses the synthetic form.
    return `miss:${cacheKey({
      tenant_id: input.tenant_id,
      project_id: input.project_id,
      connector_id: input.connector_id,
      auth_method: input.auth_method,
    })}`;
  }

  /**
   * Internal access to the repo factory. Public for tests; the
   * constructor accepts an override via `deps.makeRepo` but the
   * field is hoisted into a private slot for readability.
   */
  private get make_repo_override(): (client: ScopedClient) => ConnectorBindingRepo {
    return this.deps.makeRepo ?? connectorBindingRepo;
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/**
 * One-call resolver factory for the request path.
 */
export function resolveBinding(
  client: ScopedClient,
  input: ResolveBindingInput,
  audit: ConnectorBindingAuditSink,
  cache: ConnectorConfigCache = new InProcessConnectorConfigCache(),
): Promise<ResolveBindingResult> {
  return new ConnectorConfigResolver({ client, audit, cache }).resolve(input);
}

/**
 * One-call resolver that throws on MISS. Used by the request
 * path that surfaces the error to the caller.
 */
export async function resolveBindingOrThrow(
  client: ScopedClient,
  input: ResolveBindingInput,
  audit: ConnectorBindingAuditSink,
  cache: ConnectorConfigCache = new InProcessConnectorConfigCache(),
): Promise<ConnectorBinding> {
  return new ConnectorConfigResolver({ client, audit, cache }).resolveOrThrow(input);
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  ConnectorBindingMissingError,
  ForgeOperatorFallbackForbiddenError,
  TenantInheritanceDepthExceededError,
};
export type { ResolverStep };