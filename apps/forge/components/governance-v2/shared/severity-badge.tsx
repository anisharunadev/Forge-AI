'use client';

/**
 * Shared severity/decision/status badges used across governance v2.
 * Single source of truth for color mapping (rose/amber/cyan/emerald/etc.).
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

type Tone = 'rose' | 'amber' | 'cyan' | 'emerald' | 'violet' | 'indigo' | 'muted';

const toneClasses: Record<Tone, string> = {
  rose: 'bg-[var(--accent-rose)]/10 text-[var(--accent-rose)] border-[var(--accent-rose)]/30',
  amber: 'bg-[var(--accent-amber)]/10 text-[var(--accent-amber)] border-[var(--accent-amber)]/30',
  cyan: 'bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] border-[var(--accent-cyan)]/30',
  emerald: 'bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] border-[var(--accent-emerald)]/30',
  violet: 'bg-[var(--accent-violet)]/10 text-[var(--accent-violet)] border-[var(--accent-violet)]/30',
  indigo: 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border-[var(--accent-primary)]/30',
  muted: 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)] border-[var(--border-subtle)]',
};

const solidToneClasses: Record<Tone, string> = {
  rose: 'bg-[var(--accent-rose)] text-white',
  amber: 'bg-[var(--accent-amber)] text-black',
  cyan: 'bg-[var(--accent-cyan)] text-black',
  emerald: 'bg-[var(--accent-emerald)] text-black',
  violet: 'bg-[var(--accent-violet)] text-white',
  indigo: 'bg-[var(--accent-primary)] text-white',
  muted: 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
};

export interface ToneBadgeProps {
  readonly tone: Tone;
  readonly children: React.ReactNode;
  readonly variant?: 'outline' | 'solid';
  readonly className?: string;
}

export function ToneBadge({ tone, children, variant = 'outline', className }: ToneBadgeProps) {
  const base = variant === 'solid' ? solidToneClasses[tone] : toneClasses[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        base,
        className,
      )}
    >
      {children}
    </span>
  );
}

// Maps domain enums to UI tones (single source of truth)
export function severityTone(severity: 'critical' | 'high' | 'medium' | 'low' | 'info'): Tone {
  switch (severity) {
    case 'critical': return 'rose';
    case 'high': return 'rose';
    case 'medium': return 'amber';
    case 'low': return 'cyan';
    case 'info': return 'muted';
  }
}

export function decisionTone(decision: 'allow' | 'warn' | 'block' | 'redact'): Tone {
  switch (decision) {
    case 'allow': return 'emerald';
    case 'warn': return 'amber';
    case 'block': return 'rose';
    case 'redact': return 'cyan';
  }
}

export function policyStatusTone(status: 'strict' | 'advisory' | 'off'): Tone {
  switch (status) {
    case 'strict': return 'rose';
    case 'advisory': return 'amber';
    case 'off': return 'muted';
  }
}

export function standardStatusTone(status: 'compliant' | 'partial' | 'non-compliant' | 'not-applicable'): Tone {
  switch (status) {
    case 'compliant': return 'emerald';
    case 'partial': return 'amber';
    case 'non-compliant': return 'rose';
    case 'not-applicable': return 'muted';
  }
}