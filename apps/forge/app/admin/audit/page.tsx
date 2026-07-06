'use client';

/**
 * Phase 5 — Admin Audit Center.
 *
 * Single page with two tabs:
 *   - `history` (default) — virtualized timeline of stored events
 *     from the existing `/v1/audit/records` endpoint.
 *   - `live` — events streamed over the `/ws/audit` WebSocket.
 *
 * The "live" tab is intentionally a simple list, not a virtualized
 * timeline: the stream is bounded to the last 500 events in-process
 * and the connection status is shown as an inline indicator so an
 * operator can spot a stuck feed at a glance (R15 — empty state
 * explains, R7 — observability).
 */

import * as React from 'react';

import { Activity, Shield } from 'lucide-react';

import { AuditTimelineVirtualized } from '@/components/audit/AuditTimelineVirtualized';
import { useApiData } from '@/hooks/use-api-data';
import { useAuditStream } from '@/lib/hooks/useAuditStream';
import type { AuditRecord } from '@/lib/audit/data';
import { EmptyState } from '@/src/components/empty-state';
import { cn } from '@/lib/utils';

type Tab = 'history' | 'live';

const STATUS_DOT: Record<string, string> = {
  connecting: 'bg-muted-foreground',
  open: 'bg-emerald-500',
  reconnecting: 'bg-amber-500',
  closed: 'bg-rose-500',
};

export default function AdminAuditPage() {
  const [tab, setTab] = React.useState<Tab>('history');
  const recordsQ = useApiData<AuditRecord[]>('/v1/audit/records');
  const { status, events } = useAuditStream();

  const history: ReadonlyArray<AuditRecord> = recordsQ.data ?? [];

  return (
    <div className="p-4">
      <header className="mb-4 flex items-center gap-3">
        <Activity className="h-5 w-5" aria-hidden />
        <h1 className="text-xl font-semibold">Audit Center</h1>
        <div
          role="tablist"
          aria-label="Audit views"
          className="ml-6 inline-flex rounded-md border bg-card p-1"
        >
          <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
            History
          </TabButton>
          <TabButton active={tab === 'live'} onClick={() => setTab('live')}>
            Live
          </TabButton>
        </div>
      </header>

      {tab === 'history' ? (
        <AuditTimelineVirtualized records={history} />
      ) : (
        <LivePanel status={status} events={events} reconnect={reconnect} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'rounded px-3 py-1 text-sm transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function LivePanel({
  status,
  events,
  reconnect,
}: {
  status: ReturnType<typeof useAuditStream>['status'];
  events: ReturnType<typeof useAuditStream>['events'];
  reconnect: () => void;
}) {
  return (
    <section aria-label="Live audit feed" data-testid="audit-live-panel" data-status={status}>
      <div className="mb-3 flex items-center gap-2 text-sm" data-testid="audit-live-status">
        <span
          aria-label={`connection-${status}`}
          className={cn('inline-block h-2 w-2 rounded-full', STATUS_DOT[status] ?? 'bg-muted-foreground')}
        />
        <span className="text-muted-foreground">{labelFor(status)}</span>
        {(status === 'reconnecting' || status === 'closed') && (
          <button
            type="button"
            onClick={reconnect}
            className="ml-auto rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
            data-testid="audit-live-retry"
          >
            Retry
          </button>
        )}
      </div>

      {events.length === 0 ? (
        <div
          data-testid="audit-live-empty"
          className="rounded-md border bg-card"
        >
          <EmptyState
            compact
            illustration={<Shield size={28} strokeWidth={1.5} />}
            title="No live audit events yet"
            description="As agents, approvals, and policy decisions land in the audit log they will appear here within a second. The connection indicator above tells you when the live feed is up."
          />
        </div>
      ) : (
        <ul
          data-testid="audit-live-list"
          className="divide-y rounded-md border bg-card"
        >
          {events.map((ev) => (
            <li
              key={ev.id}
              data-testid="audit-live-row"
              data-event-id={ev.id}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <span className="font-mono text-xs text-muted-foreground">{ev.ts}</span>
              <span className="rounded bg-muted px-2 py-0.5 text-xs">{ev.action}</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">{ev.id}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function labelFor(status: string): string {
  switch (status) {
    case 'open':
      return 'Live feed connected';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'closed':
      return 'Disconnected — retry';
    case 'connecting':
    default:
      return 'Connecting…';
  }
}
