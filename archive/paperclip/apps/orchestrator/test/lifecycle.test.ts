/**
 * Lifecycle tests — the FORA-134 acceptance bar.
 *
 *   1. create via POST /v1/runs writes agent_runs + 7 agent_run_stages.
 *   2. GET /v1/runs/{id} returns the header.
 *   3. GET /v1/runs/{id}/stages returns the seven stages.
 *   4. Pause / resume / cancel are idempotent under the same key.
 *   5. Replay with same key + same body returns the cached response.
 *   6. Replay with same key + DIFFERENT body returns 409 IDEMPOTENCY_CONFLICT.
 *   7. Invalid transitions (e.g. cancel a done run) return 409.
 *   8. Soft-deleted run is invisible to GET (404).
 *   9. Crash recovery rebuilds the resume tickets from the DB.
 *
 * The pure modules (state-machine, idempotency fingerprinting) have
 * unit tests here; the HTTP layer uses an in-memory Pool shim so the
 * suite runs without a live Postgres. The integration shape (real
 * `pg.Pool` against a testcontainer) lands in v0.2 once the v1.1 ADR
 * for tenant-claim extraction is settled.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  canTransition,
  isTerminal,
  nextStatus,
} from '../src/state-machine.js';
import {
  fingerprint,
  isUuidV4,
  parseIdempotencyKey,
} from '../src/idempotency.js';
import { STAGES_IN_ORDER } from '../src/types.js';
import { ValidationError } from '../src/idempotency.js';

// ---------------------------------------------------------------------------
// state-machine unit tests
// ---------------------------------------------------------------------------

describe('state machine', () => {
  it('pause is allowed from created / running / waiting_approval', () => {
    expect(canTransition('pause', 'created')).toBe(true);
    expect(canTransition('pause', 'running')).toBe(true);
    expect(canTransition('pause', 'waiting_approval')).toBe(true);
  });

  it('pause is rejected from paused / aborted / done / finished', () => {
    expect(canTransition('pause', 'paused')).toBe(false);
    expect(canTransition('pause', 'aborted')).toBe(false);
    expect(canTransition('pause', 'done')).toBe(false);
    expect(canTransition('pause', 'finished')).toBe(false);
  });

  it('resume is only allowed from paused', () => {
    expect(canTransition('resume', 'paused')).toBe(true);
    expect(canTransition('resume', 'created')).toBe(false);
    expect(canTransition('resume', 'running')).toBe(false);
    expect(canTransition('resume', 'aborted')).toBe(false);
  });

  it('cancel is allowed from any active state, not from terminal states', () => {
    expect(canTransition('cancel', 'created')).toBe(true);
    expect(canTransition('cancel', 'running')).toBe(true);
    expect(canTransition('cancel', 'waiting_approval')).toBe(true);
    expect(canTransition('cancel', 'paused')).toBe(true);
    expect(canTransition('cancel', 'aborted')).toBe(false);
    expect(canTransition('cancel', 'done')).toBe(false);
    expect(canTransition('cancel', 'finished')).toBe(false);
  });

  it('nextStatus returns the correct destination for each (verb, status) pair', () => {
    expect(nextStatus('pause', 'created')).toBe('paused');
    expect(nextStatus('pause', 'running')).toBe('paused');
    expect(nextStatus('resume', 'paused')).toBe('running');
    expect(nextStatus('cancel', 'running')).toBe('aborted');
    expect(nextStatus('cancel', 'paused')).toBe('aborted');
  });

  it('isTerminal marks aborted and done as terminal', () => {
    expect(isTerminal('aborted')).toBe(true);
    expect(isTerminal('done')).toBe(true);
    expect(isTerminal('paused')).toBe(false);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('created')).toBe(false);
    expect(isTerminal('waiting_approval')).toBe(false);
    expect(isTerminal('finished')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// idempotency unit tests
// ---------------------------------------------------------------------------

describe('idempotency fingerprint', () => {
  it('is order-insensitive over object keys', () => {
    const a = fingerprint({ a: 1, b: 2, c: { x: 'x', y: 'y' } });
    const b = fingerprint({ c: { y: 'y', x: 'x' }, b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('is sensitive to value changes', () => {
    const a = fingerprint({ goal_id: 'g1', project_id: 'p1' });
    const b = fingerprint({ goal_id: 'g1', project_id: 'p2' });
    expect(a).not.toBe(b);
  });

  it('is sensitive to array element order (arrays are positional)', () => {
    const a = fingerprint({ tags: ['x', 'y', 'z'] });
    const b = fingerprint({ tags: ['z', 'y', 'x'] });
    expect(a).not.toBe(b);
  });

  it('handles nested nulls', () => {
    expect(fingerprint(null)).toBe(fingerprint(null));
    expect(fingerprint({ a: null })).toBe(fingerprint({ a: null }));
  });
});

describe('UUID v4 parser', () => {
  it('accepts canonical UUID v4', () => {
    const k = '9f0c0c52-7e7b-4a3a-8d5a-1c9c5e3e3e3e';
    expect(isUuidV4(k)).toBe(true);
    expect(parseIdempotencyKey(k)).toBe(k);
  });

  it('rejects missing header', () => {
    expect(() => parseIdempotencyKey(undefined)).toThrow(ValidationError);
  });

  it('rejects non-UUID v4 strings', () => {
    expect(() => parseIdempotencyKey('not-a-uuid')).toThrow(ValidationError);
    // v1 UUID (time-based) is rejected — FORA-50 §4.1 specifies v4.
    expect(() =>
      parseIdempotencyKey('12345678-1234-1234-1234-123456789012'),
    ).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Soft-delete invariant + canonical stage list
// ---------------------------------------------------------------------------

describe('STAGES_IN_ORDER', () => {
  it('has exactly the seven canonical stages in spec order', () => {
    expect(STAGES_IN_ORDER).toEqual([
      'ideation',
      'architect',
      'dev',
      'qa',
      'security',
      'devops',
      'docs',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Server-level integration tests with an in-memory Pool shim.
//
// The shim implements just enough of the `pg.Pool` surface for the
// `repo.ts` queries the lifecycle handlers use. The shape is
// deliberately minimal: real Postgres is exercised in
// `packages/db-migrator/test/*` (the property-based RLS suite). For
// FORA-134 acceptance the shim is enough to prove the controller,
// idempotency, and state-machine glue.
// ---------------------------------------------------------------------------

import { buildServer } from '../src/server.js';
import type { OrchestratorDeps } from '../src/server.js';
import type { OrchestratorConfig } from '../src/config.js';
import {
  parseTriggerPayload,
  TriggerPayloadParseError,
} from '../src/repo.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';

interface RunRow {
  id: string;
  tenant_id: string;
  goal_id: string;
  project_id: string;
  status: string;
  current_stage: string;
  triggered_by: unknown;
  cost_ceiling_usd: string;
  cost_spent_usd: string;
  started_at: string | null;
  finished_at: string | null;
  deleted_at: string | null;
  archived_at: string | null;
}

interface StageRow {
  id: string;
  run_id: string;
  stage: string;
  status: string;
  decision: unknown | null;
  started_at: string | null;
  finished_at: string | null;
}

interface IdemRow {
  key: string;
  tenant_id: string;
  run_id: string | null;
  request_fingerprint: string;
  response_status: number;
  response_body: unknown;
  created_at: string;
}

/**
 * Tiny in-memory Postgres shim. Implements only the queries the
 * lifecycle handlers actually issue. The queries are matched on a
 * normalized SQL string (whitespace collapsed, lower-cased) and a
 * positional parameter list. The shim is intentionally limited to
 * the FORA-134 acceptance bar — anything richer is the v0.2
 * testcontainers job.
 */
