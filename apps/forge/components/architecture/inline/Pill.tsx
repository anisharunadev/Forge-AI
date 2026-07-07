/**
 * Pill — small status indicator chip used across the Architecture Center.
 *
 * Extracted from `app/architecture/page.tsx` as part of M19
 * (architecture god-page decomposition). Now lives next to its
 * peers in `components/architecture/inline/` so the god-page can
 * shrink below its prior 2,936 LoC.
 */

'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface PillProps {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
  readonly testId?: string;
}

export function Pill({ active, onClick, children, testId }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-md)] border px-2.5 py-1 text-xs transition-colors duration-150 ease-out-soft',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        active
          ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.12)] text-[var(--accent-primary)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-secondary)] hover:border-[var(--border-default)] hover:text-[var(--fg-primary)]',
      )}
    >
      {children}
    </button>
  );
}