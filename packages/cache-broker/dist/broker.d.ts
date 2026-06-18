/**
 * @fora/cache-broker — broker
 *
 * The cache broker is the only path that reads or writes the cache. Every
 * method takes a {@link RequestContext} bound to the verified claim, and the
 * broker:
 *
 *   1. Derives the cache key from the `(resource, id)` pair (the tenant
 *      id is NOT in the hash; see {@link deriveKey}).
 *   2. For `get`, returns a `tenant_mismatch` result when the stored value's
 *      `__tnt` does not match the bound context. The result is shaped like
 *      a cache miss so the caller does not have to special-case it.
 *   3. For `set`, refuses to write and throws {@link TenantMismatchError} if
 *      the caller's `parts.tenant_id` does not match the bound context. The
 *      hash prevents accidental key collision; the type check prevents the
 *      caller from asking for a key under a different tenant.
 *   4. On every `tenant_mismatch` path, emits a canonical `tenancy.denied`
 *      audit event with `resource: 'cache'`.
 *
 * The broker does not depend on the audit sink to decide whether to serve a
 * read. The audit emit is best-effort: an emit failure logs to stderr but
 * does not turn a hit into a miss. The tenant gate is enforced before the
 * audit call.
 *
 * Last-writer-wins on set: the broker does not arbitrate ownership of a
 * `(resource, id)` pair between tenants; if tenant A writes, then tenant B
 * writes, B's value is stored under the same key. Tenant A's next read
 * returns `tenant_mismatch` (and emits the audit event) — that is the
 * contract, and the right way to model a cache.
 */
import type { AuditSink } from './audit.js';
import type { CacheStore } from './store.js';
import { type CacheKey, type GetResult, type KeyParts, type RequestContext } from './types.js';
export interface CacheBrokerOptions {
    readonly store: CacheStore;
    readonly audit: AuditSink;
    /** Defaults to `'cache'`. The audit resource tag emitted on tenant_mismatch. */
    readonly resource?: string;
}
export declare class CacheBroker {
    private readonly store;
    private readonly audit;
    private readonly resource;
    constructor(opts: CacheBrokerOptions);
    /**
     * Read a cache value. The broker derives the key from `(resource, id)` and
     * the stored value's `__tnt` tag is checked against the bound context.
     *
     * Returns `{ status: 'tenant_mismatch' }` if the stored value's tenant does
     * not match the bound context. This is the case where a warm cache from
     * another tenant would otherwise leak; the gate returns a miss-like result
     * and the audit event fires.
     */
    get<T>(ctx: RequestContext, parts: Pick<KeyParts, 'resource' | 'id'>): Promise<GetResult<T>>;
    /**
     * Write a cache value. Throws on key/context tenant mismatch.
     *
     * Last-writer-wins: a subsequent set by a different tenant overwrites the
     * value. The first tenant's next read returns `tenant_mismatch` (and emits
     * the audit event), which is the correct cache semantics.
     */
    set<T>(ctx: RequestContext, parts: KeyParts, value: T, opts?: {
        ttlMs?: number;
    }): Promise<CacheKey>;
    /** Invalidate a single key. Throws on tenant mismatch. */
    del(ctx: RequestContext, parts: KeyParts): Promise<void>;
    /**
     * Build a tenancy.denied audit event. The `key` and `id` are both included
     * (id is the application-level identifier, key is the hash). `metadata`
     * carries the key prefix (first 12 hex chars) for log triage; the full key
     * is never written because the on-the-wire key is opaque by design and we
     * do not want to leak it.
     */
    private emitTenancyDenied;
}
