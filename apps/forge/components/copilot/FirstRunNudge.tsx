'use client';

/**
 * One-time "Press ⌘J to chat with Co-pilot" tooltip.
 *
 * Mounted once at the ShellProvider boundary. Visibility is driven by
 * `useCopilotStore.firstRunDismissed`. Once the user clicks "Got it"
 * (or the underlying Cmd+J hotkey fires — see ShellProvider), the
 * dismissal is persisted to localStorage so the nudge never returns.
 *
 * F-800 Plan 4 — explicit handoff to F-805 for the full welcome
 * experience; this is intentionally a thin tooltip rather than a
 * first-run wizard.
 */

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { useCopilotStore } from '@/lib/store/copilot';

export function FirstRunNudge() {
  const firstRunDismissed = useCopilotStore((s) => s.firstRunDismissed);
  const dismissFirstRun = useCopilotStore((s) => s.dismissFirstRun);

  // Guard for SSR — the store defaults `firstRunDismissed` to `false`
  // on the server, so we wait for hydration before mounting the UI.
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => {
    setHydrated(true);
  }, []);

  if (!hydrated || firstRunDismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="copilot-first-run-nudge"
      className="pointer-events-auto fixed left-1/2 top-20 z-40 -translate-x-1/2 rounded-lg border bg-popover px-4 py-3 text-popover-foreground shadow-lg"
    >
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="text-lg">
          👋
        </span>
        <p className="text-sm">
          Press <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">⌘J</kbd>{' '}
          anytime to chat with Forge Co-pilot
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={dismissFirstRun}
          data-testid="copilot-first-run-dismiss"
        >
          Got it
        </Button>
      </div>
    </div>
  );
}