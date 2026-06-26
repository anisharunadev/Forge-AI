/**
 * Forge-core skill manifest reader.
 *
 * `packages/forge-core/forge-core.catalog.json` is the authoritative
 * manifest of every `forge-*` skill the platform ships. The Command
 * Center reads from this manifest to render Catalog mode, surface the
 * "Featured / Recently used / Suggested for your tickets" rails, and
 * to map each skill to a GSD phase.
 *
 * Because the catalog JSON lives in a sibling package and the dashboard
 * is a Next.js client bundle, we cannot read it from `fs` at runtime.
 * Instead, the catalog is imported via a static re-export below and
 * passed through the typed shapes defined here.
 *
 * Rules respected (from `.claude/CLAUDE.md`):
 *   - Rule 1: provider-agnostic — no SDK imports here, just metadata.
 *   - Rule 4: typed artifacts only — every helper returns a typed
 *     object; no free-form blobs.
 *   - Rule 6: auditable — `lastUsedAt` / `runCount` fields are
 *     surfaced so audit timeline can correlate.
 */

import catalog from '@forge-ai/forge-core/forge-core.catalog.json';

/** Phase bucket — drives the catalog group rail and the GSD pipeline. */
export type ForgePhase =
  | 'discovery'
  | 'planning'
  | 'execution'
  | 'verification'
  | 'deployment'
  | 'audit'
  | 'maintenance';

export type ForgeSkillCategory =
  | 'testing'
  | 'operational'
  | 'development'
  | 'architecture'
  | 'workflow'
  | 'security'
  | 'deployment'
  | 'ideation'
  | 'milestones'
  | 'review'
  | 'onboarding';

export interface ForgeSkill {
  /** Stable id used everywhere — e.g. `forge-execute-phase`. */
  readonly id: string;
  /** Slash-command surface — e.g. `forge:execute-phase`. */
  readonly command: string;
  readonly label: string;
  readonly description: string;
  readonly category: ForgeSkillCategory;
  readonly icon: string;
  readonly estimatedDurationSec: number;
  readonly phase: ForgePhase;
  readonly sourceFile: string;
  readonly skillFile: string;
  readonly requires: ReadonlyArray<string>;
  readonly argumentHint: string;
}

interface RawFrontmatter {
  name?: string;
  description?: string;
  'argument-hint'?: string | string[];
  requires?: string[];
}

interface RawCommand {
  id: string;
  name: string;
  label: string;
  description: string;
  category: string;
  icon: string;
  estimatedDuration: number;
  sourceFile: string;
  skillFile: string;
  frontmatter?: RawFrontmatter;
}

interface RawCatalog {
  $schema?: string;
  generatedAt?: string;
  engineVersion?: string;
  commandCount?: number;
  commands: RawCommand[];
}

/* ---------------------------------------------------------------------------
 * Phase mapping — recommended mapping from the design brief. Every skill
 * gets routed to one of seven GSD phases. The mapping is name-prefix based
 * with category fallback so new skills added to the catalog pick up a
 * sensible bucket automatically.
 * ------------------------------------------------------------------------- */

function inferPhase(cmd: RawCommand): ForgePhase {
  const id = cmd.id.toLowerCase();
  if (
    id.includes('spike') ||
    id.includes('capture') ||
    id.includes('explore') ||
    id.includes('brainstorm') ||
    id.includes('ideation')
  ) {
    return 'discovery';
  }
  if (
    id.includes('plan') ||
    id.includes('discuss') ||
    id.includes('ultraplan') ||
    id.includes('spec')
  ) {
    return 'planning';
  }
  if (
    id.includes('execute') ||
    id.includes('ui-phase') ||
    id.includes('ai-integration') ||
    id.includes('add-test') ||
    id.includes('debug') ||
    id.includes('dev-')
  ) {
    return 'execution';
  }
  if (
    id.includes('verify') ||
    id.includes('validate') ||
    id.includes('eval-review') ||
    id.includes('review')
  ) {
    return 'verification';
  }
  if (id.includes('deploy') || id.includes('cleanup') || id.includes('ship')) {
    return 'deployment';
  }
  if (id.includes('audit')) {
    return 'audit';
  }
  return 'maintenance';
}

