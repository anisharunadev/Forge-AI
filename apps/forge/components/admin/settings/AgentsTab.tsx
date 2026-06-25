'use client';

/**
 * Settings — Agents tab.
 *
 * Lists all agents known to the project. Row click opens the
 * `EditAgentConfigDialog` so the user can edit per-project runtime
 * config (system prompt, temperature, model, max tokens).
 *
 * The agent list comes from the existing `/v1/agent-center/agents`
 * endpoint via `useApiData` — the same fetch the agent-center page
 * uses. We only override the per-project config (the second
 * concern), not the agent registry itself.
 */

import * as React from 'react';
import { Bot } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';

import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, SectionCard, EmptyState } from '@/components/shell';
import { DataTable } from '@/components/data';
import { useApiData } from '@/hooks/use-api-data';

import { listAgents, type Agent } from '@/lib/agent-center/data';
import { EditAgentConfigDialog } from './EditAgentConfigDialog';

const agentColumns: ReadonlyArray<ColumnDef<Agent>> = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => row.original.name,
  },
  {
    accessorKey: 'type',
    header: 'Type',
    cell: ({ row }) => <StatusPill tone="agent" label={row.original.type} />,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const tone =
        row.original.status === 'active'
          ? 'success'
          : row.original.status === 'degraded'
            ? 'warn'
            : row.original.status === 'offline'
              ? 'danger'
              : 'idle';
      return <StatusPill tone={tone} label={row.original.status} />;
    },
  },
  {
    accessorKey: 'version',
    header: 'Version',
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{row.original.version}</span>
    ),
  },
  {
    accessorKey: 'defaultProvider',
    header: 'Provider',
    cell: ({ row }) => row.original.defaultProvider,
  },
  {
    accessorKey: 'invocations24h',
    header: 'Calls (24h)',
    cell: ({ row }) => row.original.invocations24h.toLocaleString(),
  },
];

export function AgentsTab() {
  const agentsQ = useApiData<ReadonlyArray<Agent>>('/v1/agent-center/agents');
  const agents = agentsQ.data ?? [];
  const [open, setOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedName, setSelectedName] = React.useState<string | undefined>(
    undefined,
  );

  const handleRowClick = (a: Agent) => {
    setSelectedId(a.id);
    setSelectedName(a.name);
    setOpen(true);
  };

  return (
    <SectionCard
      title="Agents"
      description="Per-project agent runtime config. Click a row to edit system prompt, temperature, and model."
    >
      {agentsQ.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : agents.length === 0 ? (
        <EmptyState
          icon={<Bot className="h-5 w-5" aria-hidden="true" />}
          title="No agents registered"
          description="Agents registered in the Agent Center will appear here for per-project configuration."
          testId="agents-empty"
        />
      ) : (
        <DataTable<Agent, unknown>
          data={agents}
          columns={[...agentColumns]}
          enableSorting
          getRowId={(row) => row.id}
          onRowSelectionChange={(rows) => {
            if (rows[0]) handleRowClick(rows[0]);
          }}
        />
      )}

      <EditAgentConfigDialog
        agentId={selectedId}
        agentName={selectedName}
        open={open}
        onOpenChange={setOpen}
      />
    </SectionCard>
  );
}
