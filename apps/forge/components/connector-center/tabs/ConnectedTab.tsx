'use client';

/**
 * ConnectedTab — Zone 4 in the Step 31 spec.
 *
 * M3-G7 — Step 55 wires this tab to the live `useConnectors()` hook
 * (30s poll against `GET /api/v1/connectors`). The wire payload flows
 * through `wireToConnectedCard` (alias of `wireToConnector`) so the
 * existing card UI keeps rendering unchanged.
 *
 * Behavior
 * --------
 *   - Filter chips (category / status / scope) + search work against
 *     the live data shape.
 *   - 3-dot menu's "Disconnect" action calls
 *     `useDisconnectConnector().mutate(connector.id)` and the
 *     React Query invalidation kicks the list refresh.
 *   - Loading state: 4 skeleton cards.
 *   - Empty state (Rule 15): "No connectors installed — visit the
 *     Marketplace tab" with a deep-link to the marketplace.
 *
 * The hover lift, configure drawer, and pause/resume toggle are kept
 * exactly as they were — they're purely client-side affordances and
 * don't need the live data path.
 */

import * as React from 'react';
import {
  CircleDot,
  Clock,
  Filter,
  Loader2,
  MoreVertical,
  Pause,
  PauseCircle,
  Play,
  RotateCw,
  Search,
  Workflow,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ConnectorDetailPanel } from '@/components/connector-center/ConnectorDetailPanel';
import { ConnectorHealthIndicator } from '@/components/connectors/ConnectorHealthIndicator';
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  SCOPE_LABEL,
  STATUS_LABEL,
  resolveIcon,
  sparklineFor,
  type Connector,
  type ConnectorHealthStatus,
} from '@/lib/connectors';
import { fmtCompact, fmtTimeAgo } from '../constants';
import { cn } from '@/lib/utils';
import {
  useConnectors,
  useDisconnectConnector,
} from '@/lib/hooks/useConnectors';

const STATUS_FILTERS: ReadonlyArray<ConnectorHealthStatus | 'all'> = [
  'all',
  'healthy',
  'syncing',
  'stale',
  'failed',
  'quarantined',
  'paused',
];