function normalizeCategory(raw: string): ForgeSkillCategory {
  switch (raw) {
    case 'testing':
    case 'operational':
    case 'development':
    case 'architecture':
    case 'workflow':
    case 'security':
    case 'deployment':
    case 'ideation':
    case 'milestones':
    case 'review':
    case 'onboarding':
      return raw;
    case 'code-review':
      return 'review';
    default:
      return 'operational';
  }
}

function normalizeHint(hint: string | string[] | undefined): string {
  if (!hint) return '';
  return Array.isArray(hint) ? hint.join(' ') : hint;
}

function toSkill(raw: RawCommand): ForgeSkill {
  const fm = raw.frontmatter ?? {};
  return {
    id: raw.id,
    command: fm.name ?? `forge:${raw.id.replace(/^forge-/, '')}`,
    label: raw.label,
    description: raw.description,
    category: normalizeCategory(raw.category),
    icon: raw.icon,
    estimatedDurationSec: raw.estimatedDuration ?? 60,
    phase: inferPhase(raw),
    sourceFile: raw.sourceFile,
    skillFile: raw.skillFile,
    requires: fm.requires ?? [],
    argumentHint: normalizeHint(fm['argument-hint']),
  };
}

const rawCatalog = catalog as RawCatalog;

export const FORGE_SKILLS: ReadonlyArray<ForgeSkill> = rawCatalog.commands.map(
  toSkill,
);

/* ---------------------------------------------------------------------------
 * Phase-order — drives the horizontal pipeline in Ticket Mode and the
 * vertical tracker in Spec Mode.
 * ------------------------------------------------------------------------- */

export const FORGE_PHASES: ReadonlyArray<{
  id: ForgePhase;
  label: string;
  short: string;
  description: string;
  icon: string;
  accent: 'cyan' | 'indigo' | 'emerald' | 'amber' | 'violet' | 'rose' | 'slate';
}> = [
  {
    id: 'discovery',
    label: 'Discovery',
    short: 'Spike',
    description: 'Capture, explore, and validate the problem space.',
    icon: 'Compass',
    accent: 'violet',
  },
  {
    id: 'planning',
    label: 'Planning',
    short: 'Plan',
    description: 'Generate execution plan, sub-tasks, and dependencies.',
    icon: 'ClipboardList',
    accent: 'cyan',
  },
  {
    id: 'execution',
    label: 'Execution',
    short: 'Execute',
    description: 'Build the phase — code, agents, tests, integrations.',
    icon: 'Hammer',
    accent: 'indigo',
  },
  {
    id: 'verification',
    label: 'Verification',
    short: 'Verify',
    description: 'Run automated + manual verification against UAT criteria.',
    icon: 'CheckCircle2',
    accent: 'emerald',
  },
  {
    id: 'deployment',
    label: 'Deployment',
    short: 'Deploy',
    description: 'Ship behind a flag, monitor, and roll forward.',
    icon: 'Rocket',
    accent: 'amber',
  },
  {
    id: 'audit',
    label: 'Audit',
    short: 'Audit',
    description: 'Cross-phase audit against intent and standards.',
    icon: 'ShieldCheck',
    accent: 'rose',
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    short: 'Polish',
    description: 'Docs, config, and ongoing updates.',
    icon: 'Wrench',
    accent: 'slate',
  },
] as const;

/* ---------------------------------------------------------------------------
 * Derived selectors
 * ------------------------------------------------------------------------- */

const PHASE_SKILLS_CACHE: Record<ForgePhase, ReadonlyArray<ForgeSkill>> =
  Object.create(null);

export function skillsByPhase(phase: ForgePhase): ReadonlyArray<ForgeSkill> {
  if (!PHASE_SKILLS_CACHE[phase]) {
    PHASE_SKILLS_CACHE[phase] = FORGE_SKILLS.filter((s) => s.phase === phase);
  }
  return PHASE_SKILLS_CACHE[phase];
}

export function skillById(id: string): ForgeSkill | undefined {
  return FORGE_SKILLS.find((s) => s.id === id);
}

export function searchSkills(query: string): ReadonlyArray<ForgeSkill> {
  const q = query.trim().toLowerCase();
  if (!q) return FORGE_SKILLS;
  return FORGE_SKILLS.filter(
    (s) =>
      s.id.toLowerCase().includes(q) ||
      s.label.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.category.includes(q),
  );
}

export interface SkillUsageStat {
  readonly skillId: string;
  readonly runCount: number;
  readonly lastUsedAt: string; // ISO
  readonly teamLast7d: number;
}