class MemoryPool {
  readonly runs = new Map<string, RunRow>();
  readonly stages: StageRow[] = [];
  readonly idem: IdemRow[] = [];

  // Transaction tracking — the shim commits/rolls back writes issued
  // between BEGIN and COMMIT/ROLLBACK. The test asserts that the run
  // write and the idempotency-record write are atomic: a failure in
  // either rolls back both. Without this, the shim would leak rows
  // even when the production code's ROLLBACK path is exercised.
  private inTransaction = false;
  private txAddedRunIds = new Set<string>();
  private txAddedStageIds = new Set<string>();
  private txAddedIdemKeys = new Set<string>();
  private txUpdatedRunIds = new Map<string, RunRow>();

  /**
   * One-shot injection: when set, the next `INSERT INTO
   * agent_run_idempotency_keys` throws a unique-violation. Used by the
   * M-1 regression tests to prove the createRun + recordIdempotency
   * pair is one atomic transaction.
   */
  failOnNextIdemInsert = false;

  /** Apply `WHERE` filters that match a run row. */
  private runMatches(row: RunRow, sql: string, params: unknown[]): boolean {
    // The shim normalizes the SQL to lower-case + collapsed whitespace
    // before this method sees it, so all substring checks must be
    // lower-case too.
    // tenant_id = $2 (or $1) is the RLS-shaped tenant filter.
    const tenantIdx = sql.includes('tenant_id = $1') ? 0 : 1;
    if (sql.includes('tenant_id = $' + (tenantIdx + 1))) {
      if (row.tenant_id !== params[tenantIdx]) return false;
    }
    if (sql.includes('deleted_at is null')) {
      if (row.deleted_at !== null) return false;
    }
    if (sql.includes('status = $')) {
      const m = sql.match(/status = \$(\d+)/);
      if (m) {
        const idx = Number(m[1]) - 1;
        if (row.status !== params[idx]) return false;
      }
    }
    if (sql.includes('status not in')) {
      const m = sql.match(/status not in \('done', 'aborted'\)/);
      if (m) {
        if (row.status === 'done' || row.status === 'aborted') return false;
      }
    }
    return true;
  }

