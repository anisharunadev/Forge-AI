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
import type { Pool, PoolClient } from 'pg';
import type { BypassRlsAllowList, TenantScopedModel } from './types.js';
/** The default allow-list paths. The runner reads these from the repo root. */
export declare const DEFAULT_ALLOW_LIST: BypassRlsAllowList;
/** The bookkeeping table the runner uses to track applied migrations. */
export declare const SCHEMA_MIGRATIONS_TABLE: "schema_migrations";
/** Result of a single migration run. */
export interface RunResult {
    /** Migrations applied during this run (in order). */
    applied: string[];
    /** Models whose `tenant_isolation` policy was verified post-apply. */
    verified: string[];
}
/**
 * Run the full migration set against `pool`. Idempotent: re-running against
 * an already-migrated database is a no-op.
 *
 * Throws if the BYPASSRLS audit finds any grant outside the allow-list, or
 * if Postgres rejects any statement.
 */
export declare function runMigrations(pool: Pool, opts?: {
    projectRoot?: string;
    allowList?: BypassRlsAllowList;
}): Promise<RunResult>;
/**
 * Run the property-based test invariants against an already-migrated
 * database. This is the bridge between the SQL generator and the test
 * runner; the test calls this with two tenant UUIDs and a row inserter.
 */
export declare function applyModelDdlForTest(client: PoolClient, model: TenantScopedModel): Promise<void>;
