/**
 * StageEmptyState — the empty state of a workflow stage.
 *
 * The audit flagged that empty states were inconsistent across the
 * nine centers — some showed a CTA, some showed nothing, some
 * silently rendered an empty table. The workflow shell unifies
 * those into a single typed empty state with:
 *
 *   - icon (optional)
 *   - title (required)
 *   - description (optional)
 *   - primary CTA (optional, deep-link to the action)
 *
 * Every CTA preserves the existing `data-testid` convention so e2e
 * tests can find it without per-stage selectors.
 */

import * as React from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface StageEmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly ctaHref?: string;
  readonly ctaLabel?: string;
  readonly icon?: React.ReactNode;
  readonly className?: string;
}

export function StageEmptyState({
  title,
  description,
  ctaHref,
  ctaLabel,
  icon,
  className,
}: StageEmptyStateProps) {
  return (
    <div
      role="status"
      data-testid="workflow-stage-empty"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {ctaHref && ctaLabel ? (
        <Button asChild variant="default" size="sm">
          <Link
            href={ctaHref}
            data-testid="workflow-stage-empty-cta"
            aria-label={ctaLabel}
          >
            {ctaLabel}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}