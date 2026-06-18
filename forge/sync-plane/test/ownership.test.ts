import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildOwnershipTable,
  defaultOwnershipFields,
  isValidTenantSlug,
  loadOwnership,
  OwnershipLoadError,
  parseOwnership,
  tenantOwnershipPath,
} from '../src/ownership.js';

describe('Ownership table', () => {
  it('default table covers all §4 rows', () => {
    const m = defaultOwnershipFields();
    expect(m.get('paperclip.run_id')?.mode).toBe('single');
    expect(m.get('paperclip.assignee_agent_id')?.mode).toBe('single');
    expect(m.get('jira.sprint')?.mode).toBe('single');
    expect(m.get('github.labels')?.mode).toBe('single');
    expect(m.get('issue.title')?.mode).toBe('tier2');
    expect(m.get('comment.body')?.mode).toBe('tier2');
    expect(m.get('issue.state')?.mode).toBe('creator');
  });

  it('isValidTenantSlug enforces lowercase + dash format', () => {
    expect(isValidTenantSlug('acme')).toBe(true);
    expect(isValidTenantSlug('acme-corp')).toBe(true);
    expect(isValidTenantSlug('a1')).toBe(true);
    expect(isValidTenantSlug('ACME')).toBe(false);
    expect(isValidTenantSlug('1acme')).toBe(false);
    expect(isValidTenantSlug('acme_corp')).toBe(false);
    expect(isValidTenantSlug('')).toBe(false);
  });

  it('parseOwnership applies tenant overrides on top of default table', () => {
    const t = parseOwnership(
      'acme',
      `version: 1
fields:
  issue.summary:
    mode: single
    owner: jira
    mirrorPolicy: read_only_on_remote
  comment.body:
    mode: tier2
    writers: [paperclip, jira]
`,
    );
    expect(t.tenantSlug).toBe('acme');
    expect(t.fields.get('issue.summary')?.mode).toBe('single');
    const rule = t.fields.get('comment.body');
    expect(rule?.mode).toBe('tier2');
    expect(rule && rule.mode === 'tier2' ? rule.writers : []).toEqual([
      'paperclip',
      'jira',
    ]);
    // default rules still present
    expect(t.fields.get('jira.sprint')?.mode).toBe('single');
  });

  it('parseOwnership rejects unknown platforms', () => {
    expect(() =>
      parseOwnership(
        'acme',
        `version: 1
fields:
  issue.summary:
    mode: single
    owner: gitlab
    mirrorPolicy: read_only_on_remote
`,
      ),
    ).toThrowError(OwnershipLoadError);
  });

  it('parseOwnership rejects unknown mode', () => {
    expect(() =>
      parseOwnership(
        'acme',
        `version: 1
fields:
  issue.summary:
    mode: bogus
`,
      ),
    ).toThrowError(OwnershipLoadError);
  });

  it('parseOwnership rejects unknown mirrorPolicy', () => {
    expect(() =>
      parseOwnership(
        'acme',
        `version: 1
fields:
  issue.summary:
    mode: single
    owner: jira
    mirrorPolicy: not_a_policy
`,
      ),
    ).toThrowError(OwnershipLoadError);
  });

  it('parseOwnership requires version=1', () => {
    expect(() => parseOwnership('acme', 'version: 99\nfields: {}\n')).toThrowError(
      OwnershipLoadError,
    );
  });

  it('parseOwnership honors statePrecedence override', () => {
    const t = parseOwnership(
      'acme',
      `version: 1
statePrecedence: [jira, paperclip, github, clickup]
`,
    );
    expect(t.statePrecedence).toEqual(['jira', 'paperclip', 'github', 'clickup']);
  });

  it('parseOwnership rejects invalid YAML', () => {
    expect(() => parseOwnership('acme', 'version: 1\nfields: : :\n')).toThrowError(
      OwnershipLoadError,
    );
  });

  it('tenantOwnershipPath builds the expected location', () => {
    const p = tenantOwnershipPath('acme', '/tmp/proj');
    expect(p).toBe('/tmp/proj/forge/sync-plane/tenants/acme/ownership.yaml');
  });

  it('tenantOwnershipPath rejects bad slugs', () => {
    expect(() => tenantOwnershipPath('BAD', '/tmp')).toThrowError(OwnershipLoadError);
  });

  it('loadOwnership reads disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-plane-'));
    try {
      const dir = join(root, 'forge', 'sync-plane', 'tenants', 'demo');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'ownership.yaml'),
        `version: 1
fields:
  custom.field:
    mode: single
    owner: paperclip
    mirrorPolicy: reverse_mirror_with_tag
`,
        'utf8',
      );
      const t = loadOwnership('demo', { rootDir: root });
      const rule = t.fields.get('custom.field');
      expect(rule?.mode).toBe('single');
      expect(rule && rule.mode === 'single' ? rule.owner : null).toBe('paperclip');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('loadOwnership surfaces missing files', () => {
    expect(() => loadOwnership('missing-tenant', { rootDir: '/nonexistent' })).toThrowError(
      OwnershipLoadError,
    );
  });

  it('buildOwnershipTable supports test-only overrides', () => {
    const t = buildOwnershipTable('test', {
      'custom.metric': { mode: 'tier2', writers: ['paperclip'] },
    });
    expect(t.fields.get('custom.metric')?.mode).toBe('tier2');
  });
});
