/**
 * @fora/cache-broker — types
 *
 * The request envelope the broker binds to every cache read/write. Mirrors the
 * claim set defined in ADR-0003 §3.2; the broker only sees the fields it needs
 * (`tenant_id`, `principal`, `trace_id`) plus a free-form `actor` for audit.
 *
 * The broker NEVER trusts a tenant_id that comes from the call site. The
 * `RequestContext.tenant_id` MUST be the claim from the verified JWT, set by
 * the identity broker (FORA-123). Application code passes the context through;
 * it cannot mint one.
 */

/** Resources the broker knows how to scope. Free-form `string` is allowed for app-specific resources, but the broker will not key a request with an empty resource. */
export type CacheResource = 'project' | 'run' | 'artifact' | 'user' | 'policy' | (string & {});

export interface RequestContext {
  /** Verified claim. Tenant the caller is bound to. */
  readonly tenant_id: string;
  /** `board_user` | `agent` | `cloud_operator`. Mirrors ADR-0003 §3.2. */
  readonly principal: 'board_user' | 'agent' | 'cloud_operator';
  /** Who is making the call. For agents: `agent:<type>:<run-id>`. For board users: `user:<okta-sub>`. */
  readonly actor: string;
  /** OTel trace id, when available. */
  readonly trace_id: string;
}

/** A typed cache key — opaque hex string. Use {@link deriveKey} to build. */
export type CacheKey = string & { readonly __brand: 'CacheKey' };

/** A bound tenant + resource + id. The input to {@link deriveKey}. */
export interface KeyParts {
  readonly tenant_id: string;
  readonly resource: CacheResource;
  readonly id: string;
}

/** Result of a cache `get`. `tenant_mismatch` is treated like a cache miss but emits an audit event. */
export type GetResult<T> =
  | { readonly status: 'hit'; readonly value: T }
  | { readonly status: 'miss' }
  | { readonly status: 'tenant_mismatch'; readonly reason: 'key_tenant_mismatch' | 'context_unbound' };

/** Error thrown when a caller attempts to `set` with a key that does not match the bound context. */
export class TenantMismatchError extends Error {
  readonly kind = 'tenant_mismatch' as const;
  constructor(
    message: string,
    readonly attempted_tenant_id: string,
    readonly actual_tenant_id: string,
  ) {
    super(message);
    this.name = 'TenantMismatchError';
  }
}
