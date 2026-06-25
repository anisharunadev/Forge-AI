'use client';

/**
 * F-800 — Context chip.
 *
 * Single-line footer chip showing the user's current page context:
 *   - pathname (e.g. `/project-intelligence`)
 *   - active center id (if any)
 *   - active artifact id (if any, truncated)
 *   - active conversation title (if any)
 *
 * The component is purely presentational — context is read from the
 * `window.location` (pathname) + `useCopilotStore` (active conv).
 * Co-pilot-relevant artifact id is fetched from `localStorage` if
 * the consuming app writes it there (Plan 5 wires this for real).
 */

import * as React from 'react';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { useCopilotStore } from '@/lib/store/copilot';

const RECENT_ACTIONS_KEY = 'forge.copilot.recentActions';

function readRecentActions(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_ACTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
  } catch {
    return [];
  }
}

export interface ContextChipProps {
  className?: string;
  /** Override active center id (e.g. when surfaced from server state). */
  currentCenter?: string | null;
  /** Override active artifact id. */
  currentArtifactId?: string | null;
}

/**
 * Read-only context summary shown above the composer. Helps the
 * user (and Co-pilot) verify what context the next message will
 * carry. Pure render — no fetches.
 */
export function ContextChip({
  className,
  currentCenter,
  currentArtifactId,
}: ContextChipProps) {
  const pathname = usePathname() ?? '/';
  const activeConversationId = useCopilotStore((s) => s.activeConversationId);
  const [recentActions, setRecentActions] = React.useState<string[]>([]);

  React.useEffect(() => {
    setRecentActions(readRecentActions());
  }, [pathname, activeConversationId]);

  const trimmedPath = pathname.length > 32 ? `${pathname.slice(0, 32)}…` : pathname;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground',
        className,
      )}
      data-testid="copilot-context-chip"
      data-pathname={pathname}
    >
      <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono">
        {trimmedPath}
      </span>
      {currentCenter ? (
        <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5">
          {currentCenter}
        </span>
      ) : null}
      {currentArtifactId ? (
        <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono">
          {currentArtifactId.length > 12
            ? `${currentArtifactId.slice(0, 12)}…`
            : currentArtifactId}
        </span>
      ) : null}
      {recentActions.length > 0 ? (
        <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5">
          {recentActions.length} recent action{recentActions.length === 1 ? '' : 's'}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Helper for other surfaces to record a recent user action so the
 * Co-pilot can include it on the next turn. Stored under
 * `forge.copilot.recentActions`, capped at 10 entries.
 */
export function recordRecentAction(action: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(RECENT_ACTIONS_KEY);
    const arr: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const next = [action, ...arr.filter((a) => a !== action)].slice(0, 10);
    window.localStorage.setItem(RECENT_ACTIONS_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable — silently ignore.
  }
}