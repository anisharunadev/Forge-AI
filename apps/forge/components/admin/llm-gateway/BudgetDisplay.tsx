'use client';

/**
 * BudgetDisplay — composed summary of a tenant's LLM budget.
 *
 * Combines :class:`BudgetGauge` with a 3-up stat row:
 *   - Spend (so far this period)
 *   - Ceiling (the configured max)
 *   - Projected overage (linear extrapolation to end of period)
 *
 * The projected overage uses a simple `daily_burn * days_remaining`
 * model — Phase C will replace this with the canonical forecasting
 * job. For now, this gives the Steward a useful "is this tenant
 * going to blow past the limit" signal.
 */


import { cn } from '@/lib/utils';
import { BudgetGauge } from './BudgetGauge';

export interface BudgetDisplayProps {
  /** Spend so far this period (e.g. dollars). */
  readonly spend: number;
  /** Configured ceiling (e.g. dollars per month). */
  readonly ceiling: number;
  /** ISO start of the current period. */
  readonly periodStart: string;
  /** ISO end of the current period. */
  readonly periodEnd: string;
  /** Optional className passthrough. */
  readonly className?: string;
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function projectOverage(
  spend: number,
  ceiling: number,
  periodStart: string,
  periodEnd: string,
): { projected: number; overage: number } {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const now = new Date();
  const totalDays = daysBetween(start, end);
  const elapsed = Math.max(1, daysBetween(start, now));
  const remaining = Math.max(0, totalDays - elapsed);
  const dailyBurn = spend / elapsed;
  const projected = spend + dailyBurn * remaining;
  return { projected, overage: Math.max(0, projected - ceiling) };
}

function fmtUsd(v: number): string {
  return `$${v.toFixed(2)}`;
}

export function BudgetDisplay({
  spend,
  ceiling,
  periodStart,
  periodEnd,
  className,
}: BudgetDisplayProps) {
  const { projected, overage } = projectOverage(
    spend,
    ceiling,
    periodStart,
    periodEnd,
  );

  return (
    <div
      className={cn('flex flex-col gap-3', className)}
      data-testid="budget-display"
    >
      <BudgetGauge value={spend} max={ceiling} />
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground">Spend</dt>
          <dd className="font-mono text-foreground">{fmtUsd(spend)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground">Ceiling</dt>
          <dd className="font-mono text-foreground">{fmtUsd(ceiling)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground">Projected</dt>
          <dd
            className={cn(
              'font-mono',
              overage > 0 ? 'text-red-500' : 'text-foreground',
            )}
            data-testid="budget-display-projected"
          >
            {fmtUsd(projected)}
            {overage > 0 ? (
              <span className="ml-1 text-[10px] text-red-500">
                (+{fmtUsd(overage)})
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
    </div>
  );
}
