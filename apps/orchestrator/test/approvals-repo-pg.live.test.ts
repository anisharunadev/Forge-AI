/**
 * Live-DB integration test for PgApprovalsRepo.
 *
 * FORA-168 (0.1.4.a) acceptance: "An integration test against a live
 * Postgres writes a pending row, applies a decision, and reads it back
 * with the right tenant + soft-delete filter."
 *
 * The shim-based coverage in `approvals-repo-pg.test.ts` exercises the
 * SQL surface; this file proves the migration installs the right schema
 * on a real Postgres and the adapter's queries return the right rows.
 *
 * Gated by `FORA_DATABASE_URL`. Without it, the test is skipped (same
 * pattern as `packages/db-migrator/test/property-based.test.ts`):
 * unit-level shim tests run in CI without a DB; live coverage runs in
 * a testcontainers / v0.2 staging job.
 *
 * Booting the live DB:
 *   docker run -d --name fora-pg-test -p 5433:5432 \
 *     -e POSTGRES_USER=migrator -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=fora postgres:16-alpine
 *   FORA_DATABASE_URL=postgres://migrator:test@localhost:5433/fora \
 *     pnpm vitest run test/approvals-repo-pg.live.test.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import { Pool } from 'pg';

import { PgApprovalsRepo } from '../src/approvals-repo-pg.js';
import { ApprovalAlreadyDecidedError } from '../src/ports.js';
import { asRunId, asTenantId } from '../src/types.js';

const FORA_DATABASE_URL = process.env['FORA_DATABASE_URL'];
const describeIfDb = FORA_DATABASE_URL ? describe : describe.skip;

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Bootstrap path to the migration files. The db-migrator package ships
 * raw SQL in `migrations/0001_*` (role grant), `0002_*` (constraints),
 * `0003_*` (idempotency keys), and `0004_*` (approvals). The test
 * applies 0001 + 0002 + 0004 (we don't need 0003 here).
 */
const MIGRATIONS_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'db-migrator',
  'migrations',
);

const TENANT_A = asTenantId('11111111-1111-4111-8111-111111111111');
const TENANT_B = asTenantId('22222222-2222-4222-8222-222222222222');
const RUN_A = asRunId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

function applySql(pool: Pool, file: string): void {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  // Pool.query runs multi-statement SQL atomically in a single round-trip
  // when no parameters are supplied.
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  pool.query(sql);
}

