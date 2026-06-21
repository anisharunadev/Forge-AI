'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

export type KPITone = 'positive' | 'negative' | 'neutral';

export interface KPICardProps {
  label: string;
  value: string;
  /** Signed delta, e.g. -3.2 means -3.2%. */
  deltaPct?: number;
  tone?: KPITone;
  icon?: React.ReactNode;
  className?: string;
}

function toneClass(tone: KPITone | undefined): string {
  if (tone === 'positive') return 'text-emerald-300';
  if (tone === 'negative') return 'text-rose-300';
  return 'text-forge-300';
}

export function KPICard({ label, value, deltaPct, tone, icon, className }: KPICardProps) {
  const effective: KPITone =
    tone ??
    (deltaPct == null
      ? 'neutral'
      : deltaPct > 0
        ? 'positive'
        : deltaPct < 0
          ? 'negative'
          : 'neutral');

  return (
    <Card
      className={cn('flex flex-col gap-2 p-4', className)}
      data-testid="kpi-card"
      data-kpi-label={label}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-forge-300">
          {label}
        </span>
        {icon ? <span className="text-forge-300">{icon}</span> : null}
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-semibold leading-none">{value}</span>
        {deltaPct != null ? (
          <span className={cn('inline-flex items-center gap-0.5 text-xs', toneClass(effective))}>
            {effective === 'positive' ? (
              <ArrowUp className="h-3 w-3" aria-hidden="true" />
            ) : effective === 'negative' ? (
              <ArrowDown className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Minus className="h-3 w-3" aria-hidden="true" />
            )}
            {Math.abs(deltaPct).toFixed(1)}%
          </span>
        ) : null}
      </div>
    </Card>
  );
}
