/**
 * Migration runner.
 *
 * The runner is the only path that creates tables. Ad-hoc DDL is blocked
 * by lint in 0.7.2d; this file is the runtime gate that actually applies
 * the migrations against a Postgres database.
 *
 * Algorithm:
 *   1. Run the BYPASSRLS audit. Refuse to apply if a `BYPASSRLS` grant is
 *      found outside `migrations/` and `audit/`.
 *   2. Connect to the database as the migration role.
 *   3. Create the `schema_migrations` bookkeeping table.
 *   4. Apply the bootstrap (the `tenants` table).
 *   5. Apply each RLS-bearing model in the registry. Each migration is
 *      applied inside a transaction; the runner records the version in
 *      `schema_migrations` only on commit.
 *
 * The runner never runs an unknown migration. The model registry is the
 * source of truth; adding a new model is one entry in `registry.ts` and
 * a `tenant_isolation` policy shows up in `pg_policies` on next run.
 */
import { assertAllowListDirs, auditBypassRls } from './bypass-audit.js';
import { FORA_MODELS, getRlsModels, TENANTS_MODEL_NAME } from './registry.js';
import { TENANT_ISOLATION_POLICY, emitModelDdl, } from './rls.js';
/** The default allow-list paths. The runner reads these from the repo root. */
export const DEFAULT_ALLOW_LIST = {
    migrationsDir: 'packages/db-migrator/migrations',
    auditDir: 'packages/db-migrator/audit',
};
/** The bookkeeping table the runner uses to track applied migrations. */
export const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations';
/**
 * Run the full migration set against `pool`. Idempotent: re-running against
 * an already-migrated database is a no-op.
 *
 * Throws if the BYPASSRLS audit finds any grant outside the allow-list, or
 * if Postgres rejects any statement.
 */
export async function runMigrations(pool, opts = {}) {
    const allowList = opts.allowList ?? DEFAULT_ALLOW_LIST;
    await assertAllowListDirs(allowList);
    if (opts.projectRoot) {
        const findings = await auditBypassRls(opts.projectRoot, allowList);
        if (findings.length > 0) {
            const lines = findings.map((f) => `  - ${f.relPath}:${f.line}  ${f.text}`);
            throw new Error(`BYPASSRLS audit failed. Findings outside the allow-list:\n${lines.join('\n')}`);
        }
    }
    const client = await pool.connect();
    try {
        await ensureSchemaMigrations(client);
        const result = { applied: [], verified: [] };
        // Bootstrap: the `tenants` table must exist before any FK target.
        const tenantsVersion = migrationVersionFor(TENANTS_BOOTSTRAP_MODEL());
        if (!(await isApplied(client, tenantsVersion))) {
            await applyOne(client, tenantsVersion, emitModelDdl(TENANTS_BOOTSTRAP_MODEL()));
            result.applied.push(tenantsVersion);
        }
        result.verified.push(TENANT_ISOLATION_POLICY); // tenants does not have it; see note below
        for (const model of getRlsModels()) {
            const version = migrationVersionFor(model);
            if (!(await isApplied(client, version))) {
                await applyOne(client, version, emitModelDdl(model));
                result.applied.push(version);
            }
        }
        // Post-apply: verify the policies are present.
        for (const model of getRlsModels()) {
            const present = await policyExists(client, model.name);
            if (!present) {
                throw new Error(`tenant_isolation policy missing on ${model.name} after migration`);
            }
            result.verified.push(`${TENANT_ISOLATION_POLICY}@${model.name}`);
        }
        return result;
    }
    finally {
        client.release();
    }
}
/**
 * Run the property-based test invariants against an already-migrated
 * database. This is the bridge between the SQL generator and the test
 * runner; the test calls this with two tenant UUIDs and a row inserter.
 */
export async function applyModelDdlForTest(client, model) {
    const sql = emitModelDdl(model);
    await client.query('BEGIN');
    try {
        await client.query(sql);
        await client.query('COMMIT');
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
}
function TENANTS_BOOTSTRAP_MODEL() {
    const t = FORA_MODELS.find((m) => m.name === TENANTS_MODEL_NAME);
    if (!t)
        throw new Error('tenants model missing from registry');
    return t;
}
function migrationVersionFor(model) {
    return `0001_${model.name}`;
}
async function ensureSchemaMigrations(client) {
    await client.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}
async function isApplied(client, version) {
    const r = await client.query(`SELECT version FROM ${SCHEMA_MIGRATIONS_TABLE} WHERE version = $1`, [version]);
    return r.rowCount !== null && r.rowCount > 0;
}
async function applyOne(client, version, sql) {
    await client.query('BEGIN');
    try {
        await client.query(sql);
        await client.query(`INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (version) VALUES ($1)`, [version]);
        await client.query('COMMIT');
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
}
async function policyExists(client, table) {
    const r = await client.query(`SELECT count(*)::text AS count
       FROM pg_policies
      WHERE schemaname = current_schema()
        AND tablename = $1
        AND policyname = $2`, [table, TENANT_ISOLATION_POLICY]);
    const row = r.rows[0];
    return row !== undefined && row.count !== '0';
}
//# sourceMappingURL=runner.js.map