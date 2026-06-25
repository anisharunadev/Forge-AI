'use client';

/**
 * /admin/llm-gateway/tenants/[id] — per-tenant LLM config.
 *
 * Surfaces the tenant's:
 *   - LiteLLM Team mapping status
 *   - Virtual Key lifecycle (link to /keys)
 *   - Budget (read-only; write UX lands in Phase C)
 *   - Guardrail assignment (multi-select)
 */

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Building2, KeyRound, ShieldCheck, Wallet, ExternalLink } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { PageHeader, SectionCard, StatusPill, EmptyState } from '@/components/shell';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

import { useTenantLLMConfig } from '@/lib/hooks/useLiteLLM';
import { GuardrailSelector, BudgetDisplay } from '@/components/admin/llm-gateway';

function StatusRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

export default function TenantLLMConfigPage() {
  const params = useParams<{ id: string }>();
  const tenantId = params?.id ?? '';
  const q = useTenantLLMConfig(tenantId);

  if (q.isLoading) {
    return (
      <AdminShell>
        <div className="flex flex-col gap-4" data-testid="tenant-config-loading">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </AdminShell>
    );
  }

  if (q.isError || !q.data) {
    return (
      <AdminShell>
        <div className="flex flex-col gap-6" data-testid="tenant-config-error">
          <PageHeader
            eyebrow="LLM Gateway"
            title="Tenant"
            icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
            breadcrumbs={[
              { label: 'LLM Gateway', href: '/admin/llm-gateway' },
              { label: 'Tenants', href: '/admin/llm-gateway/tenants' },
              { label: tenantId },
            ]}
          />
          <EmptyState
            icon={<Building2 className="h-5 w-5" aria-hidden="true" />}
            title="Could not load tenant config"
            description="The LiteLLM proxy did not respond. Try again in a moment."
            testId="tenant-config-error-empty"
          />
        </div>
      </AdminShell>
    );
  }

  const cfg = q.data;
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  return (
    <AdminShell>
      <div
        className="flex flex-col gap-6"
        data-testid="tenant-config"
        data-page-title={`Tenant ${tenantId}`}
      >
        <PageHeader
          eyebrow="LLM Gateway · Tenant"
          title={tenantId}
          icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
          description="Per-tenant LLM gateway configuration."
          breadcrumbs={[
            { label: 'LLM Gateway', href: '/admin/llm-gateway' },
            { label: 'Tenants', href: '/admin/llm-gateway/tenants' },
            { label: tenantId },
          ]}
          action={
            <Button asChild variant="outline">
              <Link
                href={`/admin/llm-gateway/tenants/${tenantId}/keys`}
                data-testid="tenant-config-keys-link"
              >
                <KeyRound className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Virtual Keys
                <ExternalLink className="ml-1.5 h-3 w-3" aria-hidden="true" />
              </Link>
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionCard
            title="LiteLLM Team"
            description="The 1:1 Forge tenant ↔ LiteLLM Team mapping."
          >
            <StatusRow
              label="Team id"
              value={cfg.litellm_team_id ?? <span className="text-muted-foreground">Not provisioned</span>}
            />
            <StatusRow
              label="Status"
              value={
                cfg.litellm_team_id ? (
                  <StatusPill
                    tone="success"
                    label={cfg.litellm_team_status ?? 'active'}
                    size="sm"
                  />
                ) : (
                  <StatusPill tone="warn" label="Missing" size="sm" />
                )
              }
            />
            <StatusRow
              label="Model alias"
              value={cfg.model_alias ?? <span className="text-muted-foreground">Default</span>}
            />
          </SectionCard>

          <SectionCard
            title="Budget"
            description="Per-tenant spend against the configured ceiling."
            headerRight={
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Wallet className="h-3 w-3" aria-hidden="true" />
                {cfg.budget_period ?? 'monthly'}
              </span>
            }
          >
            <BudgetDisplay
              spend={cfg.budget_spend_usd ?? 0}
              ceiling={cfg.budget_max_usd ?? 500}
              periodStart={periodStart}
              periodEnd={periodEnd}
            />
          </SectionCard>
        </div>

        <SectionCard
          title="Guardrails"
          description="Per-tenant LiteLLM guardrail assignments. OQ-34: custom regex uses the LiteLLM admin UI."
          headerRight={
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              {cfg.guardrail_ids.length} active
            </span>
          }
        >
          <GuardrailSelector
            tenantId={tenantId}
            initialAssigned={cfg.guardrail_ids}
          />
        </SectionCard>
      </div>
    </AdminShell>
  );
}
