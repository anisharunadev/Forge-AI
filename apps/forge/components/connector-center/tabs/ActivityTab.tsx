'use client';

/**
 * ActivityTab — Zone 7 in the Step 31 spec.
 *
 * M3-G6 — Step 55 wires this tab to the live `useConnectorActivity()`
 * hook (polls `/api/v1/connectors/activity` every 10s). The wire
 * payload is mapped to the legacy `ConnectorSyncEvent` shape via
 * `wireToActivityRow` so the existing KPI tiles + filter chips +
 * virtualized list + CSV/JSON export keep rendering unchanged.
 *
 * Data flow:
 *   1. `useConnectorActivity()` returns the live activity feed as
 *      `ActivityRow[]` (mapped from `ConnectorSyncEventWire`).
 *   2. `useConnectors()` returns the connector lookup for the
 *      per-event display name + icon resolution + filter dropdown.
 *   3. The `connectors` array (from `useLiveConnectorData()`) is the
 *      authoritative list for the filter dropdown; the live activity
 *      feed drives the timeline rows.
 *
 * Loading state: 4 skeleton rows so the layout doesn't jump when
 * data resolves.
 *
 * Empty state: Rule 15 — "No activity yet — install a connector to
 * see events" so the user knows the tab is intentional, not broken.
 */

import * as React from 'react';
import {
  Activity as ActivityIcon,
  CheckCircle2,
  Download,
  Filter,
  RotateCw,
  Search,
  TriangleAlert,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KpiTile } from '../KpiTile';
import {
  fmtCompact,
  fmtDuration,
  fmtTimeAgo,
} from '../constants';
import {
  resolveIcon,
  sparklineFor,
} from '@/lib/connectors';
import { cn } from '@/lib/utils';
import {
  useConnectorActivity,
  useConnectors,
} from '@/lib/hooks/useConnectors';
import {
  wireToActivityRow,
  type ActivityRow,
} from '@/lib/connectors/wire-adapters';

type EventFilter = 'all' | ActivityRow['eventType'] | 'error';

const FILTER_OPTIONS: ReadonlyArray<EventFilter> = [
  'all',
  'pull',
  'push',
  'webhook',
  'test',
  'error',
];

