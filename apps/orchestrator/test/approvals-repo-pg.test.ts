/**
 * PgApprovalsRepo integration test.
 *
 * FORA-168 (0.1.4.a) acceptance: the Postgres adapter for
 * `ApprovalsRepo` preserves the algorithm invariants the in-memory
 * test double enforces:
 *
 *   - soft-delete filter on every read (`deleted_at IS NULL`)
 *   - tenant gate enforced by JOIN to agent_runs
 *   - status transition guard (`WHERE status = 'pending'` on UPDATE)
 *   - the (run_id, gate_kind) EXCLUDE constraint catches re-issue of
 *     the same revision (the JS layer recognises the unique-violation)
 *   - expire is monotonic — re-expire on a decided row is a no-op
 *   - extend refuses a terminal row
 *   - setInteractionId rotates `superseded_interaction_id` for the
 *     stale-target audit chain (ADR-0008 §5)
 *
 * The test uses a minimal `pg.Pool` shim (not a live DB) — the SQL
 * surface the adapter uses is matched against the shim's tiny parser.
 * Live-DB coverage lands in `packages/db-migrator/test/*` once a
 * testcontainers Postgres is wired up in v0.2 (same plan as FORA-134
 * / `lifecycle.test.ts:15-17`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PgApprovalsRepo } from '../src/approvals-repo-pg.js';
import { ApprovalAlreadyDecidedError } from '../src/ports.js';
import {
  asRunId,
  asTenantId,
  type RunId,
  type TenantId,
} from '../src/types.js';

const TENANT_A = asTenantId('11111111-1111-4111-8111-111111111111');
const TENANT_B = asTenantId('22222222-2222-4222-8222-222222222222');
const RUN_A = asRunId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

interface ApprovalRow {
  id: string;
  tenant_id: string;
  run_id: string;
  stage: string | null;
  gate_kind: string;
  required_role: string;
  status: string;
  paperclip_interaction_id: string | null;
  artefact_refs: unknown[];
  reason: string | null;
  requested_at: string;
  decided_at: string | null;
  decided_by: unknown;
  decision: string | null;
  expires_at: string;
  paged_at_50_percent: boolean;
  superseded_interaction_id: string | null;
  deleted_at: string | null;
}

/**
 * Minimal pg.Pool shim scoped to the queries PgApprovalsRepo issues.
 * The shim pattern-matches on the lower-cased + whitespace-collapsed
 * SQL string and dispatches to in-memory data structures. Unlike
 * the FORA-134 shim this one DOES enforce the (run_id, gate_kind)
 * EXCLUDE constraint — a duplicate insert throws a 23505 unique-
 * violation error, mirroring the production adapter's behavior.
 */