  async query<T = unknown>(
    sqlOrConfig: string | { text: string; values?: unknown[] },
    params2?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    const text =
      typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
    const values =
      typeof sqlOrConfig === 'string'
        ? (params2 ?? [])
        : (sqlOrConfig.values ?? []);
    const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();

    // BEGIN / COMMIT / ROLLBACK — the shim tracks the in-flight
    // transaction so the atomic-rollback test can prove the create
    // + idem-record pair is one transaction.
    if (sql === 'begin') {
      this.inTransaction = true;
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'commit') {
      this.inTransaction = false;
      this.txAddedRunIds.clear();
      this.txAddedStageIds.clear();
      this.txAddedIdemKeys.clear();
      this.txUpdatedRunIds.clear();
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'rollback') {
      // Undo inserts issued inside the rolled-back tx.
      for (const id of this.txAddedRunIds) this.runs.delete(id);
      for (const id of this.txAddedStageIds) {
        const idx = this.stages.findIndex((s) => s.id === id);
        if (idx >= 0) this.stages.splice(idx, 1);
      }
      for (const k of this.txAddedIdemKeys) {
        const idx = this.idem.findIndex(
          (i) => `${i.tenant_id}:${i.key}` === k,
        );
        if (idx >= 0) this.idem.splice(idx, 1);
      }
      // Restore the pre-update snapshot for any UPDATE issued inside
      // the rolled-back tx.
      for (const [id, prev] of this.txUpdatedRunIds) {
        if (prev) this.runs.set(id, prev);
      }
      this.inTransaction = false;
      this.txAddedRunIds.clear();
      this.txAddedStageIds.clear();
      this.txAddedIdemKeys.clear();
      this.txUpdatedRunIds.clear();
      return { rows: [], rowCount: 0 };
    }

    // INSERT agent_runs
    if (sql.startsWith('insert into agent_runs')) {
      const goalId = values[1] as string;
      const projectId = values[2] as string;
      const triggeredBy = JSON.parse(values[3] as string) as unknown;
      const costOverride = values[4] as string | null;
      const id = cryptoRandomUUID();
      const row: RunRow = {
        id,
        tenant_id: values[0] as string,
        goal_id: goalId,
        project_id: projectId,
        status: 'created',
        current_stage: 'ideation',
        triggered_by: triggeredBy,
        cost_ceiling_usd: costOverride ?? '100.00',
        cost_spent_usd: '0',
        started_at: null,
        finished_at: null,
        deleted_at: null,
        archived_at: null,
      };
      this.runs.set(id, row);
      if (this.inTransaction) this.txAddedRunIds.add(id);
      return { rows: [row as unknown as T], rowCount: 1 };
    }

    // INSERT agent_run_stages
    if (sql.startsWith('insert into agent_run_stages')) {
      const runId = values[0] as string;
      const stage = values[1] as string;
      const existing = this.stages.find(
        (s) => s.run_id === runId && s.stage === stage,
      );
      if (!existing) {
        const stageRow: StageRow = {
          id: cryptoRandomUUID(),
          run_id: runId,
          stage,
          status: 'pending',
          decision: null,
          started_at: null,
          finished_at: null,
        };
        this.stages.push(stageRow);
        if (this.inTransaction) this.txAddedStageIds.add(stageRow.id);
      }
      return { rows: [], rowCount: existing ? 0 : 1 };
    }

    // INSERT agent_run_idempotency_keys (PRIMARY KEY (tenant_id, key))
    if (sql.startsWith('insert into agent_run_idempotency_keys')) {
      // Test-only injection: force the next insert to fail so we can
      // exercise the atomic-rollback path that the production code is
      // supposed to take on a unique-violation or partial-failure.
      if (this.failOnNextIdemInsert) {
        this.failOnNextIdemInsert = false;
        throw Object.assign(new Error('synthetic idem-write failure'), {
          code: '23505',
        });
      }
      const row: IdemRow = {
        key: values[0] as string,
        tenant_id: values[1] as string,
        run_id: (values[2] as string | null) ?? null,
        request_fingerprint: values[3] as string,
        response_status: values[4] as number,
        response_body: JSON.parse(values[5] as string),
        created_at: (values[6] as string | null) ?? new Date().toISOString(),
      };
      const dupe = this.idem.find(
        (i) => i.tenant_id === row.tenant_id && i.key === row.key,
      );
      if (dupe) {
        // The real pg driver throws a unique-violation. The shim
        // surfaces a sentinel error so the caller can branch.
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      this.idem.push(row);
      if (this.inTransaction) this.txAddedIdemKeys.add(`${row.tenant_id}:${row.key}`);
      return { rows: [], rowCount: 1 };
    }

    // SELECT agent_run_idempotency_keys
    if (sql.startsWith('select key, tenant_id, run_id, request_fingerprint')) {
      const tenant = values[0] as string;
      const key = values[1] as string;
      const row = this.idem.find(
        (i) => i.tenant_id === tenant && i.key === key,
      );
      return {
        rows: row ? [row as unknown as T] : [],
        rowCount: row ? 1 : 0,
      };
    }

    // SELECT agent_runs
    if (sql.startsWith('select id, tenant_id, goal_id')) {
      // Two shapes: point lookup (`WHERE id = $1 ...`) and tenant scan
      // (`WHERE tenant_id = $1 ...`). Distinguish by whether the SQL
      // filters on a standalone `id` column — `tenant_id = $1` must
      // NOT match. The regex requires whitespace or start-of-string
      // before `id` so `_id` (e.g. `tenant_id`) does not false-match.
      const isPointLookup = /(?:^|\s)id\s*=\s*\$1\b/.test(sql);
      if (isPointLookup) {
        const runId = values[0] as string;
        const row = this.runs.get(runId);
        if (!row) return { rows: [], rowCount: 0 };
        if (!this.runMatches(row, sql, values)) return { rows: [], rowCount: 0 };
        return { rows: [row as unknown as T], rowCount: 1 };
      }
      // Tenant scan (e.g. listActiveRunsForRecovery).
      const matches: T[] = [];
      for (const row of this.runs.values()) {
        if (this.runMatches(row, sql, values)) {
          matches.push(row as unknown as T);
        }
      }
      return { rows: matches, rowCount: matches.length };
    }

    // SELECT stages (JOIN runs)
    if (sql.startsWith('select s.id, s.run_id, s.stage')) {
      const runId = values[0] as string;
      const tenant = values[1] as string;
      const run = this.runs.get(runId);
      if (!run || run.tenant_id !== tenant || run.deleted_at !== null) {
        return { rows: [], rowCount: 0 };
      }
      const ordered = STAGES_IN_ORDER.map((stage) =>
        this.stages.find((s) => s.run_id === runId && s.stage === stage),
      ).filter((s): s is StageRow => Boolean(s));
      return {
        rows: ordered.map((s) => {
          const { id, run_id, stage, status, decision, started_at, finished_at } = s;
          return { id, run_id, stage, status, decision, started_at, finished_at } as unknown as T;
        }),
        rowCount: ordered.length,
      };
    }

    // UPDATE agent_runs (status transition)
    if (sql.startsWith('update agent_runs')) {
      const runId = values[0] as string;
      const tenant = values[1] as string;
      const expected = values[2] as string;
      const next = values[3] as string;
      const row = this.runs.get(runId);
      if (!row) return { rows: [], rowCount: 0 };
      if (row.tenant_id !== tenant) return { rows: [], rowCount: 0 };
      if (row.deleted_at !== null) return { rows: [], rowCount: 0 };
      if (row.status !== expected) return { rows: [], rowCount: 0 };
      // Snapshot the row before applying changes if we are inside a
      // transaction — the rollback path restores this snapshot so the
      // verb-endpoint atomic-rollback test can prove the state change
      // was undone when the idempotency record write failed.
      if (this.inTransaction && !this.txUpdatedRunIds.has(runId)) {
        this.txUpdatedRunIds.set(runId, { ...row });
      }
      row.status = next;
      if ((next === 'done' || next === 'aborted') && !row.finished_at) {
        row.finished_at = new Date().toISOString();
      }
      if (next === 'running' && !row.started_at) {
        row.started_at = new Date().toISOString();
      }
      return { rows: [row as unknown as T], rowCount: 1 };
    }

    throw new Error(`MemoryPool: unhandled SQL: ${sql}`);
  }

  async connect(): Promise<{
    query: this['query'];
    release: () => void;
  }> {
    return { query: this.query.bind(this), release: () => {} };
  }

  async end(): Promise<void> {
    /* no-op */
  }
}

function cryptoRandomUUID(): string {
  // Use the global crypto if available; otherwise fall back to a tiny
  // UUID v4 generator that satisfies the regex check.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  // Fallback (RFC 4122 v4 shape; not cryptographically strong).
  const h = (n: number) =>
    n.toString(16).padStart(2, '0');
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  // version 4
  b[6] = (b[6] & 0x0f) | 0x40;
  // variant 10xx
  b[8] = (b[8] & 0x3f) | 0x80;
  const s: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    if (i === 4 || i === 6 || i === 8 || i === 10) s.push('-');
    s.push(h(b[i]));
  }
  return s.join('');
}

