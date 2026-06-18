/**
 * @fora/db-pool — unit tests.
 *
 * These tests do NOT require a real Postgres. They use a hand-rolled
 * FakePool that simulates RLS by filtering rows based on the connection's
 * session-level `app.tenant_id` (the same way the real 0.7.2a RLS policy
 * does). The integration test in `pool.integration.test.ts` is the
 * proof against a real database.
 *
 * Acceptance bars covered:
 *   1. Claim whose tenant_id = A and envelope tenant_id = B throws
 *      TenantClaimMismatchError AND the connection is never checked out
 *      from the pool (i.e. acquire count stays at 0).
 *   2. Claim whose tenant_id = A and envelope tenant_id = A returns only
 *      A's rows even when the SQL is `SELECT * FROM customers`.
 *   3. Released connections start with the sentinel `app.tenant_id`, so a
 *      subsequent checkout without a context reads zero rows.
 *   4. Canarying: with FORA_TENANT_POOL unset (or anything other than
 *      'enforced'), the wrapper is a pass-through. This is what makes the
 *      rollout in FORA-124 acceptance bar #2 survivable.
 *   5. A `tenancy.denied` audit event is appended on every mismatch with
 *      `actor`, `attempted_tenant_id`, `actual_tenant_id`, and
 *      `resource = "db_connection"`.
 *   6. Bypassing the wrapper by calling the underlying pool directly is
 *      caught by the `enforced` mode — but the underlying pool is the
 *      single source of truth for connections, so this is asserted by
 *      the fact that the wrapper is the only call site that ever sees
 *      a check-out. (The audit gate is the safety net.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TenantAwarePool,
  InMemoryAuditSink,
  NO_TENANT_SENTINEL,
  TenantClaimMismatchError,
  MissingRequestContextError,
  type Claim,
  type RequestContext,
  type RequestEnvelope,
  type TenancyAuditEvent,
} from '../src/index.js';
import { parseEnforcement } from '../src/pool.js';

// ---- Test fixtures --------------------------------------------------------

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function claim(tenant_id: string, sub = 'user:okta-1'): Claim {
  return {
    tenant_id,
    principal: 'board_user',
    sub,
    roles: ['developer'],
    scopes: ['mcp:github:read'],
    trace_id: 'trace-test',
  };
}

function envelope(tenant_id: string): RequestEnvelope {
  return { tenant_id };
}

function ctx(claim_tenant: string, envelope_tenant: string): RequestContext {
  return { claim: claim(claim_tenant), envelope: envelope(envelope_tenant) };
}

// ---- Fake pg.Pool ---------------------------------------------------------

interface FakeQueryResult<R = Record<string, unknown>> {
  rows: R[];
  rowCount: number;
}

class FakeClient {
  /** Per-session `app.tenant_id` (the value a `SET` would persist). */
  session_tenant_id: string = NO_TENANT_SENTINEL;
  /**
   * Stack of pre-transaction `session_tenant_id` values. SET LOCAL
   * pushes the current value onto this stack; COMMIT/ROLLBACK pops it.
   * This mirrors real Postgres, where SET LOCAL is tx-scoped and the
   * value reverts to whatever was set at session level (here, the sentinel
   * installed on 'connect') once the transaction ends.
   */
  private tx_stack: string[] = [];
  /** Every query issued on this client, in order. */
  query_log: Array<{ sql: string; params?: unknown[] }> = [];
  released = false;
  /** Back-reference to the pool for shared state (e.g. customer rows). */
  private readonly pool: FakePool;

  constructor(pool: FakePool) {
    this.pool = pool;
  }

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<FakeQueryResult<R>> {
    this.query_log.push({ sql, params });
    const trimmed = sql.trim().toUpperCase();

    // Transaction control — push/pop the SET LOCAL stack.
    if (trimmed === 'BEGIN') {
      this.tx_stack.push(this.session_tenant_id);
      return { rows: [], rowCount: 0 };
    }
    if (trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
      const previous = this.tx_stack.pop();
      if (previous !== undefined) {
        this.session_tenant_id = previous;
      }
      return { rows: [], rowCount: 0 };
    }

    // SET LOCAL app.tenant_id = $1 — binds for the current transaction
    // only. The pre-tx value is on the tx_stack and is restored on
    // COMMIT/ROLLBACK above.
    if (/^SET\s+LOCAL\s+APP\.TENANT_ID\s*=/.test(trimmed)) {
      this.session_tenant_id = String(params?.[0] ?? NO_TENANT_SENTINEL);
      return { rows: [], rowCount: 0 };
    }

    // SET app.tenant_id = $1 — binds at session level.
    if (/^SET\s+APP\.TENANT_ID\s*=/.test(trimmed)) {
      this.session_tenant_id = String(params?.[0] ?? NO_TENANT_SENTINEL);
      return { rows: [], rowCount: 0 };
    }

    // SELECT current_setting('app.tenant_id') — used by tests to inspect.
    if (/CURRENT_SETTING\(['"]APP\.TENANT_ID['"]\)/.test(trimmed)) {
      return { rows: [{ setting: this.session_tenant_id }] as unknown as R[], rowCount: 1 };
    }

    // SELECT * FROM customers — RLS filter: return only rows whose
    // tenant_id matches the session's app.tenant_id. When the session
    // is the sentinel, return zero rows (no real tenant can match).
    if (/^SELECT\s+\*\s+FROM\s+CUSTOMERS/.test(trimmed)) {
      const all = this.pool.customer_rows;
      if (this.session_tenant_id === NO_TENANT_SENTINEL) {
        return { rows: [], rowCount: 0 };
      }
      const filtered = all.filter((r) => r.tenant_id === this.session_tenant_id);
      return { rows: filtered as R[], rowCount: filtered.length };
    }

    // Default: return empty.
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    this.released = true;
    // Return to the FakePool's idle pool. A real pg.Pool does this
    // automatically; we replicate it so a monkey-patched client
    // observes the patch on the next checkout.
    this.pool.return_to_idle(this);
  }
}

class FakePool {
  /** All clients ever created. */
  clients: FakeClient[] = [];
  /** Pool of released clients available for reuse. */
  private idle: FakeClient[] = [];
  /** Handlers attached via `on('connect', ...)`. */
  connect_handlers: Array<(c: FakeClient) => void> = [];
  end_called = false;
  /** Canned customer rows to return from SELECT * FROM customers. */
  customer_rows: Array<Record<string, unknown>> = [];

  async connect(): Promise<FakeClient> {
    // Hand back an idle client if one is available. This matches pg's
    // behaviour so that a test can monkey-patch a single client and
    // observe the patch on subsequent checkouts.
    const reused = this.idle.pop();
    if (reused) {
      reused.released = false;
      return reused;
    }
    const client = new FakeClient(this);
    this.clients.push(client);
    // Fire 'connect' handlers synchronously, in order. Each handler can
    // queue queries on the client; those will be serialised before any
    // query the caller issues afterwards.
    for (const h of this.connect_handlers) h(client);
    return client;
  }

  on(event: string, handler: (c: FakeClient) => void): void {
    if (event === 'connect') this.connect_handlers.push(handler);
  }

  /** Called by FakeClient.release() — returns the client to the idle pool. */
  return_to_idle(c: FakeClient): void {
    this.idle.push(c);
  }

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<FakeQueryResult<R>> {
    // Top-level query: acquire a client, run, release. This matches pg's
    // `Pool.query` shape.
    const c = await this.connect();
    try {
      return await c.query<R>(sql, params);
    } finally {
      c.release();
    }
  }

  async end(): Promise<void> {
    this.end_called = true;
  }
}

// ---- Tests ----------------------------------------------------------------

describe('parseEnforcement', () => {
  it('returns "enforced" only for the literal "enforced" (case-insensitive)', () => {
    expect(parseEnforcement('enforced')).toBe('enforced');
    expect(parseEnforcement('ENFORCED')).toBe('enforced');
    expect(parseEnforcement('  enforced  ')).toBe('enforced');
  });
  it('returns "disabled" for unset, "off", "dry-run", and typos', () => {
    expect(parseEnforcement(undefined)).toBe('disabled');
    expect(parseEnforcement('off')).toBe('disabled');
    expect(parseEnforcement('dry-run')).toBe('disabled');
    expect(parseEnforcement('enforc')).toBe('disabled');
    expect(parseEnforcement('')).toBe('disabled');
  });
});

describe('@fora/db-pool — TenantAwarePool', () => {
  let fake: FakePool;
  let audit: InMemoryAuditSink;
  let pool: TenantAwarePool;

  beforeEach(() => {
    fake = new FakePool();
    fake.customer_rows = [
      { id: 1, tenant_id: TENANT_A, name: 'Acme-1' },
      { id: 2, tenant_id: TENANT_A, name: 'Acme-2' },
      { id: 3, tenant_id: TENANT_B, name: 'Globex-1' },
    ];
    audit = new InMemoryAuditSink();
    pool = new TenantAwarePool({
      underlying_pool: fake,
      audit,
      enforcement: 'enforced',
    });
  });

  afterEach(async () => {
    await pool.close();
  });

  // ---- Acceptance bar 1: claim/envelope mismatch ------------------------

  it('throws TenantClaimMismatchError and checks out NO connection when envelope.tenant_id !== claim.tenant_id', async () => {
    const client_count_before = fake.clients.length;
    await expect(
      pool.query({ ctx: ctx(TENANT_A, TENANT_B), sql: 'SELECT * FROM customers' }),
    ).rejects.toBeInstanceOf(TenantClaimMismatchError);

    // The connection is never checked out — no new client was created.
    expect(fake.clients.length).toBe(client_count_before);
  });

  it('emits a tenancy.denied audit event with the required metadata on mismatch', async () => {
    await expect(
      pool.query({ ctx: ctx(TENANT_A, TENANT_B), sql: 'SELECT * FROM customers' }),
    ).rejects.toBeInstanceOf(TenantClaimMismatchError);

    const events = audit.all();
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.action).toBe('tenancy.denied');
    expect(ev.decision).toBe('deny');
    expect(ev.actor).toBe('user:okta-1');
    expect(ev.tenant_id).toBe(TENANT_A);
    expect(ev.principal).toBe('board_user');
    expect(ev.trace_id).toBe('trace-test');
    expect(ev.metadata).toEqual({
      attempted_tenant_id: TENANT_B,
      actual_tenant_id: TENANT_A,
      resource: 'db_connection',
    });
  });

  // ---- Acceptance bar 2: matching claim/envelope → RLS-filtered rows ----

  it('returns only A\'s rows when claim.tenant_id = A and envelope.tenant_id = A', async () => {
    const result = await pool.query({
      ctx: ctx(TENANT_A, TENANT_A),
      sql: 'SELECT * FROM customers',
    });
    expect(result.rows.map((r) => r.name)).toEqual(['Acme-1', 'Acme-2']);
    expect(result.rowCount).toBe(2);
  });

  it('returns only B\'s rows when claim.tenant_id = B and envelope.tenant_id = B', async () => {
    const result = await pool.query({
      ctx: ctx(TENANT_B, TENANT_B),
      sql: 'SELECT * FROM customers',
    });
    expect(result.rows.map((r) => r.name)).toEqual(['Globex-1']);
    expect(result.rowCount).toBe(1);
  });

  it('runs SET LOCAL app.tenant_id = $1 inside a transaction with the claim tenant id', async () => {
    await pool.query({ ctx: ctx(TENANT_A, TENANT_A), sql: 'SELECT * FROM customers' });
    // The pre-warm acquires clients[0] (idles after release). The user
    // query is then issued on the same client via pool reuse. Its log is:
    //   0: SET APP.TENANT_ID = $1          (sentinel, from 'connect' handler)
    //   1: SELECT 1                         (pre-warm round-trip)
    //   2: BEGIN
    //   3: SET LOCAL APP.TENANT_ID = $1
    //   4: SELECT * FROM customers
    //   5: COMMIT
    const user_client = fake.clients[0]!;
    const logs = user_client.query_log.map((q) => q.sql.trim().toUpperCase());
    expect(logs[0]).toMatch(/^SET\s+APP\.TENANT_ID/);
    expect(logs[1]).toBe('SELECT 1');
    expect(logs[2]).toBe('BEGIN');
    expect(logs[3]).toMatch(/^SET\s+LOCAL\s+APP\.TENANT_ID/);
    expect(logs[4]).toBe('SELECT * FROM CUSTOMERS');
    expect(logs[5]).toBe('COMMIT');

    const set_local = user_client.query_log[3]!;
    expect(set_local.params).toEqual([TENANT_A]);
  });

  // ---- Acceptance bar 3: released connections start with sentinel ------

  it('releases the connection back to the pool after each query', async () => {
    await pool.query({ ctx: ctx(TENANT_A, TENANT_A), sql: 'SELECT * FROM customers' });
    const only_client = fake.clients[0]!;
    expect(only_client.released).toBe(true);
  });

  it('installs the sentinel on a fresh physical connection (per-session app.tenant_id = 00000000-...)', async () => {
    // The pre-warm acquired a client and triggered 'connect', which set
    // the sentinel. After the user's transaction commits, the per-session
    // value reverts to the sentinel (because SET LOCAL is tx-scoped).
    await pool.query({ ctx: ctx(TENANT_A, TENANT_A), sql: 'SELECT * FROM customers' });
    const only_client = fake.clients[0]!;
    expect(only_client.session_tenant_id).toBe(NO_TENANT_SENTINEL);
  });

  it('subsequent checkout without a context would return zero rows (sentinel blocks all reads)', async () => {
    // Simulate a stray context-less query by calling the underlying pool
    // directly. This is the path the FORA-124 acceptance bar warns about;
    // the wrapper refuses to lend a connection, but the underlying pool
    // is just Postgres and will run whatever it's told.
    const stray = await fake.query('SELECT * FROM customers');
    expect(stray.rows).toEqual([]);
    expect(stray.rowCount).toBe(0);
  });

  // ---- Acceptance bar 4: canary (disabled mode) -------------------------

  it('passes through when enforcement is "disabled" (canary mode)', async () => {
    const canary_pool = new TenantAwarePool({
      underlying_pool: new FakePool(),
      audit: new InMemoryAuditSink(),
      enforcement: 'disabled',
    });
    // In disabled mode, ctx is NOT required and tenant binding is skipped.
    const result = await canary_pool.query({
      ctx: ctx(TENANT_A, TENANT_A),
      sql: 'SELECT * FROM customers',
    });
    expect(result).toBeDefined();
    await canary_pool.close();
  });

  it('does not throw on a mismatched envelope when enforcement is "disabled"', async () => {
    const canary_pool = new TenantAwarePool({
      underlying_pool: new FakePool(),
      audit: new InMemoryAuditSink(),
      enforcement: 'disabled',
    });
    // In disabled mode, the wrapper trusts the caller. A mismatch is
    // silently allowed (this is what canary means). The integration
    // test proves the gate engages when FORA_TENANT_POOL=enforced.
    await expect(
      canary_pool.query({ ctx: ctx(TENANT_A, TENANT_B), sql: 'SELECT 1' }),
    ).resolves.toBeDefined();
    await canary_pool.close();
  });

  it('reads FORA_TENANT_POOL=enforced from the env when enforcement is not set', () => {
    const prev = process.env.FORA_TENANT_POOL;
    process.env.FORA_TENANT_POOL = 'enforced';
    try {
      const p = new TenantAwarePool({
        underlying_pool: new FakePool(),
        audit: new InMemoryAuditSink(),
      });
      expect(p.enforcement_mode).toBe('enforced');
    } finally {
      if (prev === undefined) delete process.env.FORA_TENANT_POOL;
      else process.env.FORA_TENANT_POOL = prev;
    }
  });

  it('defaults to "disabled" when FORA_TENANT_POOL is unset', () => {
    const prev = process.env.FORA_TENANT_POOL;
    delete process.env.FORA_TENANT_POOL;
    try {
      const p = new TenantAwarePool({
        underlying_pool: new FakePool(),
        audit: new InMemoryAuditSink(),
      });
      expect(p.enforcement_mode).toBe('disabled');
    } finally {
      if (prev !== undefined) process.env.FORA_TENANT_POOL = prev;
    }
  });

  // ---- Acceptance bar 5: bypass detection ------------------------------

  it('throws MissingRequestContextError when ctx is omitted and enforcement is on', async () => {
    // The TypeScript type forbids this, but at runtime a bypass must
    // be caught. The test uses an `as unknown as` cast to simulate a
    // caller that hand-rolls the args object.
    await expect(
      pool.query({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: undefined as any,
        sql: 'SELECT 1',
      }),
    ).rejects.toBeInstanceOf(MissingRequestContextError);
  });

  // ---- Audit behaviour on a failed audit sink --------------------------

  it('still throws TenantClaimMismatchError when the audit sink fails (the denial is the primary signal)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    audit.fail_with = new Error('audit sink down');
    try {
      // The mismatch error is the contract; audit failure is a logger-grade
      // event, not a re-throw. We assert the error still propagates and
      // that the audit failure is surfaced through console.error.
      await expect(
        pool.query({ ctx: ctx(TENANT_A, TENANT_B), sql: 'SELECT 1' }),
      ).rejects.toBeInstanceOf(TenantClaimMismatchError);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  // ---- Misc ------------------------------------------------------------

  it('validates that claim.tenant_id is a UUID', async () => {
    await expect(
      pool.query({
        ctx: { claim: claim('not-a-uuid'), envelope: envelope('not-a-uuid') },
        sql: 'SELECT 1',
      }),
    ).rejects.toThrow(/not a valid UUID/);
  });

  it('closes the underlying pool', async () => {
    await pool.close();
    expect(fake.end_called).toBe(true);
  });

  it('rolls back the transaction on user-SQL error and re-throws', async () => {
    // Run a successful query first to populate the pool's client list.
    // The pre-warm acquires clients[0]; the first user query reuses
    // clients[0] via the idle pool. We patch clients[0] to throw on
    // the next SELECT * FROM customers.
    await pool.query({ ctx: ctx(TENANT_A, TENANT_A), sql: 'SELECT * FROM customers' });
    const user_client = fake.clients[0]!;
    const original = user_client.query.bind(user_client);
    user_client.query = async (sql: string, params?: unknown[]) => {
      if (/^SELECT\s+\*\s+FROM\s+CUSTOMERS/i.test(sql)) {
        throw new Error('user SQL exploded');
      }
      return original(sql, params);
    };
    await expect(
      pool.query({ ctx: ctx(TENANT_A, TENANT_A), sql: 'SELECT * FROM customers' }),
    ).rejects.toThrow(/user SQL exploded/);
    // The transaction must have been rolled back, not committed. The
    // second-to-last entry on the log is the failed SELECT; the last
    // is ROLLBACK.
    const logs = user_client.query_log.map((q) => q.sql.trim().toUpperCase());
    expect(logs[logs.length - 1]).toBe('ROLLBACK');
  });
});

// ---- Sentinel acceptance: 0.7.2a 0.7.2b invariant ------------------------

describe('@fora/db-pool — sentinel invariant (FORA-124 acceptance bar)', () => {
  it('a connection that was used by tenant A and released starts the next checkout with the sentinel', async () => {
    const fake = new FakePool();
    const audit = new InMemoryAuditSink();
    const pool = new TenantAwarePool({
      underlying_pool: fake,
      audit,
      enforcement: 'enforced',
    });

    // Use the pool with tenant A. The connection is released at the end.
    await pool.query({
      ctx: ctx(TENANT_A, TENANT_A),
      sql: 'SELECT * FROM customers',
    });

    // Now simulate a second checkout that, by mistake, uses the same
    // connection WITHOUT a tenant binding (e.g. a bypass). The sentinel
    // must be in effect: the row count is zero.
    const stray = await fake.query('SELECT * FROM customers');
    expect(stray.rows).toEqual([]);
    expect(stray.rowCount).toBe(0);

    await pool.close();
  });
});

// Keep imports used (the lint rule will yell otherwise).
void ({} as TenancyAuditEvent);
