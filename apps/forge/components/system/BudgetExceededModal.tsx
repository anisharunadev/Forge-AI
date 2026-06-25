'use client';

/**
 * BudgetExceededModal — modal shown when a workflow's per-workflow
 * budget hits 100% (NFR-044 enforcement path).
 *
 * Wired in Phase C (Per-workflow budget UX). Phase B ships the
 * component so callers can mount it; the trigger comes from
 * TanStack Query results / Pulse events in Phase C.
 */

import * as React from 'react';
import { AlertCircle } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface BudgetExceededModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Workflow run id whose budget was exceeded. */
  readonly runId?: string;
  /** Tenant / project the budget belongs to. */
  readonly scope?: string;
  /** Optional override for the budget ceiling (USD). */
  readonly ceilingUsd?: number;
  /** Optional override for the actual spend at the time of breach. */
  readonly spendUsd?: number;
  /** Callback when the user asks to raise the budget. */
  readonly onRaiseBudget?: () => void;
}

export function BudgetExceededModal({
  open,
  onOpenChange,
  runId,
  scope,
  ceilingUsd,
  spendUsd,
  onRaiseBudget,
}: BudgetExceededModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="budget-exceeded-modal">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-red-500/10 text-red-500"
            >
              <AlertCircle className="h-4 w-4" />
            </span>
            <DialogTitle>Workflow budget exceeded</DialogTitle>
          </div>
          <DialogDescription>
            The workflow {runId ? <code className="font-mono">{runId}</code> : 'run'}{' '}
            attempted to spend past the configured ceiling{scope ? ` for ${scope}` : ''}.
            No further LLM calls will be admitted for this run until the budget is raised.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs">
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Spend</dt>
            <dd className="font-mono text-foreground">
              {spendUsd !== undefined ? `$${spendUsd.toFixed(2)}` : '—'}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Ceiling</dt>
            <dd className="font-mono text-foreground">
              {ceilingUsd !== undefined ? `$${ceilingUsd.toFixed(2)}` : '—'}
            </dd>
          </div>
        </dl>
        <DialogFooter>
          {onRaiseBudget ? (
            <Button onClick={onRaiseBudget} data-testid="budget-exceeded-raise">
              Raise budget
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="budget-exceeded-dismiss"
          >
            Acknowledge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
