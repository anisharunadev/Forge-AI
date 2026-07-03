'use client';

/**
 * Settings — AI Gateway tab.
 *
 * Provider routing matrix + a lightweight Sankey-style distribution
 * preview. Per the spec the preview sits above the table.
 *
 * Source: useApiData hits `/v1/admin/llm-gateway/routes` (or falls
 * back to []). When the endpoint is unreachable we render the
 * shared <ErrorState /> so the page never silently shows an empty
 * table.
 */

import * as React from 'react';
import { Cpu } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';

import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, SectionCard, EmptyState } from '@/components/shell';
import { DataTable } from '@/components/data';
import { ErrorState } from '@/components/error-state';
import {
  useAIGatewayHealth,
  useAIGatewayMcpServers,
  useAIGatewayModels,
  useAIGatewaySpend,
} from '@/lib/hooks/useSettings';

interface RouteRow {
  id: string;
  provider: string;
  model: string;
  weight: number;
  status: 'active' | 'paused' | 'error';
  costPerToken: number;
}

function statusTone(s: RouteRow['status']) {
  if (s === 'active') return 'success' as const;
  if (s === 'paused') return 'idle' as const;
  return 'danger' as const;
}

const columns: ReadonlyArray<ColumnDef<RouteRow>> = [
  { accessorKey: 'provider', header: 'Provider' },
  {
    accessorKey: 'model',
    header: 'Model',
    cell: ({ row }) => (
      <span className="font-mono text-xs text-[var(--fg-primary)]">
        {row.original.model}
      </span>
    ),
  },
  {
    accessorKey: 'weight',
    header: 'Weight',
    cell: ({ row }) => `${row.original.weight}%`,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <StatusPill
        tone={statusTone(row.original.status)}
        label={row.original.status}
      />
    ),
  },
  {
    accessorKey: 'costPerToken',
    header: 'Cost / 1k tok',
    cell: ({ row }) => `$${(row.original.costPerToken * 1000).toFixed(4)}`,
  },
];

function SankeyPreview({ routes }: { routes: ReadonlyArray<RouteRow> }) {
  if (routes.length === 0) return null;
  const total = routes.reduce((s, r) => s + r.weight, 0) || 1;
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-4">
      <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--fg-tertiary)]">
        Request distribution
      </p>
      <div className="mt-3 flex h-12 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
        {routes.map((r) => (
          <span
            key={r.id}
            className="flex items-center justify-center border-r border-[var(--border-subtle)] text-[10px] font-semibold uppercase tracking-wider text-white last:border-r-0"
            style={{
              width: `${(r.weight / total) * 100}%`,
              background:
                r.status === 'error'
                  ? 'var(--accent-rose)'
                  : r.status === 'paused'
                    ? 'var(--bg-inset)'
                    : 'var(--accent-primary)',
              color: r.status === 'paused' ? 'var(--fg-tertiary)' : 'white',
            }}
            title={`${r.provider} · ${r.weight}%`}
          >
            {r.weight >= 20 ? r.provider : ''}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[var(--fg-tertiary)]">
        Aggregated over the last 24h. Adjust weights in the routing table
        below.
      </p>
    </div>
  );
}

export function AIGatewayTab() {
  const modelsQ = useAIGatewayModels();
  const mcpQ = useAIGatewayMcpServers();
  const healthQ = useAIGatewayHealth();
  const spendQ = useAIGatewaySpend();

  const models = modelsQ.data ?? [];
  const mcpServers = mcpQ.data ?? [];
  const spend = spendQ.data ?? [];

  const routes: ReadonlyArray<RouteRow> = models.map((m) => ({
    id: m.name,
    provider: m.provider,
    model: m.name,
    weight: 0,
    status: 'active' as const,
    costPerToken: m.inputCost / 1_000_000,
  }));

  const loading = modelsQ.isLoading;
  const errored = modelsQ.error || mcpQ.error || healthQ.error || spendQ.error;

  return (
    <SectionCard
      title="AI Gateway"
      description="Provider routing matrix — weight each route and the gateway will distribute requests accordingly."
    >
      <SankeyPreview routes={routes} />
      <div className="mt-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : errored ? (
          <EmptyState
            icon={<Cpu className="h-5 w-5" aria-hidden="true" />}
            title="AI gateway unavailable"
            description="The LLM gateway endpoint returned an error. Try again or check the orchestrator."
            testId="ai-gateway-error-empty"
          />
        ) : routes.length === 0 ? (
          <EmptyState
            icon={<Cpu className="h-5 w-5" aria-hidden="true" />}
            title="No routes configured"
            description="Configure provider routing to balance cost, latency, and quality."
            testId="ai-gateway-empty"
          />
        ) : (
          <DataTable<RouteRow, unknown>
            data={[...routes]}
            columns={[...columns]}
            enableSorting
            getRowId={(row) => row.id}
          />
        )}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <GatewayStat
          label="Health"
          value={
            healthQ.data
              ? healthQ.data.healthy
                ? 'Healthy'
                : 'Degraded'
              : healthQ.isLoading
                ? '…'
                : '—'
          }
          tone={healthQ.data?.healthy ? 'success' : 'idle'}
        />
        <GatewayStat
          label="MCP servers"
          value={String(mcpServers.length)}
        />
        <GatewayStat
          label="Teams tracked"
          value={String(spend.length)}
        />
      </div>
    </SectionCard>
  );
}

function GatewayStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'idle';
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
        {label}
      </p>
      <p
        className={
          tone === 'success'
            ? 'mt-1 text-[var(--text-base)] font-semibold text-[var(--accent-emerald)]'
            : 'mt-1 text-[var(--text-base)] font-semibold text-[var(--fg-primary)]'
        }
      >
        {value}
      </p>
    </div>
  );
}

export const AIGatewayErrorFallback = () => (
  <ErrorState
    title="We couldn't load the AI gateway routes"
    description="The routing endpoint is temporarily unreachable. The gateway will pick up again once the orchestrator reconnects."
    onRetry={() => window.location.reload()}
    testId="ai-gateway-error"
  />
);