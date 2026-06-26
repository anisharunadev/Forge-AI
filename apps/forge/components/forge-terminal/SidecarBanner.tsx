'use client';

/**
 * Terminal — Sidecar warning banner.
 *
 * Shown when the PTY sidecar WebSocket is unreachable. Communicates:
 *   1. Why the terminal renders but cannot execute commands.
 *   2. How to start the sidecar (`pnpm dev:terminal` or `pnpm dev:stack`).
 *   3. Auto-retry with exponential backoff (1 → 2 → 4 → 8 → 16, capped at 30s).
 *
 * Skill influence:
 *   - ux-guideline (feedback / loading) — visible state, retry counter, copyable fix.
 *   - ux-guideline (status indicator) — the dot + countdown never leaves the user
 *     guessing whether the page is alive.
 *   - prefers-reduced-motion — slide-up exit uses the global `fade-slide-up` keyframe
 *     which is already short-circuited by the global reduced-motion rule.
 */

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  RefreshCw,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SidecarBannerProps {
  /** Sidecar connection state from `useSidecarProbe`. */
  state: 'connecting' | 'connected' | 'disconnected' | 'failed';
  /** Latency to the sidecar in ms — surfaced in the Connected badge. */
  latencyMs?: number;
  /** Sidecar endpoint to surface when connected. */
  endpoint?: string;
  /** Number of consecutive failed attempts. */
  attempts: number;
  /** Manually trigger a reconnect attempt (resets the counter). */
  onRetry: () => void;
  /** Open the sidecar log stream in a new tab. */
  onViewLogs: () => void;
  /** Whether the banner has been hidden by the user. */
  hidden: boolean;
  onHide: () => void;
}

const COMMANDS: ReadonlyArray<{ label: string; cmd: string }> = [
  { label: 'Sidecar only', cmd: 'pnpm dev:terminal' },
  { label: 'Full stack', cmd: 'pnpm dev:stack' },
];

// Exponential backoff schedule: 1s, 2s, 4s, 8s, 16s, then cap at 30s.
function backoffSeconds(attempt: number): number {
  const base = Math.min(2 ** Math.max(attempt - 1, 0), 30);
  return Math.min(base, 30);
}