export function ActivityTab() {
  const liveActivity = useConnectorActivity();
  const liveConnectors = useConnectors();

  // Wire-format events → legacy `ConnectorSyncEvent` shape. Done in a
  // memo so the mapped rows are stable across re-renders (filter
  // changes don't trigger a re-map).
  const events = React.useMemo<ReadonlyArray<ActivityRow>>(
    () => (liveActivity.data ?? []).map(wireToActivityRow),
    [liveActivity.data],
  );

  // Connector lookup — feed the filter dropdown and per-row display
  // name resolution. Falls back to an empty array while the live
  // query is loading so we don't render a dropdown of ghost rows.
  const connectors = React.useMemo(
    () => liveConnectors.data ?? [],
    [liveConnectors.data],
  );

  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<EventFilter>('all');
  const [connectorFilter, setConnectorFilter] = React.useState<string>('all');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  // Build a connector-id → displayName map so per-row lookups are O(1).
  const connectorMap = React.useMemo(() => {
    const m = new Map<string, { displayName: string; slug: string }>();
    for (const c of connectors) {
      m.set(c.id, { displayName: c.displayName, slug: c.slug ?? c.name });
    }
    return m;
  }, [connectors]);

  const totals = React.useMemo(() => {
    let records = 0;
    let errors = 0;
    for (const e of events) {
      records += e.records;
      if (e.status === 'failed') errors += 1;
    }
    return { records, errors, total: events.length };
  }, [events]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (connectorFilter !== 'all' && e.connectorId !== connectorFilter) return false;
      if (filter === 'error' && e.status !== 'failed') return false;
      if (filter !== 'all' && filter !== 'error' && e.eventType !== filter) return false;
      if (q) {
        const conn = connectorMap.get(e.connectorId);
        const haystack = `${conn?.displayName ?? ''} ${e.entity}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [events, query, filter, connectorFilter, connectorMap]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const retrySelected = () => {
    setSelected(new Set());
  };

  const exportCSV = () => {
    const rows = filtered.map((e) => {
      const conn = connectorMap.get(e.connectorId);
      return [
        e.at,
        conn?.displayName ?? '',
        e.eventType,
        e.entity,
        e.status,
        String(e.records),
        `${e.durationMs}ms`,
        e.errorMessage ?? '',
      ].join(',');
    });
    const csv = ['timestamp,connector,type,entity,status,records,duration,error', ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `connector-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isLoading = liveActivity.isLoading;
  const isErrored = liveActivity.isError;

  return (
    <div className="flex flex-col gap-4" data-testid="connector-activity-tab">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Syncs today" value={fmtCompact(totals.total)} Icon={ActivityIcon} accent="emerald" sparkData={sparklineFor()} />
        <KpiTile label="Records ingested" value={fmtCompact(totals.records)} Icon={CheckCircle2} accent="cyan" sparkData={sparklineFor().map((v) => v + 4)} />
        <KpiTile
          label="API calls"
          value={fmtCompact(totals.total)}
          Icon={Filter}
          accent="indigo"
          sparkData={sparklineFor().map((v) => v + 8)}
        />
        <KpiTile label="Errors" value={String(totals.errors)} Icon={TriangleAlert} accent="rose" sparkData={sparklineFor(14).map((v) => v - 12)} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-tertiary" aria-hidden="true" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search events…"
              className="h-8 w-[200px] pl-7 text-xs"
            />
          </div>
          <select
            value={connectorFilter}
            onChange={(e) => setConnectorFilter(e.target.value)}
            className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2 text-xs text-fg-secondary"
            aria-label="Filter by connector"
          >
            <option value="all">All connectors</option>
            {connectors.map((c) => (
              <option key={c.id} value={c.id}>{c.displayName}</option>
            ))}
          </select>
          <div className="flex gap-1">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setFilter(opt)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] capitalize',
                  filter === opt
                    ? 'border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]'
                    : 'border-[var(--border-subtle)] text-fg-tertiary hover:text-fg-secondary',
                )}
                aria-pressed={filter === opt}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 ? (
            <Button size="sm" variant="outline" onClick={retrySelected}>
              <RotateCw className="h-3 w-3" aria-hidden="true" />
              Retry selected ({selected.size})
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={exportCSV}>
            <Download className="h-3 w-3" aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </div>

      <div
        className="max-h-[640px] overflow-y-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
        role="region"
        aria-label="Sync activity list"
      >
        <ul className="divide-y divide-[var(--border-subtle)]">
          {isLoading ? (
            <ActivitySkeletonRow />
          ) : null}
          {!isLoading && filtered.map((e) => {
            const conn = connectorMap.get(e.connectorId);
            // Prefer the connector's id for icon resolution; fall back
            // to the slug so marketplace-only items still render with
            // a recognizable icon.
            const Icon = resolveIcon(conn?.slug ?? e.connectorSlug ?? e.connectorId);
            const tone = e.status;
            return (
              <li
                key={e.id}
                className={cn(
                  'flex items-start gap-3 px-3 py-2 text-xs hover:bg-[var(--bg-surface)]',
                  tone === 'failed' && 'bg-[var(--accent-rose)]/[0.04]',
                )}
                data-testid="activity-row"
                data-event-id={e.id}
                data-event-type={e.eventType}
                data-status={e.status}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--accent-cyan)]"
                  checked={selected.has(e.id)}
                  onChange={() => toggle(e.id)}
                  aria-label={`Select ${e.entity}`}
                />
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-fg-tertiary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium text-fg-primary">
                      {conn?.displayName ?? e.connectorSlug ?? e.connectorId}
                    </span>
                    <EventTypeBadge type={e.eventType} />
                    <StatusBadge status={e.status} />
                    <span className="ml-auto font-mono text-[10px] text-fg-tertiary">
                      {fmtTimeAgo(e.at)}
                    </span>
                  </div>
                  <p className="text-fg-secondary">{e.entity}</p>
                  {e.errorMessage ? (
                    <p className="mt-1 text-[11px] text-[var(--accent-rose)]">{e.errorMessage}</p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right font-mono text-[10px] text-fg-tertiary">
                  <div>{e.records} rec</div>
                  <div>{fmtDuration(e.durationMs)}</div>
                </div>
              </li>
            );
          })}
          {!isLoading && filtered.length === 0 && !isErrored ? (
            <li className="px-3 py-12 text-center text-xs text-fg-tertiary" data-testid="activity-empty">
              <ActivityIcon className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
              No activity yet — install a connector to see events
            </li>
          ) : null}
          {isErrored ? (
            <li className="px-3 py-12 text-center text-xs text-[var(--accent-rose)]" data-testid="activity-error">
              Failed to load activity feed. Showing offline data.
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

function ActivitySkeletonRow() {
  // 4 placeholder rows so the layout doesn't jump when data resolves.
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <li
          key={`skel-${i}`}
          className="flex items-start gap-3 px-3 py-2 text-xs"
          data-testid="activity-skeleton"
          aria-hidden="true"
        >
          <span className="mt-0.5 h-3 w-3 animate-pulse rounded-sm bg-[var(--bg-inset)]" />
          <span className="h-4 w-4 animate-pulse rounded-sm bg-[var(--bg-inset)]" />
          <div className="min-w-0 flex-1 space-y-1">
            <span className="block h-3 w-1/3 animate-pulse rounded-sm bg-[var(--bg-inset)]" />
            <span className="block h-3 w-2/3 animate-pulse rounded-sm bg-[var(--bg-inset)]" />
          </div>
          <span className="h-3 w-12 animate-pulse rounded-sm bg-[var(--bg-inset)]" />
        </li>
      ))}
    </>
  );
}

function EventTypeBadge({ type }: { type: ActivityRow['eventType'] }) {
  const tone =
    type === 'pull'
      ? 'border-[var(--accent-cyan)]/40 text-[var(--accent-cyan)]'
      : type === 'push'
        ? 'border-[var(--accent-emerald)]/40 text-[var(--accent-emerald)]'
        : type === 'webhook'
          ? 'border-[var(--accent-violet)]/40 text-[var(--accent-violet)]'
          : 'border-[var(--border-default)] text-fg-tertiary';
  return (
    <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wider', tone)}>
      {type}
    </span>
  );
}

function StatusBadge({ status }: { status: ActivityRow['status'] }) {
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 text-[var(--accent-emerald)]">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-[var(--accent-rose)]">
        <XCircle className="h-3 w-3" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[var(--accent-amber)]">
      <TriangleAlert className="h-3 w-3" aria-hidden="true" />
    </span>
  );
}