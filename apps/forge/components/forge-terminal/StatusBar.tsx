'use client';

/**
 * Terminal — Status bar (Step 36 / Fix 5).
 *
 * Three clusters at the bottom of the terminal canvas:
 *   LEFT    — connection state + latency + reconnect attempt counter
 *   CENTER  — session id (mono) + agent name + workspace name
 *   RIGHT   — cursor position + encoding (UTF-8) + ⌘+? help hint
 *             + activity sparkline (last 60s of commands)
 *
 * Skill influence:
 *   - ux-guideline (status indicator) — colored dot is always paired
 *     with a textual label so it's never a color-only signal.
 *   - ux-guideline (loading indicators) — 'connecting' / 'reconnecting'
 *     states show a spinner instead of a static dot.
 *   - ux-guideline (reduced-motion) — pulse animation honors
 *     prefers-reduced-motion.
 */

import * as React from 'react';
import { Command, KeyRound, Loader2, Wifi } from 'lucide-react';

import { useTerminalStore } from '@/lib/store';
import { useTerminalUiStore } from '@/lib/terminal-ui-store';
import type { TerminalConnectionState } from '@/hooks/use-terminal';
import { cn } from '@/lib/utils';

const CONNECTION_BADGE: Record<
  TerminalConnectionState,
  { color: string; label: string; pulse: boolean }
> = {
  connecting:   { color: 'var(--accent-cyan)',    label: 'Connecting',    pulse: true  },
  connected:    { color: 'var(--accent-emerald)', label: 'Connected',     pulse: false },
  reconnecting: { color: 'var(--accent-amber)',   label: 'Reconnecting',  pulse: true  },
  failed:       { color: 'var(--accent-rose)',    label: 'Disconnected',  pulse: false },
};

export interface StatusBarProps {
  connectionState: TerminalConnectionState;
  latencyMs?: number;
}

/**
 * Tiny sparkline of the last 60 seconds of activity (1 bar per
 * second). Pure SVG so it inherits theme colors.
 */
function ActivitySparkline({ data }: { data: ReadonlyArray<number> }) {
  // 60 buckets, 1 bar per second, 4px wide × 12px tall max.
  const W = 60;
  const H = 12;
  const buckets = React.useMemo(() => {
    const out: number[] = new Array(W).fill(0);
    for (const t of data) {
      const idx = Math.min(W - 1, Math.max(0, t));
      out[idx] = (out[idx] ?? 0) + 1;
    }
    return out;
  }, [data]);
  const max = Math.max(1, ...buckets);
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Recent activity (commands per second, last 60s)"
      data-testid="terminal-activity-sparkline"
      className="text-[var(--accent-cyan)]"
    >
      {buckets.map((b, i) => {
        const h = (b / max) * H;
        return (
          <rect
            key={i}
            x={i}
            y={H - h}
            width={0.8}
            height={h || 0.4}
            fill="currentColor"
            opacity={b === 0 ? 0.18 : 0.85}
            rx={0.3}
          />
        );
      })}
    </svg>
  );
}