class ApprovalsPool {
  readonly approvals = new Map<string, ApprovalRow>();

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

    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
      return { rows: [], rowCount: 0 };
    }

    // INSERT agent_run_approvals
    if (sql.startsWith('insert into agent_run_approvals')) {
      const newRow: ApprovalRow = {
        id: cryptoRandomUUID(),
        tenant_id: values[0] as string,
        run_id: values[1] as string,
        stage: (values[2] as string | null) ?? null,
        gate_kind: values[3] as string,
        required_role: values[4] as string,
        status: 'pending',
        paperclip_interaction_id: null,
        artefact_refs: JSON.parse((values[5] as string) ?? '[]'),
        reason: (values[6] as string | null) ?? null,
        requested_at: new Date().toISOString(),
        decided_at: null,
        decided_by: null,
        decision: null,
        expires_at: values[7] as string,
        paged_at_50_percent: false,
        superseded_interaction_id: null,
        deleted_at: null,
      };
      // (run_id, gate_kind) EXCLUDE constraint, partial on
      // status='pending' AND deleted_at IS NULL. Mirrors the DB.
      const dupe = [...this.approvals.values()].find(
        (r) =>
          r.run_id === newRow.run_id &&
          r.gate_kind === newRow.gate_kind &&
          r.status === 'pending' &&
          r.deleted_at === null,
      );
      if (dupe) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      this.approvals.set(newRow.id, newRow);
      return { rows: [newRow as unknown as T], rowCount: 1 };
    }

    // UPDATE … markStageWaitingApproval (JOIN agent_runs)
    if (sql.startsWith('update agent_run_stages')) {
      // The shim does not track stage rows because no test exercises
      // them. Returning rowCount=0 keeps the adapter's no-op branch
      // (which is also the production behavior when the run is
      // soft-deleted).
      return { rows: [], rowCount: 0 };
    }

    // UPDATE … applyDecision
    if (
      sql.startsWith('update agent_run_approvals') &&
      sql.includes("decision = $3")
    ) {
      const approvalId = values[0] as string;
      const tenantId = values[1] as string;
      const decision = values[2] as string;
      const nextStatus = values[3] as string;
      const decidedBy = JSON.parse(values[4] as string) as unknown;
      const reason = values[5] as string;
      const row = this.approvals.get(approvalId);
      if (
        !row ||
        row.tenant_id !== tenantId ||
        row.deleted_at !== null ||
        row.status !== 'pending'
      ) {
        return { rows: [], rowCount: 0 };
      }
      row.status = nextStatus;
      row.decision = decision;
      row.decided_by = decidedBy;
      row.decided_at = new Date().toISOString();
      row.reason = reason;
      return { rows: [row as unknown as T], rowCount: 1 };
    }

    // UPDATE … expire
    if (
      sql.startsWith('update agent_run_approvals') &&
      sql.includes("status = 'expired'")
    ) {
      const approvalId = values[0] as string;
      const tenantId = values[1] as string;
      const expiredAt = values[2] as string;
      const row = this.approvals.get(approvalId);
      if (
        !row ||
        row.tenant_id !== tenantId ||
        row.deleted_at !== null ||
        row.status !== 'pending'
      ) {
        return { rows: [], rowCount: 0 };
      }
      row.status = 'expired';
      row.decided_at = expiredAt;
      return { rows: [row as unknown as T], rowCount: 1 };
    }

    // UPDATE … extend
    if (
      sql.startsWith('update agent_run_approvals') &&
      sql.includes('expires_at = $3')
    ) {
      const approvalId = values[0] as string;
      const tenantId = values[1] as string;
      const newExpiresAt = values[2] as string;
      const row = this.approvals.get(approvalId);
      if (
        !row ||
        row.tenant_id !== tenantId ||
        row.deleted_at !== null ||
        row.status !== 'pending'
      ) {
        return { rows: [], rowCount: 0 };
      }
      row.expires_at = newExpiresAt;
      row.paged_at_50_percent = false;
      return { rows: [row as unknown as T], rowCount: 1 };
    }

    // UPDATE … setInteractionId (rotation + supersede)
    if (
      sql.startsWith('update agent_run_approvals') &&
      sql.includes('paperclip_interaction_id = $3')
    ) {
      const approvalId = values[0] as string;
      const tenantId = values[1] as string;
      const interactionId = values[2] as string;
      const row = this.approvals.get(approvalId);
      if (
        !row ||
        row.tenant_id !== tenantId ||
        row.deleted_at !== null ||
        row.status !== 'pending'
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (row.paperclip_interaction_id) {
        row.superseded_interaction_id = row.paperclip_interaction_id;
      }
      row.paperclip_interaction_id = interactionId;
      return { rows: [row as unknown as T], rowCount: 1 };
    }

    // UPDATE … markPagedAt50Percent
    if (
      sql.startsWith('update agent_run_approvals') &&
      sql.includes('paged_at_50_percent = true')
    ) {
      const approvalId = values[0] as string;
      const tenantId = values[1] as string;
      const row = this.approvals.get(approvalId);
      if (
        !row ||
        row.tenant_id !== tenantId ||
        row.deleted_at !== null ||
        row.status !== 'pending' ||
        row.paged_at_50_percent === true
      ) {
        return { rows: [], rowCount: 0 };
      }
      row.paged_at_50_percent = true;
      return { rows: [], rowCount: 1 };
    }

    // SELECT findById (filters by `WHERE id = $1`, not by status='pending')
    if (
      sql.startsWith('select id, tenant_id, run_id, stage, gate_kind') &&
      sql.includes('where id = $1')
    ) {
      const approvalId = values[0] as string;
      const tenantId = values[1] as string;
      const row = this.approvals.get(approvalId);
      if (!row) return { rows: [], rowCount: 0 };
      if (row.tenant_id !== tenantId || row.deleted_at !== null) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [row as unknown as T], rowCount: 1 };
    }

    // SELECT listPendingForSweep (terminal "from agent_run_approvals")
    if (sql.includes("status = 'pending'") && sql.includes('deleted_at is null')) {
      // Two shapes: with-tenantId (params [tenant, asOf, limit]) and
      // without-tenantId (params [asOf, limit]).
      const hasTenant = sql.includes('tenant_id = $1');
      const matches: ApprovalRow[] = [];
      const asOf = new Date((hasTenant ? values[1] : values[0]) as string).getTime();
      const limit = (hasTenant ? values[2] : values[1]) as number;
      for (const row of this.approvals.values()) {
        if (row.status !== 'pending') continue;
        if (row.deleted_at !== null) continue;
        if (hasTenant && row.tenant_id !== values[0]) continue;
        const exp = new Date(row.expires_at).getTime();
        if (exp > asOf) continue;
        matches.push(row);
      }
      matches.sort((a, b) => a.expires_at.localeCompare(b.expires_at));
      return {
        rows: matches.slice(0, limit) as unknown as T[],
        rowCount: Math.min(matches.length, limit),
      };
    }

    throw new Error(`ApprovalsPool: unhandled SQL: ${sql}`);
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
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = (n: number) => n.toString(16).padStart(2, '0');
  const s: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    if (i === 4 || i === 6 || i === 8 || i === 10) s.push('-');
    s.push(h(b[i]));
  }
  return s.join('');
}

