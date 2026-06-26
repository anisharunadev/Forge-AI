'use client';

import * as React from 'react';
import { PlusSquare, Workflow as WorkflowIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * HeroBand — animated gradient border + eyebrow + title + body + CTA.
 *
 * Pattern follows Step 4's Agent Center hero card. The border is
 * drawn via a rotating conic-gradient masked by an inset border-radius.
 * prefers-reduced-motion freezes the rotation.
 */

export interface HeroBandProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly primaryActionLabel: string;
  readonly primaryActionIcon?: React.ReactNode;
  readonly onPrimaryAction: () => void;
  readonly className?: string;
}

export function HeroBand({
  eyebrow,
  title,
  description,
  primaryActionLabel,
  primaryActionIcon,
  onPrimaryAction,
  className,
}: HeroBandProps) {
  return (
    <div
      data-testid="workflow-hero"
      className={cn(
        'hero-border relative overflow-hidden rounded-[var(--radius-xl)] border border-transparent bg-[var(--bg-surface)] p-6 md:p-8',
        className,
      )}
    >
      {/* Animated gradient ring */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
        style={{
          background:
            'conic-gradient(from var(--hero-angle, 0deg), var(--accent-primary), var(--accent-violet) 33%, var(--accent-cyan) 66%, var(--accent-primary) 100%)',
          animation: 'hero-border-spin 8s linear infinite',
        }}
      />
      {/* Inner mask so the conic-gradient becomes a 1px border */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-[1px] -z-10 rounded-[calc(var(--radius-xl)-1px)] bg-[var(--bg-surface)]"
      />

      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div className="flex-1 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
            {eyebrow}
          </p>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-[var(--fg-primary)]">
            <WorkflowIcon className="h-7 w-7 text-[var(--accent-primary)]" aria-hidden="true" />
            {title}
          </h1>
          <p className="max-w-2xl text-sm text-[var(--fg-secondary)]">{description}</p>
        </div>
        <button
          type="button"
          onClick={onPrimaryAction}
          data-testid="workflow-hero-from-scratch"
          className={cn(
            'inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-transparent px-4 py-2 text-sm font-medium text-[var(--fg-primary)]',
            'transition-all duration-200 ease-out-soft hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
          )}
        >
          {primaryActionIcon ?? <PlusSquare className="h-4 w-4" aria-hidden="true" />}
          {primaryActionLabel}
        </button>
      </div>
    </div>
  );
}