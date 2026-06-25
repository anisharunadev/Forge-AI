'use client';

/**
 * F-800 — Command confirm modal.
 *
 * Opens when the user clicks a `run_command`-type suggested action.
 * Shows the proposed command (command_id + inputs), estimated cost,
 * duration, and side effects. Two actions:
 *   - "Run"   — dispatches the command via the existing forge-*
 *               command runner (Plan 6 wires the toast; for Plan 3
 *               we surface a confirmation toast).
 *   - "Cancel" — closes the modal.
 */

import * as React from 'react';
import { Play } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import type { CopilotSuggestedAction } from '@/lib/api/copilot';

export interface CommandConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: CopilotSuggestedAction | null;
}

interface CommandPayload {
  command_id?: string;
  inputs?: Record<string, unknown>;
  estimated_cost_usd?: number;
  estimated_duration_ms?: number;
  side_effects?: string[];
}

function readPayload(action: CopilotSuggestedAction | null): CommandPayload {
  if (!action) return {};
  const payload = action.payload as CommandPayload;
  return {
    command_id: typeof payload.command_id === 'string' ? payload.command_id : '',
    inputs:
      typeof payload.inputs === 'object' && payload.inputs !== null
        ? payload.inputs
        : {},
    estimated_cost_usd:
      typeof payload.estimated_cost_usd === 'number'
        ? payload.estimated_cost_usd
        : undefined,
    estimated_duration_ms:
      typeof payload.estimated_duration_ms === 'number'
        ? payload.estimated_duration_ms
        : undefined,
    side_effects: Array.isArray(payload.side_effects)
      ? (payload.side_effects as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : [],
  };
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest.toFixed(0)}s`;
}

/**
 * Modal that gates execution of a Co-pilot-proposed command. The
 * actual forge-* dispatch lands in Plan 6 — for Plan 3 we surface a
 * confirmation toast so the UI flow is testable end-to-end.
 */
export function CommandConfirmModal({
  open,
  onOpenChange,
  action,
}: CommandConfirmModalProps) {
  const { toast } = useToast();
  const proposal = React.useMemo(() => readPayload(action), [action]);

  const handleRun = React.useCallback(() => {
    toast({
      title: 'Command queued',
      description: `${proposal.command_id ?? 'command'} dispatched to the Command Center.`,
      variant: 'default',
    });
    onOpenChange(false);
  }, [toast, proposal.command_id, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="copilot-command-confirm-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-4 w-4" aria-hidden="true" />
            Confirm command
          </DialogTitle>
          <DialogDescription>
            Co-pilot wants to run the following command. Review the
            inputs and side effects before continuing.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Command
            </p>
            <code
              className="block rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs"
              data-testid="copilot-command-confirm-id"
            >
              {proposal.command_id ?? '(unknown)'}
            </code>
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Inputs
            </p>
            <pre className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px]">
              {JSON.stringify(proposal.inputs ?? {}, null, 2)}
            </pre>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Est. cost
              </p>
              <p className="text-sm font-medium">
                $
                {proposal.estimated_cost_usd !== undefined
                  ? proposal.estimated_cost_usd.toFixed(4)
                  : '—'}
              </p>
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Est. duration
              </p>
              <p className="text-sm font-medium">
                {formatDuration(proposal.estimated_duration_ms)}
              </p>
            </div>
          </div>
          {proposal.side_effects && proposal.side_effects.length > 0 ? (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Side effects
              </p>
              <ul role="list" className="list-disc pl-5 text-xs">
                {proposal.side_effects.map((s, i) => (
                  <li key={`${s}-${i}`}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="copilot-command-confirm-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleRun}
            data-testid="copilot-command-confirm-run"
          >
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}