export function SidecarBanner({
  state,
  latencyMs,
  endpoint = 'ws://localhost:4001',
  attempts,
  onRetry,
  onViewLogs,
  hidden,
  onHide,
}: SidecarBannerProps) {
  const [localAttempt, setLocalAttempt] = React.useState(1);
  const [retryIn, setRetryIn] = React.useState(() => backoffSeconds(1));
  const [copied, setCopied] = React.useState<string | null>(null);

  const connected = state === 'connected';
  const failed = state === 'failed';

  // Reset attempt counter when the sidecar comes back.
  React.useEffect(() => {
    if (connected) setLocalAttempt(1);
  }, [connected]);

  // Countdown + auto-retry while disconnected (but NOT failed) and not hidden.
  React.useEffect(() => {
    if (connected || failed || hidden) return;
    setRetryIn(backoffSeconds(localAttempt));
    if (retryIn <= 0) {
      onRetry();
      setLocalAttempt((n) => n + 1);
      return;
    }
    const id = window.setTimeout(() => setRetryIn((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryIn, connected, failed, hidden, localAttempt]);

  const copy = React.useCallback((cmd: string) => {
    void navigator.clipboard.writeText(cmd).then(() => {
      setCopied(cmd);
      window.setTimeout(() => setCopied(null), 1500);
    });
  }, []);

  const visible = !connected && !hidden;

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="banner"
          data-testid="terminal-sidecar-banner"
          data-state={failed ? 'failed' : 'reconnecting'}
          role="alert"
          aria-live="polite"
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            'overflow-hidden rounded-[var(--radius-lg)]',
            failed
              ? 'border border-[rgba(244,63,94,0.35)] bg-[rgba(244,63,94,0.08)]'
              : 'border border-[rgba(245,158,11,0.30)] bg-[rgba(245,158,11,0.08)]',
          )}
          style={{ padding: 16 }}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0',
                failed ? 'text-[var(--accent-rose)]' : 'text-[var(--accent-amber)]',
              )}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--fg-primary)]">
                {failed ? 'Connection failed' : 'Terminal sidecar not running'}
              </p>
              <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">
                The xterm.js pane can render but cannot execute commands until the
                local PTY sidecar is started on <code className="font-mono">{endpoint}</code>.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {COMMANDS.map((c) => (
                  <button
                    key={c.cmd}
                    type="button"
                    onClick={() => copy(c.cmd)}
                    className={cn(
                      'group inline-flex items-center gap-1.5 rounded-md px-2.5 py-1',
                      'border',
                      failed
                        ? 'border-[rgba(244,63,94,0.30)] bg-[rgba(244,63,94,0.10)] hover:bg-[rgba(244,63,94,0.18)]'
                        : 'border-[rgba(245,158,11,0.30)] bg-[rgba(245,158,11,0.10)] hover:bg-[rgba(245,158,11,0.18)]',
                      'text-xs font-mono text-[var(--fg-primary)] btn-press',
                    )}
                    aria-label={`Copy ${c.label} command`}
                    data-testid={`terminal-copy-${c.cmd}`}
                  >
                    <span>{c.cmd}</span>
                    {copied === c.cmd ? (
                      <CheckCircle2 className="h-3 w-3 text-[var(--accent-emerald)]" />
                    ) : (
                      <Copy className="h-3 w-3 opacity-60 group-hover:opacity-100" />
                    )}
                  </button>
                ))}
              </div>

              {failed ? (
                <p
                  className="mt-2 text-xs text-[var(--accent-rose)]"
                  data-testid="terminal-failed-note"
                >
                  Gave up after{' '}
                  <span className="font-mono">{attempts || 5}</span> attempts.
                  Start the sidecar above, then click <span className="font-mono">Try again</span>.
                </p>
              ) : (
                <p className="mt-2 text-xs text-[var(--fg-tertiary)]">
                  Auto-retrying{' '}
                  <span className="font-mono text-[var(--accent-amber)]">
                    Attempt {localAttempt}/5
                  </span>{' '}
                  · next retry in{' '}
                  <span className="font-mono">{retryIn}s</span>
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onRetry();
                  setLocalAttempt(1);
                }}
                className={cn(
                  'h-7 px-2 text-xs',
                  failed
                    ? 'bg-[var(--accent-rose)] text-white hover:opacity-90'
                    : 'text-[var(--accent-amber)] hover:bg-[rgba(245,158,11,0.12)]',
                )}
                data-testid="terminal-retry"
              >
                <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
                Try again
              </Button>
              <button
                type="button"
                onClick={onViewLogs}
                className="rounded-md px-2 py-1 text-xs text-[var(--fg-tertiary)] underline-offset-2 hover:text-[var(--fg-primary)] hover:underline"
                data-testid="terminal-view-logs"
              >
                View logs
              </button>
              <Button
                size="icon"
                variant="ghost"
                onClick={onHide}
                aria-label="Hide banner"
                className="h-7 w-7 text-[var(--fg-tertiary)]"
                data-testid="terminal-banner-hide"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * Compact "Connected" pill — shown in place of the banner once the
 * sidecar comes online. Keeps the connection signal visible without
 * the noisy warning chrome.
 */
export function ConnectedBadge({
  connected,
  latencyMs,
  endpoint = 'ws://localhost:4001',
}: {
  connected: boolean;
  latencyMs?: number;
  endpoint?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="terminal-connected-badge"
      className={cn(
        'inline-flex items-center gap-2 rounded-[var(--radius-md)] border px-3 py-1.5',
        connected
          ? 'border-[rgba(16,185,129,0.30)] bg-[rgba(16,185,129,0.08)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-inset)]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-2 w-2 rounded-full',
          connected
            ? 'bg-[var(--accent-emerald)] shadow-[0_0_0_3px_rgba(16,185,129,0.18)]'
            : 'bg-[var(--fg-muted)]',
        )}
      />
      <span className="text-xs font-medium text-[var(--fg-primary)]">
        {connected ? 'Connected' : 'Disconnected'}
      </span>
      {connected ? (
        <>
          <span className="text-xs text-[var(--fg-tertiary)]">·</span>
          <span className="font-mono text-xs text-[var(--fg-secondary)]">
            {endpoint}
          </span>
          {typeof latencyMs === 'number' ? (
            <>
              <span className="text-xs text-[var(--fg-tertiary)]">·</span>
              <span className="font-mono text-xs text-[var(--fg-tertiary)]">
                {latencyMs}ms
              </span>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
