'use client';

/**
 * ChartTooltip — Step 6 standardized tooltip formatter for Recharts.
 *
 * Renders a small dark card with the label, value(s), and a unit
 * suffix. Colors are sourced from `--accent-*` so dark mode "just
 * works". Pair with ChartFrame.
 */

import * as React from 'react';

export interface ChartTooltipFormatter {
  unit?: string;
  /** Optional accent variable to color the value text. */
  accent?: string;
}

export interface ChartTooltipProps extends ChartTooltipFormatter {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: string; value?: number | string; color?: string }>;
  label?: string | number;
}

export function ChartTooltip({
  active,
  payload,
  label,
  unit,
  accent,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      role="tooltip"
      className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-xs shadow-[var(--shadow-md)]"
      data-testid="chart-tooltip"
    >
      {label !== undefined ? (
        <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
          {String(label)}
        </div>
      ) : null}
      <ul className="mt-1 flex flex-col gap-1">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[var(--fg-secondary)]">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ background: p.color ?? 'var(--accent-primary)' }}
              />
              {p.name ?? 'value'}
            </span>
            <span
              className="font-mono"
              style={{ color: accent ?? 'var(--fg-primary)' }}
            >
              {typeof p.value === 'number' ? p.value.toLocaleString() : String(p.value ?? '')}
              {unit ? <span className="ml-0.5 text-[var(--fg-tertiary)]">{unit}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
