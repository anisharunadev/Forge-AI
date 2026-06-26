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
}

export function Panel({ title, subtitle, headerAction, children, className, contentClassName, height = 'auto', dataTestId }: PanelProps) {
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
      <div className={cn('flex-1 overflow-auto p-4', contentClassName)}>{children}</div>
    </div>
  );
}