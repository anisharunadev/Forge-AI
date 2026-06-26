'use client';

/**
 * ChartFrame — Step 6 wrapper that gives every chart in Forge the
 * same loading + empty + title shell.
 *
 * - When `loading` is true, renders the shared Shimmer skeleton.
 * - When `data` is empty, renders the Step 3 EmptyState.
 * - Otherwise renders the title + the chart children.
 */

import * as React from 'react';
import { BarChart3 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { EmptyState } from '@/src/components/empty-state';

export interface ChartFrameProps {
  title: string;
  description?: string;
  loading?: boolean;
  data?: ReadonlyArray<unknown>;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  height?: number;
  className?: string;
  children: React.ReactNode;
  /** When true, treats empty array as "no data" and shows empty state. */
  treatEmpty?: boolean;
}

export function ChartFrame({
  title,
  description,
  loading,
  data,
  emptyTitle = 'No data yet',
  emptyDescription = 'Once activity flows in, the chart will render here.',
  emptyActionLabel,
  onEmptyAction,
  height = 220,
  className,
  children,
  treatEmpty = true,
}: ChartFrameProps) {
  if (loading) {
    return (
      <section
        className={cn('card flex flex-col gap-2', className)}
        data-testid="chart-frame-loading"
      >
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{title}</h3>
        {description ? (
          <p className="text-xs text-[var(--fg-secondary)]">{description}</p>
        ) : null}
        <div className="shimmer mt-2" style={{ height }} aria-hidden="true" />
        <span className="sr-only">Loading {title}</span>
      </section>
    );
  }

  const isEmpty = treatEmpty && (!data || data.length === 0);
  if (isEmpty) {
    return (
      <section
        className={cn('card', className)}
        data-testid="chart-frame-empty"
        aria-label={title}
      >
        <EmptyState
          compact
          illustration={<BarChart3 size={28} strokeWidth={1.5} />}
          title={emptyTitle}
          description={emptyDescription}
          primaryAction={
            onEmptyAction && emptyActionLabel
              ? { label: emptyActionLabel, onClick: onEmptyAction }
              : undefined
          }
        />
      </section>
    );
  }

  return (
    <section
      className={cn('card flex flex-col gap-2', className)}
      data-testid="chart-frame"
      aria-label={title}
    >
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{title}</h3>
          {description ? (
            <p className="text-xs text-[var(--fg-secondary)]">{description}</p>
          ) : null}
        </div>
      </header>
      <div style={{ height }} role="img" aria-label={title}>
        {children}
      </div>
    </section>
  );
}
