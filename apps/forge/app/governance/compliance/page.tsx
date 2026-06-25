/**
 * F-829 Phase C — Steward compliance feed.
 *
 * Lists LiteLLM guardrail violations ingested by the 30s polling job.
 * Polls every 30s so newly-detected violations appear without manual
 * refresh; resolve / reopen buttons call the backend mutators.
 *
 * Mirrors the timeline pattern from `app/audit/page.tsx`.
 */
'use client';

import * as React from 'react';
import { Shield } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { PageHeader, EmptyState } from '@/components/shell';
import {
  ViolationCard,
  type ViolationCardProps,
} from '@/components/governance/ViolationCard';
import { useTenantId } from '@/hooks/use-tenant-id';
import {
  listViolations,
  resolveViolation,
  reopenViolation,
  triggerViolationPoll,
} from '@/lib/litellm/usage';

const SEVERITIES: ReadonlyArray<string> = [
  'all',
  'low',
  'medium',
  'high',
  'critical',
];

export const dynamic = 'force-dynamic';

export default function ComplianceFeedPage() {
  const tenantId = useTenantId();
  const [severity, setSeverity] = React.useState<string>('all');
  const [resolved, setResolved] = React.useState<'all' | 'open' | 'resolved'>(
    'open',
  );
  const [items, setItems] = React.useState<ReadonlyArray<ViolationCardProps>>([]);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const data = await listViolations(tenantId, {
        severity: severity === 'all' ? undefined : severity,
        resolved:
          resolved === 'all' ? undefined : resolved === 'resolved',
      });
      setItems(
        (data?.items ?? []).map((v) => ({
          id: v.id,
          guardrail_id: v.guardrail_id,
          severity: v.severity,
          action_taken: v.action_taken,
          sanitized_content: v.sanitized_content,
          resolved: v.resolved,
          occurred_at: v.occurred_at,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId, severity, resolved]);

  React.useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const handleResolve = React.useCallback(
    async (id: string) => {
      if (!tenantId) return;
      await resolveViolation(tenantId, id);
      refresh();
    },
    [tenantId, refresh],
  );

  const handleReopen = React.useCallback(
    async (id: string) => {
      if (!tenantId) return;
      await reopenViolation(tenantId, id);
      refresh();
    },
    [tenantId, refresh],
  );

  const handleManualPoll = React.useCallback(async () => {
    await triggerViolationPoll();
    refresh();
  }, [refresh]);

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="compliance-feed">
        <PageHeader
          eyebrow="Governance"
          title="Compliance Feed"
          icon={<Shield className="h-4 w-4" aria-hidden="true" />}
          description="LiteLLM guardrail violations. Auto-refreshes every 30s; click 'Poll now' for a one-shot ingest."
          action={
            <button
              type="button"
              onClick={handleManualPoll}
              className="rounded-md border border-border bg-background px-3 py-1 text-xs text-foreground hover:bg-accent"
              data-testid="compliance-poll-now"
            >
              Poll now
            </button>
          }
        />

        <div className="flex flex-wrap items-center gap-3" data-testid="compliance-filters">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Severity
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
              data-testid="compliance-severity"
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            State
            <select
              value={resolved}
              onChange={(e) =>
                setResolved(e.target.value as 'all' | 'open' | 'resolved')
              }
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
              data-testid="compliance-state"
            >
              <option value="open">open</option>
              <option value="resolved">resolved</option>
              <option value="all">all</option>
            </select>
          </label>
          <span className="font-mono text-[10px] text-forge-300" data-testid="compliance-count">
            {items.length} item{items.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading && items.length === 0 ? (
          <p className="text-xs text-muted-foreground" role="status">
            Loading…
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Shield className="h-5 w-5" aria-hidden="true" />}
            title="No violations in window"
            description="The Steward queue is clear."
          />
        ) : (
          <ul
            className="grid grid-cols-1 gap-3"
            aria-label="Guardrail violations"
          >
            {items.map((v) => (
              <li key={v.id}>
                <ViolationCard
                  {...v}
                  onResolve={handleResolve}
                  onReopen={handleReopen}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminShell>
  );
}
