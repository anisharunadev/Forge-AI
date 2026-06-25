'use client';

/**
 * /admin/llm-gateway/tenants — tenant list with LLM status.
 *
 * Shows the seed project's tenants with their LiteLLM-side config:
 * key presence, budget, guardrails. The list is read-only at this
 * level — drilling in opens the per-tenant config page.
 *
 * For the seed demo project, we render a single representative
 * tenant row (the follow-up FORA-128 `useTenantProject` migration
 * will switch the list to a real query).
 */

import * as React from 'react';
import Link from 'next/link';
import { Building2, KeyRound, ShieldCheck, Wallet } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';

import { AdminShell } from '@/components/admin/AdminShell';
import { PageHeader, SectionCard, StatusPill, EmptyState } from '@/components/shell';
import { DataTable } from '@/components/data';
import { Skeleton } from '@/components/ui/skeleton';

import { useTenantLLMConfig } from '@/lib/hooks/useLiteLLM';
import type { TenantLLMConfig } from '@/lib/litellm/data';

interface TenantRow {
  readonly id: string;
  readonly name: string;
  readonly config?: TenantLLMConfig;
}

const SEED_TENANTS: ReadonlyArray<TenantRow> = [
  {
    id: 'tenant-acme',
    name: 'ACME (Steward demo)',
  },
];

function TenantConfigCell({ tenantId }: { tenantId: string }) {
  const q = useTenantLLMConfig(tenantId);
  if (q.isLoading) {
    return <Skeleton className="h-5 w-24" />;
  }
  if (q.data) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px]">
          <KeyRound className="h-3 w-3" aria-hidden="true" />
          {q.data.has_virtual_key ? 'Key' : 'No key'}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px]">
          <Wallet className="h-3 w-3" aria-hidden="true" />
          {q.data.budget_max_usd !== null
            ? `$${q.data.budget_max_usd.toFixed(0)}`
            : 'No budget'}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px]">
          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
          {q.data.guardrail_ids.length} guardrails
        </span>
      </div>
    );
  }
  return (
    <StatusPill tone="warn" label="Unreachable" size="sm" />
  );
}

const columns: ReadonlyArray<ColumnDef<TenantRow>> = [
  {
    accessorKey: 'name',
    header: 'Tenant',
    cell: ({ row }) => (
      <Link
        href={`/admin/llm-gateway/tenants/${row.original.id}`}
        className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
        data-testid={`tenant-link-${row.original.id}`}
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: 'llm',
    header: 'LLM status',
    cell: ({ row }) => <TenantConfigCell tenantId={row.original.id} />,
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => (
      <Link
        href={`/admin/llm-gateway/tenants/${row.original.id}`}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Configure →
      </Link>
    ),
  },
];

export default function LLMGatewayTenantsPage() {
  return (
    <AdminShell>
      <div
        className="flex flex-col gap-6"
        data-testid="llm-gateway-tenants"
        data-page-title="LLM Gateway · Tenants"
      >
        <PageHeader
          eyebrow="LLM Gateway"
          title="Tenants"
          icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
          description="Tenants with their LiteLLM-side config: Virtual Key, budget, and guardrails. Click a tenant to manage keys and assignments."
          breadcrumbs={[
            { label: 'LLM Gateway', href: '/admin/llm-gateway' },
            { label: 'Tenants' },
          ]}
        />

        <SectionCard title="Tenants" description="One row per tenant.">
          <DataTable<TenantRow, unknown>
            data={SEED_TENANTS}
            columns={[...columns]}
            getRowId={(row) => row.id}
            emptyState={
              <EmptyState
                icon={<Building2 className="h-5 w-5" aria-hidden="true" />}
                title="No tenants yet"
                description="A tenant will appear here when the first Forge tenant is provisioned."
                testId="tenants-empty"
              />
            }
          />
        </SectionCard>
      </div>
    </AdminShell>
  );
}
