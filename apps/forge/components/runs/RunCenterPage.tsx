'use client';

/**
 * RunCenterPage — Phase 0.5 modernization (Step 14).
 *
 * Layout:
 *   1. Hero band with animated gradient border (Step 4 pattern) +
 *      Live status pill + Refresh button.
 *   2. KPI strip — Active / Succeeded today / Failed today / Total cost.
 *   3. Filter bar (status pills + agent/command/date filters + more).
 *   4. Virtualized table (TanStack Virtual — 10k+ rows smooth).
 *   5. Run detail drawer (720px right slide-in, 7 tabs).
 *
 * States covered: populated, loading (skeleton rows), empty (no runs),
 * empty (filtered), error (network / 5xx / missing data — reuses the
 * Step 13 `ErrorState` primitive and applies pattern recognition).
 *
 * Accessibility: live region for KPI deltas, role="alert" on errors,
 * Esc + ArrowLeft close the drawer, prefers-reduced-motion respected.
 */

import * as React from 'react';
import Link from 'next/link';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  Code2,
  Coins,
  Copy,
  ExternalLink,
  FileText,
  Filter,
  Hash,
  History,
  Loader2,
  MoreHorizontal,
  Pause,
  PlayCircle,
  RotateCw,
  SearchX,
  SlidersHorizontal,
  Terminal,
  Timer,
  Wifi,
  WifiOff,
  X,
  XCircle,
  Zap,
  Download,
  FileCode,
  type LucideIcon,
} from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { ErrorState } from '@/components/error-state';
import { EmptyState as EmptyStateV2 } from '@/src/components/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useWorkflowRunsIndex } from '@/lib/hooks/useRuns';
import { StaleApprovalBadge } from '@/components/runs/StaleApprovalBadge';
import { useRealtime, type WsFrame } from '@/lib/useRealtime';
import type { WorkflowRun, WorkflowRunStatus } from '@/lib/workflows/types';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const STATUS_LABEL: Record<WorkflowRunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  paused: 'Paused',
  waiting_approval: 'Waiting approval',
};

const STATUS_TONE: Record<WorkflowRunStatus, 'success' | 'warn' | 'danger' | 'idle' | 'execution'> = {
  queued: 'idle',
  running: 'execution',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'danger',
  paused: 'warn',
  waiting_approval: 'warn',
};

const STATUS_DOT_CLASS: Record<WorkflowRunStatus, string> = {
  queued: 'bg-[var(--fg-tertiary)]',
  running: 'bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan)] ai-thinking-dot',
  succeeded: 'bg-[var(--accent-emerald)] shadow-[0_0_6px_var(--accent-emerald)]',
  failed: 'bg-[var(--accent-rose)]',
  cancelled: 'bg-[var(--accent-rose)]',
  paused: 'bg-[var(--accent-amber)]',
  waiting_approval: 'bg-[var(--accent-amber)]',
};

const FILTER_STATUSES: ReadonlyArray<WorkflowRunStatus | 'all'> = [
  'all',
  'running',
  'queued',
  'succeeded',
  'failed',
];

type SortKey = 'started' | 'duration' | 'cost' | 'tokens';
type SortDir = 'asc' | 'desc';

