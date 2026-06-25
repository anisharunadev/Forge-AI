/**
 * `/copilot` — direct route into the Co-pilot panel.
 *
 * Plan 3 — this page exists so the "Co-pilot" nav entry in
 * `nav-config.ts` resolves to something real. The page renders a
 * minimal placeholder and (on mount) toggles the right-side Co-pilot
 * panel open via `useCopilotStore`.
 *
 * TODO(F-800 Plan 4): the dedicated `/welcome` and `/copilot` pages
 * will get proper first-run flows (suggested prompts, persona-aware
 * greeting, etc). For Plan 3 we just open the panel.
 */

'use client';

import * as React from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCopilotStore } from '@/lib/store/copilot';

export default function CopilotRoutePage() {
  const open = useCopilotStore((s) => s.open);
  const setOpen = useCopilotStore((s) => s.setOpen);

  // Open the right-side Co-pilot panel on mount so the user sees
  // the surface immediately. The panel itself is mounted globally
  // by `ShellProvider` so we only flip its `open` flag here.
  React.useEffect(() => {
    if (!open) setOpen(true);
  }, [open, setOpen]);

  return (
    <main
      id="main-content"
      className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center"
      data-testid="copilot-route-page"
    >
      <Sparkles className="h-10 w-10 text-primary" aria-hidden="true" />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Forge Co-pilot
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The Co-pilot panel is opening on the right. You can also press{' '}
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
            ⌘J
          </kbd>{' '}
          (or <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
            Ctrl
          </kbd>
          +<kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">J</kbd>)
          from any page.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </main>
  );
}