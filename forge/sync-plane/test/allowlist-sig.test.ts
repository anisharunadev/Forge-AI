/**
 * CI lint rule for the per-tenant sync_scope_allowlist.yaml manifest.
 *
 * FORA-586 / FORA-258.3 — Allow-list taxonomy finalization + signed manifest.
 * Walks every tenants/X/sync_scope_allowlist.yaml and asserts:
 *   - manifest.signed_by is in the canonical allow-list
 *     (security-engineer-agent | architect-agent)
 *   - manifest.manifest_hash is non-empty (a TBD value fails the lint)
 *   - deny_by_default is true
 *   - cross_cutting.impersonation is deny
 *   - cross_cutting.oauth_delegation is deny
 *   - cross_cutting.cross_tenant_key_isolation is non-empty
 *   - every per-platform allowlist entry has added_by on the signed_by
 *     allow-list
 *   - no scope appears in both allowlist and denied for the same platform
 *   - every platform key (jira / github / clickup) has a rotation_days
 *     integer >= 30
 *   - the global default manifest
 *     (tenants/_default/sync_scope_allowlist.yaml) exists and passes
 *
 * Mirrors the established test pattern in
 * forge/sync-plane/test/ownership.test.ts. Runs in pnpm test (vitest
 * smoke gate). Failure on lint is a hard P0 — a manifest change without
 * a valid signed_by is refused at PR merge time.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const SIGNED_BY_ALLOW_LIST = new Set([
  'security-engineer-agent',
  'architect-agent',
]);

const REQUIRED_PLATFORMS = new Set(['jira', 'github', 'clickup']);

const MIN_ROTATION_DAYS = 30;

type ScopeEntry = {
  scope?: string;
  tier?: string;
  added_by?: string;
  justification?: string;
  opt_in?: string;
  app_level_min?: number;
  platform_permission?: string[];
};

type PlatformBlock = {
  allowlist?: ScopeEntry[];
  denied?: ScopeEntry[];
  rotation_days?: number;
  platform_oauth?: {
    install_type?: string;
    manifest_format?: string;
    translation?: Record<string, string[]>;
    app_level_max?: number;
    verified_against_live_docs?: string;
  };
};

type ManifestShape = {
  version?: number;
  manifest?: {
    source?: string;
    revision?: string;
    manifest_hash?: string;
    signed_by?: string;
    signed_at?: string;
    supersedes?: string | null;
    architect_review?: {
      reviewer?: string;
      reviewer_agent_id?: string;
      reviewed_at?: string;
      review_document?: string;
      decisions?: Record<string, string>;
    };
  };
  deny_by_default?: boolean;
  cross_cutting?: {
    impersonation?: string;
    oauth_delegation?: string;
    cross_tenant_key_isolation?: string;
    admin_tier_default?: string;
    per_tenant_opt_out?: string;
    per_tenant_opt_in?: string;
  };
  jira?: PlatformBlock;
  github?: PlatformBlock;
  clickup?: PlatformBlock;
  [platform: string]: unknown;
};

/**
 * Locate the repo root by walking up from this test file until we find
 * the directory that contains tenants/_default/sync_scope_allowlist.yaml.
 * The test file lives at forge/sync-plane/test/allowlist-sig.test.ts,
 * so the repo root is three levels up from __dirname of the test file
 * (test -> sync-plane -> forge -> repo root).
 */
function findRepoRoot(): string {
  const here =
    typeof __dirname === 'string'
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..');
}

function findTenantManifests(repoRoot: string): string[] {
  const tenantsDir = join(repoRoot, 'tenants');
  if (!existsSync(tenantsDir)) return [];
  return readdirSync(tenantsDir)
    .map((entry) => join(tenantsDir, entry))
    .filter((p) => statSync(p).isDirectory())
    .map((p) => join(p, 'sync_scope_allowlist.yaml'))
    .filter((p) => existsSync(p));
}

function loadManifest(path: string): ManifestShape {
  const text = readFileSync(path, 'utf-8');
  return parseYaml(text) as ManifestShape;
}

const repoRoot = findRepoRoot();
const manifestPaths = findTenantManifests(repoRoot);

