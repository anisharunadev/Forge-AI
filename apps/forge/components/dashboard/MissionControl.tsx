'use client';

/**
 * MissionControl — Step 57 dashboard root (wired to real backend data).
 *
 * Orchestrates:
 *   - Zone 0: <PageBreadcrumb> shared header crumb
 *   - Zone 1: GreetingBar (with RefreshButton) + ConnectivityBanner + QuickCommandBar
 *   - Zone 2: KPIStrip (last-known values when stale)
 *   - Zone 3: Rows 1–7 of bento tiles (live + curated)
 *   - Zone 4: CustomizeDrawer (push layout, drag-to-reorder)
 *   - Zone 5: Notification popover (anchored on bell)
 *   - Zone 6: First-run onboarding overlay (when zero data)
 *
 * Data source is now `/api/v1/dashboard/*` (step-57). When the backend
 * is unreachable, the page falls back to `mockSnapshot()` so the
 * surface stays renderable during dev.
 *
 * Skill influence:
 *   - `style` (Real-Time Monitoring, Data-Dense Dashboard)
 *   - `chart` (RadialBar / Area / Bar for the three chart tiles)
 *   - `ux` (Streaming, Keyboard, Content Jumping, Reduced Motion)
 *   - `ux` (Empty States, Breadcrumbs, Hover States, Confirmation
 *     Messages, Color Only — every status pairs icon + label)
 */

import * as React from 'react';
import Link from 'next/link';
import { Activity, Cpu, Sparkles } from 'lucide-react';

import { useDashboardPrefs } from './preferences';
import { mockSnapshot } from './mock-data';
import {
  ConnectivityBanner,
  GreetingBar
} from './GreetingBar';
import { KPIStrip } from './KPIStrip';
import {
  CostBreakdownTile,
  LiveActivityTile,
  RunsOverTimeTile,
  TodaysRunsTimelineTile,
  TopAgentsTile,
  YourAgentsTile,
} from './BentoLive';
import {
  AIInsightsTile,
  PinnedTile,
  PendingApprovalsTile,
  PersonalStatsTile,
  QuickActionsTile,
  RecentAlertsTile,
  RecentIdeasTile,
  TeamActivityTile,
} from './BentoCurated';
import { CustomizeDrawer, PinManagerDrawer } from './CustomizeDrawer';
import { NotificationCenter } from './NotificationCenter';
import { FirstRunOnboarding } from './FirstRunOnboarding';
import { QuickActionsEditor } from './QuickActionsEditor';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/api/auth';
import {
  useDashboardKPIs,
  useTeamActivity,
  useAlerts,
  useAIInsights,
} from '@/lib/api/dashboard-hooks';