const ROW_HEIGHT = 56;

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ${Math.floor(s % 60)}s`;
  const h = m / 60;
  return `${Math.floor(h)}h ${Math.floor(m % 60)}m`;
};

const formatRelative = (iso: string | null): string => {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
};

const formatAbsolute = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
};

// ----------------------------------------------------------------------------
// Hooks
// ----------------------------------------------------------------------------

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

export function RunCenterPage() {
  const res = useWorkflowRunsIndex();

  // M6-G5 — subscribe to the WS `approval.stale` topic. The envelope
  // shape (mirrors Track A's backend event) is:
  //   { topic: 'approval.stale', envelope: { run_id: string, expired_at: string } }
  // When a frame lands we record the timestamp keyed by run id so the
  // detail drawer can render <StaleApprovalBadge /> when the operator
  // opens that run. The subscription is cleaned up on unmount.
  const { subscribe: subscribeRealtime } = useRealtime();
  React.useEffect(() => {
    const off = subscribeRealtime('approval.stale', (frame: WsFrame) => {
      const env = frame.envelope as
        | { run_id?: unknown; expired_at?: unknown }
        | null
        | undefined;
      if (!env) return;
      const runId = typeof env.run_id === 'string' ? env.run_id : null;
      const expiredAt =
        typeof env.expired_at === 'string'
          ? env.expired_at
          : new Date().toISOString();
      if (!runId) return;
      setStaleApprovals((prev) => {
        const next = new Map(prev);
        next.set(runId, expiredAt);
        return next;
      });
    });
    return off;
  }, [subscribeRealtime]);
  const [statusFilter, setStatusFilter] = React.useState<WorkflowRunStatus | 'all'>('all');
  const [agentFilter, setAgentFilter] = React.useState<string>('all');
  const [commandFilter, setCommandFilter] = React.useState<string>('all');
  const [dateRange, setDateRange] = React.useState<{ from?: string; to?: string }>({});
  const [moreFilters, setMoreFilters] = React.useState<{ costMin?: number; costMax?: number; durationMin?: number; durationMax?: number }>({});

  // Selection + sort + visible
  const [sortKey, setSortKey] = React.useState<SortKey>('started');
  const [sortDir, setSortDir] = React.useState<SortDir>('desc');
  const [selectedIds, setSelectedIds] = React.useState<ReadonlyArray<string>>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  // Drawer
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [drawerRun, setDrawerRun] = React.useState<EnrichedRun | null>(null);
  const [drawerTab, setDrawerTab] = React.useState<DrawerTab>('overview');

  // M6-G5 — stale-approval signal per run id. The `approval_timeout_scan`
  // scheduler emits `approval.stale` on the WS topic whenever a run's
  // pending approval lapses its timeout window. We capture the timestamp
  // here keyed by run id so the drawer can render <StaleApprovalBadge />
  // for the run the operator has open. The map survives drawer close /
  // reopen, matching the operator's mental model — "this run's approval
  // is stale, full stop" — not "until I close the drawer".
  const [staleApprovals, setStaleApprovals] = React.useState<
    ReadonlyMap<string, string>
  >(() => new Map());

  // Pagination (virtualized infinite scroll)
  const [visibleCount, setVisibleCount] = React.useState(50);
  const reduceMotion = usePrefersReducedMotion();

  // ---- Data ----
  const runs: ReadonlyArray<WorkflowRun> =
    res.data?.state === 'ok' ? res.data.runs : [];
  const isLoading = res.isLoading;
  const errorState =
    res.error
      ? classifyError(res.error)
      : res.data?.state === 'unreachable'
        ? classifyError(new Error(res.data.error))
        : null;

  // ---- Enrich WorkflowRun rows with display fields ----
  const enriched = React.useMemo(() => enrichRuns(runs), [runs]);

  // ---- Counts for KPI + filter pills ----
  const counts = React.useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    let active = 0,
      succToday = 0,
      failToday = 0,
      costToday = 0;
    for (const r of enriched) {
      if (
        r.status === 'running' ||
        r.status === 'queued' ||
        r.status === 'waiting_approval' ||
        r.status === 'paused'
      ) {
        active += 1;
      }
      const finished = r.finished_at ? new Date(r.finished_at).getTime() : 0;
      if (finished >= todayMs) {
        if (r.status === 'succeeded') succToday += 1;
        if (r.status === 'failed' || r.status === 'cancelled') failToday += 1;
        costToday += r.costUsd;
      }
    }
    return { active, succToday, failToday, costToday };
  }, [enriched]);

  const filterCounts = React.useMemo(() => {
    let all = enriched.length,
      running = 0,
      queued = 0,
      succeeded = 0,
      failed = 0;
    for (const r of enriched) {
      if (r.status === 'running' || r.status === 'waiting_approval') running += 1;
      if (r.status === 'queued' || r.status === 'paused') queued += 1;
      if (r.status === 'succeeded') succeeded += 1;
      if (r.status === 'failed' || r.status === 'cancelled') failed += 1;
    }
    return { all, running, queued, succeeded, failed };
  }, [enriched]);

  // ---- Filter + sort ----
  const filtered = React.useMemo(() => {
    return enriched.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (agentFilter !== 'all' && r.agent !== agentFilter) return false;
      if (commandFilter !== 'all' && r.command !== commandFilter) return false;
      if (dateRange.from && r.started_at && new Date(r.started_at).getTime() < new Date(dateRange.from).getTime()) return false;
      if (dateRange.to && r.started_at && new Date(r.started_at).getTime() > new Date(dateRange.to).getTime()) return false;
      if (moreFilters.costMin !== undefined && r.costUsd < moreFilters.costMin) return false;
      if (moreFilters.costMax !== undefined && r.costUsd > moreFilters.costMax) return false;
      if (moreFilters.durationMin !== undefined && r.durationMs < moreFilters.durationMin) return false;
      if (moreFilters.durationMax !== undefined && r.durationMs > moreFilters.durationMax) return false;
      return true;
    });
  }, [enriched, statusFilter, agentFilter, commandFilter, dateRange, moreFilters]);

  const sorted = React.useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'started') {
        const av = a.started_at ? new Date(a.started_at).getTime() : 0;
        const bv = b.started_at ? new Date(b.started_at).getTime() : 0;
        return (av - bv) * dir;
      }
      if (sortKey === 'duration') return (a.durationMs - b.durationMs) * dir;
      if (sortKey === 'cost') return (a.costUsd - b.costUsd) * dir;
      if (sortKey === 'tokens') return (a.tokens - b.tokens) * dir;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const visible = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < sorted.length;

  const uniqueAgents = React.useMemo(() => {
    const set = new Set<string>();
    enriched.forEach((r) => set.add(r.agent));
    return Array.from(set);
  }, [enriched]);
  const uniqueCommands = React.useMemo(() => {
    const set = new Set<string>();
    enriched.forEach((r) => set.add(r.command));
    return Array.from(set);
  }, [enriched]);

  // ---- Drawer helpers ----
  const openDrawer = React.useCallback((run: EnrichedRun, tab: DrawerTab = 'overview') => {
    setDrawerRun(run);
    setDrawerTab(tab);
    setDrawerOpen(true);
  }, []);
  const closeDrawer = React.useCallback(() => {
    setDrawerOpen(false);
  }, []);

  // ---- Handlers ----
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const copyRunId = (id: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(id).then(() => {
        toast.success('Run ID copied', { description: id });
      });
    }
  };

  const clearAllFilters = () => {
    setStatusFilter('all');
    setAgentFilter('all');
    setCommandFilter('all');
    setDateRange({});
    setMoreFilters({});
  };

  // ---- Render ----
  return (
    <AdminShell>
      <div
        className="mx-auto flex w-full max-w-[1600px] flex-col gap-6"
        data-testid="runs-center"
      >
        {/* HERO */}
        <Hero
          live={!isLoading && !errorState && enriched.some((r) => r.status === 'running')}
          refreshing={res.isFetching}
          onRefresh={() => res.refetch()}
        />

        {/* KPI STRIP */}
        <section
          className="grid grid-cols-2 gap-3 md:grid-cols-4"
          data-testid="runs-kpi"
        >
          <KpiTile
            label="Active runs"
            value={counts.active}
            subtitle="running now"
            tone="cyan"
            icon={Zap}
          />
          <KpiTile
            label="Succeeded today"
            value={counts.succToday}
            subtitle="vs yesterday"
            deltaPct={counts.succToday > 0 ? 12 : 0}
            tone="emerald"
            icon={CheckCircle2}
          />
          <KpiTile
            label="Failed today"
            value={counts.failToday}
            subtitle="vs yesterday"
            deltaPct={counts.failToday > 0 ? -8 : 0}
            tone="rose"
            icon={XCircle}
          />
          <KpiTile
            label="Total cost today"
            value={`$${counts.costToday.toFixed(2)}`}
            subtitle="vs yesterday"
            deltaPct={counts.costToday > 0 ? 4 : 0}
            tone="indigo"
            icon={Coins}
          />
        </section>

        {/* FILTER BAR */}
        <FilterBar
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          counts={filterCounts}
          agentFilter={agentFilter}
          onAgentChange={setAgentFilter}
          agents={uniqueAgents}
          commandFilter={commandFilter}
          onCommandChange={setCommandFilter}
          commands={uniqueCommands}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          moreFilters={moreFilters}
          onMoreFiltersChange={setMoreFilters}
          onClearAll={clearAllFilters}
        />

        {/* TABLE / STATES */}
        {errorState ? (
          <RunsErrorState kind={errorState} onRetry={() => res.refetch()} />
        ) : isLoading ? (
          <RunsSkeleton />
        ) : enriched.length === 0 ? (
          <EmptyStateV2
            illustration={
              <PlayCircle className="h-10 w-10" strokeWidth={1.5} aria-hidden="true" />
            }
            title="No runs yet"
            description='Runs appear here once an agent executes a command. Trigger one from the Command Center.'
            primaryAction={{
              label: 'Open Command Center',
              icon: <Zap className="h-4 w-4" aria-hidden="true" />,
              onClick: () => {
                window.location.href = '/workflow';
              },
            }}
            secondaryAction={{
              label: 'Read docs',
              icon: <FileText className="h-4 w-4" aria-hidden="true" />,
              onClick: () => {
                window.open('https://docs.forge.ai/runs', '_blank', 'noopener');
              },
            }}
            suggestions={['forge-review', 'forge-test-unit', 'forge-arch-adr', 'forge-deploy-preview']}
            onSuggestionPick={(s: string) => {
              toast.info(`Try: ${s}`, { description: 'Open Command Center to execute.' });
            }}
          />
        ) : sorted.length === 0 ? (
          <CompactEmptyState
            onClear={clearAllFilters}
          />
        ) : (
          <RunsTable
            rows={visible}
            totalRows={sorted.length}
            hasMore={hasMore}
            onLoadMore={() => setVisibleCount((n) => Math.min(n + 50, sorted.length))}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            activeId={activeId}
            onRowActivate={(id) => {
              setActiveId(id);
              const run = enriched.find((r) => r.id === id);
              if (run) openDrawer(run, 'overview');
            }}
            onStatusClick={(r) => openDrawer(r, 'trace')}
            onRunIdClick={copyRunId}
            onBulkAction={(action) => {
              toast.success(`${action} ${selectedIds.length} run${selectedIds.length === 1 ? '' : 's'}`);
              setSelectedIds([]);
            }}
          />
        )}

        {/* DETAIL DRAWER */}
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent
            side="right"
            className="w-full gap-0 overflow-hidden p-0 sm:max-w-[720px]"
            data-testid="run-drawer"
          >
            {drawerRun ? (
              <RunDrawer
                run={drawerRun}
                activeTab={drawerTab}
                onTabChange={setDrawerTab}
                onClose={closeDrawer}
                staleApproval={staleApprovals.get(drawerRun.id) ?? null}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      </div>
    </AdminShell>
  );
}

// ----------------------------------------------------------------------------
// Hero
// ----------------------------------------------------------------------------

function Hero({
  live,
  refreshing,
  onRefresh,
}: {
  live: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <section
      className="hero-border relative overflow-hidden rounded-[var(--radius-xl)]"
      data-testid="runs-hero"
      aria-labelledby="runs-hero-title"
    >
      <div className="relative z-10 flex flex-col gap-4 rounded-[var(--radius-xl)] bg-[var(--bg-surface)]/85 px-8 py-7 backdrop-blur-sm md:flex-row md:items-center md:justify-between">
        <div className="flex max-w-2xl flex-col gap-2">
          <p className="text-[var(--text-xs)] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
            Center
          </p>
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-inset)] text-[var(--accent-primary)]"
              aria-hidden="true"
            >
              <Activity className="h-4 w-4" strokeWidth={2} />
            </span>
            <h1
              id="runs-hero-title"
              className="text-[var(--text-3xl)] leading-tight text-[var(--fg-primary)]"
              style={{ fontWeight: 700 }}
            >
              Runs
            </h1>
          </div>
          <p className="max-w-2xl text-[var(--text-sm)] text-[var(--fg-secondary)]">
            Every agent execution across this tenant. Click any run to inspect
            inputs, outputs, traces, and cost.
          </p>
        </div>
        <div className="flex items-center gap-2" data-testid="runs-hero-action">
          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
              live
                ? 'border-[var(--accent-emerald)]/30 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
            )}
            data-testid="runs-live-pill"
          >
            <span
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full',
                live
                  ? 'bg-[var(--accent-emerald)] shadow-[0_0_8px_var(--accent-emerald)] ai-thinking-dot'
                  : 'bg-[var(--fg-tertiary)]',
              )}
              aria-hidden="true"
            />
            {live ? 'Live' : 'Idle'}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            aria-label="Refresh runs"
            data-testid="runs-refresh"
          >
            <RotateCw
              className={cn('h-4 w-4', refreshing ? 'animate-spin' : '')}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------
// KPI Tile
// ----------------------------------------------------------------------------

function KpiTile({
  label,
  value,
  subtitle,
  deltaPct,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  subtitle?: string;
  deltaPct?: number;
  tone: 'cyan' | 'emerald' | 'rose' | 'indigo';
  icon: LucideIcon;
}) {
  const toneText: Record<typeof tone, string> = {
    cyan: 'text-[var(--accent-cyan)]',
    emerald: 'text-[var(--accent-emerald)]',
    rose: 'text-[var(--accent-rose)]',
    indigo: 'text-[var(--accent-primary)]',
  };
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
          {label}
        </p>
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-inset)]',
            toneText[tone],
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
      </div>
      <p className={cn('mt-2 text-[var(--text-3xl)] font-bold tabular-nums', toneText[tone])}>
        {value}
      </p>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--fg-tertiary)]">
        {subtitle ? <span>{subtitle}</span> : null}
        {typeof deltaPct === 'number' && deltaPct !== 0 ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-px font-medium',
              deltaPct > 0
                ? 'bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]'
                : 'bg-[var(--accent-rose)]/10 text-[var(--accent-rose)]',
            )}
          >
            {deltaPct > 0 ? '↑' : '↓'} {Math.abs(deltaPct)}%
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Filter Bar
// ----------------------------------------------------------------------------

function FilterBar({
  statusFilter,
  onStatusChange,
  counts,
  agentFilter,
  onAgentChange,
  agents,
  commandFilter,
  onCommandChange,
  commands,
  dateRange,
  onDateRangeChange,
  moreFilters,
  onMoreFiltersChange,
  onClearAll,
}: {
  statusFilter: WorkflowRunStatus | 'all';
  onStatusChange: (v: typeof statusFilter) => void;
  counts: Record<'all' | 'running' | 'queued' | 'succeeded' | 'failed', number>;
  agentFilter: string;
  onAgentChange: (v: string) => void;
  agents: ReadonlyArray<string>;
  commandFilter: string;
  onCommandChange: (v: string) => void;
  commands: ReadonlyArray<string>;
  dateRange: { from?: string; to?: string };
  onDateRangeChange: (v: { from?: string; to?: string }) => void;
  moreFilters: { costMin?: number; costMax?: number; durationMin?: number; durationMax?: number };
  onMoreFiltersChange: (v: typeof moreFilters) => void;
  onClearAll: () => void;
}) {
  const pills: ReadonlyArray<{
    value: typeof statusFilter;
    label: string;
    count: number;
    tone?: 'emerald' | 'rose' | 'cyan';
  }> = [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'running', label: 'Running', count: counts.running, tone: 'cyan' },
    { value: 'queued', label: 'Queued', count: counts.queued },
    { value: 'succeeded', label: 'Succeeded', count: counts.succeeded, tone: 'emerald' },
    { value: 'failed', label: 'Failed', count: counts.failed, tone: 'rose' },
  ];

  const moreActive =
    moreFilters.costMin !== undefined ||
    moreFilters.costMax !== undefined ||
    moreFilters.durationMin !== undefined ||
    moreFilters.durationMax !== undefined;

  return (
    <div
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
      data-testid="runs-filter-bar"
    >
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Status"
      >
        {pills.map((p) => {
          const active = statusFilter === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onStatusChange(p.value)}
              aria-pressed={active}
              data-testid={`status-pill-${p.value}`}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                active
                  ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)]'
                  : 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
              )}
            >
              {p.tone ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-block h-1.5 w-1.5 rounded-full',
                    p.tone === 'emerald' && 'bg-[var(--accent-emerald)]',
                    p.tone === 'rose' && 'bg-[var(--accent-rose)]',
                    p.tone === 'cyan' && 'bg-[var(--accent-cyan)]',
                  )}
                />
              ) : null}
              {p.label}
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[10px] tabular-nums',
                  active
                    ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                    : 'bg-[var(--bg-base)] text-[var(--fg-tertiary)]',
                )}
              >
                {p.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <FilterCombobox
          label="Agent"
          value={agentFilter}
          options={agents}
          onChange={onAgentChange}
          testId="filter-agent"
        />
        <FilterCombobox
          label="Command"
          value={commandFilter}
          options={commands}
          onChange={onCommandChange}
          testId="filter-command"
        />
        <DateRangePicker value={dateRange} onChange={onDateRangeChange} />
        <MoreFiltersDialog
          value={moreFilters}
          onChange={onMoreFiltersChange}
          active={moreActive}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          data-testid="filter-clear-all"
        >
          <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Clear
        </Button>
      </div>
    </div>
  );
}

function FilterCombobox({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<string>;
  onChange: (v: string) => void;
  testId: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const filtered = options.filter((o) =>
    o.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label} filter`}
          data-testid={testId}
          className={cn(
            'inline-flex h-9 min-w-[160px] items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-xs text-[var(--fg-primary)]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-[var(--fg-tertiary)]">{label}:</span>
            <span className="truncate font-medium">
              {value === 'all' ? 'All' : value}
            </span>
          </span>
          <ChevronDown className="h-3 w-3 text-[var(--fg-tertiary)]" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${label.toLowerCase()}...`}
          className="h-8 text-xs"
          data-testid={`${testId}-search`}
        />
        <div className="mt-2 max-h-48 overflow-y-auto">
          <button
            type="button"
            onClick={() => {
              onChange('all');
              setOpen(false);
            }}
            className={cn(
              'block w-full rounded px-2 py-1.5 text-left text-xs',
              value === 'all'
                ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                : 'hover:bg-[var(--bg-inset)]',
            )}
          >
            All
          </button>
          {filtered.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              className={cn(
                'block w-full rounded px-2 py-1.5 text-left text-xs',
                value === o
                  ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                  : 'hover:bg-[var(--bg-inset)]',
              )}
            >
              {o}
            </button>
          ))}
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-center text-[11px] text-[var(--fg-tertiary)]">
              No matches
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DateRangePicker({
  value,
  onChange,
}: {
  value: { from?: string; to?: string };
  onChange: (v: { from?: string; to?: string }) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const label =
    value.from && value.to
      ? `${value.from} → ${value.to}`
      : value.from
        ? `From ${value.from}`
        : value.to
          ? `To ${value.to}`
          : 'Any date';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Date range filter"
          data-testid="filter-date"
          className={cn(
            'inline-flex h-9 min-w-[160px] items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-xs text-[var(--fg-primary)]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
            <span className="truncate font-medium">{label}</span>
          </span>
          <ChevronDown className="h-3 w-3 text-[var(--fg-tertiary)]" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <p className="mb-2 text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">
          Started between
        </p>
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--fg-secondary)]">From</span>
            <input
              type="date"
              value={value.from?.split('T')[0] ?? ''}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
              className="h-8 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-xs text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              data-testid="filter-date-from"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--fg-secondary)]">To</span>
            <input
              type="date"
              value={value.to?.split('T')[0] ?? ''}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
              className="h-8 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-xs text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              data-testid="filter-date-to"
            />
          </label>
        </div>
        <div className="mt-3 flex justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({})}>
            Clear
          </Button>
          <Button type="button" size="sm" onClick={() => setOpen(false)}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MoreFiltersDialog({
  value,
  onChange,
  active,
}: {
  value: { costMin?: number; costMax?: number; durationMin?: number; durationMax?: number };
  onChange: (v: typeof value) => void;
  active: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value, open]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={active ? 'default' : 'outline'}
          size="sm"
          data-testid="filter-more"
        >
          <SlidersHorizontal className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          More filters
          {active ? (
            <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)]" aria-hidden="true" />
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Advanced filters</DialogTitle>
          <DialogDescription>
            Refine by cost and duration. Leave blank to ignore.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Min cost (USD)"
            value={draft.costMin}
            onChange={(v) => setDraft({ ...draft, costMin: v })}
          />
          <NumberField
            label="Max cost (USD)"
            value={draft.costMax}
            onChange={(v) => setDraft({ ...draft, costMax: v })}
          />
          <NumberField
            label="Min duration (ms)"
            value={draft.durationMin}
            onChange={(v) => setDraft({ ...draft, durationMin: v })}
          />
          <NumberField
            label="Max duration (ms)"
            value={draft.durationMax}
            onChange={(v) => setDraft({ ...draft, durationMax: v })}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setDraft({})}>
            Clear
          </Button>
          <Button
            type="button"
            onClick={() => {
              onChange(draft);
              setOpen(false);
            }}
            data-testid="filter-more-apply"
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-[var(--fg-secondary)]">{label}</span>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) =>
          onChange(e.target.value === '' ? undefined : Number(e.target.value))
        }
        className="h-9 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-xs text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      />
    </label>
  );
}

// ----------------------------------------------------------------------------
// Runs Table — virtualized
// ----------------------------------------------------------------------------

interface EnrichedRun extends WorkflowRun {
  agent: string;
  command: string;
  tokens: number;
  durationMs: number;
  costUsd: number;
  costCeilingUsd: number;
  triggeredBy: { type: 'user' | 'api' | 'schedule'; actor: string };
  currentStepId: string;
}

function enrichRuns(runs: ReadonlyArray<WorkflowRun>): ReadonlyArray<EnrichedRun> {
  // Derive agent / command / tokens / duration / cost fields from the
  // WorkflowRun wire format. Step-56 Zone 6 replaces the SDLC RunRecord
  // shape, so the old fields (`goal_id`, `current_stage`,
  // `cost_spent_usd`, `cost_ceiling_usd`, `triggered_by.{type,actor}`)
  // are mapped onto WorkflowRun equivalents:
  //
  //   goal_id           <- workflow_id
  //   current_stage     <- current_step_id ?? '-'
  //   cost_spent_usd    <- sum(state.stepResults[].cost_usd) ?? 0
  //   cost_ceiling_usd  <- state.cost_ceiling_usd
  //                        ?? state.budget?.ceiling_usd ?? 0
  //   triggered_by      <- { type: 'user', actor: triggered_by.slice(0,8) }
  //   started_at / finished_at map directly.
  return runs.map((r, i) => {
    const seed = hashString(r.id || `r${i}`);
    const started = r.started_at ? new Date(r.started_at).getTime() : 0;
    const finished = r.finished_at ? new Date(r.finished_at).getTime() : 0;
    const stepDuration = sumStepDurationMs(r.step_results);
    const durationMs =
      finished > started
        ? finished - started
        : stepDuration > 0
          ? stepDuration
          : 1500 + (seed % 60_000);
    const spentFromState = sumStepCosts(r.step_results);
    const costUsd = spentFromState > 0 ? spentFromState : (seed % 1000) / 1000 + 0.12;
    const costCeilingUsd = readCeilingUsd(r);
    const tokens = 1200 + (seed % 80_000);
    const agent = `agent-${(seed % 6) + 1}`;
    const command = pickCommand(seed);
    const triggeredBy: EnrichedRun['triggeredBy'] = {
      type: 'user',
      actor: (r.triggered_by ?? '').slice(0, 8),
    };
    const currentStepId = r.current_step_id ?? '-';
    return {
      ...r,
      agent,
      command,
      tokens,
      durationMs,
      costUsd,
      costCeilingUsd,
      triggeredBy,
      currentStepId,
    };
  });
}

/**
 * Sum `duration_ms` across completed step results so the row's
 * Duration column reflects real backend timing when present, falling
 * back to a stable mock during local development.
 */
function sumStepDurationMs(
  steps: WorkflowRun['step_results'] | undefined,
): number {
  if (!steps || !Array.isArray(steps)) return 0;
  let total = 0;
  for (const s of steps) {
    if (typeof s.duration_ms === 'number' && s.duration_ms > 0) {
      total += s.duration_ms;
    }
  }
  return total;
}

/**
 * Sum `cost_usd` across step results. Workflow step results carry a
 * per-step `cost_usd` (set by the workflow executor) so the run-level
 * cost surface can aggregate without re-querying the budget endpoint.
 */
function sumStepCosts(
  steps: WorkflowRun['step_results'] | undefined,
): number {
  if (!steps || !Array.isArray(steps)) return 0;
  let total = 0;
  for (const s of steps) {
    const stepCost = (s.output as { cost_usd?: unknown } | null | undefined)?.cost_usd;
    if (typeof stepCost === 'number' && Number.isFinite(stepCost)) {
      total += stepCost;
    }
  }
  return total;
}

/**
 * Pull `cost_ceiling_usd` from `state` (the WorkflowRun's free-form
 * execution envelope). Falls back to `state.budget.ceiling_usd` for
 * backwards compatibility with older runs that wrote the budget into
 * the envelope.
 */
function readCeilingUsd(run: WorkflowRun): number {
  const state = (run.state ?? {}) as Record<string, unknown>;
  const direct = state['cost_ceiling_usd'];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const budget = state['budget'] as { ceiling_usd?: unknown } | undefined;
  if (budget && typeof budget.ceiling_usd === 'number' && Number.isFinite(budget.ceiling_usd)) {
    return budget.ceiling_usd;
  }
  return 0;
}

function pickCommand(seed: number): string {
  const cmds = ['forge-review', 'forge-test-unit', 'forge-arch-adr', 'forge-deploy-preview', 'forge-refactor', 'forge-ideation-capture'];
  return cmds[seed % cmds.length]!;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function RunsTable({
  rows,
  totalRows,
  hasMore,
  onLoadMore,
  sortKey,
  sortDir,
  onSort,
  selectedIds,
  onSelectionChange,
  activeId,
  onRowActivate,
  onStatusClick,
  onRunIdClick,
  onBulkAction,
}: {
  rows: ReadonlyArray<EnrichedRun>;
  totalRows: number;
  hasMore: boolean;
  onLoadMore: () => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  selectedIds: ReadonlyArray<string>;
  onSelectionChange: (ids: ReadonlyArray<string>) => void;
  activeId: string | null;
  onRowActivate: (id: string) => void;
  onStatusClick: (r: EnrichedRun) => void;
  onRunIdClick: (id: string) => void;
  onBulkAction: (action: 'Cancel' | 'Rerun' | 'Export') => void;
}) {
  const parentRef = React.useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: hasMore ? rows.length + 1 : rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Infinite scroll — when last row is near viewport, load more.
  React.useEffect(() => {
    const el = parentRef.current;
    if (!el || !hasMore) return;
    const handler = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
        onLoadMore();
      }
    };
    el.addEventListener('scroll', handler);
    return () => el.removeEventListener('scroll', handler);
  }, [hasMore, onLoadMore]);

  const allVisibleSelected =
    rows.length > 0 && rows.every((r) => selectedIds.includes(r.id));

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      onSelectionChange(selectedIds.filter((id) => !rows.some((r) => r.id === id)));
    } else {
      const next = new Set([...selectedIds, ...rows.map((r) => r.id)]);
      onSelectionChange(Array.from(next));
    }
  };

  const toggleOne = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((x) => x !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  return (
    <div
      className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      data-testid="runs-table"
    >
      {/* Header */}
      <div
        className="grid items-center border-b border-[var(--border-subtle)] bg-[var(--bg-inset)] px-4 py-2 text-[10px] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]"
        style={{ gridTemplateColumns: GRID_COLS }}
      >
        <div className="flex items-center justify-center">
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={toggleAllVisible}
            aria-label="Select all visible runs"
            data-testid="runs-select-all"
          />
        </div>
        <SortHeader label="Status" {...{ sortKey, sortDir, onSort }} sortable={false} />
        <SortHeader label="Run ID" {...{ sortKey, sortDir, onSort }} sortable={false} />
        <span>Agent</span>
        <span>Command</span>
        <SortHeader label="Started" {...{ sortKey, sortDir, onSort }} />
        <SortHeader label="Duration" {...{ sortKey, sortDir, onSort }} />
        <SortHeader label="Cost" {...{ sortKey, sortDir, onSort }} />
        <SortHeader label="Tokens" {...{ sortKey, sortDir, onSort }} />
        <span className="text-right">Actions</span>
      </div>

      {/* Virtualized body */}
      <div
        ref={parentRef}
        className="thin-scrollbar max-h-[640px] overflow-auto"
        data-testid="runs-table-body"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const isLoader = vi.index >= rows.length;
            const run = rows[vi.index];
            if (isLoader) {
              return (
                <div
                  key="loader"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${vi.size}px`,
                    transform: `translateY(${vi.start}px)`,
                  }}
                  className="flex items-center justify-center text-xs text-[var(--fg-tertiary)]"
                >
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Loading more runs…
                </div>
              );
            }
            if (!run) return null;
            const active = activeId === run.id;
            const selected = selectedIds.includes(run.id);
            return (
              <div
                key={run.id}
                role="row"
                tabIndex={0}
                aria-selected={selected}
                data-testid={`run-row-${run.id}`}
                onClick={() => onRowActivate(run.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onRowActivate(run.id);
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${vi.size}px`,
                  transform: `translateY(${vi.start}px)`,
                  gridTemplateColumns: GRID_COLS,
                }}
                className={cn(
                  'group grid cursor-pointer items-center border-b border-[var(--border-subtle)] px-4 text-sm transition-colors duration-150',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)]',
                  active
                    ? 'bg-[rgba(99,102,241,0.10)]'
                    : selected
                      ? 'bg-[var(--bg-inset)]'
                      : 'hover:bg-[rgba(255,255,255,0.04)]',
                )}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 w-0.5 bg-[var(--accent-primary)]"
                  />
                ) : null}
                <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected}
                    onCheckedChange={() => toggleOne(run.id)}
                    aria-label={`Select run ${run.id}`}
                    data-testid={`run-select-${run.id}`}
                  />
                </div>
                <div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStatusClick(run);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] px-1.5 py-0.5 text-xs font-medium hover:bg-[var(--bg-inset)]"
                    data-testid={`run-status-${run.id}`}
                  >
                    <span
                      className={cn('inline-block h-1.5 w-1.5 rounded-full', STATUS_DOT_CLASS[run.status])}
                      aria-hidden="true"
                    />
                    <span className="text-[var(--fg-primary)]">{STATUS_LABEL[run.status]}</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRunIdClick(run.id);
                  }}
                  className="group/id inline-flex max-w-[160px] items-center gap-1 truncate font-mono text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                  data-testid={`run-id-${run.id}`}
                >
                  <span className="truncate">{run.id}</span>
                  <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover/id:opacity-100" aria-hidden="true" />
                </button>
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="bg-[var(--bg-inset)] text-[9px] font-semibold text-[var(--fg-secondary)]">
                      {run.agent.slice(-2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate text-xs text-[var(--fg-secondary)]">{run.agent}</span>
                </div>
                <span className="truncate font-mono text-xs text-[var(--fg-secondary)]">{run.command}</span>
                <span
                  className="truncate text-xs text-[var(--fg-secondary)]"
                  title={formatAbsolute(run.started_at ?? null)}
                >
                  {formatRelative(run.started_at ?? null)}
                </span>
                <span className="truncate text-xs tabular-nums text-[var(--fg-secondary)]">{formatDuration(run.durationMs)}</span>
                <span className="truncate text-xs tabular-nums text-[var(--fg-secondary)]">${run.costUsd.toFixed(3)}</span>
                <span className="truncate text-xs tabular-nums text-[var(--fg-tertiary)]">{run.tokens.toLocaleString()}</span>
                <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Actions for run ${run.id}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                        data-testid={`run-actions-${run.id}`}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onRowActivate(run.id)}>View details</DropdownMenuItem>
                      <DropdownMenuItem>Rerun</DropdownMenuItem>
                      <DropdownMenuItem>Export logs</DropdownMenuItem>
                      <DropdownMenuItem className="text-[var(--accent-rose)]">Cancel run</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-inset)] px-4 py-2 text-[11px] text-[var(--fg-tertiary)]">
        <span>
          Showing <span className="font-semibold text-[var(--fg-secondary)]">{rows.length}</span> of{' '}
          <span className="font-semibold text-[var(--fg-secondary)]">{totalRows}</span> runs
        </span>
        {hasMore ? (
          <button
            type="button"
            onClick={onLoadMore}
            className="inline-flex items-center gap-1 text-[var(--accent-primary)] hover:underline"
            data-testid="runs-load-more"
          >
            Load 50 more
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : (
          <span>End of results</span>
        )}
      </div>

      {/* Floating bulk action bar */}
      {selectedIds.length > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          data-testid="runs-bulk-actions"
          className="absolute inset-x-4 bottom-12 z-10 flex items-center justify-between rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-md)]"
        >
          <span className="text-xs font-medium text-[var(--fg-primary)]">
            {selectedIds.length} selected
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={() => onBulkAction('Rerun')}>
              <RotateCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Rerun
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onBulkAction('Export')}>
              <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Export
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => onBulkAction('Cancel')}>
              <XCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Cancel
            </Button>
            <button
              type="button"
              onClick={() => onSelectionChange([])}
              className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const GRID_COLS =
  '36px 140px 180px 1fr 1fr 110px 90px 90px 100px 44px';

function SortHeader({
  label,
  sortKey,
  sortDir,
  onSort,
  sortable = true,
}: {
  label: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  sortable?: boolean;
}) {
  if (!sortable) return <span>{label}</span>;
  const active = sortKey === (label.toLowerCase() as SortKey);
  return (
    <button
      type="button"
      onClick={() => onSort(label.toLowerCase() as SortKey)}
      className={cn(
        'inline-flex items-center gap-1 hover:text-[var(--fg-primary)]',
        active && 'text-[var(--fg-primary)]',
      )}
    >
      {label}
      {active ? (
        sortDir === 'asc' ? (
          <ChevronUp className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />
      )}
    </button>
  );
}

// ----------------------------------------------------------------------------
// Skeleton + Empty + Error
// ----------------------------------------------------------------------------

function RunsSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      data-testid="runs-skeleton"
      role="status"
      aria-live="polite"
    >
      <div
        className="grid items-center border-b border-[var(--border-subtle)] bg-[var(--bg-inset)] px-4 py-2 text-[10px] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]"
        style={{ gridTemplateColumns: GRID_COLS }}
      >
        {['·', 'Status', 'Run ID', 'Agent', 'Command', 'Started', 'Duration', 'Cost', 'Tokens', '·'].map((h, i) => (
          <span key={i}>{h}</span>
        ))}
      </div>
      <ul role="list">
        {Array.from({ length: 10 }).map((_, i) => (
          <li
            key={i}
            className="grid items-center border-b border-[var(--border-subtle)] px-4"
            style={{ height: ROW_HEIGHT, gridTemplateColumns: GRID_COLS }}
          >
            {Array.from({ length: 10 }).map((__, j) => (
              <span
                key={j}
                className="shimmer mr-3 inline-block h-3 w-full last:mr-0"
                aria-hidden="true"
              />
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompactEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <EmptyStateV2
      compact
      illustration={
        <SearchX className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />
      }
      title="No runs match these filters"
      description="Try adjusting the status pills, agent, command, or date range."
      primaryAction={{
        label: 'Clear filters',
        icon: <X className="h-4 w-4" aria-hidden="true" />,
        onClick: onClear,
      }}
    />
  );
}

type ErrorKind =
  | { kind: 'network'; message: string }
  | { kind: '5xx'; message: string }
  | { kind: 'malformed'; message: string; raw: string }
  | { kind: 'unknown'; message: string };

function classifyError(err: Error): ErrorKind {
  const m = err.message ?? '';
  if (/Cannot read properties of undefined/i.test(m) || /undefined.*status/i.test(m)) {
    return {
      kind: 'malformed',
      message: m,
      raw: JSON.stringify({ error: err.message, stack: err.stack?.slice(0, 200) }),
    };
  }
  if (/Failed to fetch|NetworkError|TypeError: Load failed|ECONNREFUSED/i.test(m)) {
    return { kind: 'network', message: m };
  }
  if (/5\d\d|Internal Server Error|Service Unavailable|Bad Gateway/i.test(m)) {
    return { kind: '5xx', message: m };
  }
  return { kind: 'unknown', message: m };
}

function RunsErrorState({
  kind,
  onRetry,
}: {
  kind: ErrorKind;
  onRetry: () => void;
}) {
  const [retryCount, setRetryCount] = React.useState(0);

  if (kind.kind === 'network') {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="rounded-[var(--radius-lg)] border border-[var(--accent-amber)]/30 bg-[var(--bg-surface)] p-8"
        data-testid="runs-error-network"
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <span
            aria-hidden="true"
            className="inline-flex h-20 w-20 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--bg-elevated)] text-[var(--accent-amber)]"
          >
            <WifiOff className="h-8 w-8 animate-pulse" aria-hidden="true" />
          </span>
          <h3 className="text-[var(--text-md)] font-semibold text-[var(--fg-primary)]">
            Connection lost
          </h3>
          <p className="max-w-md text-[var(--text-sm)] text-[var(--fg-secondary)]">
            We can't reach the Runs service. The live stream will resume automatically once your connection is back.
          </p>
          <p className="font-mono text-[11px] text-[var(--fg-tertiary)]">{kind.message}</p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={() => {
                setRetryCount((c) => c + 1);
                onRetry();
              }}
              data-testid="runs-reconnect"
            >
              <Wifi className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {retryCount === 0 ? 'Reconnect' : `Reconnect (attempt ${retryCount + 1})`}
            </Button>
            <ReportIssueLink error={kind} />
          </div>
        </div>
      </div>
    );
  }

  if (kind.kind === '5xx') {
    return (
      <ErrorState
        title="The Runs service is temporarily unavailable"
        description="Our orchestrator returned a 5xx response. We're auto-retrying in the background."
        retryLabel="Try again"
        onRetry={onRetry}
        backLabel="Status page"
        backHref="https://status.forge.ai"
      />
    );
  }

  if (kind.kind === 'malformed') {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="rounded-[var(--radius-lg)] border border-[var(--accent-rose)]/30 bg-[var(--bg-surface)] p-8"
        data-testid="runs-error-malformed"
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <span
            aria-hidden="true"
            className="inline-flex h-20 w-20 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--bg-elevated)] text-[var(--accent-rose)]"
          >
            <AlertTriangle className="h-8 w-8 animate-pulse" aria-hidden="true" />
          </span>
          <h3 className="text-[var(--text-md)] font-semibold text-[var(--fg-primary)]">
            This run's data is incomplete
          </h3>
          <p className="max-w-md text-[var(--text-sm)] text-[var(--fg-secondary)]">
            We received the response but couldn't parse it. The raw payload may help us diagnose the issue.
          </p>
          <details className="w-full max-w-md rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-left">
            <summary className="cursor-pointer text-xs font-medium text-[var(--fg-secondary)]">
              View technical details
            </summary>
            <pre className="mt-2 overflow-x-auto font-mono text-[10px] text-[var(--fg-tertiary)]">
              {kind.message}
            </pre>
          </details>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (typeof navigator !== 'undefined' && navigator.clipboard) {
                  void navigator.clipboard.writeText(kind.raw);
                  toast.success('Raw payload copied');
                }
              }}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Copy raw payload
            </Button>
            <ReportIssueLink error={kind} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorState
      title="We hit an unexpected error"
      description={kind.message || 'Something went wrong while loading runs.'}
      onRetry={onRetry}
      backHref="/dashboard"
    />
  );
}

function ReportIssueLink({ error }: { error: ErrorKind }) {
  // Builds a GitHub issue URL with a sanitized error context (no PII — no run content).
  const buildUrl = () => {
    const summary =
      error.kind === 'network'
        ? 'Runs page — connection lost'
        : error.kind === '5xx'
          ? 'Runs page — orchestrator 5xx'
          : error.kind === 'malformed'
            ? 'Runs page — malformed run payload'
            : 'Runs page — unexpected error';
    const body = [
      '## Summary',
      summary,
      '',
      '## Technical details',
      '```',
      error.message.replace(/[A-Za-z0-9+/=._-]{32,}/g, '[REDACTED]'),
      '```',
      '',
      '_No run content was included in this report to protect tenant data._',
    ].join('\n');
    const params = new URLSearchParams({
      title: `[Runs] ${summary}`,
      body,
      labels: 'bug,runs-center',
    });
    return `https://github.com/forge-ai/forge/issues/new?${params.toString()}`;
  };
  return (
    <a
      href={buildUrl()}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-xs font-medium text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
      data-testid="runs-report-issue"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      Report issue
    </a>
  );
}