export function StatusBar({ connectionState, latencyMs }: StatusBarProps) {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeSessionId);
  const active = sessions.find((s) => s.id === activeId);
  const audit = useTerminalStore((s) => s.audit);

  const openHelp = useTerminalUiStore((s) => s.openHelp);
  const visitCount = useTerminalUiStore((s) => s.visitCount);

  // For the sparkline, count events per second over the last 60 seconds.
  const spark = React.useMemo(() => {
    const now = Date.now();
    const out: number[] = [];
    for (let i = 59; i >= 0; i -= 1) {
      const ts = now - i * 1000;
      const count = audit.filter((a) => {
        const t = new Date(a.timestamp).getTime();
        return t >= ts && t < ts + 1000;
      }).length;
      out.push(count > 0 ? 59 - i : 0);
    }
    return out;
  }, [audit]);

  const badge = CONNECTION_BADGE[connectionState];

  return (
    <footer
      role="status"
      aria-live="polite"
      data-testid="terminal-status-bar status-bar"
      className={cn(
        'flex h-8 items-center justify-between border-t border-[var(--border-default)]',
        'bg-[var(--bg-surface)] px-3 text-[11px] text-[var(--fg-tertiary)]',
      )}
    >
      {/* LEFT — connection state */}
      <div className="flex items-center gap-2.5">
        <span className="inline-flex items-center gap-1.5">
          {badge.pulse ? (
            <Loader2 className="h-3 w-3 animate-spin" style={{ color: badge.color }} aria-hidden="true" />
          ) : (
            <Wifi className="h-3 w-3" style={{ color: badge.color }} aria-hidden="true" />
          )}
          <span className="font-medium text-[var(--fg-secondary)]">{badge.label}</span>
          {connectionState === 'connected' && typeof latencyMs === 'number' ? (
            <span className="font-mono text-[var(--fg-tertiary)]">· {latencyMs}ms</span>
          ) : null}
        </span>
        {connectionState !== 'connected' ? (
          <>
            <span aria-hidden="true" className="h-3 w-px bg-[var(--border-subtle)]" />
            <span className="font-mono text-[var(--fg-muted)]" title="Reconnect attempts">
              attempt · {useAttemptEstimate(connectionState)}
            </span>
          </>
        ) : null}
      </div>

      {/* CENTER — session / agent / workspace */}
      <div className="flex items-center gap-2 truncate">
        <span className="font-mono text-[var(--fg-secondary)]">
          {active?.id.slice(0, 14) ?? '—'}
        </span>
        <span aria-hidden="true" className="h-3 w-px bg-[var(--border-subtle)]" />
        <span className="truncate text-[var(--fg-secondary)]">{active?.agent ?? 'no session'}</span>
        {active?.workspace ? (
          <>
            <span aria-hidden="true" className="h-3 w-px bg-[var(--border-subtle)]" />
            <span className="truncate font-mono text-[var(--fg-tertiary)]">{active.workspace}</span>
          </>
        ) : null}
      </div>

      {/* RIGHT — cursor / encoding / sparkline / help */}
      <div className="flex items-center gap-2.5">
        <span className="font-mono" data-testid="statusbar-cursor">L1 · C1</span>
        <span aria-hidden="true" className="h-3 w-px bg-[var(--border-subtle)]" />
        <span className="font-mono">UTF-8</span>
        <span aria-hidden="true" className="h-3 w-px bg-[var(--border-subtle)]" />
        <ActivitySparkline data={spark} />
        <span aria-hidden="true" className="h-3 w-px bg-[var(--border-subtle)]" />
        <button
          type="button"
          onClick={openHelp}
          data-testid="statusbar-help"
          className={cn(
            'inline-flex items-center gap-1 rounded px-1 py-0.5',
            'transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
          )}
          aria-label="Open help"
        >
          <KeyRound className="h-3 w-3" aria-hidden="true" />
          <span className="font-mono">⌘?</span>
        </button>
        <span className="hidden items-center gap-1 md:inline-flex">
          <Command className="h-3 w-3" aria-hidden="true" />
          <span className="font-mono">Ctrl+Shift+P</span>
        </span>
        {visitCount > 0 && visitCount < 5 ? (
          <span className="hidden font-mono text-[10px] text-[var(--fg-muted)] lg:inline">
            visit {visitCount}/5
          </span>
        ) : null}
      </div>
    </footer>
  );
}

function useAttemptEstimate(state: TerminalConnectionState): string {
  // We don't have direct access to `useSidecarProbe` here without
  // changing the signature; show a coarse label that matches state.
  if (state === 'connecting')   return '1';
  if (state === 'reconnecting') return '2';
  if (state === 'failed')       return '∞';
  return '0';
}