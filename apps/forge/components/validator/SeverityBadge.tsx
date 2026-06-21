/**
 * SeverityBadge — colored pill for `ValidationFinding.severity`.
 *
 * Color tokens are pinned to the user's spec (FORA-620):
 *   - critical → red   (rose-500 ring, rose-200 text)
 *   - high     → orange (amber-500 ring, amber-200 text)
 *   - medium   → yellow (amber-400 ring, amber-100 text)
 *   - low      → blue   (sky-500 ring, sky-200 text)
 *
 * The component is a pure function of `severity` — no business logic,
 * no fetches. It renders inline in the `FindingsTable`, in the
 * `RemediationPanel`, and in the `ValidationReportCard` summary.
 */

import type { ValidationSeverity } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface SeverityBadgeProps {
  readonly severity: ValidationSeverity;
  readonly className?: string;
}

const TONE: Record<
  ValidationSeverity,
  {
    readonly label: string;
    readonly className: string;
  }
> = {
  critical: {
    label: 'Critical',
    className: 'border-rose-500/60 bg-rose-500/15 text-rose-200',
  },
  high: {
    label: 'High',
    className: 'border-amber-500/60 bg-amber-500/15 text-amber-200',
  },
  medium: {
    label: 'Medium',
    className: 'border-amber-400/60 bg-amber-400/15 text-amber-100',
  },
  low: {
    label: 'Low',
    className: 'border-sky-500/60 bg-sky-500/15 text-sky-200',
  },
};

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const tone = TONE[severity];
  return (
    <span
      data-testid="severity-badge"
      data-severity={severity}
      className={cn(
        'inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        tone.className,
        className,
      )}
      aria-label={`Severity: ${tone.label}`}
    >
      {tone.label}
    </span>
  );
}