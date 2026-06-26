'use client';

import * as React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'rose' | 'amber' | 'cyan' | 'emerald' | 'violet' | 'indigo';

const toneAccent: Record<Tone, string> = {
  rose: 'text-[var(--accent-rose)]',
  amber: 'text-[var(--accent-amber)]',
  cyan: 'text-[var(--accent-cyan)]',
  emerald: 'text-[var(--accent-emerald)]',
  violet: 'text-[var(--accent-violet)]',
  indigo: 'text-[var(--accent-primary)]',
};

const toneBg: Record<Tone, string> = {
  rose: 'bg-[var(--accent-rose)]/10 border-[var(--accent-rose)]/30',
  amber: 'bg-[var(--accent-amber)]/10 border-[var(--accent-amber)]/30',
  cyan: 'bg-[var(--accent-cyan)]/10 border-[var(--accent-cyan)]/30',
  emerald: 'bg-[var(--accent-emerald)]/10 border-[var(--accent-emerald)]/30',
  violet: 'bg-[var(--accent-violet)]/10 border-[var(--accent-violet)]/30',
  indigo: 'bg-[var(--accent-primary)]/10 border-[var(--accent-primary)]/30',
};

export interface KpiTileProps {
  readonly label: string;
  readonly value: string;
  readonly sublabel?: string;
  readonly delta?: { readonly value: number; readonly unit?: string };
  readonly tone: Tone;
  readonly icon?: React.ReactNode;
  readonly progress?: number; // 0-1
  readonly footer?: React.ReactNode;
  readonly className?: string;
}

export function KpiTile({ label, value, sublabel, delta, tone, icon, progress, footer, className }: KpiTileProps) {
  const trendIcon =
    delta == null ? null : delta.value > 0 ? <TrendingUp className="h-3 w-3" aria-hidden /> : delta.value < 0 ? <TrendingDown className="h-3 w-3" aria-hidden /> : <Minus className="h-3 w-3" aria-hidden />;
  const trendColor =
    delta == null ? '' : delta.value > 0 ? 'text-[var(--accent-emerald)]' : delta.value < 0 ? 'text-[var(--accent-rose)]' : 'text-[var(--fg-tertiary)]';

  return (
    <div
      className={cn(
        'flex h-[120px] flex-col justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4',
        className,
      )}
      data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--fg-tertiary)]">{label}</p>
        {icon ? <div className={cn('rounded-md p-1', toneBg[tone])}>{icon}</div> : null}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={cn('text-[var(--text-2xl)] font-bold tabular-nums', toneAccent[tone])}>{value}</span>
        {sublabel ? <span className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">{sublabel}</span> : null}
      </div>
      <div className="flex items-center justify-between gap-2">
        {delta ? (
          <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium', trendColor)}>
            {trendIcon}
            {delta.value > 0 ? '+' : ''}{delta.value}{delta.unit ?? '%'}
          </span>
        ) : <span />}
        {footer ? <span className="text-[10px] text-[var(--fg-tertiary)]">{footer}</span> : null}
      </div>
      {progress != null ? (
        <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]">
          <div
            className={cn('h-full transition-all', tone === 'rose' ? 'bg-[var(--accent-rose)]' : tone === 'amber' ? 'bg-[var(--accent-amber)]' : tone === 'cyan' ? 'bg-[var(--accent-cyan)]' : tone === 'emerald' ? 'bg-[var(--accent-emerald)]' : tone === 'violet' ? 'bg-[var(--accent-violet)]' : 'bg-[var(--accent-primary)]')}
            style={{ width: `${Math.min(progress * 100, 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}