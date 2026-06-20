import type { JSX } from "react";
import { Building2 } from "lucide-react";
import { cn } from "../tokens/cn";

export interface TenantBadgeProps {
  /** Tenant id (e.g. "acme-corp"). */
  readonly tenantId: string;
  /** Display name (optional — falls back to the id). */
  readonly tenantName?: string;
  className?: string;
}

/**
 * TenantBadge — Plan 3 §6. The top-bar identity chip. Always rendered so a
 * user never loses track of which tenant they're viewing. `aria-label`
 * includes both id + display name so screen readers announce context.
 */
export function TenantBadge({ tenantId, tenantName, className }: TenantBadgeProps): JSX.Element {
  return (
    <span
      role="status"
      aria-label={`Active tenant: ${tenantName ?? tenantId}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border border-surface-border bg-surface-raised px-2 py-1 text-caption text-ink-default",
        className,
      )}
    >
      <Building2 size={14} aria-hidden="true" className="text-ink-muted" />
      <span className="font-medium">{tenantName ?? tenantId}</span>
      {tenantName && <span className="font-mono text-ink-subtle">({tenantId})</span>}
    </span>
  );
}
