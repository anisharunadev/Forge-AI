import type { JSX } from "react";
import {
  Area,
  AreaChart as RechartsAreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "../tokens/cn";

export interface StackedAreaChartDatum {
  readonly x: string;
  readonly [series: string]: string | number;
}

export interface StackedAreaChartProps<T extends StackedAreaChartDatum> {
  readonly data: ReadonlyArray<T>;
  readonly series: ReadonlyArray<{ readonly key: string; readonly label: string }>;
  readonly height?: number;
  readonly title?: string;
  readonly caption?: string;
  className?: string;
}

const PALETTE = [
  "hsl(var(--brand-primary) / 0.6)",
  "hsl(var(--brand-accent) / 0.6)",
  "hsl(var(--brand-warn) / 0.6)",
];

/**
 * StackedAreaChart<T> — Plan 4 §5 cumulative comparison chart.
 */
export function StackedAreaChart<T extends StackedAreaChartDatum>({
  data,
  series,
  height = 240,
  title,
  caption,
  className,
}: StackedAreaChartProps<T>): JSX.Element {
  return (
    <figure className={cn("rounded-md border border-surface-border bg-surface p-4", className)}>
      {title && <figcaption className="mb-2 text-body-sm font-medium text-ink-default">{title}</figcaption>}
      <div style={{ height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsAreaChart data={[...data]} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="hsl(var(--surface-border))" strokeDasharray="2 4" />
            <XAxis dataKey="x" stroke="hsl(var(--ink-muted))" tick={{ fontSize: 12 }} />
            <YAxis stroke="hsl(var(--ink-muted))" tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            {series.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stackId="1"
                stroke={(PALETTE[i % PALETTE.length] ?? "hsl(var(--brand-primary))").replace(" / 0.6", "")}
                fill={PALETTE[i % PALETTE.length] ?? "hsl(var(--brand-primary) / 0.6)"}
                name={s.label}
              />
            ))}
          </RechartsAreaChart>
        </ResponsiveContainer>
      </div>
      {caption && <p className="sr-only">{caption}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-caption text-ink-muted">Show data table</summary>
        <table className="mt-2 w-full text-body-sm" aria-label="Stacked area chart data">
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1 text-left text-caption text-ink-muted">x</th>
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
      </details>
    </figure>
  );
}
