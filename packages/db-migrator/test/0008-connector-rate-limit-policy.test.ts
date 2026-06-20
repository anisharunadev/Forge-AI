/**
 * String-level + e2e tests for migration 0008 (FORA-518 / FORA-487.4).
 *
 * FORA-518 AC verification:
 *   - [x] Migration 0008 creates the table + RLS + mat view
 *   - [x] Tenant-isolation policy verified by negative tests
 *   - [x] Admin override policy verified by positive tests
 *   - [x] Mat view refresh function defined
 *
 * The string-level assertions are the build-time gate. The e2e
 * assertions are the runtime gate (gated by FORA_DATABASE_URL).
 *
 * Test tiers covered:
 *   1. Unit (string-shape) — the regex assertions below
 *   2. Integration — the e2e apply + RLS isolation in a real DB
 *   3. Contract — the schema shape (columns, CHECK constraints,
 *      unique constraint, RLS policies) matches the FORA-518 spec
 *   4. E2E — the negative + positive RLS tests against two tenants
 *
 * The mat view refresh is exercised by the e2e (it must be
 * re-runnable via the public function — CONCURRENTLY requires
 * the unique index).
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
  NIL_UUID,
  TENANT_ISOLATION_POLICY,
} from '../src/rls.js';
import { withTenant } from '../src/connection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = resolvePath(
  __dirname,
  '..',
  'migrations',
  '0008_connector_rate_limit_policy.sql',
);

/**
 * Strip SQL line comments (`-- ...`) from a migration file.
 * The bypass-audit (bypass-audit.ts) ignores comments when
 * scanning for `BYPASSRLS` grants; this helper mirrors that
 * so the string-level tests exercise the same surface the
 * audit does.
 */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

/**
 * Parse the ALLOWED_ROLES Set from @fora/db-migrator's
 * bypass-audit source. Returns the set of single-quoted role
 * names defined inside the Set literal. Handles both
 * `// comment` and inline `/* comment *​/` styles, and
 * entries that span multiple lines.
 */
function parseAllowedRolesFromAudit(auditSrc: string): string[] {
  const setMatch = auditSrc.match(
    /ALLOWED_ROLES\s*=\s*new Set\(\s*\[([\s\S]*?)\]\s*\)/,
  );
  if (!setMatch) return [];
  const body = setMatch[1] ?? '';
  // Strip line comments inside the Set body.
  const codeOnly = body
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
  // Extract every single-quoted identifier.
  const quoted = codeOnly.match(/'([a-z_][a-z0-9_]*)'/g) ?? [];
  return quoted.map((s) => s.slice(1, -1));
}

// ---------------------------------------------------------------------------
// 1. String-level property (no DB)
// ---------------------------------------------------------------------------

