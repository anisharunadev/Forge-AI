'use client';

/**
 * ApprovalCard — single Pending Approval card with Approve (gated by
 * confirmation modal), Decline, and Open actions.
 *
 * Step-59 migration: was reading the `ApprovalRequest` type from
 * `@/lib/governance/data`. The approvals endpoint isn't on the
 * LiteLLM-backed governance surface yet, so the type now lives in
 * `useForgeFixtures.ts` alongside the inline fixture array. Once
 * `/v1/governance/approvals` ships on the backend, this component
 * should consume a TanStack Query hook (mirroring `useAuditEvents`)
 * and route accept/decline through `useMutation`.
 *
 * Phase 0.5-08:
 *   - Loading + disabled state on every action (Constraint).
 *   - Approve opens a confirmation modal (Dialog with role=alertdialog)
 *     showing the impact text from the spec.
 *   - Decline fires immediately with toast success/error feedback.
 *   - Toast success + error for every action.
 *
 * Per Paperclip schema, Accept requires the Board token. If absent the
 * Approve button is disabled and the title explains why.
 */

import * as React from 'react';
import {
  CheckCircle2,
  XCircle,
  ExternalLink,
  Loader2,
  ShieldAlert,
} from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import {
  FIXTURE_PENDING_APPROVALS,
  type ApprovalRequest,
} from '@/lib/hooks/useForgeFixtures';

export interface ApprovalCardProps {
  /** Optional override — defaults to the first pending approval in
   *  the fixture array. */
  approval?: ApprovalRequest;
  boardTokenPresent: boolean;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function ApprovalCard({
  approval: approvalProp,
  boardTokenPresent,
}: ApprovalCardProps) {
  const approval = approvalProp ?? FIXTURE_PENDING_APPROVALS[0];
  const { toast } = useToast();
  const [approving, setApproving] = React.useState(false);
  const [declining, setDeclining] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // Without a fixture row to fall back on, render nothing rather
  // than crashing. The original component assumed the caller
  // always supplied an approval.
  if (!approval) return null;

  const submitter =
    approval.decider?.displayName ?? approval.kind.replace(/_/g, ' ');
  const submitterRole = approval.kind === 'request_confirmation' ? 'Agent · LLM' : 'System';

  const handleApproveConfirm = React.useCallback(async () => {
    setApproving(true);
    try {
      // The page would call `acceptApproval(approval.id)` here; we
      // simulate a 600ms round-trip so the loading state is visible.
      await new Promise((resolve) => setTimeout(resolve, 600));
      setDialogOpen(false);
      toast({
        title: 'Approval accepted',
        description: `${approval.title} was accepted.`,
      });
    } catch (err) {
      toast({
        title: 'Approval failed',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    } finally {
      setApproving(false);
    }
  }, [approval.title, toast]);

  const handleDecline = React.useCallback(async () => {
    if (declining) return;
    setDeclining(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      toast({
        title: 'Approval declined',
        description: `${approval.title} was declined.`,
      });
    } catch (err) {
      toast({
        title: 'Decline failed',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    } finally {
      setDeclining(false);
    }
  }, [approval.title, declining, toast]);

  return (
    <article
      className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      data-testid={`pending-row-${approval.id}`}
      data-state={approval.state}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {/* Left: avatar + submitter meta */}
        <div className="flex items-start gap-3 md:w-56">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-[var(--bg-inset)] text-[var(--text-xs)] text-[var(--fg-secondary)]">
              {initials(submitter)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <p className="truncate text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
              {submitter}
            </p>
            <p className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
              {submitterRole}
            </p>
            <p className="font-mono text-[var(--text-xs)] text-[var(--fg-tertiary)]">
              {approval.createdAt}
            </p>
          </div>
        </div>

        {/* Center: title + snippet */}
        <div className="flex-1">
          <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--fg-tertiary)]">
            {approval.kind.replace(/_/g, ' ')}
          </p>
          <p className="mt-1 text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
            {approval.title}
          </p>
          <p className="mt-1 line-clamp-2 text-[var(--text-xs)] text-[var(--fg-secondary)]">
            {approval.prompt}
          </p>
        </div>

        {/* Right: actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 md:w-auto">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={approving || declining}
            data-testid={`page-open-${approval.id}`}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Open
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={declining || approving}
            onClick={handleDecline}
            className="border-[var(--accent-rose)]/40 text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/10"
            data-testid={`page-decline-${approval.id}`}
            data-action="decline"
          >
            {declining ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Decline
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!boardTokenPresent || approving || declining}
            onClick={() => setDialogOpen(true)}
            className="bg-[var(--accent-emerald)] text-white hover:bg-[var(--accent-emerald)]/90"
            data-testid={`page-accept-${approval.id}`}
            data-action="accept"
            title={
              boardTokenPresent
                ? 'Accept this request'
                : 'Board access required — only the Board token can accept request_confirmation.'
            }
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Approve
          </Button>
        </div>
      </div>

      {/* Approval confirmation modal — uses Dialog with role=alertdialog
          semantics (matches shadcn AlertDialog behavior without bringing
          in a new Radix package). */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent role="alertdialog" data-testid={`approval-confirm-${approval.id}`}>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <ShieldAlert
                className="h-5 w-5 text-[var(--accent-primary)]"
                aria-hidden="true"
              />
              <DialogTitle>Confirm approval</DialogTitle>
            </div>
            <DialogDescription>
              You are about to accept{' '}
              <span className="font-medium text-[var(--fg-primary)]">
                {approval.title}
              </span>{' '}
              for tenant{' '}
              <span className="font-mono text-[var(--fg-primary)]">acme-corp</span>.
              This action is recorded in the Board audit log and cannot
              be silently reverted.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-[var(--text-xs)] text-[var(--fg-secondary)]">
            <p className="font-medium text-[var(--fg-primary)]">Impact</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>Type: {approval.kind.replace(/_/g, ' ')}</li>
              <li>Submitter: {submitter}</li>
              <li>Created: <span className="font-mono">{approval.createdAt}</span></li>
              <li>Tenant: <span className="font-mono">acme-corp</span></li>
            </ul>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDialogOpen(false)}
              disabled={approving}
              data-testid={`approval-confirm-cancel-${approval.id}`}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleApproveConfirm}
              disabled={approving}
              className="bg-[var(--accent-emerald)] text-white hover:bg-[var(--accent-emerald)]/90"
              data-testid={`approval-confirm-confirm-${approval.id}`}
            >
              {approving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Accepting…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Confirm accept
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}