function makeDeps(pool: MemoryPool): OrchestratorDeps {
  const config: OrchestratorConfig = {
    port: 0,
    host: '127.0.0.1',
    databaseUrl: 'memory://test',
    defaultCostCeilingUsd: '100.00',
    logLevel: 'info',
    env: 'test',
  };
  return {
    config,
    pool: pool as unknown as OrchestratorDeps['pool'],
    extractTenant: (req) => {
      const v = req.headers['x-fora-tenant-id'];
      return typeof v === 'string' ? v : null;
    },
  };
}

const KEY1 = '11111111-1111-4111-8111-111111111111'; // valid v4
const KEY2 = '22222222-2222-4222-8222-222222222222';
const KEY3 = '33333333-3333-4333-8333-333333333333';
const KEY4 = '44444444-4444-4444-8444-444444444444';

function buildBody(overrides: Partial<{
  goal_id: string;
  project_id: string;
  triggered_by: { type: string; actor: string };
  cost_ceiling_usd?: string;
}> = {}) {
  return {
    goal_id: overrides.goal_id ?? 'goal-1',
    project_id: overrides.project_id ?? 'project-1',
    triggered_by: overrides.triggered_by ?? { type: 'manual', actor: 'tester' },
    ...(overrides.cost_ceiling_usd !== undefined
      ? { cost_ceiling_usd: overrides.cost_ceiling_usd }
      : {}),
  };
}

