import type { JSX } from "react";
import { cn } from "../tokens/cn";

export interface BudgetMeterProps {
  /** Current spend in USD. */
  readonly spentUsd: number;
  /** Cap in USD. */
  readonly capUsd: number;
  /** Optional override label (e.g. "agent budget", "tenant budget"). */
  readonly label?: string;
  className?: string;
}

/**
 * BudgetMeter — Plan 3 §6 + FORA-59 §8 budget meter. Renders a small status
 * bar in the top bar / status bar. Computes a percentage and a tone
 * (success / warn / danger) when approaching the cap.
 */
export function BudgetMeter({ spentUsd, capUsd, label = "Budget", className }: BudgetMeterProps): JSX.Element {
  const safeCap = Math.max(1e-6, capUsd);
  const pct = Math.min(100, Math.max(0, (spentUsd / safeCap) * 100));
  const tone = pct >= 95 ? "danger" : pct >= 80 ? "warn" : "success";

  return (
    <div
      role="meter"
      aria-label={`${label}: $${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)}`}
      aria-valuemin={0}
      aria-valuemax={capUsd}
      aria-valuenow={spentUsd}
      className={cn("flex items-center gap-2 text-caption text-ink-muted", className)}
    >
      <span className="font-medium text-ink-default">{label}</span>
      <div className="h-1.5 w-24 overflow-hidden rounded-sm bg-surface-sunken" aria-hidden="true">
        <div
          className={cn(
            "h-full",
            tone === "danger" && "bg-brand-danger",
            tone === "warn" && "bg-brand-warn",
            tone === "success" && "bg-brand-success",
          )}
          style={{ width: `${pct.toFixed(1)}%` }}
        />
      </div>
      <span className="font-mono">
        ${spentUsd.toFixed(2)} / ${capUsd.toFixed(2)}
      </span>
    </div>
  );
}
