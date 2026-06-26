'use client';

/**
 * ConnectorHealthRing — donut chart for the Overview "Health" tile.
 *
 * Lightweight SVG donut. Renders segments in a circle with a centered
 * label. Hover targets report the segment name + count.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface RingSegment {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

export interface ConnectorHealthRingProps {
  readonly segments: ReadonlyArray<RingSegment>;
  readonly centerLabel?: string;
  readonly centerSub?: string;
  readonly size?: number;
  readonly className?: string;
}

const SIZE_DEFAULT = 200;
const STROKE = 18;
const RADIUS = (SIZE_DEFAULT - STROKE) / 2;

export function ConnectorHealthRing({
  segments,
  centerLabel,
  centerSub = 'connectors',
  size = SIZE_DEFAULT,
  className,
}: ConnectorHealthRingProps) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const arcList = segments.map((s) => {
    const portion = total === 0 ? 0 : s.value / total;
    const len = portion * circumference;
    const node = (
      <circle
        key={s.key}
        cx={cx}
        cy={cy}
        r={r}
        fill="transparent"
        stroke={s.color}
        strokeWidth={STROKE}
        strokeDasharray={`${len} ${circumference}`}
        strokeDashoffset={-offset}
        transform={`rotate(-90 ${cx} ${cy})`}
        className="transition-opacity hover:opacity-100"
      />
    );
    offset += len;
    return node;
  });

  return (
    <div className={cn('relative', className)} style={{ width: size, height: size }} data-testid="connector-health-ring">
      <svg width={size} height={size} role="img" aria-label="Connector health breakdown">
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="transparent"
          stroke="var(--bg-inset)"
          strokeWidth={STROKE}
        />
        {arcList}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tabular-nums text-fg-primary">
          {centerLabel ?? total}
        </span>
        <span className="text-[11px] uppercase tracking-wider text-fg-tertiary">
          {centerSub}
        </span>
      </div>
      <ul className="absolute right-2 top-1/2 -translate-y-1/2 space-y-1 text-[11px]">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-sm"
              style={{ background: s.color }}
              aria-hidden="true"
            />
            <span className="text-fg-secondary">{s.label}</span>
            <span className="font-mono text-fg-tertiary">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}