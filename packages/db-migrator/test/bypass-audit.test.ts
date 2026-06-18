/**
 * Unit tests for the BYPASSRLS audit.
 *
 * The audit is the runtime gate that refuses to apply migrations if a
 * `BYPASSRLS` grant is found outside `migrations/` and `audit/`. The
 * tests lay out a temp directory with a mix of allowed and disallowed
 * files, then assert the audit returns the right findings.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditBypassRls, isAllowedRole } from '../src/bypass-audit.js';
import type { BypassRlsAllowList } from '../src/types.js';

let work: string;
let allowList: BypassRlsAllowList;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'fora-bypass-audit-'));
  const migrationsDir = join(work, 'migrations');
  const auditDir = join(work, 'audit');
  await mkdir(migrationsDir, { recursive: true });
  await mkdir(auditDir, { recursive: true });
  allowList = { migrationsDir, auditDir };
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

describe('isAllowedRole', () => {
  it('accepts the two allow-listed roles', () => {
    expect(isAllowedRole('ALTER ROLE migrator BYPASSRLS;')).toBe(true);
    expect(isAllowedRole('CREATE ROLE audit_reader BYPASSRLS;')).toBe(true);
  });
  it('rejects other roles', () => {
    expect(isAllowedRole('ALTER ROLE app_user BYPASSRLS;')).toBe(false);
    expect(isAllowedRole('GRANT BYPASSRLS TO app_user;')).toBe(false);
  });
});

describe('auditBypassRls', () => {
  it('passes when no BYPASSRLS grants exist anywhere', async () => {
    await writeFile(join(work, 'app.sql'), 'CREATE TABLE foo (id uuid);');
    const findings = await auditBypassRls(work, allowList);
    expect(findings).toEqual([]);
  });

  it('passes when BYPASSRLS is granted only to allow-listed roles in allow-list paths', async () => {
    await writeFile(
      join(allowList.migrationsDir, '0001_migration_role.sql'),
      'ALTER ROLE migrator BYPASSRLS;',
    );
    await writeFile(
      join(allowList.auditDir, '0001_audit_reader_role.sql'),
      'CREATE ROLE audit_reader BYPASSRLS;',
    );
    const findings = await auditBypassRls(work, allowList);
    expect(findings).toEqual([]);
  });

  it('fails when a BYPASSRLS grant is in a non-allow-list path', async () => {
    await writeFile(
      join(work, 'app_roles.sql'),
      'ALTER ROLE app_user BYPASSRLS;',
    );
    const findings = await auditBypassRls(work, allowList);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.relPath).toBe('app_roles.sql');
    expect(findings[0]?.line).toBe(1);
    expect(findings[0]?.text).toContain('BYPASSRLS');
  });

  it('accepts BYPASSRLS inside the migrations/ and audit/ allow-list paths (role check is the lint rule\'s job)', async () => {
    // Per spec: "refuses to apply if one is added outside those two paths".
    // The role check is the CI lint rule (0.7.2d), not the runtime audit.
    await writeFile(
      join(allowList.migrationsDir, '0001_migration_role.sql'),
      'ALTER ROLE migrator BYPASSRLS;',
    );
    await writeFile(
      join(allowList.auditDir, '0001_audit_reader_role.sql'),
      'ALTER ROLE audit_reader BYPASSRLS;',
    );
    const findings = await auditBypassRls(work, allowList);
    expect(findings).toEqual([]);
  });

  it('reports the line number of the grant', async () => {
    await writeFile(
      join(work, 'app.sql'),
      ['-- safe comment', 'CREATE TABLE foo (id uuid);', 'ALTER ROLE app_user BYPASSRLS;'].join('\n'),
    );
    const findings = await auditBypassRls(work, allowList);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(3);
  });

  it('ignores BYPASSRLS in non-SQL files (they would not be applied)', async () => {
    // We do not want a README mentioning BYPASSRLS in prose to be a finding.
    await writeFile(join(work, 'README.md'), 'BYPASSRLS is dangerous.');
    const findings = await auditBypassRls(work, allowList);
    expect(findings).toEqual([]);
  });

  it('skips node_modules and hidden directories', async () => {
    await mkdir(join(work, 'node_modules', 'evil'), { recursive: true });
    await writeFile(
      join(work, 'node_modules', 'evil', 'evil.sql'),
      'ALTER ROLE app_user BYPASSRLS;',
    );
    await mkdir(join(work, '.git'), { recursive: true });
    await writeFile(join(work, '.git', 'evil.sql'), 'ALTER ROLE app_user BYPASSRLS;');
    const findings = await auditBypassRls(work, allowList);
    expect(findings).toEqual([]);
  });
});
