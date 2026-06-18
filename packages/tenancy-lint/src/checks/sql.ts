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

import type { Finding, LintContext } from '../types.js';

/** True if the file path lives under a `migrations/` directory at any depth. */
export function isUnderMigrations(filePath: string): boolean {
  return /(?:^|\/)migrations\//.test(filePath);
}

/** True if the file path lives under an `audit/` directory at any depth. */
export function isUnderAudit(filePath: string): boolean {
  return /(?:^|\/)audit\//.test(filePath);
}

/**
 * Strip line comments (`-- ...`) and block comments (`/* ... *\/`) from SQL.
 * Strings are preserved (single-quoted). The goal is to avoid false positives
 * on commented-out `CREATE TABLE` / `BYPASSRLS` lines.
 */
export function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  let inSingle = false;
  while (i < n) {
    const c = sql[i];
    const nx = sql[i + 1];
    if (inSingle) {
      // SQL single-quoted string with `''` escape. We don't touch this.
      if (c === "'" && nx === "'") {
        out += "''";
        i += 2;
        continue;
      }
      if (c === "'") {
        inSingle = false;
        out += c;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === '-' && nx === '-') {
      // line comment
      while (i < n && sql[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && nx === '*') {
      // block comment
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Run all SQL checks on a single file's content. Returns findings — never
 * throws. Empty input is a no-op.
 */
export function checkSql(filePath: string, sql: string): Finding[] {
  if (!sql.trim()) return [];
  const ctx: LintContext = { file: filePath };
  const findings: Finding[] = [];

  const cleaned = stripSqlComments(sql);
  const lines = cleaned.split('\n');

  // 1. CREATE TABLE outside migrations/ fails the build.
  if (!isUnderMigrations(filePath)) {
    const createTableRe = /\bCREATE\s+TABLE\b/gi;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (createTableRe.test(line)) {
        findings.push({
          severity: 'error',
          rule: 'no-create-table-outside-migrations',
          file: filePath,
          line: i + 1,
          message:
            'CREATE TABLE is only allowed in `migrations/`. Use the FORA migration runner (FORA-162 0.7.2a) to add or alter tables.',
        });
        createTableRe.lastIndex = 0;
      }
    }
  }

  // 2. Multi-tenant tables without RLS — warn.
  //    A multi-tenant table is detected by the presence of `tenant_id` in a
  //    CREATE TABLE block. We look for the block, then check that the same
  //    block (loosely, the next ~30 lines or until the closing `);`) contains
  //    `ENABLE ROW LEVEL SECURITY` and a `tenant_isolation` policy.
  const createTableRe2 = /\bCREATE\s+TABLE\b/gi;
  let m: RegExpExecArray | null;
  while ((m = createTableRe2.exec(cleaned)) !== null) {
    const startOffset = m.index;
    // Find the end of this CREATE TABLE block — best-effort: scan to the
    // first `;` after the opening `(`. SQL grammar is too irregular to
    // balance parens reliably without a real parser, so we bound the scan
    // to 200 lines.
    const openParen = cleaned.indexOf('(', startOffset);
    if (openParen === -1) continue;
    let depth = 0;
    let endOffset = openParen;
    for (let i = openParen; i < cleaned.length; i += 1) {
      const ch = cleaned[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          endOffset = i;
          break;
        }
      }
    }
    const block = cleaned.slice(startOffset, endOffset + 1);
    const blockStartLine = cleaned.slice(0, startOffset).split('\n').length;

    if (!/\btenant_id\b/i.test(block)) continue; // not a multi-tenant table

    // Look ahead in the file for the RLS + policy markers. The CREATE TABLE
    // is usually followed by ALTER TABLE ... ENABLE ROW LEVEL SECURITY and
    // CREATE POLICY ... tenant_isolation in the same file. We scan up to
    // 1000 chars after the block end.
    const lookaheadLimit = Math.min(cleaned.length, endOffset + 1 + 1000);
    const tail = cleaned.slice(endOffset + 1, lookaheadLimit);

    if (!/\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(tail)) {
      findings.push({
        severity: 'warning',
        rule: 'multi-tenant-table-needs-rls',
        file: filePath,
        line: blockStartLine,
        message:
          'Multi-tenant table (has `tenant_id`) is missing `ENABLE ROW LEVEL SECURITY` after the CREATE TABLE block.',
      });
    }
    if (!/\bCREATE\s+POLICY\b[\s\S]*?\btenant_isolation\b/i.test(tail)) {
      findings.push({
        severity: 'warning',
        rule: 'multi-tenant-table-needs-tenant-isolation-policy',
        file: filePath,
        line: blockStartLine,
        message:
          'Multi-tenant table is missing a `tenant_isolation` policy. Use `USING (tenant_id = current_setting(\'app.tenant_id\')::uuid)`.',
      });
    }
  }
  createTableRe2.lastIndex = 0;

  // 3. BYPASSRLS outside migrations/ and audit/ fails the build.
  if (!isUnderMigrations(filePath) && !isUnderAudit(filePath)) {
    const bypassRe = /\bBYPASSRLS\b/gi;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (bypassRe.test(line)) {
        findings.push({
          severity: 'error',
          rule: 'no-bypassrls-outside-migrations-and-audit',
          file: filePath,
          line: i + 1,
          message:
            '`BYPASSRLS` is only allowed in `migrations/` (migration runner) and `audit/` (audit-log writer). Application roles MUST be `NOBYPASSRLS`.',
        });
        bypassRe.lastIndex = 0;
      }
    }
  }

  // Reference `ctx` to satisfy the unused-var lint in some configs.
  void ctx;
  return findings;
}
