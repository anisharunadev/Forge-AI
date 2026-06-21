/**
 * @fora/tenancy-lint — TypeScript checks
 *
 * Today there is one TS rule: `BYPASSRLS` may not appear in code that runs
 * inside an application role. The marker is the literal token `BYPASSRLS`
 * (case-insensitive), which can leak in via a string constant, a comment, or
 * a generated SQL query. Outside `migrations/` and `audit/`, any presence of
 * `BYPASSRLS` is a build failure.
 *
 * The TS scan is line-based: we look for the token in any non-comment line.
 * We do NOT parse the TypeScript AST — that would miss the dynamic case
 * (e.g. a runtime string concat that produces `BYPASSRLS`).
 */
import type { Finding } from '../types.js';
export declare function checkTs(filePath: string, source: string): Finding[];
