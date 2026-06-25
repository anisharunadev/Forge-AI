'use client';

import * as React from 'react';
import { Loader2, RefreshCw, History as HistoryIcon } from 'lucide-react';

import type { ForgeCommand } from '@/lib/forge-commands';
import { useCommandHistory } from '@/hooks/use-command-history';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export interface CommandHistoryDrawerProps {
  command: ForgeCommand;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_TONE: Record<string, string> = {
  queued: 'border-muted bg-muted text-muted-foreground',
  running: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  succeeded: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  failed: 'border-destructive/40 bg-destructive/10 text-destructive',
  cancelled: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
};

/**
 * Drawer that shows the run history for a single forge-* command.
 *
 * Wired to `GET /api/v1/commands/{name}/runs` via useCommandHistory().
 * Replaces the previous dead-anchor `<a href="?history=...">` behavior.
 */
export function CommandHistoryDrawer({
  command,
  open,
  onOpenChange,
}: CommandHistoryDrawerProps) {
  const { runs, loading, error, refresh } = useCommandHistory(
    command.name,
    open,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg"
        data-testid="command-history-drawer"
        data-command={command.name}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <HistoryIcon className="h-4 w-4" aria-hidden="true" />
            Run history
          </SheetTitle>
          <SheetDescription>
            <code className="font-mono text-xs">{command.name}</code>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {runs.length} run{runs.length === 1 ? '' : 's'}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={refresh}
              data-testid="command-history-refresh"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              Refresh
            </Button>
          </div>

          {loading ? (
            <div
              className="flex items-center gap-2 p-8 text-sm text-muted-foreground"
              data-testid="command-history-loading"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading history…
            </div>
          ) : error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              Failed to load history: {error}
            </div>
          ) : runs.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No runs yet. Click <span className="font-medium">Run</span> on the
              command card to record the first one.
            </div>
          ) : (
            <ul role="list" className="flex flex-col gap-2">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="rounded-md border border-border bg-card p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <code className="font-mono text-xs text-muted-foreground">
                      {run.id}
                    </code>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px] uppercase tracking-wide',
                        STATUS_TONE[run.status] ?? STATUS_TONE.queued,
                      )}
                    >
                      {run.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Started {new Date(run.startedAt).toLocaleString()}
                  </p>
                  {run.durationMs != null ? (
                    <p className="text-xs text-muted-foreground">
                      Duration {(run.durationMs / 1000).toFixed(1)}s
                    </p>
                  ) : null}
                  {run.error ? (
                    <p className="mt-1 break-words text-xs text-destructive">
                      {run.error}
                    </p>
                  ) : run.message ? (
                    <p className="mt-1 break-words text-xs text-foreground">
                      {run.message}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