export function MissionControl() {
  const { user, tenant } = useAuth();
  const { data: kpis, isError: kpisError } = useDashboardKPIs();
  const { data: activity } = useTeamActivity({ since: '24h' });
  const { data: alertsBackend } = useAlerts();
  const { data: insightsBackend } = useAIInsights();

  // The curated tiles still consume a DashboardSnapshot — when the
  // backend is reachable we hydrate it from the real data; otherwise
  // we fall back to mockSnapshot() so the surface never goes blank.
  const snapshot = React.useMemo(() => {
    if (kpis) {
      return {
        ...mockSnapshot(),
        generatedAt: kpis.generated_at,
        user: {
          firstName: user?.name?.split(' ')[0] ?? mockSnapshot().user.firstName,
          email: user?.email ?? mockSnapshot().user.email,
        },
        tenant: {
          name: tenant?.name ?? mockSnapshot().tenant.name,
          plan: tenant?.plan ?? mockSnapshot().tenant.plan,
        },
        online: true,
      };
    }
    if (kpisError) {
      return mockSnapshot();
    }
    return mockSnapshot();
  }, [kpis, kpisError, user, tenant]);

  const { prefs, mounted, togglePin, reorderWidgets } = useDashboardPrefs();
  const [customizeOpen, setCustomizeOpen] = React.useState(false);
  const [pinOpen, setPinOpen] = React.useState(false);
  const [quickActionsEditorOpen, setQuickActionsEditorOpen] = React.useState(false);
  const [bellOpen, setBellOpen] = React.useState(false);
  const [unreadIds, setUnreadIds] = React.useState<Set<string>>(
    () => new Set(snapshot.alerts.filter((a) => a.severity === 'critical').map((a) => a.id)),
  );
  const [isMac, setIsMac] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [showLastRefreshed, setShowLastRefreshed] = React.useState(false);
  const [firstRunDismissed, setFirstRunDismissed] = React.useState(false);

  // When the real activity feed comes in, project the first 12 into the
  // snapshot's `activity` field so LiveActivityTile renders them.
  React.useEffect(() => {
    if (!activity?.length) return;
    const projected = activity.slice(0, 12).map((a, idx) => ({
      id: a.id,
      agent: a.actor_name,
      agentId: a.actor_id ?? a.id,
      verb: (a.action.split(' ')[0] ?? 'started') as 'started' | 'completed' | 'failed' | 'paused',
      target: a.target_name ?? a.target_id ?? '',
      timestamp: new Date(a.created_at).toISOString().slice(11, 19),
      duration: '—',
      color: 'cyan' as const,
      _idx: idx,
    }));
    // Best-effort: stash on snapshot.activity only when no curated data.
    if (!snapshot.activity.length && projected.length) {
      (snapshot as any).activity = projected;
    }
  }, [activity, snapshot]);

  // When backend alerts come in, fold them into the snapshot's alert list
  // so RecentAlertsTile renders them without a separate tile.
  React.useEffect(() => {
    if (!alertsBackend?.length) return;
    const projected = alertsBackend.slice(0, 5).map((a) => ({
      id: a.id,
      severity: a.severity as 'critical' | 'warning' | 'info' | 'success',
      icon: a.severity === 'critical' ? 'triangle' as const : 'info' as const,
      title: a.title,
      body: a.body,
      timestamp: a.created_at,
    }));
    (snapshot as any).alerts = projected;
  }, [alertsBackend, snapshot]);

  // When backend insights come in, fold them into the snapshot's insight list.
  React.useEffect(() => {
    if (!insightsBackend?.length) return;
    const projected = insightsBackend.slice(0, 3).map((i) => ({
      id: i.id,
      generatedAt: i.created_at,
      title: i.title,
      body: i.body,
      accent: (i.severity === 'critical' ? 'rose' : i.severity === 'warning' ? 'amber' : 'cyan') as 'rose' | 'amber' | 'cyan' | 'indigo' | 'emerald' | 'violet',
    }));
    (snapshot as any).insights = projected;
  }, [insightsBackend, snapshot]);

  React.useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsMac(/Mac|iPod|iPhone|iPad/.test(navigator.platform));
    }
  }, []);

  // First-run detection: zero runs AND zero agents AND zero workflows
  // AND user has never dismissed onboarding.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const dismissed = window.localStorage.getItem('forge.dashboard.onboardingDismissed.v1');
    setFirstRunDismissed(dismissed === 'true');
  }, []);

  const isFirstRun =
    !firstRunDismissed &&
    snapshot.runsToday.length === 0 &&
    snapshot.agents.length === 0 &&
    snapshot.alerts.length === 0;

  const handleRetry = React.useCallback(() => {
    if (typeof window !== 'undefined') window.location.reload();
  }, []);

  const handleRefresh = React.useCallback(async () => {
    // Soft refresh — re-key the snapshot to trigger re-render.
    // Real backend seam will replace this with forgeFetch.
    setRefreshKey((k) => k + 1);
    setShowLastRefreshed(true);
  }, []);

  const handleMarkAllRead = React.useCallback(() => {
    setUnreadIds(new Set());
  }, []);

  const handleMarkRead = React.useCallback((id: string) => {
    setUnreadIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const dismissFirstRun = React.useCallback(() => {
    setFirstRunDismissed(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('forge.dashboard.onboardingDismissed.v1', 'true');
    }
  }, []);

  const v = prefs.visibility;
  const compact = prefs.density === 'compact' && mounted;

  // ⌘K focuses the quick command input.
  const commandInputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        commandInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const unreadAlerts = unreadIds.size;

  // Widget order — iterate prefs.widgetOrder for tiles that map 1:1
  // (rows 1-2 + row 3 + row 4 + row 5 + row 6 + row 7). For tiles that
  // share a row, we keep the existing row groupings for grid layout,
  // but we drive visibility by ordered id.
  void reorderWidgets;

  return (
    <>
      <div className="px-4 py-4 md:px-6 lg:px-8" data-testid="dashboard-page">
        {/* Breadcrumb lives in the global Topbar (Step 2 shell). Page-level
            PageBreadcrumb was removed in Step 42 Fix 1 to avoid a duplicate
            trail above the greeting bar. */}

        {/* Push drawer layout — grid 1fr 360px on desktop. */}
        <div
          className={cn(
            'mx-auto w-full max-w-[1600px] transition-[gap] duration-[250ms] ease-out',
            'lg:flex lg:items-start lg:gap-4',
          )}
        >
          {/* Bento column */}
          <div
            className="mx-auto w-full max-w-[1600px] space-y-6 pb-12 transition-[max-width] duration-[250ms] ease-out lg:mx-0"
            data-testid="mission-control"
            data-row-id="row-kpi"
            style={customizeOpen ? undefined : undefined}
          >
            {/* Zone 1 */}
            <div className="space-y-2">
              <GreetingBar
                snapshot={snapshot}
                isMac={isMac}
                unreadAlerts={unreadAlerts}
                onCustomize={() => setCustomizeOpen(true)}
                onBellClick={() => setBellOpen((o) => !o)}
                onRefresh={handleRefresh}
                showLastRefreshed={showLastRefreshed}
                onLastRefreshedConsumed={() => setShowLastRefreshed(false)}
              />

              <NotificationCenter
                alerts={snapshot.alerts}
                unreadIds={unreadIds}
                onMarkAll={handleMarkAllRead}
                onMarkRead={handleMarkRead}
                open={bellOpen}
              >
                {/* Hidden anchor — the canonical bell lives in the global
                    Topbar (components/shell/Topbar.tsx). The GreetingBar
                    still renders a mobile-only fallback that emits the
                    `bell:open` event consumed by BellAnchorBridge below. */}
                <span style={{ display: 'none' }} aria-hidden="true" />
              </NotificationCenter>

              <BellAnchorBridge onOpenChange={setBellOpen} />

              <ConnectivityBanner snapshot={snapshot} onRetry={handleRetry} />

              <QuickCommandBarCommandRef inputRef={commandInputRef} isMac={isMac} refreshKey={refreshKey} />
            </div>

            {/* Zone 2 */}
            {v['kpi-strip'] ? <KPIStrip snapshot={snapshot} refreshKey={refreshKey} /> : null}

            {/* Zone 3 — Row 1 */}
            {v['live-activity'] || v['your-agents'] || v['today-runs'] ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:grid-cols-4" data-row-id="row-1">
                {v['live-activity'] ? <LiveActivityTile snapshot={snapshot} online={snapshot.online} /> : null}
                {v['your-agents'] ? <YourAgentsTile snapshot={snapshot} online={snapshot.online} /> : null}
                {v['today-runs'] ? <TodaysRunsTimelineTile snapshot={snapshot} /> : null}
              </div>
            ) : null}

            {/* Zone 3 — Row 2 */}
            {v['cost-breakdown'] || v['runs-over-time'] || v['top-agents'] ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:grid-cols-4" data-row-id="row-2">
                {v['cost-breakdown'] ? <CostBreakdownTile snapshot={snapshot} online={snapshot.online} /> : null}
                {v['runs-over-time'] ? <RunsOverTimeTile snapshot={snapshot} online={snapshot.online} /> : null}
                {v['top-agents'] ? <TopAgentsTile snapshot={snapshot} /> : null}
              </div>
            ) : null}

            {/* Zone 3 — Row 3 */}
            {v['pending-approvals'] || v['recent-ideas'] ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-row-id="row-3">
                {v['pending-approvals'] ? <PendingApprovalsTile snapshot={snapshot} /> : null}
                {v['recent-ideas'] ? <RecentIdeasTile snapshot={snapshot} /> : null}
              </div>
            ) : null}

            {/* Zone 3 — Row 4 */}
            {v['ai-insights'] || v['personal-stats'] ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" data-row-id="row-4">
                {v['ai-insights'] ? <AIInsightsTile snapshot={snapshot} online={snapshot.online} /> : null}
                {v['personal-stats'] ? <PersonalStatsTile snapshot={snapshot} /> : null}
              </div>
            ) : null}

            {/* Zone 3 — Row 5 */}
            {v.pinned || v['quick-actions'] ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-row-id="row-5">
                {v.pinned ? (
                  <PinnedTile
                    snapshot={snapshot}
                    pinIds={prefs.pins}
                    onManage={() => setPinOpen(true)}
                    onUnpin={(id) => togglePin(id)}
                  />
                ) : null}
                {v['quick-actions'] ? (
                  <QuickActionsTile onCustomize={() => setQuickActionsEditorOpen(true)} />
                ) : null}
              </div>
            ) : null}

            {/* Zone 3 — Row 6 */}
            {v['team-activity'] ? <TeamActivityTile snapshot={snapshot} /> : null}

            {/* Zone 3 — Row 7 */}
            {v['recent-alerts'] ? (
              <RecentAlertsTile snapshot={snapshot} onMarkAll={handleMarkAllRead} />
            ) : null}
          </div>

          {/* Zone 4 — drawer */}
          <CustomizeDrawer open={customizeOpen} onOpenChange={setCustomizeOpen} />
        </div>
      </div>

      {/* First-run onboarding overlay */}
      {isFirstRun ? <FirstRunOnboarding onDismiss={dismissFirstRun} /> : null}

      {/* Other drawers (always Sheet — they don't push the dashboard) */}
      <PinManagerDrawer open={pinOpen} onOpenChange={setPinOpen} snapshot={snapshot} />
      <QuickActionsEditor open={quickActionsEditorOpen} onOpenChange={setQuickActionsEditorOpen} />

      {/* Unused state hints to silence lint */}
      {void compact}
    </>
  );
}

