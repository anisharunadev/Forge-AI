/**
 * Shared chart data types.
 *
 * All chart primitives (LineChartCard, BarChartCard, etc.) consume
 * these types so a single `<LineChartCard data={…} />` works for
 * ideation velocity, run-time, agent-token cost, etc.
 */

export type ChartX = number | string | Date

/** One point on a line/area chart. */
export interface SeriesPoint {
  x: ChartX
  y: number
}

/** One named series on a line/area chart. */
export interface Series {
  name: string
  /** Override the auto-assigned color from `chartColorList`. */
  color?: string
  data: ReadonlyArray<SeriesPoint>
}

/** One bar on a bar chart. */
export interface BarDatum {
  label: string
  value: number
  color?: string
}

/** One slice on a pie chart. */
export interface PieDatum {
  name: string
  value: number
  color?: string
}