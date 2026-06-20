import type { JSX } from "react";
import { cn } from "../tokens/cn";

export interface SparklineProps {
  readonly values: ReadonlyArray<number>;
  readonly height?: number;
  readonly label?: string;
  /** Optional tone override. Default: brand-primary. */
  readonly tone?: "primary" | "accent" | "warn" | "success" | "danger";
  className?: string;
}

const TONE_VAR: Record<NonNullable<SparklineProps["tone"]>, string> = {
  primary: "hsl(var(--brand-primary))",
  accent: "hsl(var(--brand-accent))",
  warn: "hsl(var(--brand-warn))",
  success: "hsl(var(--brand-success))",
  danger: "hsl(var(--brand-danger))",
};

/**
 * Sparkline<T> — Plan 4 §5 inline trend preview used inside cards and summary
 * rows. No axes / tooltip — it's a glance, not an analysis surface. The aria
 * label exposes the delta so screen-reader users hear the trend.
 */
export function Sparkline({
  values,
  height = 24,
  label,
  tone = "primary",
  className,
}: SparklineProps): JSX.Element {
  if (values.length < 2) {
    return (
      <span className={cn("text-caption text-ink-subtle", className)} aria-label={label ?? "Sparkline"}>
        —
      </span>
    );
  }
  const w = 80;
  const h = height;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 2) - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const first = values[0]!;
  const last = values[values.length - 1]!;
  const delta = last - first;
  const pct = first === 0 ? 0 : Math.round((delta / first) * 100);

  const trendLabel = `Sparkline trend, ${values.length} points, ${pct >= 0 ? "+" : ""}${pct}%`;
  return (
    <svg
      width={w}
      height={h}
      role="img"
      aria-label={label ? `${label}, ${trendLabel}` : trendLabel}
      className={cn("inline-block align-middle", className)}
    >
      <polyline
        fill="none"
        stroke={TONE_VAR[tone]}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
