/**
 * Chart theme — semantic chart series colors.
 *
 * Source of truth for chart series colors. Reads CSS variables so a
 * theme flip (light/dark) re-skins every chart with zero JS changes.
 *
 * Per the curated spec (Phase 0.5 amendment, 2026-06-23) the chart
 * palette is intentionally separate from the brand palette: charts
 * need N distinct hues that all read as "data", not "brand".
 *
 * The 9 series colors align with the AI-native channels in
 * `lib/design-system/forge-color-tokens.ts`:
 *   1. primary (indigo)
 *   2. agent (cyan, identity)
 *   3. execution (violet, executing)
 *   4. review (orange, reviewing)
 *   5. success (green, completed)
 *   6. warning (amber)
 *   7. destructive (red)
 *   8. thinking (blue, agent thinking state)
 *   9. muted (gray, idle)
 */
export type ChartColorName =
  | 'primary'
  | 'agent'
  | 'execution'
  | 'review'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'thinking'
  | 'muted'

/** Each value is a Tailwind/CSS variable reference. */
export const chartColors: Record<ChartColorName, string> = {
  primary: 'hsl(var(--primary))',
  agent: 'hsl(var(--agent))',
  execution: 'hsl(var(--execution))',
  review: 'hsl(var(--review))',
  success: 'hsl(var(--success))',
  warning: 'hsl(var(--warning))',
  destructive: 'hsl(var(--destructive))',
  thinking: 'hsl(var(--thinking))',
  muted: 'hsl(var(--muted-foreground))',
}

/** Ordered list — chart consumers cycle through this for N series. */
export const chartColorList: ReadonlyArray<string> = [
  chartColors.primary,
  chartColors.agent,
  chartColors.execution,
  chartColors.review,
  chartColors.success,
  chartColors.warning,
  chartColors.destructive,
  chartColors.thinking,
  chartColors.muted,
]

/** Resolve a color name (or fall back to position in the list). */
export function getChartColor(name: ChartColorName): string {
  return chartColors[name]
}

/** Pick a series color by index, modulo the list length. */
export function getSeriesColor(index: number): string {
  const list = chartColorList
  if (list.length === 0) {
    return chartColors.muted
  }
  const idx = ((index % list.length) + list.length) % list.length
  return list[idx]!
}