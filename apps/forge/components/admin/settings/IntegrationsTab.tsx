'use client';

/**
 * Settings — Integrations tab.
 * Summary of project connectors with CTA to /connector-center.
 */

import * as React from 'react';
import Link from 'next/link';
import { PlugZap, ExternalLink } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, SectionCard, EmptyState } from '@/components/shell';
import { DataTable } from '@/components/data';
import { useApiData } from '@/hooks/use-api-data';

import type { Connector } from '@/lib/connector-center/data';

const columns: ReadonlyArray<ColumnDef<Connector>> = [
  { accessorKey: 'displayName', header: 'Connector' },
  {
    accessorKey: 'category',
    header: 'Category',
    cell: ({ row }) => <StatusPill tone="info" label={row.original.category} />,
  },
  {
    accessorKey: 'status',
    header: 'Health',
    cell: ({ row }) => {
      const tone =
        row.original.status === 'healthy'
          ? 'success'
          : row.original.status === 'syncing'
            ? 'info'
            : row.original.status === 'stale'
              ? 'warn'
              : 'danger';
      return <StatusPill tone={tone} label={row.original.status} />;
    },
  },
  {
    accessorKey: 'errorRate24h',
    header: 'Error rate (24h)',
    cell: ({ row }) => `${(row.original.errorRate24h * 100).toFixed(1)}%`,
  },
];

export function IntegrationsTab() {
  const q = useApiData<ReadonlyArray<Connector>>('/v1/connector-center/connectors');
  const connectors = q.data ?? [];

  return (
    <SectionCard
      title="Integrations"
      description="Project connectors (MCP servers) and external system integrations."
      headerRight={
        <Button asChild data-testid="integrations-manage">
          <Link href="/connector-center">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Manage in Connector Center
          </Link>
        </Button>
      }
    >
      {q.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : connectors.length === 0 ? (
        <EmptyState
          icon={<PlugZap className="h-5 w-5" aria-hidden="true" />}
          title="No integrations"
          description="Install a connector from the Connector Center to wire an external system into this project."
          testId="integrations-empty"
        />
      ) : (
        <DataTable<Connector, unknown>
          data={connectors}
          columns={[...columns]}
          enableSorting
          getRowId={(row) => row.id}
        />
      )}
    </SectionCard>
  );
}
