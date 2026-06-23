/**
 * StatusPill — single source of truth for state-bearing chips.
 *
 * Per the curated spec (Phase 0.5 amendment, 2026-5 amendment §6
 * "Agent Status Language"): a status pill MUST show a color, a glyph,
 * and a label. Color alone is never the only signal — accessibility
 * (WCAG 1.4.1) and dashboard scannability both require it.
 *
 * Color is read from `toneClasses[tone]` in `lib/design-system/status.ts`,
 * so a brand refresh in `forge-color-tokens.ts` cascades without touching
 * callers. Pulse is a Tailwind animation class; prefers-reduced-motion
 * is handled globally in `app/globals.css`.
 *
 * Sizing:
 *   - sm  : h-5  text-[11px] — for table rows, dense lists
 *   - md  : h-6  text-xs     — for headers, sidebars (default)
 *
 * Default radius is `rounded-md` (8px), matching the curated spec's
 * Card radius.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  toneClasses,
  type PulseKind,
  type StateGlyph,
  type StatusTone,
} from '@/lib/design-system/status';

export type StatusPillSize = 'sm' | 'md';

export interface StatusPillProps {
  /** The semantic tone. Drives bg / fg / ring classes via toneClasses. */
  tone: StatusTone;
  /** Optional glyph (auto-derived from tone if omitted). */
  glyph?: StateGlyph;
  /**
   * Pulse animation. Honor prefers-reduced-motion (handled globally;
   * the global stylesheet collapses animation-iteration-count to 1).
   */
  pulse?: PulseKind;
  /** Human-readable label — always rendered. */
  label: string;
  /** 'sm' = h-5 text-[11px]; 'md' = h-6 text-xs (default). */
  size?: StatusPillSize;
  /** Optional extra classes appended via cn(). */
  className?: string;
  /** Optional id passthrough. */
  id?: string;
}

/** Default glyph for each tone, per the curated spec. */
const toneGlyph: Record<StatusTone, StateGlyph> = {
  success:    '✓',
  warn:       '◑',
  danger:     '✕',
  info:       '◐',
  idle:       '○',
  agent:      '●',
  execution:  '●',
  review:     '◑',
  cost:       '◐',
};

/** Map a pulse kind to a Tailwind animate-* class. */
function pulseClass(pulse: PulseKind | undefined): string {
  switch (pulse) {
    case 'slow':
      return 'animate-pulse-agent';
    case 'active':
      return 'animate-spin-execution';
    case 'fast-to-static':
      // One-shot pulse; the global stylesheet forces iteration-count to 1
      // when prefers-reduced-motion is set.
      return 'animate-pulse';
    case 'none':
    case undefined:
    default:
      return '';
  }
}

function sizeClasses(size: StatusPillSize | undefined): string {
  switch (size) {
    case 'sm':
      return 'h-5 px-2 text-[11px] gap-1';
    case 'md':
    case undefined:
    default:
      return 'h-6 px-2.5 text-xs gap-1.5';
  }
}

/**
 * StatusPill — colored chip with mandatory glyph + label.
 *
 * @example
 *   <StatusPill tone="success" glyph="✓" label="Healthy" />
 *   <StatusPill tone="execution" pulse="active" label="Running" />
 */
export const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  function StatusPill(
    { tone, glyph, pulse, label, size = 'md', className, id, ...rest },
    ref,
  ) {
    const classes = toneClasses[tone];
    const resolvedGlyph = glyph ?? toneGlyph[tone];
    const animation = pulseClass(pulse);

    return (
      <span
        ref={ref}
        id={id}
        role="status"
        aria-label={label}
        data-testid="status-pill"
        data-tone={tone}
        data-pulse={pulse ?? 'none'}
        className={cn(
          'inline-flex select-none items-center rounded-md border font-medium',
          'ring-1 ring-inset',
          classes.bg,
          classes.fg,
          classes.ring,
          sizeClasses(size),
          animation,
          className,
        )}
        {...rest}
      >
        <span aria-hidden="true" className="inline-flex">
          {resolvedGlyph}
        </span>
        <span>{label}</span>
      </span>
    );
  },
);
