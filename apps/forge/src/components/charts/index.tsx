/**
 * src/components/charts/ — Step 6 data-viz standardisation.
 *
 * Wraps Recharts so every chart in Forge:
 *   1. Pulls colors from `--accent-*` CSS vars (light/dark safe).
 *   2. Carries title + Tooltip + (multi-series) legend.
 *   3. Shows the shared EmptyState instead of a blank canvas.
 *   4. Uses the shared Skeleton placeholder while loading.
 *   5. Caps the bar palette to {indigo, cyan, emerald, amber, rose}.
 *
 * Standard usage:
 *
 *   <ChartFrame title="Runs / 24h" loading={isLoading} data={data}>
 *     <ResponsiveContainer>
 *       <AreaChart data={data}>
 *         <CartesianGrid stroke="var(--border-subtle)" />
 *         <XAxis dataKey="hour" stroke="var(--fg-tertiary)" />
 *         <YAxis stroke="var(--fg-tertiary)" />
 *         <Tooltip content={<ChartTooltip unit="calls" />} />
 *         <Area
 *           type="monotone"
 *           dataKey="calls"
 *           stroke="var(--accent-primary)"
 *           fill="url(#forge-area-gradient-primary)"
 *         />
 *       </AreaChart>
 *     </ResponsiveContainer>
 *   </ChartFrame>
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as React from 'react';

export const CHART_PALETTE: ReadonlyArray<string> = [
  'var(--accent-primary)', // indigo
  'var(--accent-cyan)', // cyan
  'var(--accent-emerald)', // emerald
  'var(--accent-amber)', // amber
  'var(--accent-rose)', // rose
];

/** Line/area gradient: 12% at top → 0% at bottom. */
export const AREA_GRADIENT: ReadonlyArray<{
  id: string;
  fromVar: string;
}> = [
  { id: 'forge-area-gradient-primary', fromVar: 'var(--accent-primary)' },
  { id: 'forge-area-gradient-cyan', fromVar: 'var(--accent-cyan)' },
  { id: 'forge-area-gradient-emerald', fromVar: 'var(--accent-emerald)' },
  { id: 'forge-area-gradient-amber', fromVar: 'var(--accent-amber)' },
  { id: 'forge-area-gradient-rose', fromVar: 'var(--accent-rose)' },
];

/**
 * Build an inline <defs> block for the line/area gradients. Drop this
 * inside a <svg> returned by Recharts' custom `content` to color the
 * area fill.
 */
export function ChartGradientDefs(): React.ReactElement {
  return (
    <defs>
      {AREA_GRADIENT.map((g) => (
        <linearGradient key={g.id} id={g.id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={g.fromVar} stopOpacity="0.12" />
          <stop offset="100%" stopColor={g.fromVar} stopOpacity="0" />
        </linearGradient>
      ))}
    </defs>
  );
}

/**
 * Pie/donut rule: only use when parts-of-whole is meaningful, max 5
 * slices. If you need more, switch to a horizontal bar.
 */
export const PIE_MAX_SLICES = 5;

/**
 * Sparkline rule: 60px tall, no axis, no tooltip. Pair inline next
 * to any single number metric so the user reads trend at a glance.
 */
export const SPARKLINE_HEIGHT = 60;
