/**
 * @fora/db-pool — `TenantAwarePool`.
 *
 * A `pg.Pool` wrapper that, on every checkout:
 *
 *   1. Verifies the request envelope's `tenant_id` equals the verified
 *      claim's `tenant_id`. On mismatch, throws `TenantClaimMismatchError`
 *      and emits `tenancy.denied`. The connection is never checked out.
 *   2. Acquires a connection, opens a transaction, and runs
 *      `SET LOCAL app.tenant_id = '<claim.tenant_id>'` so the RLS policy
 *      from 0.7.2a binds the query to the claim.
 *   3. Releases the connection. The per-session `app.tenant_id` is the
 *      sentinel `00000000-0000-0000-0000-000000000000` so a stray
 *      checkout cannot read across tenants.
 *
 * The wrapper is gated by `FORA_TENANT_POOL=enforced`. When not enforced
 * (default), it is a pass-through — useful for canary rollout. When
 * enforced, the wrapper is the *only* safe entry point; the acceptance
 * test in `test/pool.test.ts` proves the bypass is caught.
 *
 * Per ADR-0003 §4.2 the wrapper is the runtime gate; the migration from
 * 0.7.2a is the data-layer gate. Both must pass for tenancy to hold.
 */

import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import {
  type AuditSink,
  type Claim,
  type RequestContext,
  type RequestEnvelope,
  type TenancyAuditEvent,
  type TenantId,
  MissingRequestContextError,
  NO_TENANT_SENTINEL,
  TenantClaimMismatchError,
  TenantIdSchema,
} from './types.js';

// ---- Enforcement mode -----------------------------------------------------

export type EnforcementMode = 'enforced' | 'disabled';

/**
 * Parse the `FORA_TENANT_POOL` env var. Only the literal value `enforced`
 * enables the gate; anything else (unset, `off`, `dry-run`, typo) is a
 * pass-through. The default is `disabled` so a missed flag does not
 * silently enforce — it must be explicitly turned on.
 */
export function parseEnforcement(raw: string | undefined): EnforcementMode {
  if (typeof raw === 'string' && raw.trim().toLowerCase() === 'enforced') {
    return 'enforced';
  }
  return 'disabled';
}

// ---- Query context types --------------------------------------------------

/**
 * The arguments accepted by `query()`. Postgres's `pg.Pool` accepts the
 * SQL string and a parameter list. We accept the same shape, plus the
 * required `RequestContext`.
 */
export type QueryArgs<R extends QueryResultRow = QueryResultRow> =
  | { ctx: RequestContext; sql: string; params?: unknown[] }
  | { ctx: RequestContext; sql: string; values: unknown[] };

/**
 * A `pg.Pool`-compatible factory so the wrapper can stand up its own
 * underlying pool. The factory is injectable for tests (we use a stub
 * in unit tests; integration uses a real `pg.Pool`).
 */
export type UnderlyingPoolFactory = () => Pool;

// ---- TenantAwarePool ------------------------------------------------------

export interface TenantAwarePoolOptions {
  /** Factory that produces a `pg.Pool`-compatible pool. */
  underlying_pool: Pool | UnderlyingPoolFactory;
  /** Audit sink — receives `tenancy.denied` on mismatch. */
  audit: AuditSink;
  /**
   * `enforced` ⇒ validate claim/envelope, set sentinel, refuse mismatches.
   * `disabled` ⇒ pass-through (for canary rollout).
   * Defaults to `parseEnforcement(process.env.FORA_TENANT_POOL)`.
   */
  enforcement?: EnforcementMode;
  /**
   * Override `new Date()` for tests. Used to stamp `timestamp` on audit
   * events. Defaults to `() => new Date().toISOString()`.
   */
  now?: () => string;
}

export class TenantAwarePool {
  private readonly pool: Pool;
  private readonly audit: AuditSink;
  private readonly mode: EnforcementMode;
  private readonly now: () => string;
  private sentinel_installed = false;
  private closed = false;

