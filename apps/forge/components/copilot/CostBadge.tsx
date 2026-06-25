'use client';

/**
 * F-800 — Cost badge.
 *
 * Small inline badge showing the running cost of the active
 * conversation. Polls `useCost(conversationId)` every 5s while the
 * panel is open. When the budget is exhausted, the badge turns
 * destructive.
 */

import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { useCost } from '@/hooks/use-copilot';
import { cn } from '@/lib/utils';

export interface CostBadgeProps {
  conversationId: string | null;
  className?: string;
}

/**
 * Renders the running conversation cost in a compact badge. Tones
 * shift to `destructive` when the budget is exhausted or closed.
 */
export function CostBadge({ conversationId, className }: CostBadgeProps) {
  const cost = useCost(conversationId);

  const total = cost.data?.total_cost_usd ?? 0;
  const exhausted =
    cost.data?.budget_status === 'exhausted' ||
    cost.data?.budget_status === 'closed';

  return (
    <Badge
      variant="outline"
      data-testid="copilot-cost-badge"
      data-budget-status={cost.data?.budget_status ?? 'unknown'}
      className={cn(
        'px-1.5 py-0 text-[10px] uppercase tracking-wide',
        exhausted
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-border bg-muted/40 text-muted-foreground',
        className,
      )}
    >
      ${total.toFixed(4)}
    </Badge>
  );
}