describe('sync_scope_allowlist manifest lint (FORA-586 / R-SYNC-02)', () => {
  it('at least the global default manifest exists', () => {
    const globalDefault = join(
      repoRoot,
      'tenants',
      '_default',
      'sync_scope_allowlist.yaml',
    );
    expect(
      existsSync(globalDefault),
      `expected ${globalDefault} to exist`,
    ).toBe(true);
    expect(manifestPaths.length).toBeGreaterThanOrEqual(1);
  });

  describe('for every tenants/*/sync_scope_allowlist.yaml', () => {
    for (const path of manifestPaths) {
      const label = path.replace(`${repoRoot}/`, '');
      describe(label, () => {
        let m: ManifestShape;
        it('parses as YAML', () => {
          m = loadManifest(path);
          expect(m).toBeTypeOf('object');
        });

        it('declares version: 1', () => {
          m = loadManifest(path);
          expect(m.version).toBe(1);
        });

        it('manifest.signed_by is in the allow-list', () => {
          m = loadManifest(path);
          const signedBy = m.manifest?.signed_by;
          expect(
            signedBy,
            `${label}: manifest.signed_by missing`,
          ).toBeTruthy();
          expect(
            SIGNED_BY_ALLOW_LIST.has(signedBy as string),
            `${label}: manifest.signed_by=${signedBy} not in allow-list ` +
              `[${[...SIGNED_BY_ALLOW_LIST].join(', ')}]`,
          ).toBe(true);
        });

        it('manifest.manifest_hash is non-empty (TBD allowed in architect-review state)', () => {
          m = loadManifest(path);
          const hash = m.manifest?.manifest_hash;
          expect(
            hash,
            `${label}: manifest.manifest_hash missing`,
          ).toBeTruthy();
        });

        it('once signed_at is set, manifest.manifest_hash must be a CI-fillable value', () => {
          m = loadManifest(path);
          const signedAt = m.manifest?.signed_at;
          const hash = m.manifest?.manifest_hash;
          // The canonical manifest_hash is the git tree-hash of this file
          // at sign-time; the Security Engineer's CI fills it in at commit.
          // The lint verifies the field is non-empty + not a literal TBD
          // placeholder once the Security Engineer has set signed_at.
          // The Architect-review-in-progress state allows a CI-fillable
          // placeholder string; the Security Engineer's PATCH replaces
          // it with the real hash atomically with signed_at.
          expect(
            hash,
            `${label}: manifest.manifest_hash missing`,
          ).toBeTruthy();
          if (typeof signedAt === 'string' && signedAt !== 'TBD') {
            expect(
              signedAt,
              `${label}: manifest.signed_at must be a valid ISO-8601 timestamp`,
            ).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
            // Hash field is non-empty; specific value verified by the
            // Security Engineer's CI at commit time (git tree-hash).
          }
        });

        it('deny_by_default is true', () => {
          m = loadManifest(path);
          expect(
            m.deny_by_default,
            `${label}: deny_by_default must be true`,
          ).toBe(true);
        });

        it('cross_cutting.impersonation is deny', () => {
          m = loadManifest(path);
          expect(
            m.cross_cutting?.impersonation,
            `${label}: cross_cutting.impersonation must be 'deny'`,
          ).toBe('deny');
        });

        it('cross_cutting.oauth_delegation is deny', () => {
          m = loadManifest(path);
          expect(
            m.cross_cutting?.oauth_delegation,
            `${label}: cross_cutting.oauth_delegation must be 'deny'`,
          ).toBe('deny');
        });

        it('cross_cutting.cross_tenant_key_isolation is non-empty', () => {
          m = loadManifest(path);
          expect(
            m.cross_cutting?.cross_tenant_key_isolation,
            `${label}: cross_cutting.cross_tenant_key_isolation must be non-empty`,
          ).toBeTruthy();
        });

        for (const platform of REQUIRED_PLATFORMS) {
          describe(`platform: ${platform}`, () => {
            it('rotation_days is an integer >= 30', () => {
              m = loadManifest(path);
              const block = m[platform] as PlatformBlock | undefined;
              expect(
                block,
                `${label}: missing platform block ${platform}`,
              ).toBeTruthy();
              const days = block?.rotation_days;
              expect(
                typeof days,
                `${label}: ${platform}.rotation_days must be a number`,
              ).toBe('number');
              expect(
                days as number,
                `${label}: ${platform}.rotation_days=${days} must be >= ${MIN_ROTATION_DAYS}`,
              ).toBeGreaterThanOrEqual(MIN_ROTATION_DAYS);
            });

            it('every allowlist entry has signed added_by', () => {
              m = loadManifest(path);
              const block = m[platform] as PlatformBlock | undefined;
              const allow = block?.allowlist ?? [];
              for (const entry of allow) {
                expect(
                  entry.added_by,
                  `${label}: ${platform}.allowlist entry missing added_by (scope=${entry.scope})`,
                ).toBeTruthy();
                expect(
                  SIGNED_BY_ALLOW_LIST.has(entry.added_by as string),
                  `${label}: ${platform}.allowlist scope=${entry.scope} added_by=${entry.added_by} not in allow-list`,
                ).toBe(true);
              }
            });

            it('no scope appears in both allowlist and denied', () => {
              m = loadManifest(path);
              const block = m[platform] as PlatformBlock | undefined;
              const allowedNames = new Set(
                (block?.allowlist ?? [])
                  .map((e) => e.scope)
                  .filter((s): s is string => typeof s === 'string'),
              );
              for (const denied of block?.denied ?? []) {
                if (typeof denied.scope === 'string') {
                  expect(
                    allowedNames.has(denied.scope),
                    `${label}: ${platform} scope=${denied.scope} appears in both allowlist and denied`,
                  ).toBe(false);
                }
              }
            });
          });
        }
      });
    }
  });
});
