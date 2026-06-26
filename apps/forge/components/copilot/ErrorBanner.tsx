'use client';

/**
 * Step 37 — Small dismissible error banner.
 *
 * Replaces the large "Couldn't load conversations" card that used to
 * dominate the panel. Renders as a compact one-liner just below the
 * header — non-blocking, dismissible, with a Retry action that sits
 * inline with the message (the panel header stays clean).
 *
 * Design rules applied (ui-ux-pro-max):
 *   - "Error states" — non-blocking toasts/banners, not full-page
 *     takeovers, when the action surface is still usable.
 *   - "Heading hierarchy" — single-line text, no promoted heading;
 *     the panel above is still the focal surface.
 *   - "Show helpful message and action" — every banner ships a verb
 *     the user can take right now (Retry / Start new chat).
 */

import * as React from 'react';
import { AlertCircle, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ErrorBannerProps {
  /** Primary message — short, action-oriented. */
  message: string;
  /** Optional sub-message in lighter type. */
  detail?: string;
  /** Label for the inline action button. */
  actionLabel?: string;
  /** Optional secondary action (rendered as a ghost button). */
  secondaryLabel?: string;
  onAction?: () => void;
  onSecondary?: () => void;
  /** Optional test id override. */
  testId?: string;
  className?: string;
}

/**
 * Inline error banner — small, dismissible, non-blocking.
 *
 * Visual contract: h-32px single-line on desktop; gracefully wraps to
 * two lines if the message is long. `--bg-rose` tint, never solid.
 */
export function ErrorBanner({
  message,
  detail,
  actionLabel = 'Retry',
  secondaryLabel,
  onAction,
  onSecondary,
  testId = 'copilot-error-banner',
  className,
}: ErrorBannerProps) {
  const [dismissed, setDismissed] = React.useState(false);

  if (dismissed) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid={testId}
      className={cn(
        'flex items-center gap-2 border-b border-[var(--accent-rose)]/30 bg-[var(--accent-rose)]/10 px-3 py-2 text-[var(--text-xs)] text-[var(--fg-secondary)]',
        className,
      )}
    >
      <AlertCircle
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-[var(--accent-rose)]"
      />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-[var(--fg-primary)]">{message}</span>
        {detail ? (
          <span className="hidden truncate text-[var(--fg-tertiary)] sm:inline">
            {detail}
          </span>
        ) : null}
      </div>
      {onAction ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] font-medium text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/15"
          onClick={onAction}
          data-testid={`${testId}-action`}
        >
          {actionLabel}
        </Button>
      ) : null}
      {onSecondary && secondaryLabel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)]"
          onClick={onSecondary}
          data-testid={`${testId}-secondary`}
        >
          {secondaryLabel}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-5 w-5 text-[var(--fg-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss error"
        data-testid={`${testId}-dismiss`}
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </Button>
    </div>
  );
}

export default ErrorBanner;
