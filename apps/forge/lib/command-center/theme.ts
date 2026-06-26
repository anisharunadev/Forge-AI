/**
 * Phase color tokens — central place so we don't repeat the lookup.
 *
 * Maps the FORGE_PHASES `accent` field to the matching CSS variable
 * defined in `globals.css` (`--accent-cyan`, `--accent-violet`, etc).
 *
 * Skill influence: `03-color.md` (dark-mode palette).
 */

import type { ForgePhase } from '../forge-core/manifest';

export const PHASE_ACCENT: Record<
  ForgePhase,
  {
    bg: string;
    fg: string;
    ring: string;
    chip: string;
    dot: string;
    label: string;
  }
> = {
  discovery: {
    bg: 'bg-[var(--accent-violet)]/15',
    fg: 'text-[var(--accent-violet)]',
    ring: 'ring-[var(--accent-violet)]/40',
    chip: 'border-[var(--accent-violet)]/30 bg-[var(--accent-violet)]/10 text-[var(--accent-violet)]',
    dot: 'bg-[var(--accent-violet)] shadow-[0_0_6px_var(--accent-violet)]',
    label: 'Discovery',
  },
  planning: {
    bg: 'bg-[var(--accent-cyan)]/15',
    fg: 'text-[var(--accent-cyan)]',
    ring: 'ring-[var(--accent-cyan)]/40',
    chip: 'border-[var(--accent-cyan)]/30 bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]',
    dot: 'bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan)]',
    label: 'Planning',
  },
  execution: {
    bg: 'bg-[var(--accent-primary)]/15',
    fg: 'text-[var(--accent-primary)]',
    ring: 'ring-[var(--accent-primary)]/40',
    chip: 'border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]',
    dot: 'bg-[var(--accent-primary)] shadow-[0_0_6px_var(--accent-primary)]',
    label: 'Execution',
  },
  verification: {
    bg: 'bg-[var(--accent-emerald)]/15',
    fg: 'text-[var(--accent-emerald)]',
    ring: 'ring-[var(--accent-emerald)]/40',
    chip: 'border-[var(--accent-emerald)]/30 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]',
    dot: 'bg-[var(--accent-emerald)] shadow-[0_0_6px_var(--accent-emerald)]',
    label: 'Verification',
  },
  deployment: {
    bg: 'bg-[var(--accent-amber)]/15',
    fg: 'text-[var(--accent-amber)]',
    ring: 'ring-[var(--accent-amber)]/40',
    chip: 'border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]',
    dot: 'bg-[var(--accent-amber)] shadow-[0_0_6px_var(--accent-amber)]',
    label: 'Deployment',
  },
  audit: {
    bg: 'bg-[var(--accent-rose)]/15',
    fg: 'text-[var(--accent-rose)]',
    ring: 'ring-[var(--accent-rose)]/40',
    chip: 'border-[var(--accent-rose)]/30 bg-[var(--accent-rose)]/10 text-[var(--accent-rose)]',
    dot: 'bg-[var(--accent-rose)] shadow-[0_0_6px_var(--accent-rose)]',
    label: 'Audit',
  },
  maintenance: {
    bg: 'bg-[var(--fg-tertiary)]/15',
    fg: 'text-[var(--fg-tertiary)]',
    ring: 'ring-[var(--fg-tertiary)]/40',
    chip: 'border-[var(--border-default)] bg-[var(--bg-inset)] text-[var(--fg-secondary)]',
    dot: 'bg-[var(--fg-tertiary)]',
    label: 'Maintenance',
  },
};

/**
 * Source badge tokens for ticket connectors (Jira / GitHub / Linear).
 */
export const TICKET_SOURCE_COLOR: Record<
  'jira' | 'github' | 'linear' | 'manual',
  { bg: string; fg: string; ring: string }
> = {
  jira: {
    bg: 'bg-[#0052CC]/15',
    fg: 'text-[#4C9AFF]',
    ring: 'ring-[#0052CC]/40',
  },
  github: {
    bg: 'bg-[#24292F]/40',
    fg: 'text-[#C9D1D9]',
    ring: 'ring-white/20',
  },
  linear: {
    bg: 'bg-[#5E6AD2]/15',
    fg: 'text-[#9DA8FA]',
    ring: 'ring-[#5E6AD2]/40',
  },
  manual: {
    bg: 'bg-[var(--bg-inset)]',
    fg: 'text-[var(--fg-secondary)]',
    ring: 'ring-[var(--border-default)]',
  },
};

export const TICKET_STATUS_COLOR: Record<string, string> = {
  backlog: 'text-[var(--fg-tertiary)] border-[var(--border-default)] bg-[var(--bg-inset)]',
  todo: 'text-[var(--fg-secondary)] border-[var(--border-default)] bg-[var(--bg-inset)]',
  'in-progress': 'text-[var(--accent-cyan)] border-[var(--accent-cyan)]/30 bg-[var(--accent-cyan)]/10',
  'in-review': 'text-[var(--accent-violet)] border-[var(--accent-violet)]/30 bg-[var(--accent-violet)]/10',
  done: 'text-[var(--accent-emerald)] border-[var(--accent-emerald)]/30 bg-[var(--accent-emerald)]/10',
  blocked: 'text-[var(--accent-rose)] border-[var(--accent-rose)]/30 bg-[var(--accent-rose)]/10',
};

export const SPEC_STATUS_COLOR: Record<string, string> = {
  drafting: 'text-[var(--accent-amber)] border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/10',
  planning: 'text-[var(--accent-cyan)] border-[var(--accent-cyan)]/30 bg-[var(--accent-cyan)]/10',
  executing: 'text-[var(--accent-primary)] border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10',
  completed: 'text-[var(--accent-emerald)] border-[var(--accent-emerald)]/30 bg-[var(--accent-emerald)]/10',
  archived: 'text-[var(--fg-tertiary)] border-[var(--border-default)] bg-[var(--bg-inset)]',
};

export const PRIORITY_COLOR: Record<string, string> = {
  p0: 'bg-[var(--accent-rose)]/15 text-[var(--accent-rose)] border-[var(--accent-rose)]/40',
  p1: 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)] border-[var(--accent-amber)]/40',
  p2: 'bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)] border-[var(--accent-cyan)]/40',
  p3: 'bg-[var(--bg-inset)] text-[var(--fg-secondary)] border-[var(--border-default)]',
};

/**
 * Compact number helper — "2.3k", "184", "60s".
 */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

/**
 * Friendly duration helper for sample data ("~5m", "~12s", "~2h").
 */
export function friendlyDuration(sec: number): string {
  if (sec < 60) return `~${Math.round(sec)}s`;
  if (sec < 3600) return `~${Math.round(sec / 60)}m`;
  return `~${(sec / 3600).toFixed(1)}h`;
}
