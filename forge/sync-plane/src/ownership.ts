/**
 * Field-ownership table loader — ADR-0010 §4 Tier-1.
 *
 * Each tenant publishes a YAML file at
 *   `forge/sync-plane/tenants/<slug>/ownership.yaml`
 * that declares, per field, which platform owns the canonical write.
 * The §4 table is the default fixture; tenant overrides layer on top of it.
 *
 * Ownership has three modes:
 *   - `single`  — exactly one platform owns the field. Writes from any
 *                 other platform are mirrored as `mirror_state` (Tier-1 deterministic).
 *   - `creator` — the platform that *created* the issue owns the field
 *                 (e.g. `issue.summary` is Paperclip when created via Paperclip,
 *                 else the creating platform). Resolver looks at the
 *                 `creatorPlatform` of the event context.
 *   - `tier2`   — multiple platforms have write rights; HLC LWW decides.
 *                 (Tier-2 path in `resolver.ts`.)
 *
 * Each rule also names the optional `mirrorPolicy`:
 *   - `read_only_on_remote` (default for `single`)
 *   - `reverse_mirror_with_tag` (e.g. `assignee_agent_id` → §4 row 2)
 *   - `translated_mirror_state` (e.g. workflow `state` → §4 row 6)
 *
 * The loader is fully sync, reads from disk via Node `fs`, parses with `yaml`,
 * validates structure, and returns an immutable `OwnershipTable`. Callers
 * usually wrap this in a per-tenant cache keyed by `(tenant_slug, file_mtime)`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

export type Platform = 'paperclip' | 'jira' | 'github' | 'clickup';

export const KNOWN_PLATFORMS: readonly Platform[] = [
  'paperclip',
  'jira',
  'github',
  'clickup',
];

export type OwnershipMode = 'single' | 'creator' | 'tier2';

export type MirrorPolicy =
  | 'read_only_on_remote'
  | 'reverse_mirror_with_tag'
  | 'translated_mirror_state';

export interface SingleOwnerRule {
  readonly mode: 'single';
  readonly owner: Platform;
  readonly mirrorPolicy: MirrorPolicy;
}

export interface CreatorOwnerRule {
  readonly mode: 'creator';
  /** Fallback when the issue has no `creatorPlatform` (e.g. legacy import). */
  readonly fallback: Platform;
  readonly mirrorPolicy: MirrorPolicy;
}

export interface Tier2Rule {
  readonly mode: 'tier2';
  /**
   * Restricts the set of platforms that may write this field. An empty
   * array means "any platform". HLC LWW picks the winner among writers.
   */
  readonly writers: readonly Platform[];
}

export type OwnershipRule = SingleOwnerRule | CreatorOwnerRule | Tier2Rule;

export interface OwnershipTable {
  readonly tenantSlug: string;
  /** Per-tenant precedence order across tiers (§4 last paragraph). */
  readonly statePrecedence: readonly Platform[];
  /**
   * Field path → rule. Field paths are dotted, e.g. `paperclip.run_status`,
   * `issue.summary`, `comment.body`. Lookup is exact, no wildcards.
   */
  readonly fields: ReadonlyMap<string, OwnershipRule>;
}

export class OwnershipLoadError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'OwnershipLoadError';
  }
}

