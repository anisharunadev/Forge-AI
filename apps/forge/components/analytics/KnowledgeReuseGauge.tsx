'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface KnowledgeReuseGaugeProps {
  /** 0-100. */
  value: number;
  className?: string;
}

function tone(pct: number): string {
  if (pct >= 60) return 'text-emerald-300';
  if (pct >= 30) return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
}

export function KnowledgeReuseGauge({ value, className }: KnowledgeReuseGaugeProps) {
  const clamped = Math.max(0, Math.min(100, value));
  // Half-circle gauge using SVG path.
  const r = 70;
  const cx = 100;
  const cy = 90;
  const startAngle = 180;
  const endAngle = 360;
  const sweep = ((endAngle - startAngle) * clamped) / 100 + startAngle;
  const polar = (a: number) => ({
    x: cx + r * Math.cos((a * Math.PI) / 180),
    y: cy + r * Math.sin((a * Math.PI) / 180),
  });
  const start = polar(startAngle);
  const end = polar(endAngle);
  const cur = polar(sweep);
  const largeArc = sweep - startAngle > 180 ? 1 : 0;
  const dBg = `M ${start.x} ${start.y} A ${r} ${r} 0 1 1 ${end.x} ${end.y}`;
  const dFg = `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${cur.x} ${cur.y}`;

  return (
    <div
      data-testid="knowledge-reuse-gauge"
      data-value={clamped}
      className={cn('flex flex-col items-center gap-2', className)}
    >
      <svg viewBox="0 0 200 110" width="100%" height="180" role="img" aria-label={`Knowledge reuse ${clamped}%`}>
        <path d={dBg} stroke="#243152" strokeWidth={14} fill="none" strokeLinecap="round" />
        <path d={dFg} stroke="#22d3ee" strokeWidth={14} fill="none" strokeLinecap="round" />
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          fontSize={28}
          fontWeight="600"
          fill="#f5f7fb"
        >
          {clamped}%
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fontSize={11}
          fill="#94a6cd"
        >
          Knowledge reuse
        </text>
      </svg>
      <span
        className={cn(
          'inline-flex rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
          tone(clamped),
        )}
      >
        {clamped >= 60 ? 'Healthy' : clamped >= 30 ? 'Improving' : 'Low'}
      </span>
    </div>
  );
}
