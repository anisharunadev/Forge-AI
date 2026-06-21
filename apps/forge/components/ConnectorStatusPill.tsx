/**
 * ConnectorStatusPill — typed status pill for the Connector Center.
 *
 * Mirrors `the v2.0 typed-artifact system/connector-status-pill` (shipped
 * in FORA-577, package v0.3.0) but uses the forge console's tailwind
 * `forge-*` tokens so the list page matches the rest of the app. The
 * two implementations converge to the same brand-token mapping per
 * Plan 3 §7.1:
 *
 *   success  → --brand-success (green)
 *   degraded → --brand-warn    (amber)
 *   error    → --brand-danger  (red)
 *
 * Color is always paired with a text label and `aria-label` per
 * WCAG 1.4.1.
 */

import type { ToolCallStatus } from "@/lib/connectors/data";

const TONE_CLASS: Record<ToolCallStatus, string> = {
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  degraded: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  error: "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

const LABEL: Record<ToolCallStatus, string> = {
  success: "healthy",
  degraded: "degraded",
  error: "broken",
};

export interface ConnectorStatusPillProps {
  readonly status: ToolCallStatus;
  readonly className?: string;
}

export function ConnectorStatusPill({ status, className }: ConnectorStatusPillProps) {
  const label = LABEL[status];
  return (
    <span
      data-testid="connector-status-pill"
      data-status={status}
      role="status"
      aria-label={`Status: ${label}`}
      className={
        "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium uppercase tracking-wide " +
        TONE_CLASS[status] +
        (className ? ` ${className}` : "")
      }
    >
      {label}
    </span>
  );
}