describe('POST /v1/runs — acceptance #1', () => {
  let pool: MemoryPool;
  beforeEach(() => {
    pool = new MemoryPool();
  });
  afterEach(() => {
    /* nothing to clean up */
  });

  it('creates a run + seven stage rows, all stage rows status=pending', async () => {
    const app = await buildServer(makeDeps(pool));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        'x-fora-tenant-id': TENANT,
        'idempotency-key': KEY1,
      },
      payload: buildBody(),
    });
    expect(res.statusCode).toBe(201);
    const run = res.json();
    expect(run.tenant_id).toBe(TENANT);
    expect(run.status).toBe('created');
    expect(run.current_stage).toBe('ideation');
    expect(run.cost_ceiling_usd).toBe('100.00');
    expect(pool.runs.size).toBe(1);
    const runRows = Array.from(pool.runs.values());
    expect(runRows).toHaveLength(1);
    const runId = runRows[0]!.id;
    const stages = pool.stages.filter((s) => s.run_id === runId);
    expect(stages).toHaveLength(7);
    for (const s of stages) expect(s.status).toBe('pending');
    const stageNames = stages.map((s) => s.stage).sort();
    expect(stageNames).toEqual(
      ['architect', 'dev', 'devops', 'docs', 'ideation', 'qa', 'security'].sort(),
    );
  });

  it('replays the same response on retry with the same key + same body', async () => {
    const app = await buildServer(makeDeps(pool));
    const first = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        'x-fora-tenant-id': TENANT,
        'idempotency-key': KEY1,
      },
      payload: buildBody(),
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        'x-fora-tenant-id': TENANT,
        'idempotency-key': KEY1,
      },
      payload: buildBody(),
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json()).toEqual(first.json());
    // Only one run was actually written.
    expect(pool.runs.size).toBe(1);
  });

  it('returns 409 IDEMPOTENCY_CONFLICT when the key is reused with a different body', async () => {
    const app = await buildServer(makeDeps(pool));
    const first = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        'x-fora-tenant-id': TENANT,
        'idempotency-key': KEY1,
      },
      payload: buildBody(),
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        'x-fora-tenant-id': TENANT,
        'idempotency-key': KEY1,
      },
      payload: buildBody({ goal_id: 'goal-DIFFERENT' }),
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('rejects an invalid Idempotency-Key header', async () => {
    const app = await buildServer(makeDeps(pool));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        'x-fora-tenant-id': TENANT,
        'idempotency-key': 'not-a-uuid',
      },
      payload: buildBody(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('rejects requests without the tenant header', async () => {
    const app = await buildServer(makeDeps(pool));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        'idempotency-key': KEY1,
      },
      payload: buildBody(),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/runs/{id} — acceptance #2', () => {
  let pool: MemoryPool;
  beforeEach(() => {
    pool = new MemoryPool();
  });

  it('returns the run header for the owner tenant', async () => {
    const app = await buildServer(makeDeps(pool));
    const create = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY1 },
      payload: buildBody(),
    });
    const run = create.json();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/runs/${run.id}`,
      headers: { 'x-fora-tenant-id': TENANT },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(run.id);
  });

  it('returns 404 for a different tenant (no cross-tenant leak)', async () => {
    const app = await buildServer(makeDeps(pool));
    const create = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY1 },
      payload: buildBody(),
    });
    const run = create.json();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/runs/${run.id}`,
      headers: { 'x-fora-tenant-id': OTHER_TENANT },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /v1/runs/{id}/stages — acceptance #2', () => {
  let pool: MemoryPool;
  beforeEach(() => {
    pool = new MemoryPool();
  });

  it('returns the seven stages in canonical order', async () => {
    const app = await buildServer(makeDeps(pool));
    const create = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY1 },
      payload: buildBody(),
    });
    const run = create.json();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/runs/${run.id}/stages`,
      headers: { 'x-fora-tenant-id': TENANT },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stages).toHaveLength(7);
    expect(body.stages.map((s: { stage: string }) => s.stage)).toEqual([
      'ideation',
      'architect',
      'dev',
      'qa',
      'security',
      'devops',
      'docs',
    ]);
  });
});

describe('Lifecycle verbs — acceptance #3', () => {
  let pool: MemoryPool;
  beforeEach(() => {
    pool = new MemoryPool();
  });

  async function createAndGet(app: Awaited<ReturnType<typeof buildServer>>) {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY1 },
      payload: buildBody(),
    });
    return create.json();
  }

  it('pause → resume → cancel cycle is idempotent on each verb', async () => {
    const app = await buildServer(makeDeps(pool));
    const run = await createAndGet(app);

    const pause1 = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/pause`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY2 },
    });
    const pause2 = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/pause`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY2 },
    });
    expect(pause1.statusCode).toBe(200);
    expect(pause1.json().status).toBe('paused');
    expect(pause2.statusCode).toBe(200);
    expect(pause2.headers['idempotent-replay']).toBe('true');
    expect(pause2.json().status).toBe('paused');

    const resume1 = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/resume`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY3 },
    });
    expect(resume1.statusCode).toBe(200);
    expect(resume1.json().status).toBe('running');

    const cancel1 = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/cancel`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY4 },
    });
    expect(cancel1.statusCode).toBe(200);
    expect(cancel1.json().status).toBe('aborted');
  });

  it('rejects cancel of an aborted run (INVALID_TRANSITION)', async () => {
    const app = await buildServer(makeDeps(pool));
    const run = await createAndGet(app);
    await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/cancel`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY2 },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/cancel`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY3 },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('INVALID_TRANSITION');
  });

  it('rejects resume of a created run (INVALID_TRANSITION)', async () => {
    const app = await buildServer(makeDeps(pool));
    const run = await createAndGet(app);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/resume`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY2 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_TRANSITION');
  });
});

