'use client';

/**
 * Settings — Audit tab.
 * Filtered view of audit events scoped to settings actions.
 */

import * as React from 'react';
import { History } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';

import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, SectionCard, EmptyState } from '@/components/shell';
import { DataTable } from '@/components/data';

import { useAuditSettings } from '@/lib/hooks/useSettings';
import type { AuditEvent } from '@/lib/settings/types';

const SETTINGS_TARGETS: ReadonlyArray<AuditEvent['targetType']> = [
  'project',
  'member',
  'agent',
  'model_provider',
  'envvar',
];

const actionTone = (action: string): 'success' | 'warn' | 'danger' | 'info' | 'idle' => {
  if (action.startsWith('delete') || action.startsWith('remove') || action.endsWith('.remove')) return 'danger';
  if (action.startsWith('invite') || action.endsWith('.invite')) return 'info';
  if (action.startsWith('rotate') || action.endsWith('.reveal')) return 'warn';
  if (action.includes('create') || action.includes('update') || action.includes('accept')) return 'success';
  return 'idle';
};

const columns: ReadonlyArray<ColumnDef<AuditEvent>> = [
  {
    accessorKey: 'occurredAt',
    header: 'When',
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {new Date(row.original.occurredAt).toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: 'actorEmail',
    header: 'Actor',
    cell: ({ row }) =>
      row.original.actorEmail ?? (
        <span className="text-muted-foreground">system</span>
      ),
  },
  {
    accessorKey: 'action',
    header: 'Action',
    cell: ({ row }) => (
      <StatusPill tone={actionTone(row.original.action)} label={row.original.action} />
    ),
  },
  {
    accessorKey: 'targetType',
    header: 'Target',
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.targetType}</span>
    ),
  },
  {
    accessorKey: 'targetId',
    header: 'Target ID',
    cell: ({ row }) => (
      <code className="text-xs text-muted-foreground">
        {row.original.targetId.slice(0, 8)}…
      </code>
    ),
  },
];

export function AuditTab() {
  const q = useAuditSettings({ targetTypes: SETTINGS_TARGETS, limit: 50 });
  const events = q.data ?? [];

  return (
    <SectionCard
      title="Audit log"
      description="Settings-scoped events: project updates, member changes, agent config, providers, and env vars."
    >
      {q.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={<History className="h-5 w-5" aria-hidden="true" />}
          title="No audit events yet"
          description="Settings changes will appear here. Each mutation is recorded with actor, action, and redacted payload."
          testId="audit-empty"
        />
      ) : (
        <DataTable<AuditEvent, unknown>
          data={events}
          columns={[...columns]}
          enableSorting
          getRowId={(row) => row.id}
        />
      )}
    </SectionCard>
  );
}
