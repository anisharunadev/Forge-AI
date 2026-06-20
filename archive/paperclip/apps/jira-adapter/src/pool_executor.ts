/**
 * `PoolExecutor` — the transactional query handle passed to
 * every adapter operation.
 *
 * Mirrors the `@fora/db-pool` `TenantAwarePool.query()` shape
 * (FORA-163 / ADR-0003 §4.2) but is interface-typed so the
 * adapter can be tested with an in-memory fake (the
 * `idempotency.test.ts` property test does NOT require a real
 * Postgres). The runtime path passes the real `TenantAwarePool`
 * wrapper; the test path passes a `FakeExecutor` that simulates
 * the `INSERT ... ON CONFLICT DO NOTHING` semantics on top of
 * a `Map`.
 *
 * Why interface-typed instead of imported:
 *   - The adapter's hard dependency on `@fora/db-pool` is at
 *     the seam level (FORA-200 charter §"Output / review bar":
 *     "produce evidence per slice: contract tests"). The runtime
 *     wiring injects the pool; the test wiring injects the fake.
 *   - Keeping the seam small (one interface, two methods) means
 *     the FORA-402/404/405 implementations inherit the same
 *     testability without each carrying their own fake.
 */

/** Postgres parameter binding. Mirrors `pg`'s `QueryResultRow` shape. */
export interface QueryResultRow {
  [column: string]: unknown;
}

/** Query argument shape — same surface as `pg.Pool.query`. */
export interface QueryArgs<R extends QueryResultRow = QueryResultRow> {
  sql: string;
  params?: unknown[];
}

/** Minimal query result surface used by the adapter. */
export interface QueryResult<R extends QueryResultRow = QueryResultRow> {
  rowCount: number;
  rows: R[];
}

/**
 * Transactional query handle. The caller owns the transaction
 * boundary: opening it, committing, or rolling back. The
 * adapter's operations call `query()` only — the seam is
 * intentionally narrow so a future `pg.PoolClient` swap is
 * trivial.
 */
export interface PoolExecutor {
  query<R extends QueryResultRow = QueryResultRow>(
    args: QueryArgs<R>,
  ): Promise<QueryResult<R>>;
}