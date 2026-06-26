'use client';

/**
 * Mission Control — Step 26 dashboard surface.
 *
 * Replaces the old two-card layout. Composed of:
 *   - Zone 0: PageBreadcrumb (shared)
 *   - Zone 1: Greeting + Refresh button + Tenant health pill + Customize gear + Bell + Theme toggle
 *   - Zone 1b: ConnectivityBanner (when orchestrator is down)
 *   - Zone 1c: QuickCommandBar (Cmd+K focus)
 *   - Zone 2: KPI strip (6 tiles)
 *   - Zone 3: Bento grid (7 rows of curated tiles)
 *   - Zone 4: Customize drawer (push layout, drag-to-reorder)
 *   - Zone 5: Notification popover (anchored on bell)
 *   - Zone 6: First-run onboarding overlay
 *
 * Skill influence:
 *   - `style` (Real-Time Monitoring, Data-Dense Dashboard)
 *   - `chart` (RadialBar / Area / Bar for cost / runs / top agents)
 *   - `ux` (Streaming, Keyboard, Content Jumping, Reduced Motion)
 *   - `ux` (Empty States, Breadcrumbs, Hover States, Color Only)
 *
 * The Mission Control root is a single large client component because
 * the tiles share prefs + snapshot; co-location keeps data flow
 * obvious.
 */

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Bell,
  Hand,
  LayoutGrid,
  RefreshCw,
  Search,
  Sparkles,
  Sun,
  Moon,
  X,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { RefreshButton } from './RefreshButton';
import { StaleBadge, snapshotAgeSec } from './StaleBadge';
import { cn } from '@/lib/utils';

import {
  ALL_WIDGETS,
  useDashboardPrefs,
} from './preferences';
import type { DashboardSnapshot } from './mock-data';
import type {
  AccentName,
  AgentState,
  KpiMetric,
} from './types';

// ---------------------------------------------------------------------------
//  Utility — accent color map. Tokens, never literal hex outside mock data.
// ---------------------------------------------------------------------------

const ACCENT_VAR: Record<AccentName, string> = {
  cyan: 'var(--accent-cyan)',
  indigo: 'var(--accent-primary)',
  emerald: 'var(--accent-emerald)',
  amber: 'var(--accent-amber)',
  rose: 'var(--accent-rose)',
  violet: 'var(--accent-violet)',
};

function agentStatusColor(state: AgentState): { fg: string; dot: string; border: string } {
  switch (state) {
    case 'running':
      return { fg: 'text-[var(--accent-cyan)]', dot: 'bg-[var(--accent-cyan)]', border: 'border-[var(--accent-cyan)]/60' };
    case 'idle':
      return { fg: 'text-[var(--accent-emerald)]', dot: 'bg-[var(--accent-emerald)]', border: 'border-[var(--accent-emerald)]/40' };
    case 'paused':
      return { fg: 'text-[var(--accent-amber)]', dot: 'bg-[var(--accent-amber)]', border: 'border-[var(--accent-amber)]/40' };
    case 'error':
      return { fg: 'text-[var(--accent-rose)]', dot: 'bg-[var(--accent-rose)]', border: 'border-[var(--accent-rose)]/40' };
  }
}

function timeAwareGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatKpi(metric: KpiMetric, value: number): string {
  if (metric === 'tokens-used') {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return String(value);
  }
  if (metric === 'cost-today') return value.toFixed(2);
  if (metric === 'success-rate') return value.toFixed(1);
  if (metric === 'avg-latency') return Math.round(value).toString();
  return String(value);
}

function formatDelta(delta: number): { text: string; positive: boolean } {
  if (delta === 0) return { text: '±0', positive: false };
  const positive = delta > 0;
  const sign = positive ? '+' : '−';
  return { text: `${sign}${Math.abs(delta).toFixed(delta % 1 === 0 ? 0 : 1)}`, positive };
}

// ---------------------------------------------------------------------------
//  Bento container — shared tile wrapper.
// ---------------------------------------------------------------------------