/** Default field-ownership table per ADR-0010 §4. */
export function defaultOwnershipFields(): ReadonlyMap<string, OwnershipRule> {
  const m = new Map<string, OwnershipRule>();
  // Row 1 — Paperclip run is read-only on remote.
  for (const f of [
    'paperclip.run_id',
    'paperclip.run_status',
    'paperclip.run_events',
  ]) {
    m.set(f, {
      mode: 'single',
      owner: 'paperclip',
      mirrorPolicy: 'read_only_on_remote',
    });
  }
  // Row 2 — assignee_agent_id mirrors to remote with reverse tag.
  m.set('paperclip.assignee_agent_id', {
    mode: 'single',
    owner: 'paperclip',
    mirrorPolicy: 'reverse_mirror_with_tag',
  });
  // Row 3 — Jira sprint / story points / epic link.
  for (const f of [
    'jira.sprint',
    'jira.story_points',
    'jira.epic_link',
  ]) {
    m.set(f, {
      mode: 'single',
      owner: 'jira',
      mirrorPolicy: 'read_only_on_remote',
    });
  }
  // Row 4 — GitHub labels + milestone.
  for (const f of ['github.labels', 'github.milestone']) {
    m.set(f, {
      mode: 'single',
      owner: 'github',
      mirrorPolicy: 'read_only_on_remote',
    });
  }
  // Row 5 — title/body/comment.body — all writers, HLC ordered.
  for (const f of ['issue.title', 'issue.body', 'comment.body']) {
    m.set(f, { mode: 'tier2', writers: [] });
  }
  // Row 6 — workflow state has per-platform owner; the resolver picks the
  // platform of the *originating* event (creator rule with mirror_state).
  m.set('issue.state', {
    mode: 'creator',
    fallback: 'paperclip',
    mirrorPolicy: 'translated_mirror_state',
  });
  m.set('issue.status', {
    mode: 'creator',
    fallback: 'paperclip',
    mirrorPolicy: 'translated_mirror_state',
  });
  return m;
}

const DEFAULT_STATE_PRECEDENCE: readonly Platform[] = [
  'paperclip',
  'jira',
  'github',
  'clickup',
];

/**
 * Load a tenant's `ownership.yaml`. Tenant overrides merge field-by-field
 * onto the default table; the tenant may also reorder `statePrecedence`.
 *
 * YAML shape:
 *   version: 1
 *   statePrecedence: [paperclip, jira, github, clickup]   # optional override
 *   fields:
 *     issue.summary:
 *       mode: single
 *       owner: jira
 *       mirrorPolicy: read_only_on_remote
 *     comment.body:
 *       mode: tier2
 *       writers: [paperclip, jira]
 *     issue.state:
 *       mode: creator
 *       fallback: paperclip
 *       mirrorPolicy: translated_mirror_state
 */
export interface LoadOwnershipOptions {
  /** Override the default base table (§4). */
  readonly base?: ReadonlyMap<string, OwnershipRule>;
  /** Override the project root used when computing tenant paths. */
  readonly rootDir?: string;
}

export function tenantOwnershipPath(
  tenantSlug: string,
  rootDir = process.cwd(),
): string {
  if (!isValidTenantSlug(tenantSlug))
    throw new OwnershipLoadError(`invalid tenant slug: "${tenantSlug}"`);
  return resolve(
    rootDir,
    'forge',
    'sync-plane',
    'tenants',
    tenantSlug,
    'ownership.yaml',
  );
}

export function isValidTenantSlug(s: string): boolean {
  return /^[a-z][a-z0-9-]{0,62}$/.test(s);
}

export function loadOwnership(
  tenantSlug: string,
  options: LoadOwnershipOptions = {},
): OwnershipTable {
  const path = tenantOwnershipPath(tenantSlug, options.rootDir);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new OwnershipLoadError(
      `cannot read ownership.yaml for tenant "${tenantSlug}" at ${path}: ${(err as Error).message}`,
    );
  }
  return parseOwnership(tenantSlug, raw, options.base);
}