export function ConnectedTab() {
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [scope, setScope] = React.useState<string>('all');
  const [pausedIds, setPausedIds] = React.useState<Set<string>>(new Set());
  const [openId, setOpenId] = React.useState<string | null>(null);

  // M3-G7 — read the live connector list. `data` is `Connector[]`
  // (the wire-to-legacy mapping is applied by the hook's `select`).
  const liveConnectors = useConnectors();
  const disconnect = useDisconnectConnector();

  const connectors = React.useMemo(
    () => liveConnectors.data ?? [],
    [liveConnectors.data],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return connectors.filter((c) => {
      if (q && !c.displayName.toLowerCase().includes(q) && !c.tagline.toLowerCase().includes(q)) return false;
      if (category !== 'all' && c.category !== category) return false;
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (scope !== 'all' && c.scope !== scope) return false;
      return true;
    });
  }, [connectors, query, category, statusFilter, scope]);

  const togglePause = (id: string) => {
    setPausedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isLoading = liveConnectors.isLoading;
  const isErrored = liveConnectors.isError;
  const hasResults = filtered.length > 0;

  return (
    <div className="flex flex-col gap-4" data-testid="connector-connected-tab">
      {/* Filter bar */}
      <div className="flex flex-col gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-tertiary" aria-hidden="true" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search connected integrations…"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <Filter className="h-3.5 w-3.5 text-fg-tertiary" aria-hidden="true" />
          <ChipRow label="Category" value={category} options={['all', ...CATEGORY_ORDER]} onChange={setCategory} labelOf={(v) => (v === 'all' ? 'All' : CATEGORY_LABEL[v as keyof typeof CATEGORY_LABEL])} />
          <ChipRow label="Status" value={statusFilter} options={STATUS_FILTERS} onChange={setStatusFilter} labelOf={(v) => (v === 'all' ? 'All' : STATUS_LABEL[v as ConnectorHealthStatus])} />
          <ChipRow label="Scope" value={scope} options={['all', 'org', 'project']} onChange={setScope} labelOf={(v) => (v === 'all' ? 'All' : SCOPE_LABEL[v as 'org' | 'project'])} />
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {isLoading ? (
          <ConnectedCardSkeleton />
        ) : null}
        {!isLoading && hasResults ? filtered.map((c) => (
          <ConnectedCard
            key={c.id}
            connector={c}
            paused={pausedIds.has(c.id)}
            onPauseToggle={() => togglePause(c.id)}
            onConfigure={() => setOpenId(c.id)}
            onDisconnect={() => {
              if (window.confirm(`Disconnect ${c.displayName}? You can re-install later from the Marketplace tab.`)) {
                disconnect.mutate(c.id);
              }
            }}
            isDisconnecting={disconnect.isPending && disconnect.variables === c.id}
          />
        )) : null}
        {!isLoading && !hasResults && !isErrored ? (
          <div
            className="col-span-full rounded-md border border-dashed border-[var(--border-default)] p-8 text-center"
            data-testid="connected-empty"
          >
            <p className="text-sm text-fg-secondary">
              {connectors.length === 0
                ? 'No connectors installed — visit the Marketplace tab'
                : 'No connectors match these filters.'}
            </p>
            {connectors.length === 0 ? (
              <a
                href="#tab=marketplace"
                className="mt-2 inline-block text-xs text-[var(--accent-cyan)] hover:underline"
                onClick={(e) => {
                  // Real navigation is the parent's setTabAndHash; the
                  // anchor's href is a hint to storybook / e2e tests.
                  e.preventDefault();
                  window.location.hash = 'tab=marketplace';
                }}
              >
                Browse marketplace →
              </a>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory('all');
                  setStatusFilter('all');
                  setScope('all');
                }}
                className="mt-2 text-xs text-[var(--accent-cyan)] hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : null}
        {isErrored ? (
          <div className="col-span-full rounded-md border border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10 p-8 text-center text-xs text-[var(--accent-rose)]" data-testid="connected-error">
            Failed to load connectors. Showing offline data.
          </div>
        ) : null}
      </div>

      {/* Configure drawer */}
      {openId ? (
        <DrawerShell onClose={() => setOpenId(null)}>
          <ConnectorDetailPanel
            connector={connectors.find((c) => c.id === openId) as never}
            auditEntries={[]}
          />
        </DrawerShell>
      ) : null}
    </div>
  );
}

interface ChipRowProps {
  readonly label: string;
  readonly value: string;
  readonly options: ReadonlyArray<string>;
  readonly onChange: (v: string) => void;
  readonly labelOf: (v: string) => string;
}

function ChipRow({ label, value, options, onChange, labelOf }: ChipRowProps) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] uppercase tracking-wider text-fg-tertiary">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px]',
                active
                  ? 'border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]'
                  : 'border-[var(--border-subtle)] text-fg-tertiary hover:text-fg-secondary',
              )}
              aria-pressed={active}
            >
              {labelOf(opt)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ConnectedCardProps {
  readonly connector: Connector;
  readonly paused: boolean;
  readonly onPauseToggle: () => void;
  readonly onConfigure: () => void;
  readonly onDisconnect: () => void;
  readonly isDisconnecting: boolean;
}

function ConnectedCard({ connector: c, paused, onPauseToggle, onConfigure, onDisconnect, isDisconnecting }: ConnectedCardProps) {
  const Icon = resolveIcon(c.id);
  const showAsPaused = paused || c.status === 'paused';
  const lastFailureEvent = c.recentEvents.find((e) => e.status === 'failed');
  const totalUsage =
    c.usage.workflows + c.usage.destinations + c.usage.ideationSources + c.usage.agentContexts;
  const spark = sparklineFor(14).map((v) => v + c.usage.apiCallsToday / 800);

  return (
    <article
      className="flex flex-col gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 transition-all hover:-translate-y-px hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)]"
      data-testid="connected-card"
      data-connector-id={c.id}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] text-fg-secondary">
            <Icon className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-md font-semibold text-fg-primary">{c.displayName}</h3>
            <p className="text-[10px] uppercase tracking-wider text-fg-tertiary">
              {CATEGORY_LABEL[c.category]} · {SCOPE_LABEL[typeof c.scope === 'string' ? c.scope : c.scope.binding]}
            </p>
            <p className="mt-0.5 text-[11px] text-fg-secondary">{c.connectedAs}</p>
          </div>
        </div>
        <ConnectorHealthIndicator
          connectorId={c.id}
          status={showAsPaused ? 'paused' : c.status}
          showLabel
        />
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <dt className="inline-flex items-center gap-1 text-fg-tertiary">
          <Clock className="h-3 w-3" aria-hidden="true" />
          Last sync
        </dt>
        <dd className="font-mono text-fg-primary">{fmtTimeAgo(c.lastSyncAt)}</dd>

        <dt className="text-fg-tertiary">Records today</dt>
        <dd className="font-mono text-fg-primary">{fmtCompact(c.recentEvents.reduce((a, e) => a + e.records, 0))}</dd>

        <dt className="inline-flex items-center gap-1 text-fg-tertiary">
          <Workflow className="h-3 w-3" aria-hidden="true" />
          Used in
        </dt>
        <dd className="text-fg-primary">
          {c.usage.workflows} workflows · {c.usage.destinations} destinations
        </dd>
      </dl>

      {/* Mini spark */}
      <svg viewBox="0 0 100 24" className="h-6 w-full" preserveAspectRatio="none" aria-hidden="true">
        <polyline
          fill="none"
          stroke="var(--accent-cyan)"
          strokeWidth="1.2"
          points={spark.map((v, i) => `${(i / (spark.length - 1)) * 100},${24 - (v / Math.max(...spark)) * 22}`).join(' ')}
        />
      </svg>

      {/* Last error */}
      {lastFailureEvent ? (
        <div
          className="rounded-md border border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10 p-2 text-xs text-[var(--accent-rose)]"
          data-testid="connected-card-error"
        >
          <div className="flex items-start gap-2">
            <CircleDot className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">Last sync failed</div>
              <div className="truncate text-[10px]">{lastFailureEvent.errorMessage}</div>
            </div>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]">
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      <footer className="mt-auto flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onConfigure} data-testid="connected-configure">
            Configure
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onPauseToggle}
            data-testid="connected-pause"
            aria-pressed={paused}
            className="text-fg-secondary"
          >
            {paused ? <Play className="h-3 w-3" aria-hidden="true" /> : <Pause className="h-3 w-3" aria-hidden="true" />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="More actions">
              <MoreVertical className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onConfigure}>Open detail</DropdownMenuItem>
            <DropdownMenuItem>
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
              Rotate credentials
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Workflow className="h-3.5 w-3.5" aria-hidden="true" />
              View activity
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-[var(--accent-rose)]"
              onClick={onDisconnect}
              disabled={isDisconnecting}
              data-testid="connected-disconnect"
            >
              {isDisconnecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </footer>

      {paused ? (
        <span className="absolute -top-2 right-3 rounded-full border border-[var(--accent-amber)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--accent-amber)]">
          Paused locally
        </span>
      ) : null}
    </article>
  );
}

function ConnectedCardSkeleton() {
  // 4 placeholder cards so the grid layout doesn't jump when data resolves.
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={`skel-${i}`}
          className="flex flex-col gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
          data-testid="connected-card-skeleton"
          aria-hidden="true"
        >
          <div className="flex items-start gap-3">
            <span className="h-12 w-12 animate-pulse rounded-md bg-[var(--bg-inset)]" />
            <div className="flex-1 space-y-2">
              <span className="block h-4 w-2/3 animate-pulse rounded-sm bg-[var(--bg-inset)]" />
              <span className="block h-3 w-1/2 animate-pulse rounded-sm bg-[var(--bg-inset)]" />
            </div>
          </div>
          <span className="block h-3 w-full animate-pulse rounded-sm bg-[var(--bg-inset)]" />
          <span className="block h-3 w-3/4 animate-pulse rounded-sm bg-[var(--bg-inset)]" />
        </div>
      ))}
    </>
  );
}

function DrawerShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-end"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
      <div
        className="relative h-full w-[640px] max-w-[95vw] overflow-y-auto border-l border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[-8px_0_24px_rgba(0,0,0,0.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}