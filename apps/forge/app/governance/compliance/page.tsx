/**
 * Steward compliance feed.
 *
 * Lists guardrail violations derived from the LiteLLM spend-log feed
 * (`useSpendLogs`) filtered for non-200 status or guardrail actions.
 * The canonical backend route `/api/v1/governance/violations`
 * (Zone 6 — `backend/app/api/v1/governance_violations.py`) applies
 * the same derivation server-side; we prefer that endpoint when it
 * is reachable and fall back to client-side filtering on the spend
 * logs when the backend is unavailable.
 *
 * `resolveViolation` has no LiteLLM equivalent — there is no
 * first-class "resolve" mutation in the Zone 6 contract. We hide the
 * resolve / reopen buttons (the action has no canonical endpoint to
 * call) and surface the violations as read-only audit cards.
 *
 * Polls every 30s so newly-detected violations appear without manual
 * refresh; mirrors the timeline pattern from `app/audit/page.tsx`.
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
import { useSpendLogs } from '@/lib/hooks/useAnalytics';
import { forgeFetch } from '@/lib/forge-api';
import type { SpendLogEntry } from '@/lib/litellm/data';

const SEVERITIES: ReadonlyArray<string> = [
  'all',
  'low',
  'medium',
  'high',
  'critical',
];

/** Backend canonical shape from `/api/v1/governance/violations`. */
interface BackendViolation {
  id: string;
  timestamp?: string | null;
  model?: string | null;
  severity?: string | null;
  kind?: string | null;
  description?: string | null;
  actor?: string | null;
  key_alias?: string | null;
}

/**
 * Derive a guardrail-violation feed from raw LiteLLM spend logs. We
 * only surface entries whose HTTP status is not 200 (e.g. 403 guardrail
 * blocks, 429 budget exceeded) or whose metadata carries a guardrail
 * action marker. This mirrors the Zone 6 derivation.
 */
function deriveViolationsFromLogs(
  logs: ReadonlyArray<SpendLogEntry>,
): ReadonlyArray<ViolationCardProps> {
  const out: ViolationCardProps[] = [];
  for (const log of logs) {
    const meta = (log.metadata ?? {}) as Record<string, unknown>;
    const status = log.status;
    const guardrailAction =
      typeof meta.guardrail_action === 'string' ? meta.guardrail_action : null;

    const statusIsFailure =
      status !== null &&
      status !== undefined &&
      status !== 200 &&
      status !== '200';

    if (!statusIsFailure && !guardrailAction) continue;

    const id = log.request_id ?? `${log.startTime ?? 'unknown'}-${out.length}`;
    const severity =
      status === 403 ||
      status === '403' ||
      status === 429 ||
      status === '429'
        ? 'high'
        : 'medium';

    const description =
      typeof meta.guardrail_reason === 'string'
        ? meta.guardrail_reason
        : guardrailAction ?? 'Guardrail blocked or budget exceeded';

    out.push({
      id,
      guardrail_id: typeof meta.guardrail_id === 'string' ? meta.guardrail_id : 'litellm',
      severity,
      action_taken: guardrailAction ?? (statusIsFailure ? 'blocked' : 'warned'),
      sanitized_content: description,
      resolved: false,
      occurred_at: log.startTime ?? new Date().toISOString(),
    });
  }
  return out;
}

function severityRank(s: string | undefined | null): number {
  switch ((s ?? '').toLowerCase()) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}

export const dynamic = 'force-dynamic';

export default function ComplianceFeedPage() {
  const [severity, setSeverity] = React.useState<string>('all');
  const [resolved, setResolved] = React.useState<'all' | 'open' | 'resolved'>(
    'open',
  );

  // Prefer the canonical backend derivation; fall back to spend logs.
  const [backendItems, setBackendItems] = React.useState<
    ReadonlyArray<BackendViolation> | null
  >(null);
  const [backendError, setBackendError] = React.useState<boolean>(false);

  const fetchBackend = React.useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (severity !== 'all') params.set('severity', severity);
      params.set('days', '7');
      const qs = params.toString();
      const data = await forgeFetch<ReadonlyArray<BackendViolation>>(
        `/governance/violations${qs ? `?${qs}` : ''}`,
      );
      setBackendItems(data);
      setBackendError(false);
    } catch {
      setBackendError(true);
    }
  }, [severity]);

  React.useEffect(() => {
    void fetchBackend();
    const id = window.setInterval(() => void fetchBackend(), 30_000);
    return () => window.clearInterval(id);
  }, [fetchBackend]);

  const spendLogsRes = useSpendLogs(7, 500);
  const logs: ReadonlyArray<SpendLogEntry> = spendLogsRes.data ?? [];

  // Resolve / reopen has no LiteLLM equivalent — see file header.
  // We surface the violation list read-only; no actions are wired.

  const items: ReadonlyArray<ViolationCardProps> = React.useMemo(() => {
    if (backendItems !== null && !backendError) {
      return backendItems.map((v) => ({
        id: v.id,
        guardrail_id: v.kind ?? 'litellm',
        severity: v.severity ?? 'medium',
        action_taken: v.description ?? 'blocked',
        sanitized_content: v.description ?? 'Guardrail violation',
        resolved: false,
        occurred_at: v.timestamp ?? new Date().toISOString(),
      }));
    }
    return deriveViolationsFromLogs(logs);
  }, [backendItems, backendError, logs]);

  // Apply severity + resolved filters client-side as the canonical
  // backend only supports the severity dimension.
  const filtered = React.useMemo(() => {
    let rows = items;
    if (severity !== 'all') {
      rows = rows.filter((r) => (r.severity ?? '').toLowerCase() === severity);
    }
    if (resolved === 'open') {
      rows = rows.filter((r) => !r.resolved);
    } else if (resolved === 'resolved') {
      rows = rows.filter((r) => r.resolved);
    }
    return rows.slice().sort((a, b) => {
      const sevDiff = severityRank(b.severity) - severityRank(a.severity);
      if (sevDiff !== 0) return sevDiff;
      return (b.occurred_at ?? '').localeCompare(a.occurred_at ?? '');
    });
  }, [items, severity, resolved]);

  const loading = backendItems === null && spendLogsRes.isLoading;

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="compliance-feed">
        <PageHeader
          eyebrow="Governance"
          title="Compliance Feed"
          icon={<Shield className="h-4 w-4" aria-hidden="true" />}
          description="LiteLLM guardrail violations. Auto-refreshes every 30s. Resolve / reopen actions are read-only — there is no LiteLLM mutation for them."
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
            {filtered.length} item{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading && filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground" role="status">
            Loading…
          </p>
        ) : filtered.length === 0 ? (
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
            {filtered.map((v) => (
              <li key={v.id}>
                <ViolationCard {...v} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminShell>
  );
}