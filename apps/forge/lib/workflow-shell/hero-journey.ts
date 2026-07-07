/**
 * Hero Journey — the spec → code → PR journey that is the product.
 *
 * Per M20 (Phase C — Experience), the workflow shell now exposes a
 * continuous "hero journey" surface: a persistent banner that
 * shows where the user is in the Idea → PR journey, how long
 * they've been at it, and what the next step is.
 *
 * This module is pure: it derives progress + next-step hints from
 * the underlying workflow state. The component layer (`HeroJourney
 * Banner`) renders it. Time tracking uses `localStorage` so the
 * journey survives page navigations.
 *
 * The hero journey is intentionally narrow — eight steps. Every
 * other capability in Forge (audit, knowledge, connectors, etc.)
 * exists to serve one of these eight steps.
 */

import type { WorkflowStageId } from './types';

/** The eight hero steps — the product's reason for existing. */
export const HERO_STEPS: ReadonlyArray<{
  readonly id: WorkflowStageId | 'deploy';
  readonly label: string;
  readonly path: string;
  readonly oneLiner: string;
}> = [
  {
    id: 'idea',
    label: 'Capture the idea',
    path: '/workflow/idea',
    oneLiner: 'Type the product idea in one paragraph.',
  },
  {
    id: 'prd',
    label: 'Generate the PRD',
    path: '/workflow/prd',
    oneLiner: 'Forge expands the idea into user stories + acceptance criteria.',
  },
  {
    id: 'architecture',
    label: 'Approve architecture',
    path: '/workflow/architecture',
    oneLiner: 'Review ADRs, contracts, and risks. Approve or revise.',
  },
  {
    id: 'tasks',
    label: 'Break down tasks',
    path: '/workflow/tasks',
    oneLiner: 'Forge produces implementation tasks with estimates + deps.',
  },
  {
    id: 'approval',
    label: 'Approve the plan',
    path: '/workflow/approval',
    oneLiner: 'Sign off. The plan becomes the contract for the run.',
  },
  {
    id: 'develop',
    label: 'AI develops',
    path: '/workflow/develop',
    oneLiner: 'Agents execute the plan against your connected repository.',
  },
  {
    id: 'pr',
    label: 'Open the PR',
    path: '/workflow/pr',
    oneLiner: 'Review the generated PR with the spec → code trace.',
  },
  {
    id: 'deploy',
    label: 'Deploy',
    path: '/admin/cost',
    oneLiner: 'Ship it. Forge keeps the audit chain intact.',
  },
] as const;

/** localStorage key for the journey start timestamp. */
export const HERO_JOURNEY_START_KEY = 'forge.heroJourney.start';

/** Persist the journey start to localStorage. Idempotent — only sets
 *  if no start has been recorded yet. */
export function markJourneyStart(now: number = Date.now()): number {
  if (typeof window === 'undefined') return now;
  try {
    const existing = window.localStorage.getItem(HERO_JOURNEY_START_KEY);
    if (existing !== null) {
      const parsed = Number(existing);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    window.localStorage.setItem(HERO_JOURNEY_START_KEY, String(now));
    return now;
  } catch {
    return now;
  }
}

/** Read the journey start; returns null if never started. */
export function readJourneyStart(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(HERO_JOURNEY_START_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** Reset the journey (e.g. when the user explicitly "starts over"). */
export function clearJourneyStart(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(HERO_JOURNEY_START_KEY);
  } catch {
    /* swallow — localStorage may be unavailable in private mode */
  }
}

/** Format a duration (ms) as "1h 23m" / "12m 34s" / "8s". */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes.toString().padStart(2, '0')}m`;
}

/** Return the next hero step after the given stage. `null` past deploy. */
export function getNextHeroStep(stage: WorkflowStageId): {
  readonly id: WorkflowStageId | 'deploy';
  readonly label: string;
  readonly path: string;
  readonly oneLiner: string;
} | null {
  const idx = HERO_STEPS.findIndex((s) => s.id === stage);
  if (idx < 0 || idx >= HERO_STEPS.length - 1) return null;
  return HERO_STEPS[idx + 1] ?? null;
}