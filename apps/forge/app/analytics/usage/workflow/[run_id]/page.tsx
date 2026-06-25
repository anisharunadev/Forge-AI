/**
 * F-829 Phase C — Per-workflow usage drill-down.
 *
 * Renders the cost/calls breakdown for a single workflow run. Uses
 * the same data layer as the parent `/analytics/usage` page; the
 * `run_id` route param becomes the workflow id passed to
 * `getWorkflowUsage`.
 */
'use client';

import * as React from 'react';
import { Activity } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { KPICard } from '@/components/analytics/KPICard';
import { PageHeader } from '@/components/shell';
import { getWorkflowUsage } from '@/lib/litellm/usage';
import { useTenantId } from '@/hooks/use-tenant-id';

export const dynamic = 'force-dynamic';

export default function WorkflowUsagePage({
  params,
}: {
  params: { run_id: string };
}) {
  const tenantId = useTenantId();
  const runId = decodeURIComponent(params.run_id);
  const [payload, setPayload] = React.useState<{
    workflow_id: string;
    cost_usd: number;
    calls: number;
  } | null>(null);

  React.useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      const data = await getWorkflowUsage(tenantId, runId);
      if (!cancelled) setPayload(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, runId]);

  return (
    <AdminShell>
      <div
        className="flex flex-col gap-6"
        data-testid="workflow-usage"
        data-run-id={runId}
      >
        <PageHeader
          eyebrow="Analytics · Workflow"
          title={runId}
          icon={<Activity className="h-4 w-4" aria-hidden="true" />}
          description="LLM cost + call count for this workflow run."
        />
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <KPICard
            label="Cost (USD)"
            value={`$${(payload?.cost_usd ?? 0).toFixed(4)}`}
          />
          <KPICard label="Calls" value={String(payload?.calls ?? 0)} />
        </section>
      </div>
    </AdminShell>
  );
}
