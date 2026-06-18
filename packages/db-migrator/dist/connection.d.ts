/**
 * Connection helper: `withTenant(pool, tenantId, fn)`.
 *
 * The 0.7.2b connection pool will set `app.tenant_id` on every connect
 * via `SET LOCAL`. This helper is the *test* equivalent: it sets the GUC
 * for the lifetime of a single client checkout. Application code should
 * use the pool wrapper, not this helper; this helper exists for the
 * property-based test, which needs to swap `app.tenant_id` per test case.
 *
 * Uses `SET LOCAL` inside a transaction so the GUC is scoped to the
 * transaction and cannot leak across pool checkouts.
 */
import type { Pool, PoolClient } from 'pg';
/** The `00000000-0000-0000-0000-000000000000` sentinel that matches zero rows. */
export declare const TENANT_ID_SENTINEL = "00000000-0000-0000-0000-000000000000";
/**
 * Validate a tenant id is a UUID. We never pass a non-UUID to `app.tenant_id`
 * because the cast in the RLS policy is `::uuid`; a non-UUID would error
 * and a transaction would roll back. Catching it here gives a clearer
 * error than a Postgres `invalid input syntax for type uuid`.
 */
export declare function isUuid(s: string): boolean;
/**
 * Run `fn` with `app.tenant_id` set to `tenantId` for the duration of a
 * transaction. The client is checked out from the pool, used, and released.
 *
 * If `tenantId` is `null`, the helper does not set the GUC — the canonical
 * policy shape defaults to the nil-UUID sentinel via `coalesce(...)` and
 * the read returns zero rows. This is what a misconfigured pool sees.
 */
export declare function withTenant<T>(pool: Pool, tenantId: string | null, fn: (client: PoolClient) => Promise<T>): Promise<T>;
