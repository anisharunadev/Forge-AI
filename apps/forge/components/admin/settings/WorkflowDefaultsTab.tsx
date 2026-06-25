'use client';

/**
 * Settings — Workflow Defaults tab.
 * Surfaces the task→agent assignment matrix from /v1/agent-center/assignments.
 */

import * as React from 'react';
import { Workflow } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';

import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, SectionCard, EmptyState } from '@/components/shell';
import { DataTable } from '@/components/data';
import { useApiData } from '@/hooks/use-api-data';

import type { AgentAssignment } from '@/lib/agent-center/data';

const columns: ReadonlyArray<ColumnDef<AgentAssignment>> = [
  { accessorKey: 'taskType', header: 'Task type' },
  { accessorKey: 'agentId', header: 'Agent' },
  { accessorKey: 'providerId', header: 'Provider' },
  {
    accessorKey: 'enabled',
    header: 'Enabled',
    cell: ({ row }) => (
      <StatusPill
        tone={row.original.enabled ? 'success' : 'idle'}
        label={row.original.enabled ? 'enabled' : 'disabled'}
      />
    ),
  },
];

export function WorkflowDefaultsTab() {
  const q = useApiData<ReadonlyArray<AgentAssignment>>(
    '/v1/agent-center/assignments',
  );
  const assignments = q.data ?? [];

  return (
    <SectionCard
      title="Workflow defaults"
      description="Default agent and provider for each task type. Edits made here apply to new runs."
    >
      {q.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : assignments.length === 0 ? (
        <EmptyState
          icon={<Workflow className="h-5 w-5" aria-hidden="true" />}
          title="No task assignments"
          description="Configure task→agent mappings in the Agent Center to see them here."
          testId="workflow-empty"
        />
      ) : (
        <DataTable<AgentAssignment, unknown>
          data={assignments}
          columns={[...columns]}
          enableSorting
          getRowId={(row) => row.taskType}
        />
      )}
    </SectionCard>
  );
}
