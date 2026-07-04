'use client';

/**
 * RunBudgetBadge — per-RUN USD ceiling / spent surface (M2 ADR-009).
 *
 * Drives the operator's "is this run about to blow the budget?" signal
 * surfaced on the Runs Center page (T-B7 wires it via
 * `GET /api/v1/runs/{run_id}/budget`).
 *
 * Visual contract:
 *   - Always renders "Run budget: $X / Used: $Y" so the badge carries
 *     its own context (no color-only signal).
 *   - StatusPill flips to the `warn` tone when spent/ceiling >= 0.80
 *     so a run approaching the cap is visible at a glance.
 *   - Negative or NaN inputs are clamped to zero — defensive against
 *     upstream partial-fetch states (a tenant mid-bootstrap that
 *     returns no rows yet).
 *
 * Semantic tokens only — every class is a `var(--…)` token (R12,
 * cross-cutting concerns) so a brand refresh in
 * `forge-color-tokens.ts` cascades without touching callers.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';
import { StatusPill } from '@/components/shell/StatusPill';

export interface RunBudgetBadgeProps {
  /** Declared per-RUN ceiling in USD. */
  ceilingUsd: number;
  /** Confirmed spend (`projected=false`) for the run in USD. */
  spentUsd: number;
  /** Optional className passthrough for layout. */
  className?: string;
  /** Optional id passthrough. */
  id?: string;
}

const WARN_THRESHOLD = 0.8;

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '$0.00';
  // Use a 2-decimal fixed format for small ceilings (<$1) so $0.50 reads
  // correctly; fall back to a compact "$X" for very large ceilings to
  // avoid a row that overflows on mobile.
  if (value < 1) return `$${value.toFixed(2)}`;
  if (value >= 10_000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
}

export function RunBudgetBadge({
  ceilingUsd,
  spentUsd,
  className,
  id,
}: RunBudgetBadgeProps) {
  const ceiling = Math.max(0, Number.isFinite(ceilingUsd) ? ceilingUsd : 0);
  const spent = Math.max(0, Number.isFinite(spentUsd) ? spentUsd : 0);
  const ratio = ceiling > 0 ? spent / ceiling : 0;
  const warn = ratio >= WARN_THRESHOLD;
  const label = warn ? 'At cap' : 'On budget';
  const tone = warn ? 'warn' : 'success';
  const glyph = warn ? '◑' : '✓';

  return (
    <div
      id={id}
      data-testid="run-budget-badge"
      data-warn={warn ? 'true' : 'false'}
      className={cn(
        'inline-flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5',
        className,
      )}
    >
      <span className="flex items-baseline gap-1.5 text-xs text-[var(--fg-secondary)]">
        <span className="font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
          Run budget
        </span>
        <span className="font-mono tabular-nums text-[var(--fg-primary)]">
          {formatUsd(ceiling)}
        </span>
        <span className="text-[var(--fg-tertiary)]" aria-hidden="true">
          /
        </span>
        <span className="font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
          Used
        </span>
        <span
          className="font-mono tabular-nums text-[var(--fg-primary)]"
          data-testid="run-budget-spent"
        >
          {formatUsd(spent)}
        </span>
      </span>
      <StatusPill
        tone={tone}
        glyph={glyph}
        label={label}
        size="sm"
        data-testid="run-budget-pill"
        data-tone={tone}
      />
    </div>
  );
}

export default RunBudgetBadge;