'use client';

/**
 * KeyListTable — list of a tenant's LiteLLM Virtual Keys.
 *
 * CRITICAL SECURITY NOTE
 * ----------------------
 * This component MUST NEVER render the key value. The list endpoint
 * returns metadata only (alias, fingerprint, last_used, status);
 * we explicitly type the row shape to *not* include a value field
 * so even a misbehaving server cannot leak a secret into the DOM.
 *
 * The fingerprint is a short sha256 prefix used for correlation
 * with LiteLLM's own spend logs.
 */

import * as React from 'react';
import { KeyRound, RefreshCcw, ShieldOff } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, EmptyState } from '@/components/shell';
import { DataTable } from '@/components/data';
import { useToast } from '@/hooks/use-toast';

import {
  useRevokeTenantKey,
  useRotateTenantKey,
  useTenantKeys,
} from '@/lib/hooks/useLiteLLM';
import type { VirtualKeyMetadata, VirtualKeyStatus } from '@/lib/litellm/data';

const STATUS_TONE: Record<VirtualKeyStatus, React.ComponentProps<typeof StatusPill>['tone']> = {
  active: 'success',
  rotated: 'warn',
  revoked: 'danger',
};

const STATUS_GLYPH: Record<VirtualKeyStatus, React.ComponentProps<typeof StatusPill>['glyph']> = {
  active: '✓',
  rotated: '◑',
  revoked: '✕',
};

const STATUS_LABEL: Record<VirtualKeyStatus, string> = {
  active: 'Active',
  rotated: 'Rotated',
  revoked: 'Revoked',
};

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso) - Date.parse('2026-06-21T09:30:00Z');
  const abs = Math.abs(ms);
  if (abs < 60_000) return 'just now';
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ago`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ago`;
  return `${Math.round(abs / 86_400_000)}d ago`;
}

function statusPill(status: VirtualKeyStatus) {
  return (
    <StatusPill
      tone={STATUS_TONE[status]}
      glyph={STATUS_GLYPH[status]}
      label={STATUS_LABEL[status]}
      size="sm"
    />
  );
}

export interface KeyListTableProps {
  readonly tenantId: string;
}

export function KeyListTable({ tenantId }: KeyListTableProps) {
  const keysQ = useTenantKeys(tenantId);
  const rotate = useRotateTenantKey();
  const revoke = useRevokeTenantKey();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);

  const rows = keysQ.data ?? [];

  const handleRotate = async (row: VirtualKeyMetadata) => {
    setBusy(row.alias || row.id);
    try {
      await rotate.mutateAsync({ tenantId, body: {} });
      toast({ title: 'Key rotated', description: 'A new Virtual Key was minted.' });
    } catch (err) {
      toast({
        title: 'Rotate failed',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleRevoke = async (row: VirtualKeyMetadata) => {
    setBusy(row.alias || row.id);
    try {
      await revoke.mutateAsync({
        tenantId,
        keyId: row.id,
        body: { reason: 'steward_revoke' },
      });
      toast({
        title: 'Key revoked',
        description: 'The Virtual Key can no longer be used to make LLM calls.',
      });
    } catch (err) {
      toast({
        title: 'Revoke failed',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const columns: ReadonlyArray<ColumnDef<VirtualKeyMetadata>> = [
    {
      accessorKey: 'alias',
      header: 'Alias',
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.alias || '—'}</span>
      ),
    },
    {
      accessorKey: 'fingerprint',
      header: 'Fingerprint',
      cell: ({ row }) => (
        <span
          className="font-mono text-xs text-muted-foreground"
          data-testid={`key-fingerprint-${row.original.id}`}
        >
          {row.original.fingerprint ? row.original.fingerprint.slice(0, 12) : '—'}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => statusPill(row.original.status),
    },
    {
      accessorKey: 'created_at',
      header: 'Created',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {fmtRelative(row.original.created_at)}
        </span>
      ),
    },
    {
      accessorKey: 'last_used_at',
      header: 'Last used',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {fmtRelative(row.original.last_used_at)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const isBusy = busy === (row.original.alias || row.original.id);
        const canAct = row.original.status !== 'revoked';
        return (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={!canAct || isBusy}
              onClick={() => handleRotate(row.original)}
              data-testid={`key-rotate-${row.original.id}`}
            >
              <RefreshCcw className="mr-1 h-3 w-3" aria-hidden="true" />
              Rotate
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canAct || isBusy}
              onClick={() => handleRevoke(row.original)}
              data-testid={`key-revoke-${row.original.id}`}
            >
              <ShieldOff className="mr-1 h-3 w-3" aria-hidden="true" />
              Revoke
            </Button>
          </div>
        );
      },
    },
  ];

  if (keysQ.isLoading) {
    return (
      <div className="space-y-2" data-testid="key-list-loading">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (keysQ.isError) {
    return (
      <EmptyState
        icon={<KeyRound className="h-5 w-5" aria-hidden="true" />}
        title="Could not load keys"
        description="The LiteLLM audit log was unreachable. Try again in a moment."
        testId="key-list-error"
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<KeyRound className="h-5 w-5" aria-hidden="true" />}
        title="No Virtual Keys yet"
        description="A key will be minted automatically the first time this tenant makes an LLM call."
        testId="key-list-empty"
      />
    );
  }

  return (
    <DataTable<VirtualKeyMetadata, unknown>
      data={rows}
      columns={[...columns]}
      getRowId={(row) => row.id || row.alias}
    />
  );
}
