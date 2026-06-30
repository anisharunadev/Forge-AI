'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface PanelProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly headerAction?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly contentClassName?: string;
  readonly height?: 'auto' | 'fixed-200' | 'fixed-280' | 'fixed-320' | 'full';
  readonly dataTestId?: string;
  /**
   * Scrollbar variant for the panel's scrollable content area.
   *   - 'default' inherits the global themed scrollbar (most panels)
   *   - 'thin' uses the extra-subtle 6px thumb (lists, modals, dense data)
   *   - 'accent' uses the indigo-tinted thumb (hero / chat panels)
   *   - 'hidden' removes the thumb entirely (still scrollable)
   * Default is 'default' to match the rest of the app.
   */
  readonly scrollbar?: 'default' | 'thin' | 'accent' | 'hidden';
}

const scrollbarClass: Record<NonNullable<PanelProps['scrollbar']>, string> = {
  default: '',
  thin: 'scrollbar-thin',
  accent: 'scrollbar-accent',
  hidden: 'scrollbar-hidden',
};

export function Panel({ title, subtitle, headerAction, children, className, contentClassName, height = 'auto', dataTestId, scrollbar = 'default' }: PanelProps) {
  const heightClass = height === 'fixed-280' ? 'h-[280px]' : height === 'fixed-320' ? 'h-[320px]' : height === 'fixed-200' ? 'h-[200px]' : height === 'full' ? 'h-full' : '';
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]',
        heightClass,
        className,
      )}
      data-testid={dataTestId}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">{title}</h3>
          {subtitle ? <p className="text-[11px] text-[var(--fg-tertiary)]">{subtitle}</p> : null}
        </div>
        {headerAction}
      </div>
      <div className={cn('flex-1 overflow-auto p-4', scrollbarClass[scrollbar], contentClassName)}>{children}</div>
    </div>
  );
}