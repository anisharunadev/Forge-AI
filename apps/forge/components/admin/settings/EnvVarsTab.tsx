'use client';

/**
 * Settings — Env Vars tab.
 *
 * Lists per-project secrets with masked values. The eye icon
 * triggers a one-shot reveal call (server-audited as
 * `envvar.reveal`); copy and delete also wired.
 */

import * as React from 'react';
import {
  Eye,
  EyeOff,
  Copy,
  Trash2,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, SectionCard, EmptyState } from '@/components/shell';
import { DataTable } from '@/components/data';
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
  useDeleteEnvVar,
  useEnvVars,
  useRevealEnvVar,
} from '@/lib/hooks/useSettings';
import type { EnvVar } from '@/lib/settings/types';
import { AddEnvVarDialog } from './AddEnvVarDialog';

interface RowState {
  revealed: boolean;
  revealedValue: string | null;
}

export function EnvVarsTab() {
  const envVarsQ = useEnvVars();
  const reveal = useRevealEnvVar();
  const del = useDeleteEnvVar();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null);
  const [rowState, setRowState] = React.useState<Record<string, RowState>>({});

  const envVars = envVarsQ.data ?? [];

  const handleReveal = async (key: string) => {
    const current = rowState[key];
    if (current?.revealed) {
      setRowState((s) => ({ ...s, [key]: { revealed: false, revealedValue: null } }));
      return;
    }
    try {
      const r = await reveal.mutateAsync(key);
      setRowState((s) => ({ ...s, [key]: { revealed: true, revealedValue: r.value } }));
    } catch (err) {
      toast({
        title: 'Reveal failed',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    }
  };

  const handleCopy = async (key: string) => {
    const value = rowState[key]?.revealedValue;
    if (!value) {
      toast({ title: 'Reveal the value first', variant: 'destructive' });
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `Copied ${key} to clipboard` });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  };

  const handleDelete = async (key: string) => {
    try {
      await del.mutateAsync(key);
      toast({ title: `Deleted ${key}` });
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    }
  };

  const columns: ReadonlyArray<ColumnDef<EnvVar>> = [
    { accessorKey: 'key', header: 'Key' },
    {
      accessorKey: 'scope',
      header: 'Scope',
      cell: ({ row }) => <StatusPill tone="info" label={row.original.scope} />,
    },
    {
      id: 'value',
      header: 'Value',
      cell: ({ row }) => {
        const state = rowState[row.original.key];
        return (
          <div className="flex items-center gap-2">
            <code className="text-xs text-muted-foreground">
              {state?.revealed ? state.revealedValue : row.original.maskedValue}
            </code>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => void handleReveal(row.original.key)}
              data-testid={`envvar-reveal-${row.original.key}`}
            >
              {state?.revealed ? (
                <EyeOff className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Eye className="h-3 w-3" aria-hidden="true" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => void handleCopy(row.original.key)}
              data-testid={`envvar-copy-${row.original.key}`}
            >
              <Copy className="h-3 w-3" aria-hidden="true" />
            </Button>
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive"
          onClick={() => setPendingDelete(row.original.key)}
          data-testid={`envvar-delete-${row.original.key}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      ),
    },
  ];

  return (
    <SectionCard
      title="Environment variables"
      description="Per-project secrets available to workflows and agents. Values are encrypted at rest."
      headerRight={
        <Button onClick={() => setOpen(true)} data-testid="envvars-add-button">
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Add variable
        </Button>
      }
    >
      <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Values never appear in audit logs. Reveal actions are recorded
        as <code className="rounded bg-background px-1">envvar.reveal</code>.
      </div>
      {envVarsQ.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : envVars.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
          title="No environment variables"
          description="Add a secret to make it available to workflows and agents in this project."
          testId="envvars-empty"
        />
      ) : (
        <DataTable<EnvVar, unknown>
          data={envVars}
          columns={[...columns]}
          enableSorting
          getRowId={(row) => row.id}
        />
      )}
      <AddEnvVarDialog open={open} onOpenChange={setOpen} />
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <DialogContent data-testid="envvar-confirm-delete">
          <DialogHeader>
            <DialogTitle>Delete {pendingDelete}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the secret. The action is recorded
              in the audit log and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)} type="button">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) void handleDelete(pendingDelete);
                setPendingDelete(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
