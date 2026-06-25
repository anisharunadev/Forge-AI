'use client';

/**
 * Settings — Providers tab.
 * Lists tenant LLM providers with enable/disable toggle and Add dialog.
 */

import * as React from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { StatusPill, SectionCard, EmptyState } from '@/components/shell';
import { DataTable } from '@/components/data';
import { useToast } from '@/hooks/use-toast';

import { useProviders, useUpdateProvider } from '@/lib/hooks/useSettings';
import type { ModelProvider } from '@/lib/settings/types';
import { AddProviderDialog } from './AddProviderDialog';

const providerColumns = (
  onToggle: (id: string, enabled: boolean) => void,
): ReadonlyArray<ColumnDef<ModelProvider>> => [
  { accessorKey: 'name', header: 'Name' },
  {
    accessorKey: 'type',
    header: 'Type',
    cell: ({ row }) => <StatusPill tone="agent" label={row.original.type} />,
  },
  {
    accessorKey: 'litellmModelAlias',
    header: 'LiteLLM alias',
    cell: ({ row }) =>
      row.original.litellmModelAlias ?? (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: 'rateLimitRpm',
    header: 'RPM',
    cell: ({ row }) => row.original.rateLimitRpm ?? '—',
  },
  {
    accessorKey: 'rateLimitTpm',
    header: 'TPM',
    cell: ({ row }) => row.original.rateLimitTpm ?? '—',
  },
  {
    accessorKey: 'enabled',
    header: 'Enabled',
    cell: ({ row }) => (
      <Switch
        checked={row.original.enabled}
        onCheckedChange={(v) => onToggle(row.original.id, v)}
        data-testid={`provider-toggle-${row.original.id}`}
      />
    ),
  },
];

export function ProvidersTab() {
  const providersQ = useProviders();
  const update = useUpdateProvider();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await update.mutateAsync({ id, body: { enabled } });
      toast({ title: enabled ? 'Provider enabled' : 'Provider disabled' });
    } catch (err) {
      toast({
        title: 'Toggle failed',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    }
  };

  const providers = providersQ.data ?? [];

  return (
    <SectionCard
      title="Model providers"
      description="LLM providers available to this tenant. Toggle to enable or disable."
      headerRight={
        <Button onClick={() => setOpen(true)} data-testid="providers-add-button">
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Add provider
        </Button>
      }
    >
      {providersQ.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : providers.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="h-5 w-5" aria-hidden="true" />}
          title="No providers configured"
          description="Add a model provider to start routing agent traffic."
          testId="providers-empty"
        />
      ) : (
        <DataTable<ModelProvider, unknown>
          data={providers}
          columns={[...providerColumns(handleToggle)]}
          enableSorting
          getRowId={(row) => row.id}
        />
      )}
      <AddProviderDialog open={open} onOpenChange={setOpen} />
    </SectionCard>
  );
}
