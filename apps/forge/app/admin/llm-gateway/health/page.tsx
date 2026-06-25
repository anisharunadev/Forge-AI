'use client';

/**
 * /admin/llm-gateway/health — LiteLLM availability dashboard.
 *
 * Shows the cached health snapshot from `LiteLLMHealthMonitor` and
 * auto-refreshes every 30s. The global `LLMUnavailableBanner` is
 * the at-a-glance surface; this page adds drill-down details
 * (consecutive failures, last probe timestamp, source).
 */

import * as React from 'react';
import { Activity } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { PageHeader, SectionCard, StatusPill, EmptyState } from '@/components/shell';
import { Skeleton } from '@/components/ui/skeleton';

import { useAdminLLMHealth, useLiteLLMHealth } from '@/lib/hooks/useLiteLLM';

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString();
}

export default function LLMGatewayHealthPage() {
  const probe = useLiteLLMHealth();
  const detail = useAdminLLMHealth();
  const isLoading = probe.isLoading || detail.isLoading;

  const healthy = probe.data?.healthy ?? false;
  const consecutive = detail.data?.consecutive_failures ?? 0;
  const lastCheck = detail.data?.last_check_at ?? probe.data?.last_check_at ?? null;
  const lastError = detail.data?.last_error ?? null;
  const source = probe.data?.source ?? 'monitor';

  return (
    <AdminShell>
      <div
        className="flex flex-col gap-6"
        data-testid="llm-gateway-health"
        data-page-title="LLM Gateway · Health"
      >
        <PageHeader
          eyebrow="LLM Gateway"
          title="Health"
          icon={<Activity className="h-4 w-4" aria-hidden="true" />}
          description="LiteLLM availability probe. Cached snapshot, refreshed every 30 seconds."
          breadcrumbs={[
            { label: 'LLM Gateway', href: '/admin/llm-gateway' },
            { label: 'Health' },
          ]}
        />

        {isLoading ? (
          <div className="space-y-3" data-testid="health-loading">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            <SectionCard
              title="Availability"
              description="The flag the global LLMUnavailableBanner reads from."
            >
              <div className="flex items-center justify-between gap-3">
                <StatusPill
                  tone={healthy ? 'success' : 'danger'}
                  glyph={healthy ? '✓' : '✕'}
                  label={healthy ? 'Healthy' : 'Down'}
                  size="md"
                />
                <span className="text-xs text-muted-foreground">
                  Source: {source}
                </span>
              </div>
            </SectionCard>

            <SectionCard
              title="Probe details"
              description="Drill-down from the cached monitor state."
            >
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground">Last check</dt>
                  <dd className="font-mono">{fmtTime(lastCheck)}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground">Consecutive failures</dt>
                  <dd
                    className="font-mono"
                    data-testid="health-consecutive-failures"
                  >
                    {consecutive}
                  </dd>
                </div>
                <div className="col-span-2 flex flex-col gap-0.5">
                  <dt className="text-muted-foreground">Last error</dt>
                  <dd className="font-mono text-xs">
                    {lastError ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </dd>
                </div>
              </dl>
            </SectionCard>
          </>
        )}

        {!isLoading && !healthy ? (
          <EmptyState
            icon={<Activity className="h-5 w-5" aria-hidden="true" />}
            title="LiteLLM is currently unreachable"
            description="LLM calls will fail until the gateway recovers. Cached data is still rendered for the most recent successful probe."
            testId="health-down-empty"
          />
        ) : null}
      </div>
    </AdminShell>
  );
}
