import type { RunStatus } from '@/lib/types';
import { StatusPill } from '@/components/shell';
import type { PulseKind, StateGlyph, StatusTone } from '@/lib/design-system/status';

/**
 * RunStatusBadge — thin wrapper around <StatusPill> for run lifecycle states.
 *
 * Color/glyph/pulse map to the curated spec (Phase 0.5 amendment §6):
 *   - created          → idle       ○    none
 *   - running          → execution  ●    active
 *   - waiting_approval → review     ◑    slow
 *   - paused           → execution  ●    slow
 *   - aborted          → danger     ✕    none
 *   - finished         → success    ✓    none
 *   - done             → success    ✓    none
 *
 * Back-compat: the `run-status-badge` testid and `data-status` attribute
 * are preserved on the underlying <StatusPill> root.
 */
const MAPPING: Record<RunStatus, { tone: StatusTone; glyph: StateGlyph; pulse: PulseKind; label: string }> = {
  created:          { tone: 'idle',      glyph: '○', pulse: 'none',   label: 'created' },
  running:          { tone: 'execution', glyph: '●', pulse: 'active', label: 'running' },
  waiting_approval: { tone: 'review',    glyph: '◑', pulse: 'slow',   label: 'waiting approval' },
  paused:           { tone: 'execution', glyph: '●', pulse: 'slow',   label: 'paused' },
  aborted:          { tone: 'danger',    glyph: '✕', pulse: 'none',   label: 'aborted' },
  finished:         { tone: 'success',   glyph: '✓', pulse: 'none',   label: 'finished' },
  done:             { tone: 'success',   glyph: '✓', pulse: 'none',   label: 'done' },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const m = MAPPING[status] ?? MAPPING.created;
  return (
    <StatusPill
      tone={m.tone}
      glyph={m.glyph}
      pulse={m.pulse}
      label={m.label}
      data-testid="run-status-badge"
      data-status={status}
    />
  );
}