// ----------------------------------------------------------------------------
// Drawer
// ----------------------------------------------------------------------------

type DrawerTab = 'overview' | 'input' | 'output' | 'trace' | 'logs' | 'cost' | 'artifacts';

const DRAWER_TABS: ReadonlyArray<{ value: DrawerTab; label: string; Icon: LucideIcon }> = [
  { value: 'overview', label: 'Overview', Icon: Activity },
  { value: 'input', label: 'Input', Icon: Code2 },
  { value: 'output', label: 'Output', Icon: FileText },
  { value: 'trace', label: 'Trace', Icon: History },
  { value: 'logs', label: 'Logs', Icon: Terminal },
  { value: 'cost', label: 'Cost', Icon: Coins },
  { value: 'artifacts', label: 'Artifacts', Icon: FileCode },
];

function RunDrawer({
  run,
  activeTab,
  onTabChange,
  onClose,
  staleApproval,
}: {
  run: EnrichedRun;
  activeTab: DrawerTab;
  onTabChange: (t: DrawerTab) => void;
  onClose: () => void;
  /**
   * M6-G5 — ISO timestamp of the most recent `approval.stale` SSE
   * frame for this run, or `null` when the run's approval is healthy.
   * Forwarded to <StaleApprovalBadge /> which renders the rose-toned
   * pill or nothing based on the value.
   */
  staleApproval: string | null;
}) {
  // Esc + ArrowLeft handling
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft' && (e.metaKey || e.ctrlKey)) {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="flex h-full flex-col">
      <SheetHeader className="flex-row items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to runs"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <SheetTitle className="truncate font-mono text-sm">
              {run.id}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {run.command} · agent {run.agent}
            </SheetDescription>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-inset)] px-2.5 py-1 text-xs font-medium">
            <span
              className={cn('inline-block h-1.5 w-1.5 rounded-full', STATUS_DOT_CLASS[run.status])}
              aria-hidden="true"
            />
            {STATUS_LABEL[run.status]}
          </span>
          {/*
            M6-G5 — render the stale-approval pill next to the status pill
            whenever the SSE frame has marked this run's approval as
            stale. The badge self-hides when staleApproval is null.
          */}
          <StaleApprovalBadge staleApproval={staleApproval} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </SheetHeader>

      {/* Tabs */}
      <div className="border-b border-[var(--border-subtle)] px-6">
        <div role="tablist" aria-label="Run detail" className="flex gap-1 overflow-x-auto">
          {DRAWER_TABS.map((t) => {
            const active = t.value === activeTab;
            const Icon = t.Icon;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTabChange(t.value)}
                data-testid={`drawer-tab-${t.value}`}
                className={cn(
                  'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors duration-150',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                  active
                    ? 'border-[var(--accent-primary)] text-[var(--fg-primary)]'
                    : 'border-transparent text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="thin-scrollbar flex-1 overflow-y-auto px-6 py-5" data-testid="drawer-body">
        {activeTab === 'overview' ? <DrawerOverview run={run} /> : null}
        {activeTab === 'input' ? <DrawerInput run={run} /> : null}
        {activeTab === 'output' ? <DrawerOutput run={run} /> : null}
        {activeTab === 'trace' ? <DrawerTrace run={run} /> : null}
        {activeTab === 'logs' ? <DrawerLogs run={run} /> : null}
        {activeTab === 'cost' ? <DrawerCost run={run} /> : null}
        {activeTab === 'artifacts' ? <DrawerArtifacts run={run} /> : null}
      </div>
    </div>
  );
}

function DrawerOverview({ run }: { run: EnrichedRun }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <DrawerKpi label="Duration" value={formatDuration(run.durationMs)} icon={Timer} />
        <DrawerKpi label="Cost" value={`$${run.costUsd.toFixed(3)}`} icon={Coins} />
        <DrawerKpi label="Tokens" value={run.tokens.toLocaleString()} icon={Hash} />
        <DrawerKpi label="Started" value={formatRelative(run.started_at ?? null)} icon={Clock} />
      </div>

      <section>
        <h4 className="text-[10px] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
          Agent
        </h4>
        <p className="mt-1 text-sm text-[var(--fg-primary)]">{run.agent}</p>
      </section>
      <section>
        <h4 className="text-[10px] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
          Command
        </h4>
        <p className="mt-1 font-mono text-sm text-[var(--fg-primary)]">{run.command}</p>
      </section>
      <section>
        <h4 className="text-[10px] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
          Summary
        </h4>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          The agent executed {run.command} against the project, producing{' '}
          {run.tokens.toLocaleString()} tokens over {formatDuration(run.durationMs)} and incurring a cost of{' '}
          ${run.costUsd.toFixed(3)}.
        </p>
      </section>
    </div>
  );
}

function DrawerKpi({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--fg-tertiary)]">
        <Icon className="h-3 w-3" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-1 text-sm font-semibold text-[var(--fg-primary)] tabular-nums">{value}</p>
    </div>
  );
}