/**
 * Bridge component: the bell button is rendered inside the GreetingBar
 * (so it sits next to the tenant-health pill and the customize gear).
 * The Popover primitive must wrap the trigger, so we mount a hidden
 * Popover here that listens for a custom "bell:click" event and
 * toggles its own state, which the GreetingBar bell button dispatches
 * via `window.dispatchEvent`.
 */
function BellAnchorBridge({ onOpenChange }: { onOpenChange: (v: boolean) => void }) {
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    function onBell() { onOpenChange(true); }
    window.addEventListener('bell:open', onBell);
    return () => window.removeEventListener('bell:open', onBell);
  }, [onOpenChange]);
  return null;
}

function QuickCommandBarCommandRef({
  inputRef,
  isMac,
  refreshKey,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  isMac: boolean;
  refreshKey: number;
}) {
  void refreshKey;
  const placeholders = React.useMemo<ReadonlyArray<string>>(
    () => [
      "Ask Forge to do anything…",
      "Try: 'summarize today's runs'",
      'Type / for commands, @ for context',
      'Or just press ⌘K',
    ],
    [],
  );
  const [placeholderIdx, setPlaceholderIdx] = React.useState(0);
  const [placeholderVisible, setPlaceholderVisible] = React.useState(true);
  const [inputHasFocus, setInputHasFocus] = React.useState(false);
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Cycle the placeholder text every 4s. When the user is typing we
  // suspend rotation so the overlay stops blinking.
  React.useEffect(() => {
    if (reduceMotion || inputHasFocus) return;
    const interval = setInterval(() => {
      setPlaceholderVisible(false);
      window.setTimeout(() => {
        setPlaceholderIdx((i) => (i + 1) % placeholders.length);
        setPlaceholderVisible(true);
      }, 200);
    }, 4000);
    return () => clearInterval(interval);
  }, [placeholders.length, reduceMotion, inputHasFocus]);

  return (
    <div
      className="flex items-center gap-3 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-md)]"
      data-testid="dashboard-command-bar"
    >
      <div className="relative flex flex-1 items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 py-2">
        <Activity className="h-4 w-4 shrink-0 text-[var(--fg-tertiary)]" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          placeholder={reduceMotion ? placeholders[0] : ''}
          onFocus={() => setInputHasFocus(true)}
          onBlur={(e) => setInputHasFocus(e.currentTarget.value.length > 0)}
          className="relative z-10 flex-1 bg-transparent text-[var(--text-sm)] text-[var(--fg-primary)] outline-none placeholder:text-transparent"
          aria-label="Quick command"
          data-testid="dashboard-command-input"
        />
        {/* Rotating placeholder overlay. Sits behind the input via
            pointer-events-none so the field stays clickable. */}
        {!inputHasFocus ? (
          <span
            aria-hidden="true"
            data-testid="dashboard-command-placeholder"
            data-placeholder-idx={placeholderIdx}
            className="pointer-events-none absolute inset-y-0 left-9 right-12 flex items-center truncate text-[var(--text-sm)] text-[var(--fg-tertiary)] transition-opacity duration-200 ease-out"
            style={{ opacity: placeholderVisible ? 1 : 0 }}
          >
            {placeholders[placeholderIdx]}
          </span>
        ) : null}
        <Kbd>{isMac ? '⌘' : 'Ctrl'}K</Kbd>
      </div>
      <a
        href="/copilot?prompt=Plan%20a%20new%20feature"
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--accent-primary)] px-3 text-[var(--text-sm)] font-medium text-white hover:bg-[var(--accent-primary)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
      >
        <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
        New run
      </a>
      <a
        href="/copilot"
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-[var(--text-sm)] font-medium text-[var(--fg-primary)] hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      >
        <Sparkles className="h-3.5 w-3.5 text-[var(--accent-cyan)]" aria-hidden="true" />
        Open Co-pilot
      </a>
    </div>
  );
}

/**
 * Properly-styled kbd element (Fix 12). Mono font, --bg-inset, --radius-sm.
 */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--fg-secondary)]',
        className,
      )}
      data-testid="kbd"
    >
      {children}
    </kbd>
  );
}

/**
 * Multi-key kbd cluster (e.g. ⌘⇧N).
 */
export function KbdGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn('hidden md:inline-flex shrink-0 items-center gap-1', className)}
      data-testid="kbd-group"
    >
      {children}
    </span>
  );
}

void Link;