export function parseOwnership(
  tenantSlug: string,
  yamlText: string,
  base?: ReadonlyMap<string, OwnershipRule>,
): OwnershipTable {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    throw new OwnershipLoadError(
      `tenant "${tenantSlug}" ownership.yaml is not valid YAML: ${(err as Error).message}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OwnershipLoadError(
      `tenant "${tenantSlug}" ownership.yaml must be a mapping at the root`,
    );
  }
  const obj = parsed as Record<string, unknown>;
  if (obj['version'] !== 1) {
    throw new OwnershipLoadError(
      `tenant "${tenantSlug}" ownership.yaml: only version=1 is supported (got ${JSON.stringify(obj['version'])})`,
    );
  }

  const merged = new Map<string, OwnershipRule>(base ?? defaultOwnershipFields());
  const fieldsRaw = obj['fields'];
  if (fieldsRaw !== undefined) {
    if (typeof fieldsRaw !== 'object' || fieldsRaw === null || Array.isArray(fieldsRaw)) {
      throw new OwnershipLoadError(
        `tenant "${tenantSlug}" ownership.yaml: "fields" must be a mapping`,
      );
    }
    for (const [field, ruleRaw] of Object.entries(
      fieldsRaw as Record<string, unknown>,
    )) {
      merged.set(field, parseRule(tenantSlug, field, ruleRaw));
    }
  }

  let statePrecedence: readonly Platform[] = DEFAULT_STATE_PRECEDENCE;
  const spRaw = obj['statePrecedence'];
  if (spRaw !== undefined) {
    if (!Array.isArray(spRaw)) {
      throw new OwnershipLoadError(
        `tenant "${tenantSlug}" ownership.yaml: "statePrecedence" must be an array`,
      );
    }
    const sp: Platform[] = [];
    for (const p of spRaw) {
      if (!isPlatform(p))
        throw new OwnershipLoadError(
          `tenant "${tenantSlug}" statePrecedence has unknown platform: ${JSON.stringify(p)}`,
        );
      sp.push(p);
    }
    statePrecedence = sp;
  }

  return {
    tenantSlug,
    statePrecedence,
    fields: merged,
  };
}

function parseRule(tenant: string, field: string, raw: unknown): OwnershipRule {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new OwnershipLoadError(
      `tenant "${tenant}" field "${field}": rule must be a mapping`,
    );
  }
  const r = raw as Record<string, unknown>;
  const mode = r['mode'];
  if (mode === 'single') {
    if (!isPlatform(r['owner']))
      throw new OwnershipLoadError(
        `tenant "${tenant}" field "${field}": "single" mode requires an "owner" platform`,
      );
    const mirrorPolicy = r['mirrorPolicy'] ?? 'read_only_on_remote';
    if (!isMirrorPolicy(mirrorPolicy))
      throw new OwnershipLoadError(
        `tenant "${tenant}" field "${field}": unknown mirrorPolicy ${JSON.stringify(r['mirrorPolicy'])}`,
      );
    return { mode: 'single', owner: r['owner'] as Platform, mirrorPolicy };
  }
  if (mode === 'creator') {
    if (!isPlatform(r['fallback']))
      throw new OwnershipLoadError(
        `tenant "${tenant}" field "${field}": "creator" mode requires a "fallback" platform`,
      );
    const mirrorPolicy = r['mirrorPolicy'] ?? 'translated_mirror_state';
    if (!isMirrorPolicy(mirrorPolicy))
      throw new OwnershipLoadError(
        `tenant "${tenant}" field "${field}": unknown mirrorPolicy ${JSON.stringify(r['mirrorPolicy'])}`,
      );
    return { mode: 'creator', fallback: r['fallback'] as Platform, mirrorPolicy };
  }
  if (mode === 'tier2') {
    const writersRaw = r['writers'] ?? [];
    if (!Array.isArray(writersRaw))
      throw new OwnershipLoadError(
        `tenant "${tenant}" field "${field}": "writers" must be an array`,
      );
    const writers: Platform[] = [];
    for (const w of writersRaw) {
      if (!isPlatform(w))
        throw new OwnershipLoadError(
          `tenant "${tenant}" field "${field}": unknown platform in writers: ${JSON.stringify(w)}`,
        );
      writers.push(w);
    }
    return { mode: 'tier2', writers };
  }
  throw new OwnershipLoadError(
    `tenant "${tenant}" field "${field}": unknown mode ${JSON.stringify(mode)}`,
  );
}

function isPlatform(v: unknown): v is Platform {
  return typeof v === 'string' && (KNOWN_PLATFORMS as readonly string[]).includes(v);
}

function isMirrorPolicy(v: unknown): v is MirrorPolicy {
  return (
    v === 'read_only_on_remote' ||
    v === 'reverse_mirror_with_tag' ||
    v === 'translated_mirror_state'
  );
}

/** Build an in-memory table without hitting disk — useful in tests + tools. */
export function buildOwnershipTable(
  tenantSlug: string,
  overrides: Record<string, OwnershipRule> = {},
  statePrecedence: readonly Platform[] = DEFAULT_STATE_PRECEDENCE,
): OwnershipTable {
  const merged = new Map<string, OwnershipRule>(defaultOwnershipFields());
  for (const [k, v] of Object.entries(overrides)) merged.set(k, v);
  return { tenantSlug, statePrecedence, fields: merged };
}
