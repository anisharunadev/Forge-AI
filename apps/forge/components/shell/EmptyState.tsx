import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * EmptyState — the standard empty-state primitive.
 *
 * Used for: no data yet, filtered to nothing, no rows on a page.
 *
 * Visual contract:
 *   - Centered column inside a dashed border rounded box
 *   - Icon (optional) in a 12x12 muted-bg circle
 *   - Title (h3) below the icon
 *   - Optional muted description
 *   - Optional CTA (right-aligned under the description)
 *
 * Tokens used: border-border, bg-muted, text-foreground,
 * text-muted-foreground. No `forge-*` literal classes.
 */

export interface EmptyStateProps {
  /** Optional leading icon. */
  icon?: React.ReactNode;
  /** Headline (h3). */
  title: string;
  /** Optional supporting copy. */
  description?: string;
  /** Optional CTA. */
  action?: React.ReactNode;
  /** Optional data-testid passthrough (default: "empty-state"). */
  testId?: string;
  /** Extra classes appended to the root. */
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  testId = 'empty-state',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-6 py-12 text-center',
        className,
      )}
      data-testid={testId}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          {icon}
        </span>
      ) : null}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}