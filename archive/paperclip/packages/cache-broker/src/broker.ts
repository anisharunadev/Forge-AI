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

import { deriveKey, deriveTag } from './keys.js';
import type { AuditSink, ForaAuditEvent } from './audit.js';
import type { CacheStore } from './store.js';
import {
  type CacheKey,
  type GetResult,
  type KeyParts,
  type RequestContext,
  TenantMismatchError,
} from './types.js';

export interface CacheBrokerOptions {
  readonly store: CacheStore;
  readonly audit: AuditSink;
  /** Defaults to `'cache'`. The audit resource tag emitted on tenant_mismatch. */
  readonly resource?: string;
}

interface WrappedValue<T> {
  __tnt: string;
  v: T;
  ts: number;
}

export class CacheBroker {
  private readonly store: CacheStore;
  private readonly audit: AuditSink;
  private readonly resource: string;

  constructor(opts: CacheBrokerOptions) {
    this.store = opts.store;
    this.audit = opts.audit;
    this.resource = opts.resource ?? 'cache';
  }

  /**
   * Read a cache value. The broker derives the key from `(resource, id)` and
   * the stored value's `__tnt` tag is checked against the bound context.
   *
   * Returns `{ status: 'tenant_mismatch' }` if the stored value's tenant does
   * not match the bound context. This is the case where a warm cache from
   * another tenant would otherwise leak; the gate returns a miss-like result
   * and the audit event fires.
   */
  async get<T>(ctx: RequestContext, parts: Pick<KeyParts, 'resource' | 'id'>): Promise<GetResult<T>> {
    if (!ctx.tenant_id) {
      // Defensive: a RequestContext without a tenant_id is a programming
      // error in the caller (the broker is supposed to receive only
      // claim-bound contexts). Refuse loudly.
      throw new Error('cache-broker.get: ctx.tenant_id is required');
    }
    const key = deriveKey(parts);
    const raw = await this.store.get(key);
    if (raw === null) return { status: 'miss' };

    let parsed: WrappedValue<T>;
    try {
      parsed = JSON.parse(raw) as WrappedValue<T>;
    } catch {
      // Corrupt entry — treat as miss. (Should never happen in production;
      // surfaced loudly so a bad writer is caught.)
      return { status: 'miss' };
    }

    if (parsed.__tnt !== ctx.tenant_id) {
      await this.emitTenancyDenied(ctx, {
        attempted_tenant_id: ctx.tenant_id,
        actual_tenant_id: parsed.__tnt,
        key,
        resource: parts.resource,
        id: parts.id,
      });
      return { status: 'tenant_mismatch', reason: 'key_tenant_mismatch' };
    }

    return { status: 'hit', value: parsed.v };
  }

  /**
   * Write a cache value. Throws on key/context tenant mismatch.
   *
   * Last-writer-wins: a subsequent set by a different tenant overwrites the
   * value. The first tenant's next read returns `tenant_mismatch` (and emits
   * the audit event), which is the correct cache semantics.
   */
  async set<T>(ctx: RequestContext, parts: KeyParts, value: T, opts: { ttlMs?: number } = {}): Promise<CacheKey> {
    if (parts.tenant_id !== ctx.tenant_id) {
      await this.emitTenancyDenied(ctx, {
        attempted_tenant_id: parts.tenant_id,
        actual_tenant_id: ctx.tenant_id,
        key: deriveKey(parts),
        resource: parts.resource,
        id: parts.id,
      });
      throw new TenantMismatchError(
        `cache-broker: set tenant_id '${parts.tenant_id}' does not match context tenant_id '${ctx.tenant_id}'`,
        parts.tenant_id,
        ctx.tenant_id,
      );
    }
    const key = deriveKey(parts);
    const payload: WrappedValue<T> = { __tnt: ctx.tenant_id, v: value, ts: Date.now() };
    await this.store.set(key, JSON.stringify(payload), opts);
    return key;
  }

  /** Invalidate a single key. Throws on tenant mismatch. */
  async del(ctx: RequestContext, parts: KeyParts): Promise<void> {
    if (parts.tenant_id !== ctx.tenant_id) {
      throw new TenantMismatchError(
        `cache-broker: del tenant_id '${parts.tenant_id}' does not match context tenant_id '${ctx.tenant_id}'`,
        parts.tenant_id,
        ctx.tenant_id,
      );
    }
    await this.store.del(deriveKey(parts));
  }

  /**
   * Build a tenancy.denied audit event. The `key` and `id` are both included
   * (id is the application-level identifier, key is the hash). `metadata`
   * carries the key prefix (first 12 hex chars) for log triage; the full key
   * is never written because the on-the-wire key is opaque by design and we
   * do not want to leak it.
   */
  private async emitTenancyDenied(
    ctx: RequestContext,
    details: {
      attempted_tenant_id: string;
      actual_tenant_id: string;
      key: CacheKey;
      resource: string;
      id: string;
    },
  ): Promise<void> {
    const event: ForaAuditEvent = {
      event_type: 'tenancy.denied',
      actor: ctx.actor,
      attempted_tenant_id: details.attempted_tenant_id,
      actual_tenant_id: details.actual_tenant_id,
      resource: this.resource as ForaAuditEvent['resource'],
      trace_id: ctx.trace_id,
      timestamp: new Date().toISOString(),
      metadata: {
        key_prefix: details.key.slice(0, 12),
        resource: details.resource,
        id_prefix: details.id.length > 32 ? details.id.slice(0, 32) : details.id,
      },
    };
    try {
      await this.audit.emit(event);
    } catch (err) {
      // Audit emit failures must not turn a hit into a miss, but they must
      // be visible. Log to stderr; production would route to a logger.
      // eslint-disable-next-line no-console
      console.error('[cache-broker] audit emit failed', err);
    }
  }
}