interface BentoTileProps {
  title: string;
  /** Optional right-side header slot (count, link, toggle). */
  headerRight?: React.ReactNode;
  /** Compact mode shrinks padding for the "compact" density preset. */
  compact?: boolean;
  className?: string;
  children: React.ReactNode;
  /** When true, draws a left accent strip. */
  accentStrip?: AccentName;
  /** Make the tile visually clickable (cursor + hover affordance). */
  clickable?: boolean;
  /** Optional href the tile navigates to when clicked. */
  href?: string;
  /** Optional flag — if true, tile is dimmed (stale data). */
  stale?: boolean;
  /** Test ID forwarded to the section element. */
  testId?: string;
  /** Optional stale badge rendered in top-right. */
  staleBadgeAgeSec?: number;
}

function BentoTile({ title, headerRight, compact, className, children, accentStrip, clickable, href, stale, testId, staleBadgeAgeSec }: BentoTileProps) {
  const inner = (
    <>
      {accentStrip ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1"
          style={{ background: `linear-gradient(180deg, ${ACCENT_VAR[accentStrip]}, ${ACCENT_VAR.violet})` }}
        />
      ) : null}
      {staleBadgeAgeSec && staleBadgeAgeSec > 0 ? (
        <div className="absolute right-2 top-2 z-10">
          <StaleBadge ageSec={staleBadgeAgeSec} compact />
        </div>
      ) : null}
      <header className="mb-3 flex items-start justify-between gap-2 pr-16">
        <h3 className="text-[var(--text-md)] font-semibold tracking-tight text-[var(--fg-primary)]">
          {title}
        </h3>
        {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </>
  );

  const baseClass = cn(
    'relative flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)] transition-colors',
    compact ? 'p-3' : 'p-4',
    stale ? 'stale-border' : '',
    clickable ? 'card-hover cursor-pointer' : '',
    className,
  );

  if (href) {
    return (
      <Link href={href} className={baseClass} data-testid={testId}>
        {inner}
      </Link>
    );
  }

  return (
    <section className={baseClass} data-testid={testId}>
      {inner}
    </section>
  );
}

// ---------------------------------------------------------------------------
//  Zone 1 — Greeting + Refresh + Bell
// ---------------------------------------------------------------------------

interface GreetingBarProps {
  snapshot: DashboardSnapshot;
  isMac: boolean;
  onCustomize: () => void;
  onBellClick: () => void;
  unreadAlerts: number;
  onRefresh: () => Promise<void> | void;
  showLastRefreshed: boolean;
  onLastRefreshedConsumed: () => void;
}

function GreetingBar({ snapshot, isMac, onCustomize, onBellClick, unreadAlerts, onRefresh, showLastRefreshed, onLastRefreshedConsumed }: GreetingBarProps) {
  const online = snapshot.online;
  const greeting = timeAwareGreeting();
  const onlineAgents = snapshot.agents.filter((a) => a.status === 'running').length;
  const activeProjects = 2;
  const totalAgents = snapshot.agents.length;
  const ageSec = snapshotAgeSec(snapshot.generatedAt, online);

  React.useEffect(() => {
    if (!showLastRefreshed) return;
    const t = setTimeout(onLastRefreshedConsumed, 4000);
    return () => clearTimeout(t);
  }, [showLastRefreshed, onLastRefreshedConsumed]);

  const handleBell = React.useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bell:open'));
    }
    onBellClick();
  }, [onBellClick]);

  return (
    <div
      className="relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4"
      data-testid="dashboard-greeting"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            'radial-gradient(ellipse 800px 300px at 20% 0%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(ellipse 600px 250px at 90% 100%, rgba(34,211,238,0.12), transparent 60%)',
        }}
      />
      <div className="relative flex min-h-[56px] flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h1 className="flex shrink-0 items-center gap-2 truncate text-[var(--text-lg)] font-semibold tracking-tight text-[var(--fg-primary)]">
            <span className="truncate">
              {greeting}, {snapshot.user.firstName}
            </span>
            <Hand className="h-4 w-4 shrink-0 text-[var(--accent-amber)]" aria-hidden="true" />
          </h1>
          <span aria-hidden="true" className="hidden h-4 w-px shrink-0 bg-[var(--border-subtle)] md:inline-block" />
          <p className="truncate text-[var(--text-xs)] text-[var(--fg-tertiary)]" data-testid="dashboard-greeting-sub">
            {formatDate(new Date())} · {snapshot.tenant.name} · {onlineAgents} active · {totalAgents} registered
          </p>
          {showLastRefreshed ? (
            <span
              className="hidden shrink-0 animate-fade-in text-[11px] text-[var(--accent-emerald)] md:inline-flex"
              role="status"
              data-testid="last-refreshed-toast"
            >
              ✓ refreshed
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Tenant health pill */}
          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[var(--text-xs)] font-medium',
              online
                ? 'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]'
                : 'border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]',
            )}
            data-testid="tenant-health"
            data-state={online ? 'online' : 'offline'}
          >
            <span
              aria-hidden="true"
              className={cn('h-1.5 w-1.5 rounded-full', online ? 'bg-[var(--accent-emerald)]' : 'bg-[var(--accent-amber)]')}
              style={online ? { animation: 'ai-thinking-pulse 1.6s ease-in-out infinite' } : undefined}
            />
            {online ? 'All systems normal' : 'Orchestrator unreachable'}
            {!online ? <StaleBadge ageSec={ageSec} compact className="ml-1" /> : null}
          </span>

          {/* Refresh button */}
          <RefreshButton online={online} onRefresh={onRefresh} />

          {/* Customize */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onCustomize}
            aria-label="Customize dashboard"
            data-testid="dashboard-customize-btn"
          >
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
          </Button>

          {/* Theme toggle */}
          <ThemeToggle />

          {/* Notifications — the canonical bell + dot badge lives in the
              Topbar (see components/shell/Topbar.tsx). We expose a
              hidden bridge button here that re-emits the same `bell:open`
              event when the Topbar bell isn't reachable (e.g. mobile
              layouts where the Topbar bell is collapsed). */}
          <button
            type="button"
            onClick={handleBell}
            aria-label={`Open notifications${unreadAlerts ? ` (${unreadAlerts} unread)` : ''}`}
            className="md:hidden relative flex h-8 w-8 items-center justify-center rounded-md text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            data-testid="dashboard-bell-mobile"
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            {unreadAlerts > 0 ? (
              <span
                aria-hidden="true"
                className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--accent-rose)]"
              />
            ) : null}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Connectivity banner (Zone 1)