/**
 * Mock usage stats — drives the "Featured" + "Recently used by your team"
 * rails. Real wiring would hit `/api/forge/skills/usage`; we keep the
 * shape stable so the swap is trivial.
 */
export const SAMPLE_USAGE: ReadonlyArray<SkillUsageStat> = [
  { skillId: 'forge-execute-phase', runCount: 184, lastUsedAt: '2026-06-26T08:14:00Z', teamLast7d: 42 },
  { skillId: 'forge-plan-phase', runCount: 162, lastUsedAt: '2026-06-26T07:51:00Z', teamLast7d: 38 },
  { skillId: 'forge-verify-phase', runCount: 141, lastUsedAt: '2026-06-25T19:02:00Z', teamLast7d: 31 },
  { skillId: 'forge-spike', runCount: 88, lastUsedAt: '2026-06-25T16:11:00Z', teamLast7d: 19 },
  { skillId: 'forge-add-tests', runCount: 76, lastUsedAt: '2026-06-25T13:48:00Z', teamLast7d: 17 },
  { skillId: 'forge-validate-phase', runCount: 64, lastUsedAt: '2026-06-24T22:30:00Z', teamLast7d: 14 },
  { skillId: 'forge-audit-uat', runCount: 51, lastUsedAt: '2026-06-24T11:20:00Z', teamLast7d: 11 },
  { skillId: 'forge-deploy', runCount: 47, lastUsedAt: '2026-06-23T18:00:00Z', teamLast7d: 9 },
  { skillId: 'forge-debug', runCount: 38, lastUsedAt: '2026-06-23T10:45:00Z', teamLast7d: 8 },
  { skillId: 'forge-review', runCount: 33, lastUsedAt: '2026-06-22T15:30:00Z', teamLast7d: 7 },
];

export function featuredSkills(limit = 6): ReadonlyArray<ForgeSkill> {
  const ids = new Set(SAMPLE_USAGE.slice(0, limit).map((s) => s.skillId));
  return FORGE_SKILLS.filter((s) => ids.has(s.id));
}

export function recentlyUsedByTeam(limit = 4): ReadonlyArray<ForgeSkill> {
  const ids = new Set(
    [...SAMPLE_USAGE]
      .sort((a, b) => b.teamLast7d - a.teamLast7d)
      .slice(0, limit)
      .map((s) => s.skillId),
  );
  return FORGE_SKILLS.filter((s) => ids.has(s.id));
}

export function usageFor(skillId: string): SkillUsageStat | undefined {
  return SAMPLE_USAGE.find((u) => u.skillId === skillId);
}

/* ---------------------------------------------------------------------------
 * Kanban-column → phase bridge.
 *
 * Stories Center exposes a 6-column kanban (backlog → done, plus
 * blocked). ForgeRunActions wants to surface "automate this column"
 * affordances that list the skills that *typically* fire when a card
 * enters that column. We map columns to the closest GSD phase and
 * reuse the existing `skillsByPhase` selector.
 *
 * Kept here (not in `lib/stories/`) so the manifest remains the single
 * source of truth for "what skills live in which phase".
 * ------------------------------------------------------------------------- */

const STATUS_TO_PHASE: Record<string, ForgePhase> = {
  backlog: 'discovery',
  todo: 'planning',
  in_progress: 'execution',
  in_review: 'verification',
  done: 'deployment',
  blocked: 'maintenance',
};

export function phaseFor(status: string): ReadonlyArray<ForgeSkill> {
  const phase = STATUS_TO_PHASE[status] ?? 'maintenance';
  return skillsByPhase(phase);
}

export function phaseLabel(status: string): string {
  const phase = STATUS_TO_PHASE[status] ?? 'maintenance';
  return FORGE_PHASES.find((p) => p.id === phase)?.label ?? phase;
}

/**
 * Estimated wall-clock minutes for a phase, derived as the average of
 * `estimatedDurationSec` across every skill in that phase. Falls back
 * to 5 minutes when the phase is empty so UI never renders `~0m`.
 */
export function phaseEstimatedMinutes(status: string): number {
  const phase = STATUS_TO_PHASE[status] ?? 'maintenance';
  const skills = skillsByPhase(phase);
  if (skills.length === 0) return 5;
  const avgSec =
    skills.reduce((sum, s) => sum + s.estimatedDurationSec, 0) / skills.length;
  return Math.max(1, Math.round(avgSec / 60));
}
