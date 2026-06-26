'use client';

/**
 * ErrorState — the canonical, a11y-first error surface for Forge AI.
 *
 * Visual contract:
 *   - 80×80 square tile in --bg-elevated with --radius-xl
 *   - AlertOctagon 32px in --accent-rose with `animate-pulse` (gated by
 *     the global prefers-reduced-motion guard)
 *   - h3 title + supporting copy
 *   - Two actions: primary (Try again) + ghost (Back to dashboard)
 *   - role="alert" + aria-live="assertive" so screen readers
 *     announce the failure immediately
 *
 * Used wherever a backend seam returns an unreachable state. In the
 * Settings page (Center #9) the General tab uses this when the
 * project-info endpoint hasn't shipped yet.
 */

import * as React from 'react';
import Link from 'next/link';
import { AlertOctagon, RefreshCw, ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';

export interface ErrorStateProps {
  /** Headline (h3). */
  title: string;
  /** Supporting copy explaining what failed and why. */
  description?: string;
  /** Try-again label (default: "Try again"). */
  retryLabel?: string;
  /** Try-again callback. When omitted, a Back-to-dashboard link is shown. */
  onRetry?: () => void;
  /** Back-to-dashboard label (default: "Back to dashboard"). */
  backLabel?: string;
  /** Optional override href for the back link (default: "/dashboard"). */
  backHref?: string;
  /** Optional className passthrough. */
  className?: string;
  /** Optional data-testid. */
  testId?: string;
}

export function ErrorState({
  title,
  description,
  retryLabel = 'Try again',
  onRetry,
  backLabel = 'Back to dashboard',
  backHref = '/dashboard',
  className,
  testId = 'error-state',
}: ErrorStateProps) {
  const [retrying, setRetrying] = React.useState(false);

  const handleRetry = React.useCallback(async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try {
      await Promise.resolve(onRetry());
    } finally {
      window.setTimeout(() => setRetrying(false), 600);
    }
  }, [onRetry, retrying]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={
        'rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 ' +
        (className ?? '')
      }
      data-testid={testId}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <span
          aria-hidden="true"
          className="inline-flex h-20 w-20 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--bg-elevated)] text-[var(--accent-rose)]"
        >
          <AlertOctagon className="h-8 w-8 animate-pulse" aria-hidden="true" />
        </span>
        <h3 className="text-[var(--text-md)] font-semibold text-[var(--fg-primary)]">
          {title}
        </h3>
        {description ? (
          <p className="max-w-md text-[var(--text-sm)] text-[var(--fg-secondary)]">
            {description}
          </p>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          {onRetry ? (
            <Button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              data-testid={`${testId}-retry`}
            >
              <RefreshCw
                className={
                  retrying
                    ? 'h-3.5 w-3.5 animate-spin'
                    : 'h-3.5 w-3.5'
                }
                aria-hidden="true"
              />
              {retrying ? 'Retrying…' : retryLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            asChild
            data-testid={`${testId}-back`}
          >
            <Link href={backHref}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              {backLabel}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}