// ---------------------------------------------------------------------------

function ConnectivityBanner({
  snapshot,
  onRetry,
}: {
  snapshot: DashboardSnapshot;
  onRetry: () => void;
}) {
  if (snapshot.online) return null;
  return (
    <div
      className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--accent-amber)]/30 bg-[rgba(245,158,11,0.08)] p-3"
      role="status"
      aria-live="polite"
      data-testid="dashboard-connectivity-banner"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent-amber)]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">Orchestrator unreachable</p>
        <p className="mt-0.5 text-[var(--text-sm)] text-[var(--fg-secondary)]">
          Live data is paused. The dashboard is showing last-known values from <span className="font-mono">2m ago</span>. Bring the stack back up:
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[var(--text-xs)]">
          <code className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5 font-mono">./scripts/dev-up.sh</code>
          <code className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5 font-mono">pnpm dev:stack</code>
          <span className="text-[var(--fg-tertiary)]">· auto-retry in {snapshot.retryInSec}s</span>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} className="shrink-0">
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Retry now
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Quick command bar (Zone 1)
// ---------------------------------------------------------------------------

function QuickCommandBar({ isMac }: { isMac: boolean }) {
  return (
    <div
      className="flex items-center gap-3 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-md)]"
      data-testid="dashboard-command-bar"
    >
      <div className="flex flex-1 items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-[var(--fg-tertiary)]" aria-hidden="true" />
        <input
          type="search"
          placeholder="Ask Forge to do anything — try 'summarize today's runs' or / for commands"
          className="flex-1 bg-transparent text-[var(--text-sm)] text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)]"
          aria-label="Quick command"
        />
        <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]">
          {isMac ? '⌘' : 'Ctrl'}K
        </kbd>
      </div>
      <Button asChild>
        <Link href="/copilot?prompt=Plan%20a%20new%20feature">
          <Zap className="h-3.5 w-3.5" aria-hidden="true" />
          New run
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link href="/copilot">
          <Sparkles className="h-3.5 w-3.5 text-[var(--accent-cyan)]" aria-hidden="true" />
          Open Co-pilot
        </Link>
      </Button>
    </div>
  );
}

export {
  GreetingBar,
  ConnectivityBanner,
  QuickCommandBar,
  BentoTile,
  ACCENT_VAR,
  agentStatusColor,
  formatKpi,
  formatDelta,
};