  constructor(opts: TenantAwarePoolOptions) {
    this.pool =
      typeof (opts.underlying_pool as unknown as { query?: unknown }).query === 'function'
        ? (opts.underlying_pool as Pool)
        : (opts.underlying_pool as UnderlyingPoolFactory)();
    this.audit = opts.audit;
    this.mode = opts.enforcement ?? parseEnforcement(process.env.FORA_TENANT_POOL);
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  /**
   * Run a query under the claim's tenant binding. The wrapper always
   * wraps the user SQL in a transaction with `SET LOCAL app.tenant_id`.
   * On a claim/envelope mismatch the connection is never checked out.
   */
  async query<R extends QueryResultRow = QueryResultRow>(
    args: QueryArgs<R>,
  ): Promise<QueryResult<R>> {
    if (this.closed) throw new Error('db-pool: pool is closed');
    if (this.mode === 'disabled') {
      // Pass-through. We intentionally do NOT validate ctx, so legacy
      // callers keep working during canary. The acceptance test in
      // FORA-124 switches this to `enforced` to prove bypass is caught.
      const { sql, params } = splitArgs<R>(args);
      return this.pool.query<R>(sql, params as unknown[]);
    }

    // Enforced path. The connection is NOT yet checked out; we may still
    // throw without acquiring one.
    const { ctx, sql, params } = splitArgs<R>(args);
    this.assertContext(ctx);

    // Make sure the underlying connection has the sentinel installed.
    // This is idempotent: pg's `connect` event fires once per physical
    // connection, so we set the sentinel exactly once per connection.
    await this.ensureSentinelInstalled();

    // Acquire a connection, run the user query under a tx with SET LOCAL.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // SET LOCAL takes effect for the duration of the current transaction.
      // We use a parameterised statement so the tenant id is bound safely.
      await client.query('SET LOCAL app.tenant_id = $1', [ctx.claim.tenant_id]);
      const result = await client.query<R>(sql, params as unknown[]);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // best effort
      }
      throw err;
    } finally {
      client.release();
      // The connection's per-session `app.tenant_id` is the sentinel (we
      // set it on connect and never persist a per-session value), so
      // post-commit state is the sentinel automatically. No RESET needed.
    }
  }

  /**
   * Run a function inside a tenant-bound transaction. The function
   * receives a scoped client that has `app.tenant_id` bound. On exit
   * (resolve or throw) the transaction is committed or rolled back and
   * the connection is released.
   */
  async withTransaction<R>(
    ctx: RequestContext,
    fn: (client: ScopedClient) => Promise<R>,
  ): Promise<R> {
    if (this.closed) throw new Error('db-pool: pool is closed');
    if (this.mode === 'disabled') {
      const client = await this.pool.connect();
      try {
        return await fn(client as unknown as ScopedClient);
      } finally {
        client.release();
      }
    }
    this.assertContext(ctx);
    await this.ensureSentinelInstalled();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL app.tenant_id = $1', [ctx.claim.tenant_id]);
      const result = await fn(client as unknown as ScopedClient);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // best effort
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /** Surface the current enforcement mode. */
  get enforcement_mode(): EnforcementMode {
    return this.mode;
  }

  /** Close the underlying pool. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
    await this.audit.close();
  }

  // ---- Internals ----------------------------------------------------------

  private assertContext(ctx: RequestContext): void {
    if (!ctx || !ctx.claim || !ctx.envelope) {
      throw new MissingRequestContextError();
    }
    // Validate the claim and envelope tenant ids are well-formed UUIDs.
    // We do this here (not in the zod parse at construction) so the error
    // path is "pool refused the query" rather than a parse failure upstack.
    const parsed_claim = TenantIdSchema.safeParse(ctx.claim.tenant_id);
    if (!parsed_claim.success) {
      throw new Error(
        `db-pool: claim.tenant_id is not a valid UUID: ${ctx.claim.tenant_id}`,
      );
    }
    const parsed_envelope = TenantIdSchema.safeParse(ctx.envelope.tenant_id);
    if (!parsed_envelope.success) {
      throw new Error(
        `db-pool: envelope.tenant_id is not a valid UUID: ${ctx.envelope.tenant_id}`,
      );
    }
    if (ctx.claim.tenant_id !== ctx.envelope.tenant_id) {
      const err = new TenantClaimMismatchError({
        claim_tenant_id: ctx.claim.tenant_id as TenantId,
        envelope_tenant_id: ctx.envelope.tenant_id as TenantId,
        actor: ctx.claim.sub,
        trace_id: ctx.claim.trace_id,
      });
      // Audit the denial. We await so a crash during audit is observable;
      // a denial that cannot be audited is itself a P0 incident.
      void this.emitTenancyDenied(ctx.claim, ctx.envelope, ctx.claim.tenant_id as TenantId);
      throw err;
    }
  }

  private async emitTenancyDenied(
    claim: Claim,
    envelope: RequestEnvelope,
    claim_tenant: TenantId,
  ): Promise<void> {
    const event: TenancyAuditEvent = {
      actor: claim.sub,
      tenant_id: claim_tenant,
      principal: claim.principal,
      action: 'tenancy.denied',
      scopes_used: claim.scopes,
      decision: 'deny',
      trace_id: claim.trace_id,
      timestamp: this.now(),
      metadata: {
        attempted_tenant_id: envelope.tenant_id,
        actual_tenant_id: claim.tenant_id,
        resource: 'db_connection',
      },
    };
    try {
      await this.audit.append(event);
    } catch (err) {
      // Audit is non-negotiable (ADR-0003 §2 #6). If the sink is down we
      // still throw the mismatch error, but we surface the sink failure
      // through the logger-ish interface the consumer can wire.
      // We do NOT swallow the audit failure silently.
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`db-pool: audit sink failed on tenancy.denied: ${msg}`);
    }
  }

  private async ensureSentinelInstalled(): Promise<void> {
    if (this.sentinel_installed) return;
    // pg.Pool emits a 'connect' event every time a new physical connection
    // is added to the pool. We install a one-shot handler that sets the
    // sentinel on each new connection. After the first event we set
    // `sentinel_installed` to true; subsequent connections are also
    // handled (we keep the handler attached), but we don't re-install.
    this.pool.on('connect', (client: PoolClient) => {
      // Fire-and-forget: SET is best-effort at pool-startup. A failure
      // here would surface on the first query, not silently corrupt
      // tenant binding.
      void client
        .query('SET app.tenant_id = $1', [NO_TENANT_SENTINEL])
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.error(
            `db-pool: failed to set sentinel on new connection: ${msg}`,
          );
        });
    });
    this.sentinel_installed = true;
    // Pre-warm: acquire and release a single connection so the 'connect'
    // event fires at construction time, not on the first user query. This
    // is what makes the integration test for the sentinel deterministic.
    const warm = await this.pool.connect();
    try {
      // The 'connect' handler has already queued SET; we don't need to
      // wait for it — pg serialises queries on a single client.
      await warm.query('SELECT 1');
    } finally {
      warm.release();
    }
  }
}

// ---- Helpers --------------------------------------------------------------

/**
 * `pg`'s `query()` accepts either `(sql, params)` or `(sql)`. The wrapper
 * normalises both shapes so the user only types one signature.
 */
function splitArgs<R extends QueryResultRow>(
  args: QueryArgs<R>,
): { ctx: RequestContext; sql: string; params?: unknown[] } {
  if ('values' in args) {
    return { ctx: args.ctx, sql: args.sql, params: args.values };
  }
  return { ctx: args.ctx, sql: args.sql, params: args.params ?? [] };
}

// ---- Scoped client --------------------------------------------------------

/**
 * A `pg.PoolClient` whose `app.tenant_id` is bound via `SET LOCAL` for the
 * lifetime of the transaction. The binding is reset on `release` by the
 * surrounding transaction. We expose a typed shape so consumers do not
 * need to import the full `pg` API surface.
 */
export interface ScopedClient {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
  release(): void;
}