describe('Soft-delete invariant', () => {
  it('GET on a soft-deleted run returns 404 (acceptance #5)', async () => {
    const pool = new MemoryPool();
    const app = await buildServer(makeDeps(pool));
    const create = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY1 },
      payload: buildBody(),
    });
    const run = create.json();
    // Soft-delete directly in the shim (the soft-delete endpoint is
    // out of scope for FORA-134; ADR-0009 §6 schedules it for v1.1).
    const row = pool.runs.get(run.id);
    expect(row).toBeDefined();
    row!.deleted_at = new Date().toISOString();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/runs/${run.id}`,
      headers: { 'x-fora-tenant-id': TENANT },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('Crash recovery — acceptance #4', () => {
  it('builds a resume ticket per active run, with the right current stage', async () => {
    const pool = new MemoryPool();
    const { buildRecoveryTickets } = await import('../src/rehydrate.js');

    const app = await buildServer(makeDeps(pool));
    const create = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY1 },
      payload: buildBody(),
    });
    const run = create.json();
    // Advance the run to running via the verb handlers.
    await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/pause`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY2 },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/resume`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY3 },
    });
    // Drive current_stage manually (the engine will own this in FORA-135).
    const row = pool.runs.get(run.id)!;
    row.current_stage = 'qa';

    const tickets = await buildRecoveryTickets(
      pool as unknown as Parameters<typeof buildRecoveryTickets>[0],
      TENANT,
    );

    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.run.id).toBe(run.id);
    expect(tickets[0]!.run.status).toBe('running');
    expect(tickets[0]!.resumeFrom.stage).toBe('qa');
    expect(tickets[0]!.resumeFrom.status).toBe('pending');
    expect(tickets[0]!.stages).toHaveLength(7);
  });

  it('skips terminal runs in recovery (only non-terminal runs are resumable)', async () => {
    const pool = new MemoryPool();
    const { buildRecoveryTickets } = await import('../src/rehydrate.js');
    const app = await buildServer(makeDeps(pool));

    const a = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY1 },
      payload: buildBody(),
    });
    const runA = a.json();
    await app.inject({
      method: 'POST',
      url: `/v1/runs/${runA.id}/cancel`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY2 },
    });

    const tickets = await buildRecoveryTickets(
      pool as unknown as Parameters<typeof buildRecoveryTickets>[0],
      TENANT,
    );
    expect(tickets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// M-1 atomicity — the run write and the idempotency record write share
// one transaction. A failure in the idempotency record write must roll
// back the run write too, otherwise a retry with the same key creates
// a second run.
//
// The shim tracks BEGIN/COMMIT/ROLLBACK so the test can prove the
// rollback actually undid the writes.
// ---------------------------------------------------------------------------

describe('M-1: createRun + recordIdempotency share one transaction', () => {
  it('rolls back the run + stages when the idempotency record write throws', async () => {
    const pool = new MemoryPool();
    const app = await buildServer(makeDeps(pool));
    pool.failOnNextIdemInsert = true;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        'x-fora-tenant-id': TENANT,
        'idempotency-key': KEY1,
      },
      payload: buildBody(),
    });

    // Handler returns 500 — the idempotency write failed.
    expect(res.statusCode).toBe(500);
    // Both writes were on the same transaction; ROLLBACK undoes them.
    expect(pool.runs.size).toBe(0);
    expect(pool.stages).toHaveLength(0);
    expect(pool.idem).toHaveLength(0);
  });

  it('a retry with the same key after the failed write succeeds (no orphan run)', async () => {
    const pool = new MemoryPool();
    const app = await buildServer(makeDeps(pool));
    pool.failOnNextIdemInsert = true;

    const failed = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        'x-fora-tenant-id': TENANT,
        'idempotency-key': KEY1,
      },
      payload: buildBody(),
    });
    expect(failed.statusCode).toBe(500);
    expect(pool.runs.size).toBe(0);

    // Retry with the same key — the lookup is a miss (the previous
    // idempotency record was rolled back), so the handler runs the
    // full createRun path again. There must be no orphan run from
    // the first attempt to collide with.
    const retry = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        'x-fora-tenant-id': TENANT,
        'idempotency-key': KEY1,
      },
      payload: buildBody(),
    });
    expect(retry.statusCode).toBe(201);
    expect(pool.runs.size).toBe(1);
    expect(pool.idem).toHaveLength(1);
  });
});

describe('M-1: transitionRunStatus + recordIdempotency share one transaction', () => {
  async function createRun(
    app: Awaited<ReturnType<typeof buildServer>>,
    pool: MemoryPool,
  ): Promise<{ id: string; status: string }> {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY1 },
      payload: buildBody(),
    });
    return create.json();
  }

  it('rolls back the verb state change when the idempotency record write throws', async () => {
    const pool = new MemoryPool();
    const app = await buildServer(makeDeps(pool));
    const created = await createRun(app, pool);
    expect(created.status).toBe('created');
    expect(pool.runs.get(created.id)?.status).toBe('created');
    // The create-run step left exactly one idem record (for KEY1);
    // any pause-path failure must NOT add a second entry.
    const idemBefore = pool.idem.length;

    pool.failOnNextIdemInsert = true;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/runs/${created.id}/pause`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY2 },
    });

    expect(res.statusCode).toBe(500);
    // The UPDATE ran first, but the ROLLBACK restored the row to
    // status='created'. No idempotency record was persisted.
    expect(pool.runs.get(created.id)?.status).toBe('created');
    expect(pool.idem).toHaveLength(idemBefore);
  });

  it('a retry with the same verb + key after the failed write still transitions', async () => {
    const pool = new MemoryPool();
    const app = await buildServer(makeDeps(pool));
    const created = await createRun(app, pool);
    const idemBefore = pool.idem.length;

    pool.failOnNextIdemInsert = true;
    const failed = await app.inject({
      method: 'POST',
      url: `/v1/runs/${created.id}/pause`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY2 },
    });
    expect(failed.statusCode).toBe(500);
    expect(pool.runs.get(created.id)?.status).toBe('created');
    expect(pool.idem).toHaveLength(idemBefore);

    // Retry — the lookup is a miss, the run is still in 'created',
    // so the verb transition fires and persists this time.
    const retry = await app.inject({
      method: 'POST',
      url: `/v1/runs/${created.id}/pause`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY2 },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().status).toBe('paused');
    expect(pool.runs.get(created.id)?.status).toBe('paused');
    expect(pool.idem).toHaveLength(idemBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// FORA-134.1 — lifecycle cleanups (SeniorEngineer review).
//
// Two new cases pin the contract for the remaining low-severity
// findings:
//   (a) Reusing the same Idempotency-Key across `/pause` then `/resume`
//       on the same run returns the cached paused response — the key
//       is bound to the (verb, run_id) tuple, not to the verb alone.
//   (b) `buildRecoveryTickets` skips an active run whose `current_stage`
//       is outside the seven canonical stages and emits a warn log so
//       an operator can detect the invariant break.
// ---------------------------------------------------------------------------

describe('FORA-134.1: Idempotency-Key is bound to (verb, run_id)', () => {
  it('reusing the same key on /pause then /resume returns the cached paused response', async () => {
    const pool = new MemoryPool();
    const app = await buildServer(makeDeps(pool));

    // First, create a run that is in 'running' (so /pause is the first
    // valid verb). We pause once to move status to 'paused', then resume
    // to bring it back to 'running' so /pause is a valid verb again.
    const create = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY1 },
      payload: buildBody(),
    });
    expect(create.statusCode).toBe(201);
    const run = create.json();

    // /pause (KEY2) → 'paused'
    const pause1 = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/pause`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY2 },
    });
    expect(pause1.statusCode).toBe(200);
    expect(pause1.json().status).toBe('paused');

    // /resume (KEY3) → 'running'
    const resume1 = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/resume`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY3 },
    });
    expect(resume1.statusCode).toBe(200);
    expect(resume1.json().status).toBe('running');

    // /pause (KEY2, REUSED) → cached 'paused' response.
    // The fingerprint for KEY2 is { verb: 'pause', run_id: run.id },
    // which the second call reproduces; the lookup hits the cache and
    // replays the original response WITHOUT executing the verb again.
    const pauseReplay = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/pause`,
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY2 },
    });
    expect(pauseReplay.statusCode).toBe(200);
    expect(pauseReplay.headers['idempotent-replay']).toBe('true');
    expect(pauseReplay.json().status).toBe('paused');
    expect(pauseReplay.json().id).toBe(run.id);

    // Sanity: the cached pause replay never touched the DB. The run is
    // still 'running' (the resume between the two pauses advanced it;
    // the cached pause replay is read-only by design).
    expect(pool.runs.get(run.id)?.status).toBe('running');
    expect(pool.idem).toHaveLength(3); // KEY1 (create), KEY2 (pause), KEY3 (resume)
  });
});

describe('FORA-134.1: rehydrate skip-on-invariant-violation', () => {
  it('skips a run whose current_stage is outside the seven canonical stages and emits a warn log', async () => {
    const pool = new MemoryPool();
    const { buildRecoveryTickets } = await import('../src/rehydrate.js');
    const app = await buildServer(makeDeps(pool));

    // Create the run normally (current_stage starts at 'ideation').
    const create = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY1 },
      payload: buildBody(),
    });
    const run = create.json();

    // Corrupt current_stage to a non-canonical value. The seven stages
    // are ideation/architect/dev/qa/security/devops/docs; 'launch' is
    // not one of them, simulating a data-integrity violation.
    const row = pool.runs.get(run.id)!;
    row.current_stage = 'launch';

    const warnLines: Array<Record<string, unknown>> = [];
    const tickets = await buildRecoveryTickets(
      pool as unknown as Parameters<typeof buildRecoveryTickets>[0],
      TENANT,
      (line) => warnLines.push(line),
    );

    expect(tickets).toHaveLength(0);
    expect(warnLines).toHaveLength(1);
    expect(warnLines[0]!.level).toBe('warn');
    expect(warnLines[0]!.run_id).toBe(run.id);
    expect(warnLines[0]!.current_stage).toBe('launch');
    expect(warnLines[0]!.canonical_stages).toEqual(STAGES_IN_ORDER);
  });
});

// ---------------------------------------------------------------------------
// FORA-134.1 §4 — `parseTriggerPayload` replaces the jsonb cast at the
// repo boundary. The schema is the trust contract for both the create
// path (server.ts) and the read path (repo.ts rowToRun). A malformed
// jsonb value in a row surfaces as a typed parse error — the HTTP layer
// maps that to a 500 INTERNAL via the setErrorHandler safety net, the
// same envelope as any other unrecoverable DB shape mismatch.
// ---------------------------------------------------------------------------

describe('parseTriggerPayload', () => {
  it('accepts a canonical {type, actor} shape', () => {
    const out = parseTriggerPayload({ type: 'manual', actor: 'tester' });
    expect(out).toEqual({ type: 'manual', actor: 'tester' });
  });

  it('accepts the optional payload_ref field when present', () => {
    const out = parseTriggerPayload({
      type: 'slack',
      actor: 'u1',
      payload_ref: 'msg:42',
    });
    expect(out).toEqual({ type: 'slack', actor: 'u1', payload_ref: 'msg:42' });
  });

  it('rejects an unknown type enum with TriggerPayloadParseError', () => {
    expect(() => parseTriggerPayload({ type: 'pigeon', actor: 'a' })).toThrow(
      TriggerPayloadParseError,
    );
  });

  it('rejects a missing actor with TriggerPayloadParseError', () => {
    expect(() => parseTriggerPayload({ type: 'manual' })).toThrow(
      TriggerPayloadParseError,
    );
  });

  it('rejects a non-object input with TriggerPayloadParseError', () => {
    expect(() => parseTriggerPayload('not-a-payload')).toThrow(
      TriggerPayloadParseError,
    );
    expect(() => parseTriggerPayload(null)).toThrow(TriggerPayloadParseError);
  });
});

describe('FORA-134.1: GET surfaces a 500 when triggered_by jsonb is malformed', () => {
  it('returns 500 INTERNAL when a row has a non-conforming triggered_by shape', async () => {
    const pool = new MemoryPool();
    const app = await buildServer(makeDeps(pool));

    // Create a run normally; this round-trips a valid triggered_by
    // through the create path. The test then hand-edits the row in
    // the shim to simulate legacy data (or a hand-edited row) that
    // does NOT satisfy the schema. The next read must surface the
    // typed parse error as a 500 INTERNAL, not a 200 with a
    // structurally-incorrect payload.
    const create = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { 'x-fora-tenant-id': TENANT, 'idempotency-key': KEY1 },
      payload: buildBody(),
    });
    expect(create.statusCode).toBe(201);
    const run = create.json();

    const row = pool.runs.get(run.id);
    expect(row).toBeDefined();
    // 'pigeon' is not in the {manual, slack, email, schedule, api} enum.
    row!.triggered_by = { type: 'pigeon', actor: '' };

    const res = await app.inject({
      method: 'GET',
      url: `/v1/runs/${run.id}`,
      headers: { 'x-fora-tenant-id': TENANT },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL');
  });
});