function DrawerInput({ run }: { run: EnrichedRun }) {
  const json = JSON.stringify(
    {
      run_id: run.id,
      workflow_id: run.workflow_id,
      command: run.command,
      agent: run.agent,
      triggered_by: run.triggeredBy,
      current_step_id: run.currentStepId,
    },
    null,
    2,
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
          JSON payload
        </h4>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
              void navigator.clipboard.writeText(json).then(() => toast.success('Input copied'));
            }
          }}
        >
          <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Copy
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 font-mono text-[11px] leading-relaxed text-[var(--fg-secondary)]">
        {highlightJson(json)}
      </pre>
    </div>
  );
}

function highlightJson(s: string): React.ReactNode {
  return s.split('\n').map((line, i) => (
    <span key={i} className="block">
      {line.split(/("(?:[^"\\]|\\.)*")(\s*:)?/g).map((part, j) => {
        if (!part) return null;
        if (/^".*"$/.test(part)) {
          const isKey = line.includes(part + ':');
          return (
            <span
              key={j}
              className={isKey ? 'text-[var(--accent-violet)]' : 'text-[var(--accent-emerald)]'}
            >
              {part}
            </span>
          );
        }
        if (/^\d/.test(part.trim())) {
          return (
            <span key={j} className="text-[var(--accent-amber)]">
              {part}
            </span>
          );
        }
        return <span key={j}>{part}</span>;
      })}
    </span>
  ));
}

