'use client';

/**
 * RefreshButton — small icon button that re-triggers all dashboard
 * data fetches (Fix 13).
 *
 * Visual:
 *   - lucide RefreshCw 14 px, --fg-tertiary, rotates while in flight.
 *   - Disabled when orchestrator is unreachable — tooltip explains why.
 *   - On success, fires a global "dashboard:refreshed" event so tile
 *     shells can flash their border for 1 s (emerald glow).
 *
 * Skill influence:
 *   - `ux` (Hover vs Tap) — primary action lives on click, but the
 *     rotation gives a hover affordance too.
 *   - `ux` (Reduced Motion) — rotation is gated by
 *     prefers-reduced-motion via the `stale-pulse` global rule.
 */

import * as React from 'react';
import { RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface RefreshButtonProps {
  /** Whether the orchestrator is reachable — disables when false. */
  online: boolean;
  /** Called when the user clicks; consumers should kick their fetches. */
  onRefresh: () => Promise<void> | void;
  className?: string;
}

export const DASHBOARD_REFRESHED_EVENT = 'dashboard:refreshed';

export function RefreshButton({ online, onRefresh, className }: RefreshButtonProps) {
  const [spinning, setSpinning] = React.useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = React.useState<number | null>(null);
  const [showLastFor, setShowLastFor] = React.useState(0);

  const handleClick = React.useCallback(async () => {
    if (!online || spinning) return;
    setSpinning(true);
    try {
      await onRefresh();
      const ts = Date.now();
      setLastRefreshedAt(ts);
      setShowLastFor(4000);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(DASHBOARD_REFRESHED_EVENT, { detail: { ts } }));
      }
    } finally {
      // Minimum 600ms so the user sees the rotation complete.
      setTimeout(() => setSpinning(false), 600);
    }
  }, [online, onRefresh, spinning]);

  // Auto-hide the "last refreshed" message.
  React.useEffect(() => {
    if (!showLastFor) return;
    const t = setTimeout(() => setShowLastFor(0), showLastFor);
    return () => clearTimeout(t);
  }, [showLastFor]);

  const lastAgoSec = lastRefreshedAt ? Math.max(0, Math.floor((Date.now() - lastRefreshedAt) / 1000)) : 0;

  const tooltip = !online
    ? 'Orchestrator unreachable — cannot refresh'
    : spinning
      ? 'Refreshing…'
      : lastRefreshedAt
        ? `Last refreshed ${lastAgoSec}s ago`
        : 'Refresh dashboard data';

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            disabled={!online || spinning}
            aria-label="Refresh all dashboard data"
            data-testid="dashboard-refresh"
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              !online ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : '',
              className,
            )}
          >
            <RefreshCw
              aria-hidden="true"
              className={cn('h-3.5 w-3.5', spinning ? 'refresh-spin' : '')}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Hook a tile can use to flash its border for 1 s when the global
 * dashboard refresh event fires. Returns the `stale-glow` class name
 * that callers should toggle on their tile root.
 */
export function useRefreshGlow(): boolean {
  const [glow, setGlow] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      setGlow(true);
      setTimeout(() => setGlow(false), 1000);
    };
    window.addEventListener(DASHBOARD_REFRESHED_EVENT, handler);
    return () => window.removeEventListener(DASHBOARD_REFRESHED_EVENT, handler);
  }, []);
  return glow;
}