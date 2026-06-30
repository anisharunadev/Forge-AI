'use client';

/**
 * `<IdeationQueryState>` — Step-57 Zone 6.
 *
 * Wraps loading / error / retry affordances for every tab in the
 * Ideation Center. Each tab previously rendered a bare empty state
 * when its `useApiData` hook returned `data = null` — that conflated
 * "still loading" with "zero rows", violating Rule 15.
 *
 * Usage:
 *
 *   const { data, isLoading, isError, error, refetch } = useIdeasAdapter();
 *
 *   return (
 *     <IdeationQueryState
 *       isLoading={isLoading}
 *       isError={isError}
 *       error={error}
 *       onRetry={refetch}
 *       loadingRows={6}
 *     >
 *       <IdeationBoard ideas={data} ... />
 *     </IdeationQueryState>
 *   );
 *
 * The wrapper renders nothing extra on success (children only), so
 * the tab UI is unchanged for the happy path.
 */

import * as React from 'react';
import { AlertTriangle, Loader2, RotateCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface IdeationQueryStateProps {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error?: string | null;
  readonly onRetry?: () => void;
  /** Number of skeleton rows to render while loading. */
  readonly loadingRows?: number;
  /** Optional explicit error title — defaults to "Couldn't load …". */
  readonly errorTitle?: string;
  /** Children render only when not loading and not errored. */
  readonly children: React.ReactNode;
}

export function IdeationQueryState({
  isLoading,
  isError,
  error,
  onRetry,
  loadingRows = 5,
  errorTitle,
  children,
}: IdeationQueryStateProps) {
  if (isLoading) {
    return <SkeletonRows rows={loadingRows} />;
  }

  if (isError) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        data-testid="ideation-query-error"
        className="flex flex-col items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--accent-rose)]/30 bg-[rgba(244,63,94,0.06)] p-4"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle
            className="h-4 w-4 text-[var(--accent-rose)]"
            aria-hidden="true"
          />
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
            {errorTitle ?? "Couldn't load this section"}
          </h3>
        </div>
        <p className="font-mono text-[11px] text-[var(--fg-tertiary)]">
          {error ?? 'Unknown error'}
        </p>
        {onRetry ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRetry}
            data-testid="ideation-query-retry"
            className="border-[var(--accent-rose)]/40 text-[var(--accent-rose)] hover:bg-[rgba(244,63,94,0.08)]"
          >
            <RotateCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Skeleton — neutral, animated, dark-theme-aware.
// ---------------------------------------------------------------------------

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="ideation-query-loading"
      className="flex flex-col gap-2"
    >
      {[...Array(rows)].map((_, i) => (
        <SkeletonRow key={i} index={i} />
      ))}
    </div>
  );
}

function SkeletonRow({ index }: { index: number }) {
  // Vary the width so the skeleton doesn't look unnaturally uniform.
  const widths = ['w-full', 'w-11/12', 'w-5/6', 'w-4/5', 'w-3/4', 'w-2/3'];
  const width = widths[index % widths.length] ?? 'w-full';
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3',
      )}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--bg-inset)]"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span
          aria-hidden="true"
          className={cn(
            'h-3 animate-pulse rounded-[var(--radius-sm)] bg-[var(--bg-inset)]',
            width,
          )}
        />
        <span
          aria-hidden="true"
          className="h-2 w-1/3 animate-pulse rounded-[var(--radius-sm)] bg-[var(--bg-inset)]"
        />
      </div>
      <Loader2
        className="h-3.5 w-3.5 animate-spin text-[var(--fg-muted)]"
        aria-hidden="true"
      />
    </div>
  );
}