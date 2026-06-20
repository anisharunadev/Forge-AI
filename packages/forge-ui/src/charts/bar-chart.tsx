import type { JSX } from "react";
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "../tokens/cn";

export interface BarChartDatum {
  readonly label: string;
  readonly [series: string]: string | number;
}

export interface BarChartProps<T extends BarChartDatum> {
  readonly data: ReadonlyArray<T>;
  readonly series: ReadonlyArray<{ readonly key: string; readonly label: string }>;
  readonly height?: number;
  readonly title?: string;
  readonly caption?: string;
  className?: string;
}

const PALETTE = [
  "hsl(var(--brand-primary))",
  "hsl(var(--brand-accent))",
  "hsl(var(--brand-warn))",
];

/**
 * BarChart<T> — Plan 4 §5 typed comparison chart. Accessible data table fallback
 * via <details> for screen readers / print.
 */
export function BarChart<T extends BarChartDatum>({
  data,
  series,
  height = 240,
  title,
  caption,
  className,
}: BarChartProps<T>): JSX.Element {
  return (
    <figure className={cn("rounded-md border border-surface-border bg-surface p-4", className)}>
      {title && <figcaption className="mb-2 text-body-sm font-medium text-ink-default">{title}</figcaption>}
      <div style={{ height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsBarChart data={[...data]} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="hsl(var(--surface-border))" strokeDasharray="2 4" />
            <XAxis dataKey="label" stroke="hsl(var(--ink-muted))" tick={{ fontSize: 12 }} />
            <YAxis stroke="hsl(var(--ink-muted))" tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} fill={PALETTE[i % PALETTE.length]} name={s.label} />
            ))}
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
      {caption && <p className="sr-only">{caption}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-caption text-ink-muted">Show data table</summary>
        <table className="mt-2 w-full text-body-sm" aria-label="Bar chart data">
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1 text-left text-caption text-ink-muted">
                category
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
                <td className="px-2 py-1 text-ink-default">{String(row.label)}</td>
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
