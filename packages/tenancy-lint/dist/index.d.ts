/**
 * @fora/tenancy-lint — public API + runner
 *
 * Lint entry point. `lintRepo(root)` walks the tree, runs the SQL and TS
 * checks, and returns a summary. CI calls this; the CLI bin/tenancy-lint.mjs
 * is a thin wrapper.
 */
import { type ScanOptions } from './repo.js';
import type { LintSummary } from './types.js';
export type { Finding, FindingSeverity, LintContext, LintSummary } from './types.js';
export { walk } from './repo.js';
export type { ScannedFile, ScanOptions } from './repo.js';
export { checkSql, stripSqlComments, isUnderMigrations, isUnderAudit } from './checks/sql.js';
export { checkTs } from './checks/ts.js';
export { matchesIgnore, parseIgnoreText, loadIgnorePatterns, } from './repo.js';
/** Run the lint on a directory tree. Returns the full finding list and counts. */
export declare function lintRepo(opts?: ScanOptions): LintSummary;
/** Format a summary for the CLI / CI log. */
export declare function formatSummary(summary: LintSummary): string;
