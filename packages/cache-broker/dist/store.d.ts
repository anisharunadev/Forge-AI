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
    set(key: string, value: string, opts?: {
        ttlMs?: number;
    }): Promise<void>;
    del(key: string): Promise<void>;
    /** Test-only. List keys (filtered by an optional tag prefix). Never called in production code paths. */
    keys?(prefix?: string): Promise<string[]>;
}
/** A simple in-memory store. For tests + dev. */
export declare class InMemoryCacheStore implements CacheStore {
    private readonly map;
    private readonly clock;
    constructor(opts?: {
        now?: () => number;
    });
    get(key: string): Promise<string | null>;
    set(key: string, value: string, opts?: {
        ttlMs?: number;
    }): Promise<void>;
    del(key: string): Promise<void>;
    keys(prefix?: string): Promise<string[]>;
    /** Test-only: number of live entries. */
    size(): number;
    /** Test-only: clear the store. */
    clear(): void;
}