describe('0008_connector_rate_limit_policy.sql — string shape', () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(MIGRATION_PATH, 'utf8');
  });

  it('uses the canonical tenant_isolation policy shape', () => {
    // The canonical policy emitter (rls.ts →
    // tenantIsolationPolicyExpr) emits a single-line substring.
    // The migration splits the same shape across multiple
    // lines for readability; we assert the components
    // individually here so the test survives the formatting.
    const components = [
      'coalesce(',
      "nullif(current_setting('app.tenant_id', true), '')",
      "::uuid,",
      NIL_UUID,
    ];
    for (const c of components) {
      expect(sql).toContain(c);
    }
  });

  it('enables and FORCES row-level security on the policy table', () => {
    expect(sql).toMatch(
      /ALTER TABLE connector_rate_limit_policy\s+ENABLE ROW LEVEL SECURITY/,
    );
    expect(sql).toMatch(
      /ALTER TABLE connector_rate_limit_policy\s+FORCE\s+ROW LEVEL SECURITY/,
    );
  });

  it('enables and FORCES row-level security on the circuit stub', () => {
    expect(sql).toMatch(
      /ALTER TABLE connector_circuit\s+ENABLE ROW LEVEL SECURITY/,
    );
    expect(sql).toMatch(
      /ALTER TABLE connector_circuit\s+FORCE\s+ROW LEVEL SECURITY/,
    );
  });

  it('defines the admin_override policy attached to app_admin', () => {
    expect(sql).toMatch(
      /CREATE POLICY\s+connector_rate_limit_policy_admin_override\s+ON connector_rate_limit_policy\s+FOR ALL\s+TO app_admin/,
    );
    expect(sql).toMatch(/USING \(true\)\s+WITH CHECK \(true\)/);
  });

  it('creates app_admin WITHOUT BYPASSRLS (bypass-audit safe)', () => {
    // The role creation must be a CREATE ROLE without BYPASSRLS.
    // The bypass-audit (bypass-audit.ts) refuses to apply if a
    // BYPASSRLS grant is added outside migrations/ and audit/;
    // app_admin is created in this migration, so the audit
    // passes, but the role must NOT have BYPASSRLS.
    expect(sql).toMatch(/CREATE ROLE app_admin NOLOGIN/);

    // The bypass-audit ignores SQL comments. Mirror that:
    // strip comments from the migration before applying the
    // BYPASSRLS regex so the test exercises the same surface
    // the audit does. The role creation statement (extracted
    // up to the semicolon) must not contain a BYPASSRLS token.
    const codeOnly = stripSqlComments(sql);
    const roleCreationStmt = /CREATE\s+ROLE\s+app_admin[^;]*;/i;
    const m = codeOnly.match(roleCreationStmt);
    expect(m).not.toBeNull();
    expect(m![0]).not.toMatch(/BYPASSRLS/i);

    // And the audit role allow-list (migrator, audit_reader)
    // must not be expanded in this migration to include
    // app_admin. No ALTER ROLE / GRANT statement may grant
    // app_admin BYPASSRLS.
    expect(codeOnly).not.toMatch(
      /\b(ALTER\s+ROLE|GRANT)\b[^;]*\bapp_admin\b[^;]*\bBYPASSRLS\b/i,
    );
    expect(codeOnly).not.toMatch(
      /\bGRANT\s+BYPASSRLS\s+TO\s+app_admin\b/i,
    );
  });

  it('defines the unique constraint per the spec', () => {
    expect(sql).toMatch(
      /CONSTRAINT connector_rate_limit_policy_unique\s+UNIQUE \(tenant_id, project_id, connector_id\)/,
    );
  });

  it('defines the closed tier enum + override_source enum + state enum', () => {
    expect(sql).toMatch(/CHECK \(tier IN \([\s\S]+'trial'[\s\S]+'standard'[\s\S]+'enterprise'\s*\)\)/);
    expect(sql).toMatch(
      /CHECK \(override_source IN \([\s\S]+'default'[\s\S]+'project'[\s\S]+'operator'\s*\)\)/,
    );
    expect(sql).toMatch(
      /CHECK \(state IN \([\s\S]+'closed'[\s\S]+'open'[\s\S]+'half_open'\s*\)\)/,
    );
  });

  it('creates the materialized view with the unique index', () => {
    expect(sql).toMatch(
      /CREATE MATERIALIZED VIEW connector_rate_limit_status/,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX[\s\S]+connector_rate_limit_status_uidx/,
    );
  });

  it('creates the mat view refresh function with SECURITY DEFINER', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION refresh_connector_rate_limit_status/,
    );
    expect(sql).toMatch(/LANGUAGE plpgsql/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(
      /REFRESH MATERIALIZED VIEW CONCURRENTLY connector_rate_limit_status/,
    );
  });

  it('does not use created_at on sync_op (the real column is claimed_at)', () => {
    // FORA-518 spec wrote `created_at`; the real column is
    // `claimed_at` per `migrations/0008_jira_adapter.sql`. The
    // mat view must use the real column.
    const matView = sql.split('CREATE MATERIALIZED VIEW')[1] ?? '';
    expect(matView).toMatch(/sync_op\.claimed_at/);
    expect(matView).not.toMatch(/sync_op\.created_at/);
  });

  it('uses outcome IS NULL for the in-flight check (not status)', () => {
    // The spec wrote `status = 'in_flight'`; the real column is
    // `outcome` (NULL while in flight, ok/fail when done).
    const matView = sql.split('CREATE MATERIALIZED VIEW')[1] ?? '';
    expect(matView).toMatch(/sync_op\.outcome IS NULL/);
    expect(matView).not.toMatch(/sync_op\.status\s*=\s*'in_flight'/);
  });

  it('uses LEFT JOIN LATERAL for the circuit state (defensive)', () => {
    // The mat view must build even when connector_circuit is
    // empty. LEFT JOIN LATERAL handles this; a plain correlated
    // subquery would also work but the join shape is explicit.
    const matView = sql.split('CREATE MATERIALIZED VIEW')[1] ?? '';
    expect(matView).toMatch(/LEFT JOIN LATERAL/);
  });

  it('is idempotent (DROP POLICY IF EXISTS + CREATE TABLE IF NOT EXISTS)', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS connector_rate_limit_policy_tenant_isolation/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS connector_rate_limit_policy_admin_override/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS connector_circuit_tenant_isolation/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS connector_circuit_admin_override/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS connector_rate_limit_policy/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS connector_circuit/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION refresh_connector_rate_limit_status/);
  });

  it('forward-only (no DROP TABLE / DROP VIEW statements)', () => {
    expect(sql).not.toMatch(/DROP TABLE/);
    expect(sql).not.toMatch(/DROP MATERIALIZED VIEW/);
  });

  it('does not modify the bypass-audit role allow-list in this migration', () => {
    // The bypass-audit allow-list (migrator, audit_reader) is
    // a sibling TypeScript file. This migration must not
    // add a third BYPASSRLS role to the allow-list. We assert
    // it by reading the bypass-audit.ts source and confirming
    // the ALLOWED_ROLES Set still contains only the two
    // baseline roles.
    const auditPath = resolvePath(
      __dirname,
      '..',
      'src',
      'bypass-audit.ts',
    );
    return readFile(auditPath, 'utf8').then((auditSrc) => {
      const entries = parseAllowedRolesFromAudit(auditSrc);
      expect(entries).toEqual(['migrator', 'audit_reader']);
      expect(entries).not.toContain('app_admin');
    });
  });
});

