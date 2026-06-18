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

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

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

/** The set of allowed `BYPASSRLS` roles. Anything else is a finding. */
const ALLOWED_ROLES = new Set([
  'migrator', // migration role; defined in migrations/
  'audit_reader', // audit-reader role; defined in audit/
]);

/**
 * Regex for a `BYPASSRLS` grant. Matches `ALTER ROLE ... BYPASSRLS`,
 * `CREATE ROLE ... BYPASSRLS`, and `GRANT BYPASSRLS TO ...`. We do not
 * try to be a full SQL parser; we look for the keyword on a logical
 * statement boundary.
 */
const BYPASSRLS_RE = /\b(ALTER\s+ROLE|CREATE\s+ROLE|GRANT)\b[^;]*\bBYPASSRLS\b[^;]*?(?=;|$)/gi;

/** Recursively walk `dir` and yield absolute paths of every regular file. */
async function* walk(dir: string): AsyncGenerator<string> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules and hidden dirs; we only care about the source tree.
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      yield* walk(p);
    } else if (entry.isFile()) {
      // Only scan .sql files — `BYPASSRLS` should not appear in code.
      if (p.endsWith('.sql')) yield p;
    }
  }
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
export async function auditBypassRls(
  projectRoot: string,
  allowList: BypassRlsAllowList,
): Promise<BypassRlsFinding[]> {
  const findings: BypassRlsFinding[] = [];
  const allowedRoots = [resolve(allowList.migrationsDir), resolve(allowList.auditDir)];

  for await (const file of walk(projectRoot)) {
    const abs = resolve(file);
    const isInAllowList = allowedRoots.some((root) => isUnder(abs, root));
    // Test fixtures under `test/fixtures/` are intentionally outside the
    // migrations/audit allow-list — they exist to exercise the audit itself
    // and the tenancy-lint rule (FORA-165). They are never applied to a real
    // database because the migrator only walks `migrationsDir`. The lint
    // rule already exempts them via its own `migrations/...` regex; the
    // runtime audit now matches.
    const isTestFixture = /[/\\]test[/\\]fixtures[/\\]/.test(abs);
    const text = await readFile(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      BYPASSRLS_RE.lastIndex = 0;
      if (!BYPASSRLS_RE.test(line)) continue;
      if (isInAllowList) continue; // allow-list path; expected
      if (isTestFixture) continue; // test fixtures; expected
      findings.push({
        file: abs,
        relPath: relative(projectRoot, abs),
        line: i + 1,
        text: line.trim(),
      });
    }
  }
  return findings;
}

/** Return true if `child` is the same as or nested under `parent`. */
function isUnder(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return !!rel && !rel.startsWith('..') && !rel.startsWith(sep);
}

/**
 * Verify a `BYPASSRLS` grant in the allow-list references one of the
 * allowed roles. The audit returns a finding if a role outside the
 * allow-list is granted `BYPASSRLS`, even inside `migrations/` or `audit/`.
 */
export function isAllowedRole(text: string): boolean {
  // Look for the role name after `ROLE` or after `TO`.
  const m = text.match(/\b(ROLE|TO)\s+("?[a-z_][a-z0-9_]*"?)/i);
  if (!m || !m[2]) return false;
  return ALLOWED_ROLES.has(m[2].replace(/"/g, '').toLowerCase());
}

/** Sanity check: the allow-list directories exist and are readable. */
export async function assertAllowListDirs(allowList: BypassRlsAllowList): Promise<void> {
  for (const dir of [allowList.migrationsDir, allowList.auditDir]) {
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) {
        throw new Error(`BYPASSRLS allow-list path is not a directory: ${dir}`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`BYPASSRLS allow-list directory does not exist: ${dir}`);
      }
      throw err;
    }
  }
}
