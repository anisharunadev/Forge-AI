'use client';

/**
 * Stories Center — Board skeleton (loading state).
 *
 * 3 placeholder cards per column. Shimmer via the global `.shimmer`
 * utility from app/globals.css (Step 6 motion primitives).
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

const COLUMNS = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
] as const;

export function BoardSkeleton() {
  return (
    <section
      aria-label="Loading"
      aria-busy="true"
      data-testid="stories-skeleton"
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}
    >
      {COLUMNS.map((col) => (
        <div
          key={col.id}
          className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
        >
          <div className="flex items-center gap-2">
            <span className="shimmer h-2 w-2 rounded-full" />
            <span className="text-sm font-semibold text-[var(--fg-tertiary)]">{col.label}</span>
          </div>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
            >
              <div className="shimmer h-2 w-12 rounded-[var(--radius-sm)]" />
              <div className="shimmer h-3 w-4/5 rounded-[var(--radius-sm)]" />
              <div className="shimmer h-3 w-3/5 rounded-[var(--radius-sm)]" />
              <div className="flex items-center gap-2">
                <div className="shimmer h-4 w-4 rounded-full" />
                <div className="shimmer h-3 w-12 rounded-[var(--radius-sm)]" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}