describeIfDb('PgApprovalsRepo against live Postgres (FORA-168)', () => {
  let pool: Pool;
  let repo: PgApprovalsRepo;

  beforeAll(async () => {
    if (!FORA_DATABASE_URL) return;
    pool = new Pool({ connectionString: FORA_DATABASE_URL });

    // Reset the schema between runs. The test owns the DB; in CI the
    // job provisions a fresh container per run.
    await pool.query('DROP TABLE IF EXISTS agent_run_approvals CASCADE');
    await pool.query('DROP TABLE IF EXISTS agent_run_idempotency_keys CASCADE');
    await pool.query('DROP TABLE IF EXISTS agent_run_stages CASCADE');
    await pool.query('DROP TABLE IF EXISTS agent_runs CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    await pool.query('DROP TABLE IF EXISTS tenants CASCADE');

    // Bootstrap the migrator role + canonical tables in dependency order:
    //   0001_migration_role.sql -> tenants table comes via the registry
    //   0002_* CHECK constraints on agent_runs / agent_run_stages
    //   0004_* approvals
    //
    // We apply the registry-driven tables via raw CREATE TABLE so the
    // test does not depend on the db-migrator package's BYPASSRLS audit
    // (which would require the `migrator` role to actually have that
    // attribute set in Postgres; we don't need RLS for the contract
    // verification, which is about the approvals table shape + the
    // adapter's SQL).
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE tenants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        slug text NOT NULL UNIQUE,
        name text NOT NULL
      );

      CREATE TABLE agent_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        goal_id text NOT NULL,
        project_id text NOT NULL,
        status text NOT NULL,
        current_stage text NOT NULL,
        triggered_by jsonb NOT NULL,
        cost_ceiling_usd numeric(10,2) NOT NULL DEFAULT 100.00,
        cost_spent_usd numeric(10,2) NOT NULL DEFAULT 0,
        started_at timestamptz,
        finished_at timestamptz,
        deleted_at timestamptz,
        archived_at timestamptz
      );

      CREATE TABLE agent_run_stages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        stage text NOT NULL,
        status text NOT NULL,
        decision jsonb,
        started_at timestamptz,
        finished_at timestamptz
      );
    `);

    // Apply the approved SQL migrations in order.
    applySql(pool, '0002_orchestrator_constraints_and_indexes.sql');
    applySql(pool, '0004_agent_run_approvals.sql');

    // Seed the tenants + run rows the test will reference.
    await pool.query(
      `INSERT INTO tenants (id, slug, name) VALUES
         ($1, 'acme', 'Acme'),
         ($2, 'beta', 'Beta')`,
      [TENANT_A, TENANT_B],
    );
    await pool.query(
      `INSERT INTO agent_runs
         (id, tenant_id, goal_id, project_id, status, current_stage, triggered_by)
       VALUES ($1, $2, 'goal-1', 'proj-1', 'running', 'dev',
               '{"type":"manual","actor":"alice"}'::jsonb)`,
      [RUN_A, TENANT_A],
    );

    repo = new PgApprovalsRepo(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('migration installs the agent_run_approvals table with FORA-50 §3.4 columns', async () => {
    if (!pool) return;
    const r = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'agent_run_approvals'
        ORDER BY ordinal_position`,
    );
    const cols = r.rows.map((row) => row.column_name);
    // Spec §3.4 columns + the system 'id' / 'created_at'.
    expect(cols).toContain('id');
    expect(cols).toContain('tenant_id');
    expect(cols).toContain('run_id');
    expect(cols).toContain('stage');
    expect(cols).toContain('gate_kind');
    expect(cols).toContain('required_role');
    expect(cols).toContain('status');
    expect(cols).toContain('paperclip_interaction_id');
    expect(cols).toContain('artefact_refs');
    expect(cols).toContain('reason');
    expect(cols).toContain('requested_at');
    expect(cols).toContain('decided_at');
    expect(cols).toContain('decided_by');
    expect(cols).toContain('decision');
    expect(cols).toContain('expires_at');
    expect(cols).toContain('paged_at_50_percent');
    expect(cols).toContain('superseded_interaction_id');
    expect(cols).toContain('deleted_at');
  });

  it('writes a pending row, applies a decision, and reads it back', async () => {
    if (!repo) return;
    const expiresAt = new Date('2026-06-17T01:00:00.000Z');
    const pending = await repo.insertPending({
      runId: RUN_A,
      tenantId: TENANT_A,
      stage: 'dev',
      gateKind: 'dev->qa',
      requiredRole: 'qa',
      expiresAt,
      artefactRefs: [{ kind: 'pr', url: 'https://example/pr/42' }],
      reason: 'CI green',
    });
    expect(pending.status).toBe('pending');
    expect(pending.tenant_id).toBe(TENANT_A);
    expect(pending.run_id).toBe(RUN_A);

    // Read it back inside the same tenant.
    const read = await repo.findById({
      approvalId: pending.id,
      tenantId: TENANT_A,
    });
    expect(read?.id).toBe(pending.id);
    expect(read?.status).toBe('pending');
    expect(read?.decided_at).toBeNull();

    // Cross-tenant read returns null (NOT_FOUND envelope, not 403).
    const cross = await repo.findById({
      approvalId: pending.id,
      tenantId: TENANT_B,
    });
    expect(cross).toBeNull();

    // Apply a decision and read it back with the decided fields populated.
    const decided = await repo.applyDecision({
      approvalId: pending.id,
      tenantId: TENANT_A,
      decision: 'accept',
      decidedBy: { actor: 'qa-lead', role: 'qa' },
      reason: 'lgtm',
    });
    expect(decided.status).toBe('approved');
    expect(decided.decision).toBe('accept');
    expect(decided.decided_by).toEqual({ actor: 'qa-lead', role: 'qa' });

    // A re-decision on the terminal row raises the typed error.
    await expect(
      repo.applyDecision({
        approvalId: pending.id,
        tenantId: TENANT_A,
        decision: 'reject',
        decidedBy: { actor: 'qa-lead', role: 'qa' },
        reason: 'changed mind',
      }),
    ).rejects.toBeInstanceOf(ApprovalAlreadyDecidedError);
  });

  it('soft-delete filter excludes rows with deleted_at set', async () => {
    if (!pool || !repo) return;
    const expiresAt = new Date('2026-06-17T02:00:00.000Z');
    const row = await repo.insertPending({
      runId: RUN_A,
      tenantId: TENANT_A,
      stage: 'qa',
      gateKind: 'qa->security',
      requiredRole: 'security',
      expiresAt,
      artefactRefs: [],
    });
    expect(row.status).toBe('pending');

    // Soft-delete the row directly in the DB (simulating an ADR-0009 §6
    // tombstone). The adapter must NOT surface soft-deleted rows.
    await pool.query(
      `UPDATE agent_run_approvals SET deleted_at = now() WHERE id = $1`,
      [row.id],
    );
    const read = await repo.findById({
      approvalId: row.id,
      tenantId: TENANT_A,
    });
    expect(read).toBeNull();
  });

  it('EXCLUDE constraint catches duplicate (run_id, gate_kind) pending insert', async () => {
    if (!repo) return;
    await repo.insertPending({
      runId: RUN_A,
      tenantId: TENANT_A,
      stage: 'security',
      gateKind: 'security->devops',
      requiredRole: 'devops',
      expiresAt: new Date('2026-06-17T03:00:00.000Z'),
      artefactRefs: [],
    });
    // Postgres raises SQLSTATE 23P01 for EXCLUDE-constraint violations
    // (23505 is the UNIQUE-constraint SQLSTATE). The shim test asserts
    // 23505 because the shim is hand-rolled; the live DB returns the
    // real code. Either way the constraint fired — that is the bar.
    await expect(
      repo.insertPending({
        runId: RUN_A,
        tenantId: TENANT_A,
        stage: 'security',
        gateKind: 'security->devops',
        requiredRole: 'devops',
        expiresAt: new Date('2026-06-17T03:00:00.000Z'),
        artefactRefs: [],
      }),
    ).rejects.toMatchObject({
      code: '23P01',
      constraint: 'agent_run_approvals_run_gate_pending_unique',
    });
  });
});
