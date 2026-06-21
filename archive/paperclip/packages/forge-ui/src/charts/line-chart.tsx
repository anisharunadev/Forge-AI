import type { JSX } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import { cn } from "../tokens/cn";

export interface LineChartDatum {
  /** X-axis label (typically an ISO date or bucket name). */
  readonly x: string;
  /** Per-series numeric value. */
  readonly [series: string]: string | number;
}

export interface LineChartProps<T extends LineChartDatum> {
  readonly data: ReadonlyArray<T>;
  /** Series keys to draw (each becomes a `<Line>`). The "x" key is the axis. */
  readonly series: ReadonlyArray<{ readonly key: string; readonly label: string; readonly tone?: string }>;
  readonly height?: number;
  readonly title?: string;
  /** Accessible caption (also rendered to screen readers). */
  readonly caption?: string;
  className?: string;
}

const DEFAULT_PALETTE = [
  "hsl(var(--brand-primary))",
  "hsl(var(--brand-accent))",
  "hsl(var(--brand-warn))",
  "hsl(var(--brand-success))",
  "hsl(var(--brand-danger))",
];

function AccessibleTableFallback<T extends LineChartDatum>({
  data,
  series,
}: Pick<LineChartProps<T>, "data" | "series">) {
  return (
    <table className="mt-3 w-full text-body-sm" aria-label="Chart data">
      <caption className="sr-only">Line chart data — accessible fallback.</caption>
      <thead>
        <tr>
          <th scope="col" className="px-2 py-1 text-left text-caption text-ink-muted">
            x
          </th>
          {series.map((s) => (
            <th key={s.key} scope="col" className="px-2 py-1 text-left text-caption text-ink-muted">
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr key={i} className="border-t border-surface-border">
            <td className="px-2 py-1 font-mono text-ink-default">{String(row.x)}</td>
            {series.map((s) => (
              <td key={s.key} className="px-2 py-1 font-mono text-ink-default">
                {typeof row[s.key] === "number" ? (row[s.key] as number) : "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * LineChart<T> — Plan 4 §5 typed trend chart (Recharts). Color-blind safe via
 * the default palette; provides a screen-reader-only caption and a hidden
 * data table fallback (WCAG 1.1.1).
 */
export function LineChart<T extends LineChartDatum>({
  data,
  series,
  height = 240,
  title,
  caption,
  className,
}: LineChartProps<T>): JSX.Element {
  return (
    <figure className={cn("rounded-md border border-surface-border bg-surface p-4", className)}>
      {title && <figcaption className="mb-2 text-body-sm font-medium text-ink-default">{title}</figcaption>}
      <div style={{ height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsLineChart data={[...data]} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="hsl(var(--surface-border))" strokeDasharray="2 4" />
            <XAxis dataKey="x" stroke="hsl(var(--ink-muted))" tick={{ fontSize: 12 }} />
            <YAxis stroke="hsl(var(--ink-muted))" tick={{ fontSize: 12 }} />
            <Tooltip content={(p: TooltipProps<number, string>) => <div aria-hidden="true" />} />
            <Legend />
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.tone ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                name={s.label}
              />
            ))}
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
      {caption && <p className="sr-only">{caption}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-caption text-ink-muted">Show data table</summary>
        <AccessibleTableFallback data={data} series={series} />
      </details>
    </figure>
  );
}