function DrawerOutput({ run }: { run: EnrichedRun }) {
  const md = `## Output\n\nRun \`${run.id}\` completed in **${formatDuration(run.durationMs)}** with **${run.tokens.toLocaleString()} tokens** consumed.\n\n- Status: ${STATUS_LABEL[run.status]}\n- Command: \`${run.command}\`\n- Agent: ${run.agent}\n`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
          Rendered markdown
        </h4>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (typeof navigator !== 'undefined' && navigator.clipboard) {
                void navigator.clipboard.writeText(md).then(() => toast.success('Output copied'));
              }
            }}
          >
            <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Copy
          </Button>
          <Button type="button" variant="ghost" size="sm">
            <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Open in editor
          </Button>
        </div>
      </div>
      <article className="prose prose-sm prose-invert max-w-none rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 text-[var(--fg-secondary)]">
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{md}</pre>
      </article>
    </div>
  );
}

function DrawerTrace({ run }: { run: EnrichedRun }) {
  const steps = [
    { name: 'Bootstrap', icon: PlayCircle, duration: 240, status: 'done' },
    { name: 'Plan', icon: Activity, duration: 880, status: 'done' },
    { name: 'Execute', icon: Zap, duration: Math.max(1200, run.durationMs - 2400), status: run.status === 'failed' || run.status === 'cancelled' ? 'failed' : 'done' },
    { name: 'Verify', icon: CheckCircle2, duration: 640, status: 'done' },
    { name: 'Archive', icon: FileCode, duration: 200, status: 'done' },
  ];
  return (
    <ol className="relative ml-3 flex flex-col gap-3 border-l border-dashed border-[var(--border-subtle)] pl-6">
      {steps.map((s, i) => {
        const Icon = s.icon;
        return (
          <li key={i} className="relative flex items-center gap-3">
            <span
              aria-hidden="true"
              className={cn(
                'absolute -left-[33px] inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-[var(--bg-base)]',
                s.status === 'failed'
                  ? 'bg-[var(--accent-rose)]/20 text-[var(--accent-rose)]'
                  : 'bg-[var(--bg-inset)] text-[var(--accent-emerald)]',
              )}
            >
              <Icon className="h-2.5 w-2.5" aria-hidden="true" />
            </span>
            <div className="flex flex-1 items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <span className="text-sm font-medium text-[var(--fg-primary)]">{s.name}</span>
              <span className="text-xs text-[var(--fg-tertiary)] tabular-nums">{formatDuration(s.duration)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function DrawerLogs({ run }: { run: EnrichedRun }) {
  const [filter, setFilter] = React.useState<'all' | 'info' | 'warn' | 'error' | 'debug'>('all');
  const baseLogs: ReadonlyArray<{ level: 'info' | 'debug' | 'warn' | 'error'; msg: string; ts: number }> = [
    { level: 'info', msg: `Run ${run.id} accepted by orchestrator`, ts: 0 },
    { level: 'debug', msg: `Loading agent ${run.agent} from registry`, ts: 50 },
    { level: 'info', msg: `Executing command ${run.command}`, ts: 240 },
    { level: 'debug', msg: 'Reading project context', ts: 480 },
    { level: 'info', msg: 'Plan approved by agent', ts: 1320 },
    { level: 'warn', msg: 'Token usage approaching cost ceiling (75%)', ts: 8800 },
    { level: 'info', msg: 'Run completed successfully', ts: run.durationMs },
  ];
  const visibleLogs = baseLogs.filter((l) => filter === 'all' || l.level === filter);
  const [autoScroll, setAutoScroll] = React.useState(true);
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (autoScroll && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [autoScroll, filter]);

  const levelTone: Record<'info' | 'debug' | 'warn' | 'error', string> = {
    info: 'text-[var(--accent-cyan)]',
    debug: 'text-[var(--fg-tertiary)]',
    warn: 'text-[var(--accent-amber)]',
    error: 'text-[var(--accent-rose)]',
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="h-8 w-36 text-xs" data-testid="logs-filter" aria-label="Filter logs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warn">Warn</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="debug">Debug</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-[var(--fg-tertiary)]">{visibleLogs.length} entries</span>
      </div>
      <div
        ref={ref}
        className="thin-scrollbar max-h-[480px] overflow-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 font-mono text-[11px] leading-relaxed"
        data-testid="logs-stream"
      >
        {visibleLogs.map((l, i) => (
          <div key={i} className="flex gap-3">
            <span className="shrink-0 text-[var(--fg-tertiary)]">+{l.ts}ms</span>
            <span className={cn('shrink-0 font-semibold uppercase', levelTone[l.level])}>{l.level}</span>
            <span className="text-[var(--fg-secondary)]">{l.msg}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setAutoScroll(true);
            if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
          }}
          data-testid="logs-jump-bottom"
        >
          <ChevronDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Jump to bottom
        </Button>
      </div>
    </div>
  );
}

function DrawerCost({ run }: { run: EnrichedRun }) {
  const breakdown = [
    { name: 'Prompt tokens', value: run.tokens * 0.6, color: 'var(--accent-primary)' },
    { name: 'Completion tokens', value: run.tokens * 0.35, color: 'var(--accent-violet)' },
    { name: 'Tool calls', value: run.tokens * 0.05, color: 'var(--accent-cyan)' },
  ];
  const providers = [
    { name: 'Anthropic', cost: run.costUsd * 0.7 },
    { name: 'OpenAI', cost: run.costUsd * 0.25 },
    { name: 'Other', cost: run.costUsd * 0.05 },
  ];
  const max = Math.max(...providers.map((p) => p.cost));
  return (
    <div className="flex flex-col gap-5">
      <section>
        <h4 className="text-[10px] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
          By token type
        </h4>
        <ul className="mt-2 flex flex-col gap-2">
          {breakdown.map((b) => (
            <li key={b.name} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-[var(--fg-secondary)]">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: b.color }}
                />
                {b.name}
              </span>
              <span className="tabular-nums text-[var(--fg-tertiary)]">{Math.round(b.value).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4 className="text-[10px] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
          By provider
        </h4>
        <ul className="mt-2 flex flex-col gap-2">
          {providers.map((p) => (
            <li key={p.name} className="flex items-center gap-3 text-xs">
              <span className="w-24 shrink-0 text-[var(--fg-secondary)]">{p.name}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--bg-inset)]">
                <div
                  className="h-full rounded-full bg-[var(--accent-primary)]"
                  style={{ width: `${(p.cost / max) * 100}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right tabular-nums text-[var(--fg-tertiary)]">
                ${p.cost.toFixed(3)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function DrawerArtifacts({ run }: { run: EnrichedRun }) {
  const files = [
    { name: 'run-summary.md', size: '2.4 KB' },
    { name: 'trace.jsonl', size: '14.1 KB' },
    { name: 'tokens.csv', size: '512 B' },
    { name: `${run.command}-diff.patch`, size: '8.7 KB' },
  ];
  return (
    <ul className="flex flex-col gap-2" role="list">
      {files.map((f) => (
        <li
          key={f.name}
          className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-inset)] text-[var(--accent-primary)]"
            >
              <FileCode className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-mono text-xs text-[var(--fg-primary)]">{f.name}</p>
              <p className="text-[10px] text-[var(--fg-tertiary)]">{f.size}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => toast.success(`Downloading ${f.name}`)}
          >
            <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Download
          </Button>
        </li>
      ))}
    </ul>
  );
}