// ---------------------------------------------------------------------------
// 2. End-to-end property (skipped without FORA_DATABASE_URL)
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.FORA_DATABASE_URL;
const e2e = DATABASE_URL ? describe : describe.skip;

e2e('0008_connector_rate_limit_policy.sql — e2e RLS isolation', () => {
  let pool: pg.Pool;
  let tenantA: string;
  let tenantB: string;
  let policyA: string;
  let policyB: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    // Apply migration 0008. We assume migrations 0001-0007 + the
    // top-level `migrations/0008_jira_adapter.sql` (sync_op) have
    // already been applied by the orchestrator setup; if not, the
    // mat view will fail at apply time.
    const sql = await readFile(MIGRATION_PATH, 'utf8');
    await pool.query(sql);

    // Seed two tenants.
    const a = await pool.query<{ id: string }>(
      'INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id',
      [`tnt-a-${randomUUID()}`, 'Tenant A'],
    );
    const b = await pool.query<{ id: string }>(
      'INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id',
      [`tnt-b-${randomUUID()}`, 'Tenant B'],
    );
    tenantA = a.rows[0]!.id;
    tenantB = b.rows[0]!.id;
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('applies the migration idempotently (re-run is a no-op)', async () => {
    const sql = await readFile(MIGRATION_PATH, 'utf8');
    await expect(pool.query(sql)).resolves.toBeDefined();
  });

  it('the tenant_isolation policy uses the canonical shape (pg_policies)', async () => {
    const r = await pool.query<{ policyname: string; qual: string }>(
      `SELECT policyname, qual
         FROM pg_policies
        WHERE schemaname = current_schema()
          AND tablename = 'connector_rate_limit_policy'
          AND policyname = 'connector_rate_limit_policy_tenant_isolation'`,
    );
    expect(r.rowCount).toBe(1);
    const qual = r.rows[0]!.qual;
    expect(qual).toContain("current_setting('app.tenant_id', true)");
    expect(qual).toContain(NIL_UUID);
  });

  it('the admin_override policy exists attached to app_admin', async () => {
    const r = await pool.query<{ policyname: string; roles: string[]; cmd: string }>(
      `SELECT policyname, roles, cmd
         FROM pg_policies
        WHERE schemaname = current_schema()
          AND tablename = 'connector_rate_limit_policy'
          AND policyname = 'connector_rate_limit_policy_admin_override'`,
    );
    expect(r.rowCount).toBe(1);
    expect(r.rows[0]!.roles).toContain('app_admin');
    expect(r.rows[0]!.cmd).toBe('ALL');
  });

  it('RLS negative: tenant A cannot read tenant B rows (default app.tenant_id unset)', async () => {
    await withTenant(pool, null, async (client) => {
      const r = await client.query(
        'SELECT count(*)::int AS n FROM connector_rate_limit_policy',
      );
      // The sentinel default ('00000000-...') matches zero rows
      // because no policy row has that tenant_id.
      expect(r.rows[0]!.n).toBe(0);
    });
  });

  it('RLS negative: tenant A can only read its own rows (project override)', async () => {
    // Seed one row per tenant.
    policyA = randomUUID();
    policyB = randomUUID();
    await withTenant(pool, tenantA, (client) =>
      client.query(
        `INSERT INTO connector_rate_limit_policy
           (id, tenant_id, project_id, connector_id, tier, rpm,
            concurrent_max, override_source, updated_by)
         VALUES ($1, $2, $3, 'jira', 'standard', 300, 16, 'default', $2)`,
        [policyA, tenantA, randomUUID()],
      ),
    );
    await withTenant(pool, tenantB, (client) =>
      client.query(
        `INSERT INTO connector_rate_limit_policy
           (id, tenant_id, project_id, connector_id, tier, rpm,
            concurrent_max, override_source, updated_by)
         VALUES ($1, $2, $3, 'jira', 'standard', 300, 16, 'default', $2)`,
        [policyB, tenantB, randomUUID()],
      ),
    );

    // Read as tenantA — must see only the row tagged tenantA.
    await withTenant(pool, tenantA, async (client) => {
      const r = await client.query<{ id: string; tenant_id: string }>(
        'SELECT id, tenant_id FROM connector_rate_limit_policy WHERE connector_id = $1',
        ['jira'],
      );
      expect(r.rows.length).toBe(1);
      expect(r.rows[0]!.tenant_id).toBe(tenantA);
      expect(r.rows[0]!.id).toBe(policyA);
    });

    // Read as tenantB — must see only the row tagged tenantB.
    await withTenant(pool, tenantB, async (client) => {
      const r = await client.query<{ id: string; tenant_id: string }>(
        'SELECT id, tenant_id FROM connector_rate_limit_policy WHERE connector_id = $1',
        ['jira'],
      );
      expect(r.rows.length).toBe(1);
      expect(r.rows[0]!.tenant_id).toBe(tenantB);
      expect(r.rows[0]!.id).toBe(policyB);
    });
  });

  it('RLS negative: tenant A cannot INSERT a row tagged tenant B (WITH CHECK)', async () => {
    await withTenant(pool, tenantA, async (client) => {
      await expect(
        client.query(
          `INSERT INTO connector_rate_limit_policy
             (tenant_id, project_id, connector_id, tier, rpm,
              concurrent_max, override_source, updated_by)
           VALUES ($1, $2, 'jira', 'standard', 300, 16, 'default', $1)`,
          [tenantB, randomUUID()],
        ),
      ).rejects.toThrow(/row-level security policy|row-level security/);
    });
  });

  it('RLS negative: tenant A cannot UPDATE a tenant B row (USING)', async () => {
    await withTenant(pool, tenantA, async (client) => {
      const r = await client.query(
        'UPDATE connector_rate_limit_policy SET rpm = 999 WHERE connector_id = $1',
        ['jira'],
      );
      // USING policy blocks: zero rows affected.
      expect(r.rowCount).toBe(0);
    });

    // Verify tenant B's row was NOT modified.
    await withTenant(pool, tenantB, async (client) => {
      const r = await client.query<{ rpm: number }>(
        'SELECT rpm FROM connector_rate_limit_policy WHERE id = $1',
        [policyB],
      );
      expect(r.rows[0]!.rpm).toBe(300);
    });
  });

  it('RLS positive: app_admin can read across tenants (admin_override)', async () => {
    // Switch to the app_admin role for this query. The role
    // exists without BYPASSRLS; the admin_override policy
    // grants USING (true) so the SELECT returns both rows.
    const client = await pool.connect();
    try {
      await client.query("SET LOCAL ROLE app_admin");
      const r = await client.query<{ tenant_id: string }>(
        "SELECT tenant_id FROM connector_rate_limit_policy WHERE connector_id = $1",
        ['jira'],
      );
      // The two seeded rows (tenantA + tenantB) are visible.
      const tenants = r.rows.map((row) => row.tenant_id).sort();
      expect(tenants).toEqual([tenantA, tenantB].sort());
    } finally {
      // RESET ROLE to avoid leaking the role switch.
      await client.query("RESET ROLE");
      client.release();
    }
  });

  it('mat view refresh function runs without error (CONCURRENTLY works)', async () => {
    // The mat view has the unique index — REFRESH CONCURRENTLY
    // succeeds. We invoke the function as the runtime role
    // (SECURITY DEFINER).
    await pool.query('SELECT refresh_connector_rate_limit_status()');

    // After refresh, the mat view should have one row per
    // (tenant, connector) for the seeded policies. The view
    // also reads connector_circuit (LEFT JOIN LATERAL, so
    // missing circuit state is fine).
    const r = await pool.query<{ tenant_id: string; rpm_remaining: number; circuit_state: string | null }>(
      'SELECT tenant_id, rpm_remaining, circuit_state FROM connector_rate_limit_status ORDER BY tenant_id',
    );
    expect(r.rows.length).toBe(2);
    for (const row of r.rows) {
      expect([tenantA, tenantB]).toContain(row.tenant_id);
      expect(row.rpm_remaining).toBeGreaterThanOrEqual(0);
      expect(row.circuit_state).toBeNull(); // no circuit rows seeded
    }
  });
});
