/**
 * @fora/tenancy-lint — public API + runner
 *
 * Lint entry point. `lintRepo(root)` walks the tree, runs the SQL and TS
 * checks, and returns a summary. CI calls this; the CLI bin/tenancy-lint.mjs
 * is a thin wrapper.
 */

import { checkSql } from './checks/sql.js';
import { checkTs } from './checks/ts.js';
import { walk, type ScanOptions } from './repo.js';
import type { Finding, LintSummary } from './types.js';

export type { Finding, FindingSeverity, LintContext, LintSummary } from './types.js';
export { walk } from './repo.js';
export type { ScannedFile, ScanOptions } from './repo.js';
export { checkSql, stripSqlComments, isUnderMigrations, isUnderAudit } from './checks/sql.js';
export { checkTs } from './checks/ts.js';
export {
  matchesIgnore,
  parseIgnoreText,
  loadIgnorePatterns,
} from './repo.js';

/** Run the lint on a directory tree. Returns the full finding list and counts. */
export function lintRepo(opts: ScanOptions = {}): LintSummary {
  const files = walk(opts);
  const findings: Finding[] = [];
  for (const f of files) {
    const ext = extname(f.relPath);
    if (ext === '.sql') {
      findings.push(...checkSql(f.relPath, f.content));
    } else {
      findings.push(...checkTs(f.relPath, f.content));
    }
  }
  return {
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
    findings,
  };
}

/** Format a summary for the CLI / CI log. */
export function formatSummary(summary: LintSummary): string {
  const lines: string[] = [];
  for (const f of summary.findings) {
    const tag = f.severity === 'error' ? 'error' : 'warning';
    lines.push(`  ${tag.padEnd(7)} ${f.file}:${f.line}  ${f.rule}  ${f.message}`);
  }
  lines.push('');
  lines.push(`Found ${summary.errors} error(s) and ${summary.warnings} warning(s).`);
  return lines.join('\n');
}

function extname(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}
