/**
 * BYPASSRLS audit.
 *
 * Per FORA-124 / 0.7.2a, the runner greps the `migrations/` and `audit/`
 * directories for any `BYPASSRLS` grant and refuses to apply if one is
 * found outside those two paths. The lint rule in 0.7.2d is the CI-side
 * enforcement of the same rule; this audit is the runtime gate.
 *
 * We only allow `BYPASSRLS` for two roles, both defined in this package:
 *   - the migration role (`migrator`), created in `migrations/`
 *   - the audit-reader role (`audit_reader`), created in `audit/`
 * Every application role — including the runtime, the broker, and any
 * future service — is created without `BYPASSRLS`.
 */
import type { BypassRlsAllowList } from './types.js';
/** A `BYPASSRLS` grant found by the audit. */
export interface BypassRlsFinding {
    /** Absolute path to the file. */
    file: string;
    /** Path relative to the allow-list root, e.g. `migrations/0001_tenants.sql`. */
    relPath: string;
    /** 1-indexed line number. */
    line: number;
    /** The full line that triggered the finding. */
    text: string;
}
/**
 * Run the audit.
 *
 * - Scans `allowList.migrationsDir` and `allowList.auditDir` for `BYPASSRLS`
 *   grants referencing the allowed roles — those are expected.
 * - Scans every other `.sql` file in the project (outside the allow-list)
 *   for *any* `BYPASSRLS` grant — those are findings.
 *
 * Returns a list of findings; an empty list means the audit is clean.
 */
export declare function auditBypassRls(projectRoot: string, allowList: BypassRlsAllowList): Promise<BypassRlsFinding[]>;
/**
 * Verify a `BYPASSRLS` grant in the allow-list references one of the
 * allowed roles. The audit returns a finding if a role outside the
 * allow-list is granted `BYPASSRLS`, even inside `migrations/` or `audit/`.
 */
export declare function isAllowedRole(text: string): boolean;
/** Sanity check: the allow-list directories exist and are readable. */
export declare function assertAllowListDirs(allowList: BypassRlsAllowList): Promise<void>;
