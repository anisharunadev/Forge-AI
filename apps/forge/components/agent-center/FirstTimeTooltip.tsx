'use client';

/**
 * Agent Center — Floating "First-time?" tooltip (Step 43 / Addition 5).
 *
 * Appears 3 seconds after the explainer hero mounts, dismisses
 * automatically after 10 seconds, and respects a localStorage flag so
 * it never returns once dismissed. Anchored to the bottom-right of
 * the explainer so it visually points to the Guided Setup button.
 *
 * Constraints adopted from skill searches:
 *   - "Progressive disclosure" + "skip tutorials" — auto-dismisses
 *     and stores the dismissal so we never nag the same user twice.
 *   - Lucide Hand icon (no emoji wave — per design system checklist).
 *   - Honours prefers-reduced-motion via the global CSS gate.
 */

import * as React from 'react';
import { Hand, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'forge.agent-center.first-run-tooltip.dismissed';
const SHOW_DELAY_MS = 3000;
const AUTO_DISMISS_MS = 10_000;

export interface FirstTimeTooltipProps {
  /** When false the tooltip is suppressed entirely (post-first-run state). */
  enabled: boolean;
  /** Tooltip body — kept short and actionable. */
  message?: string;
  /** CTA label. */
  ctaLabel?: string;
  /** Fired when the user clicks the CTA. */
  onActivate?: () => void;
}

export function FirstTimeTooltip({
  enabled,
  message = 'New to agents? Take the 2-minute tour.',
  ctaLabel = 'Start tour',
  onActivate,
}: FirstTimeTooltipProps) {
  const [visible, setVisible] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(true);

  // Read the persisted dismissal flag exactly once on mount.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  // Schedule the show + auto-dismiss timers.
  React.useEffect(() => {
    if (!enabled || dismissed) return;
    const showTimer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    const hideTimer = window.setTimeout(() => handleDismiss(), AUTO_DISMISS_MS);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, dismissed]);

  const handleDismiss = React.useCallback(() => {
    setVisible(false);
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore quota errors */
    }
  }, []);

  if (!enabled || dismissed || !visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="first-time-tooltip"
      className={cn(
        'pointer-events-auto relative mt-3 flex items-start gap-3 rounded-[var(--radius-md)] border',
        'border-[var(--accent-cyan)]/40 bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-lg)]',
        'animate-[fade-slide-up_220ms_var(--motion-ease-out)_both]',
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[rgba(34,211,238,0.15)] text-[var(--accent-cyan)]"
      >
        <Hand className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="flex-1 text-sm text-[var(--fg-secondary)]">{message}</div>
      <div className="flex items-center gap-2">
        {onActivate ? (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onActivate();
              handleDismiss();
            }}
            data-testid="first-time-tooltip-cta"
            className="h-8 bg-[var(--accent-primary)] px-3 text-xs text-white hover:opacity-90"
          >
            {ctaLabel}
          </Button>
        ) : null}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss tooltip"
          data-testid="first-time-tooltip-close"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
