'use client';

import * as React from 'react';
import { CheckCircle2, Loader2, Terminal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ForgeCommand } from '@/lib/forge-commands';
import { useForgeCommands, type RunStatus } from '@/hooks/use-forge-commands';

export interface CommandRunDialogProps {
  command: ForgeCommand | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

function StatusLine({ status }: { status: RunStatus }) {
  if (status === 'queued' || status === 'running') {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Executing command…
      </div>
    );
  }
  if (status === 'succeeded') {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-500">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Command completed successfully.
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        Command failed. See the audit log for details.
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Terminal className="h-4 w-4" aria-hidden="true" />
      Idle.
    </div>
  );
}

export function CommandRunDialog({
  command,
  open,
  onOpenChange,
}: CommandRunDialogProps) {
  const { run, runs } = useForgeCommands();
  const state = command ? runs[command.name] : undefined;

  React.useEffect(() => {
    if (!open || !command) return;
    if (state && (state.status === 'succeeded' || state.status === 'failed')) {
      return;
    }
    void run(command);
    // We intentionally only auto-run on dialog open + command change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, command?.name]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="h-4 w-4" aria-hidden="true" />
            {command?.label ?? 'Run command'}
          </DialogTitle>
          <DialogDescription>
            <code className="break-all text-xs">{command?.name}</code>
            <p className="mt-2 text-sm text-muted-foreground">
              {command?.description}
            </p>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-dashed border-border p-4">
          <StatusLine status={state?.status ?? 'idle'} />
          {state?.message ? (
            <p className="mt-2 text-xs text-muted-foreground">{state.message}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {command ? (
            <Button onClick={() => void run(command)}>Re-run</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
