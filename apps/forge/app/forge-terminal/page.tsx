'use client';

/**
 * Terminal page — Step 36: canvas-first layout.
 *
 * Layout (after Step 36):
 *
 *   ┌────────────────────── Hero band (compact, optional) ──────────────────────┐
 *   │ Sidecar banner (when disconnected)                                       │
 *   │                                                                           │
 *   │ ┌─ LeftRail ─┬─ TerminalPanel (hero) ─────────────┬─ AuditRail ─┐        │
 *   │ │  56/320 px │  SessionTabs                         │  56/360 px  │        │
 *   │ │            │  Toolbar                             │             │        │
 *   │ │            │  Pane canvas                         │             │        │
 *   │ │            │  StatusBar                           │             │        │
 *   │ └────────────┴──────────────────────────────────────┴─────────────┘        │
 *   └───────────────────────────────────────────────────────────────────────────┘
 *
 * On <1024px viewports the rails become drawers (hidden) and the page
 * falls back to a stacked layout. The hero remains so users on narrow
 * screens can still see the workspace/agent pickers.
 *
 * State architecture:
 *   - `useSidecarProbe()` — single source of truth for sidecar
 *     reachability. Drives the banner and status bar.
 *   - `useTerminalStore()` — sessions, layout, audit log (Zustand).
 *   - `useTerminalUiStore()` — rail state, focus mode, help overlay
 *     (persisted to localStorage).
 *
 * Skill influence:
 *   - ux-guideline (loading indicators) — every state has a visible
 *     affordance; auto-retry with exponential backoff never leaves the
 *     user guessing.
 *   - ux-guideline (submit feedback) — new sessions animate in,
 *     audit-row clicks activate and highlight, search results filter.
 *   - prefers-reduced-motion — global rule zeros slide-in / pulse
 *     animations; the page does not introduce additional motion.
 */

import * as React from 'react';
import dynamic from 'next/dynamic';
import { Plus, TerminalSquare } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { TerminalHero } from '@/components/forge-terminal/TerminalHero';
import { SidecarBanner } from '@/components/forge-terminal/SidecarBanner';
import { LeftRail } from '@/components/forge-terminal/LeftRail';
import { AuditRail } from '@/components/forge-terminal/AuditRail';
import { useSidecarProbe, type SidecarState } from '@/hooks/use-sidecar-probe';
import { useTerminalStore } from '@/lib/store';
import { FORGE_TERMINAL_WS_URL } from '@/lib/forge-api';
import type { TerminalConnectionState } from '@/hooks/use-terminal';

const TerminalPanel = dynamic(
  () =>
    import('@/components/forge-terminal/TerminalPanel').then(
      (m) => m.TerminalPanel,
    ),
  { ssr: false },
);

function toConnectionState(s: SidecarState): TerminalConnectionState {
  if (s === 'connecting') return 'connecting';
  if (s === 'connected') return 'connected';
  if (s === 'failed') return 'failed';
  return 'reconnecting';
}

export default function ForgeTerminalPage() {
  const sessionsCount = useTerminalStore((s) => s.sessions.length);
  const createSession = useTerminalStore((s) => s.createSession);
  const [bannerHidden, setBannerHidden] = React.useState(false);
  const [heroHidden, setHeroHidden] = React.useState(false);

  const probe = useSidecarProbe({
    endpoint: FORGE_TERMINAL_WS_URL,
    maxAttemptsBeforeFail: 5,
  });
  const connectionState = toConnectionState(probe.state);

  // Auto-create a starter session so the layout renders something useful.
  React.useEffect(() => {
    if (sessionsCount === 0) {
      createSession({ title: 'Session 1', color: 'indigo' });
    }
  }, [sessionsCount, createSession]);

  const onAuditCommand = React.useCallback(
    (entry: { sessionId: string; command: string }) => {
      window.dispatchEvent(new CustomEvent('forge:terminal:goto', { detail: entry }));
    },
    [],
  );

  return (
    <AdminShell>
      <div className="mx-auto flex h-[calc(100vh-6rem)] max-w-[1800px] flex-col gap-3">
        {heroHidden ? null : (
          <TerminalHero
            connectionState={connectionState}
            latencyMs={probe.latencyMs}
            endpoint={FORGE_TERMINAL_WS_URL}
            onNewSession={() => {
              window.dispatchEvent(new CustomEvent('forge:terminal:open-new'));
            }}
            onHide={() => setHeroHidden(true)}
          />
        )}

        {heroHidden ? (
          <div className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5">
            <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-tertiary)]">
              <TerminalSquare className="h-3 w-3 text-[var(--accent-primary)]" aria-hidden="true" />
              Forge Terminal Center
            </span>
            <button
              type="button"
              onClick={() => setHeroHidden(false)}
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
              data-testid="hero-restore"
            >
              <Plus className="mr-1 inline h-3 w-3" aria-hidden="true" />
              Show hero
            </button>
          </div>
        ) : null}

        <SidecarBanner
          state={probe.state}
          latencyMs={probe.latencyMs}
          endpoint={FORGE_TERMINAL_WS_URL}
          attempts={probe.attempts}
          onRetry={probe.retry}
          onViewLogs={probe.viewLogs}
          hidden={bannerHidden}
          onHide={() => setBannerHidden(true)}
        />

        {/* MAIN CANVAS — three-column on lg+, stacked on smaller screens. */}
        <div
          className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto]"
          data-testid="terminal-main-grid"
        >
          <LeftRail
            onNewSession={() => {
              window.dispatchEvent(new CustomEvent('forge:terminal:open-new'));
            }}
          />

          <div className="min-h-0">
            <TerminalPanel
              connectionState={connectionState}
              latencyMs={probe.latencyMs}
              endpoint={FORGE_TERMINAL_WS_URL}
            />
          </div>

          <AuditRail onCommandClick={onAuditCommand} endpoint={FORGE_TERMINAL_WS_URL} />
        </div>
      </div>
    </AdminShell>
  );
}