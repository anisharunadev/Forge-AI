/**
 * @fora/tenancy-lint — SQL checks
 *
 * The three SQL rules from FORA-165:
 *   1. `CREATE TABLE` is only allowed under `migrations/` (or `audit/` for
 *      audit-only tables). Anywhere else is a build failure.
 *   2. A multi-tenant table — detected by the presence of a `tenant_id`
 *      column — must be paired with `ENABLE ROW LEVEL SECURITY` and a
 *      `tenant_isolation` policy. Missing either is a warning (the build
 *      passes; the warning is surfaced in the PR review).
 *   3. `BYPASSRLS` is only allowed under `migrations/` and `audit/`. New
 *      roles in `apps/` or `packages/` getting `BYPASSRLS` is a build failure.
 *
 * The check is regex-driven because Postgres DDL is a small, well-defined
 * grammar and a full SQL parser is overkill for the patterns we care about.
 * False positives are reviewed in the PR; false negatives are caught by the
 * property-based test in 0.7.2a.
 */
import type { Finding } from '../types.js';
/** True if the file path lives under a `migrations/` directory at any depth. */
export declare function isUnderMigrations(filePath: string): boolean;
/** True if the file path lives under an `audit/` directory at any depth. */
export declare function isUnderAudit(filePath: string): boolean;
/**
 * Strip line comments (`-- ...`) and block comments (`/* ... *\/`) from SQL.
 * Strings are preserved (single-quoted). The goal is to avoid false positives
 * on commented-out `CREATE TABLE` / `BYPASSRLS` lines.
 */
export declare function stripSqlComments(sql: string): string;
/**
 * Run all SQL checks on a single file's content. Returns findings — never
 * throws. Empty input is a no-op.
 */
export declare function checkSql(filePath: string, sql: string): Finding[];
