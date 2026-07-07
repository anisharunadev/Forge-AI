/**
 * StageLoadingSkeleton — the loading state of a workflow stage.
 *
 * Skeleton patterns are intentionally boring: a vertical stack of
 * rounded grey bars that mimic the eventual content shape. We avoid
 * spinners here because the workflow shell favors "show structure
 * now, fill in data later" — the user can see where text will land.
 *
 * Each stage passes a `rows` count so the skeleton matches the
 * density of the eventual table. Default is 4.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface StageLoadingSkeletonProps {
  readonly rows?: number;
  readonly className?: string;
}

export function StageLoadingSkeleton({
  rows = 4,
  className,
}: StageLoadingSkeletonProps) {
  const safeRows = Math.max(1, Math.min(rows, 12));
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-testid="workflow-stage-skeleton"
      className={cn('flex flex-col gap-3', className)}
    >
      <span className="sr-only">Loading workflow stage…</span>
      {Array.from({ length: safeRows }).map((_, idx) => (
        <div
          key={idx}
          className={cn(
            'h-12 rounded-md border border-border bg-card/40',
            idx === 0 ? 'w-3/4' : idx % 2 === 0 ? 'w-full' : 'w-5/6',
          )}
        />
      ))}
    </div>
  );
}