describe('PgApprovalsRepo (FORA-168)', () => {
  let pool: ApprovalsPool;
  let repo: PgApprovalsRepo;

  beforeEach(() => {
    pool = new ApprovalsPool();
    repo = new PgApprovalsRepo(pool as unknown as Parameters<typeof PgApprovalsRepo>[0]);
  });

  afterEach(() => {
    pool.approvals.clear();
  });

  it('inserts a pending row and reads it back by id', async () => {
    const expiresAt = new Date('2026-06-17T01:00:00.000Z');
    const row = await repo.insertPending({
      runId: RUN_A,
      tenantId: TENANT_A,
      stage: 'dev',
      gateKind: 'dev->qa',
      requiredRole: 'qa',
      expiresAt,
      artefactRefs: [{ kind: 'pr', url: 'https://github.com/fora/repo/pull/42' }],
      reason: 'CI green',
    });
    expect(row.status).toBe('pending');
    expect(row.gate_kind).toBe('dev->qa');
    expect(row.required_role).toBe('qa');
    expect(row.tenant_id).toBe(TENANT_A);
    expect(row.run_id).toBe(RUN_A);
    expect(row.decided_at).toBeNull();
    expect(row.paged_at_50_percent).toBe(false);

    const read = await repo.findById({
      approvalId: row.id,
      tenantId: TENANT_A,
    });
    expect(read?.id).toBe(row.id);
    expect(read?.expires_at).toBe(expiresAt.toISOString());
  });

  it('returns null for a cross-tenant read', async () => {
    const row = await repo.insertPending({
      runId: RUN_A,
      tenantId: TENANT_A,
      stage: 'dev',
      gateKind: 'dev->qa',
      requiredRole: 'qa',
      expiresAt: new Date('2026-06-17T01:00:00.000Z'),
      artefactRefs: [],
    });
    const cross = await repo.findById({
      approvalId: row.id,
      tenantId: TENANT_B,
    });
    expect(cross).toBeNull();
  });

  it('rejects a duplicate (run_id, gate_kind) pending insert', async () => {
    await repo.insertPending({
      runId: RUN_A,
      tenantId: TENANT_A,
      stage: 'dev',
      gateKind: 'dev->qa',
      requiredRole: 'qa',
      expiresAt: new Date('2026-06-17T01:00:00.000Z'),
      artefactRefs: [],
    });
    // Re-issue of the same revision hits the EXCLUDE constraint.
    await expect(
      repo.insertPending({
        runId: RUN_A,
        tenantId: TENANT_A,
        stage: 'dev',
        gateKind: 'dev->qa',
        requiredRole: 'qa',
        expiresAt: new Date('2026-06-17T01:00:00.000Z'),
        artefactRefs: [],
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('applyDecision transitions pending → approved on accept', async () => {
    const row = await repo.insertPending({
      runId: RUN_A,
      tenantId: TENANT_A,
      stage: 'dev',
      gateKind: 'dev->qa',
      requiredRole: 'qa',
      expiresAt: new Date('2026-06-17T01:00:00.000Z'),
      artefactRefs: [],
    });
    const decided = await repo.applyDecision({
      approvalId: row.id,
      tenantId: TENANT_A,
      decision: 'accept',
      decidedBy: { actor: 'qa-lead', role: 'qa' },
      reason: 'lgtm',
    });
    expect(decided.status).toBe('approved');
    expect(decided.decision).toBe('accept');
    expect(decided.decided_by).toEqual({ actor: 'qa-lead', role: 'qa' });
    expect(decided.reason).toBe('lgtm');
  });

  it('applyDecision on a terminal row raises ApprovalAlreadyDecidedError', async () => {
    const row = await repo.insertPending({
      runId: RUN_A,
      tenantId: TENANT_A,
      stage: 'dev',
      gateKind: 'dev->qa',
      requiredRole: 'qa',
      expiresAt: new Date('2026-06-17T01:00:00.000Z'),
      artefactRefs: [],
    });
    await repo.applyDecision({
      approvalId: row.id,
      tenantId: TENANT_A,
      decision: 'accept',
      decidedBy: { actor: 'qa-lead', role: 'qa' },
      reason: 'lgtm',
    });
    await expect(
      repo.applyDecision({
        approvalId: row.id,
        tenantId: TENANT_A,
        decision: 'reject',
        decidedBy: { actor: 'qa-lead', role: 'qa' },
        reason: 'changed mind',
      }),
    ).rejects.toBeInstanceOf(ApprovalAlreadyDecidedError);
  });

  it('expire is monotonic — re-expire on a decided row returns the existing row', async () => {
    const row = await repo.insertPending({
      runId: RUN_A,
      tenantId: TENANT_A,
      stage: 'dev',
      gateKind: 'dev->qa',
      requiredRole: 'qa',
      expiresAt: new Date('2026-06-17T01:00:00.000Z'),
      artefactRefs: [],
    });
    await repo.applyDecision({
      approvalId: row.id,
      tenantId: TENANT_A,
      decision: 'accept',
      decidedBy: { actor: 'qa-lead', role: 'qa' },
      reason: 'lgtm',
    });
    // The sweeper races and tries to expire AFTER the row was
    // decided. The adapter must NOT flip status back; it returns
    // the existing approved row so the sweeper logs the race.
    const after = await repo.expire({
      approvalId: row.id,
      tenantId: TENANT_A,
      expiredAt: new Date('2026-06-17T02:00:00.000Z'),
    });
    expect(after.status).toBe('approved');
  });

  it('extend on a terminal row throws (router maps to INVALID_TRANSITION)', async () => {
    const row = await repo.insertPending({
      runId: RUN_A,
      tenantId: TENANT_A,
      stage: 'dev',
      gateKind: 'dev->qa',
      requiredRole: 'qa',
      expiresAt: new Date('2026-06-17T01:00:00.000Z'),
      artefactRefs: [],
    });
    await repo.applyDecision({
      approvalId: row.id,
      tenantId: TENANT_A,
      decision: 'reject',
      decidedBy: { actor: 'qa-lead', role: 'qa' },
      reason: 'CI red',
    });
    await expect(
      repo.extend({
        approvalId: row.id,
        tenantId: TENANT_A,
        newExpiresAt: new Date('2026-06-17T05:00:00.000Z'),
        extendedBy: 'sre',
      }),
    ).rejects.toThrow(/not pending/);
  });

  it('setInteractionId rotates superseded_interaction_id (stale-target audit chain)', async () => {
    const row = await repo.insertPending({
      runId: RUN_A,
      tenantId: TENANT_A,
      stage: 'dev',
      gateKind: 'dev->qa',
      requiredRole: 'qa',
      expiresAt: new Date('2026-06-17T01:00:00.000Z'),
      artefactRefs: [],
    });
    await repo.setInteractionId({
      approvalId: row.id,
      tenantId: TENANT_A,
      interactionId: 'pc-rev1',
    });
    // Stale-target recovery (§5) re-issues against the latest revision.
    const updated = await repo.setInteractionId({
      approvalId: row.id,
      tenantId: TENANT_A,
      interactionId: 'pc-rev2',
    });
    expect(updated.paperclip_interaction_id).toBe('pc-rev2');
    expect(updated.superseded_interaction_id).toBe('pc-rev1');
  });

  it('markPagedAt50Percent is idempotent', async () => {
    const row = await repo.insertPending({
      runId: RUN_A,
      tenantId: TENANT_A,
      stage: 'dev',
      gateKind: 'dev->qa',
      requiredRole: 'qa',
      expiresAt: new Date('2026-06-17T01:00:00.000Z'),
      artefactRefs: [],
    });
    await repo.markPagedAt50Percent({ approvalId: row.id, tenantId: TENANT_A });
    await repo.markPagedAt50Percent({ approvalId: row.id, tenantId: TENANT_A });
    const after = await repo.findById({
      approvalId: row.id,
      tenantId: TENANT_A,
    });
    expect(after?.paged_at_50_percent).toBe(true);
  });

  it('listPendingForSweep returns only rows past TTL, scoped by tenant', async () => {
    // Row 1: tenant A, expired (sweeper should pick it up).
    await repo.insertPending({
      runId: RUN_A,
      tenantId: TENANT_A,
      stage: 'dev',
      gateKind: 'dev->qa',
      requiredRole: 'qa',
      expiresAt: new Date('2026-06-17T01:00:00.000Z'),
      artefactRefs: [],
    });
    // Row 2: tenant A, future TTL (sweeper should NOT pick it up).
    await repo.insertPending({
      runId: RUN_A,
      tenantId: TENANT_A,
      stage: 'qa',
      gateKind: 'qa->security',
      requiredRole: 'security',
      expiresAt: new Date('2026-06-17T05:00:00.000Z'),
      artefactRefs: [],
    });
    // Row 3: tenant B, expired (tenant-scoped sweep should skip).
    await repo.insertPending({
      runId: asRunId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      tenantId: TENANT_B,
      stage: 'dev',
      gateKind: 'dev->qa',
      requiredRole: 'qa',
      expiresAt: new Date('2026-06-17T01:00:00.000Z'),
      artefactRefs: [],
    });

    const aOnly = await repo.listPendingForSweep({
      tenantId: TENANT_A,
      asOf: new Date('2026-06-17T02:00:00.000Z'),
      limit: 100,
    });
    expect(aOnly).toHaveLength(1);
    expect(aOnly[0]?.gate_kind).toBe('dev->qa');
    expect(aOnly[0]?.tenant_id).toBe(TENANT_A);
  });
});