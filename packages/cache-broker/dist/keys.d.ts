/**
 * @fora/cache-broker — keys
 *
 * Every cache key is `sha256(resource + ':' + id)`. The hash is opaque on the
 * wire and at rest — the tenant boundary is NOT in the key. The broker stores
 * the value as `{ __tnt: <tenant_id>, v: <actualValue> }` and the read path
 * verifies the stored tenant_id matches the bound claim.
 *
 * Why a single shared namespace (and not a per-tenant hash like
 * `sha256(tenant_id + ':' + resource + ':' + id)`):
 *
 *   - The spec ("A warm cache cannot serve cross-tenant data: a tenant-B
 *     `get` for a key written by tenant A returns `tenant_mismatch`")
 *     requires the broker to KNOW about tenant A's value when tenant B asks
 *     for the same `(resource, id)`. A per-tenant hash would make those
 *     lookups miss and the gate would be untestable.
 *   - The hash makes the on-the-wire key opaque; a casual dump of the
 *     backend cannot reconstruct `(resource, id)` without the work factor
 *     of sha256. For an extra layer, the broker also stores the tenant
 *     boundary inside the wrapped value.
 *   - The un-hashed tag `tenants:{tenant_id}:{resource}` is what the backend
 *     uses for tag-based eviction. The hash is the lookup key; the tag is
 *     the policy surface.
 *
 * The function names are kept as `deriveKey` and `deriveTag` so the public
 * surface is stable; the semantics are documented here and in the README.
 */
import type { CacheKey, KeyParts } from './types.js';
/** Derive a cache key from `(resource, id)`. The tenant id is NOT in the hash. */
export declare function deriveKey(parts: Pick<KeyParts, 'resource' | 'id'>): CacheKey;
/**
 * The "tag" the broker stores alongside the hashed key. Backends like Redis
 * support tag-based eviction; the tag is the un-hashed `(tenant_id, resource)`
 * pair. The id is not in the tag because ids are not enumerable the way
 * resources are.
 */
export declare function deriveTag(parts: Pick<KeyParts, 'tenant_id' | 'resource'>): string;
/** Test-only: the canonical input string for a key, for diagnostic dumps. */
export declare function keyMaterial(parts: Pick<KeyParts, 'resource' | 'id'>): string;
