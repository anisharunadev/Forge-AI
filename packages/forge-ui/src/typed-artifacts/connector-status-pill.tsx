import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { ToolCallStatus } from "./types";

/**
 * Plan 3 §7.1 — colors match this enum, owned by the IAM broker (FORA-125).
 *   success  → --brand-success
 *   degraded → --brand-warn
 *   error    → --brand-danger
 *
 * Color is always paired with a text label and an `aria-label`
 * per WCAG 1.4.1 (Plan 3 §5.1). The status pill is the single
 * canonical indicator for connector health — every Connector
 * Center surface uses this component rather than a free-form
 * `<Badge tone="...">` so the colors stay aligned across the
 * list page, the detail page, and the rotate modal.
 */
const TONE_BY_STATUS: Record<ToolCallStatus, "success" | "warn" | "danger"> = {
  success: "success",
  degraded: "warn",
  error: "danger",
};

/** Human label per status — what the operator reads. */
const LABEL_BY_STATUS: Record<ToolCallStatus, string> = {
  success: "healthy",
  degraded: "degraded",
  error: "broken",
};

export interface ConnectorStatusPillProps {
  readonly status: ToolCallStatus;
  readonly className?: string;
}

/**
 * ConnectorStatusPill — the typed status pill for the Connector Center.
 * Maps `ToolCallStatus` to brand tokens (Plan 3 §7.1) and exposes
 * the human label as visible text and an `aria-label` for screen
 * readers. Use this anywhere the Connector Center needs to indicate
 * connector health.
 */
export function ConnectorStatusPill({
  status,
  className,
}: ConnectorStatusPillProps): JSX.Element {
  const label = LABEL_BY_STATUS[status];
  return (
    <Badge
      tone={TONE_BY_STATUS[status]}
      aria-label={`Status: ${label}`}
      data-status={status}
      data-testid="connector-status-pill"
      className={className}
    >
      {label}
    </Badge>
  );
}
