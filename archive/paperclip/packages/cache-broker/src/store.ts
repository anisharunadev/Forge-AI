/**
 * @fora/cache-broker — store interface
 *
 * The broker is a thin facade over a backend. v0.7.2d ships an in-memory
 * implementation for tests + dev; production wiring is a Redis adapter
 * (deferred to v0.7.2d-followup). The store interface is intentionally tiny:
 * get/set/del/keys. The broker does NOT support scan-by-tenant in v0.7.2
 * because we never want to enumerate one tenant's keys from another tenant's
 * context. Eviction by tenant is done by the backend's tag system, not by a
 * broker method.
 */

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ttlMs?: number }): Promise<void>;
  del(key: string): Promise<void>;
  /** Test-only. List keys (filtered by an optional tag prefix). Never called in production code paths. */
  keys?(prefix?: string): Promise<string[]>;
}

/** A simple in-memory store. For tests + dev. */
export class InMemoryCacheStore implements CacheStore {
  private readonly map = new Map<string, { value: string; expiresAt: number | null }>();
  private readonly clock: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.clock = opts.now ?? Date.now;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.clock()) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, opts: { ttlMs?: number } = {}): Promise<void> {
    const expiresAt = opts.ttlMs ? this.clock() + opts.ttlMs : null;
    this.map.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }

  async keys(prefix?: string): Promise<string[]> {
    const all = Array.from(this.map.keys());
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }

  /** Test-only: number of live entries. */
  size(): number {
    return this.map.size;
  }

  /** Test-only: clear the store. */
  clear(): void {
    this.map.clear();
  }
}
