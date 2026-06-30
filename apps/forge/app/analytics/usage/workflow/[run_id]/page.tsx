/**
 * F-829 Phase C — Per-workflow usage drill-down.
 *
 * Renders the cost/calls breakdown for a single workflow run by
 * filtering the tenant-wide spend log feed (from the typed SDK +
 * `useSpendLogs`) to logs whose `metadata.run_id` (or `request_id`)
 * matches the `run_id` route param. The upstream
 * `/admin/llm-gateway/spend/teams` endpoint is tenant-scoped, not
 * per-workflow, so we derive the per-run slice client-side.
 */
'use client';

import * as React from 'react';
import { Activity } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { KPICard } from '@/components/analytics/KPICard';
import { PageHeader } from '@/components/shell';
import { useSpendLogs } from '@/lib/hooks/useAnalytics';
import type { SpendLogEntry } from '@/lib/litellm/data';

export const dynamic = 'force-dynamic';

/**
 * Pull the run identifier out of a spend log entry. LiteLLM doesn't
 * store a first-class `run_id` field, but the Forge runtime records
 * it in `metadata.run_id` and we also fall back to `request_id` so
 * the page works when the caller passes a request id.
 */
function readRunId(log: SpendLogEntry): string | null {
  const meta = (log.metadata ?? {}) as { run_id?: unknown; workflow_id?: unknown };
  const fromMeta = meta.run_id ?? meta.workflow_id;
  if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta;
  if (typeof log.request_id === 'string' && log.request_id.length > 0) {
    return log.request_id;
  }
  return null;
}

export default function WorkflowUsagePage({
  params,
}: {
  params: { run_id: string };
}) {
  const runId = decodeURIComponent(params.run_id);
  // 30-day window matches the parent /analytics/usage page.
  const spendLogsRes = useSpendLogs(30, 1000);
  const logs: ReadonlyArray<SpendLogEntry> = spendLogsRes.data ?? [];

  const aggregate = React.useMemo(() => {
    let cost = 0;
    let calls = 0;
    let matched = 0;
    for (const log of logs) {
      if (readRunId(log) !== runId) continue;
      matched += 1;
      cost += log.spend ?? 0;
      calls += 1;
    }
    return {
      workflow_id: matched > 0 ? runId : runId,
      cost_usd: cost,
      calls,
    };
  }, [logs, runId]);

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
          description="LLM cost + call count for this workflow run (derived from tenant spend logs)."
        />
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <KPICard
            label="Cost (USD)"
            value={`$${aggregate.cost_usd.toFixed(4)}`}
          />
          <KPICard label="Calls" value={String(aggregate.calls)} />
        </section>
      </div>
    </AdminShell>
  );
}