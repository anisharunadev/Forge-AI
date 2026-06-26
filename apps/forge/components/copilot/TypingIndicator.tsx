'use client';

/**
 * Step 24 — Typing indicator + loading state.
 *
 * Shown BELOW the user's message while we wait for the first token
 * of the assistant's response. Three cyan dots that pulse in
 * sequence, with a small "Forge Co-pilot is thinking..." label.
 *
 * The component also exposes an inline retry affordance for the
 * network-error case (rose border + "Couldn't reach the AI service.
 * Retry?") and a timeout warning (>10s without a response) with a
 * cancel button.
 *
 * Skill influence (ui-ux-pro-max):
 *   - "Streaming" UX — never block on a full-screen spinner. The
 *     dots appear inline and don't shift the layout.
 *   - "Show helpful message and action" — error and timeout both
 *     have a clear verb the user can take.
 */

import * as React from 'react';
import { AlertTriangle, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';

import { cn } from '@/lib/utils';

export type TypingState = 'thinking' | 'timeout' | 'error';

export interface TypingIndicatorProps {
  state: TypingState;
  /** Optional retry handler — fires when the user clicks Retry. */
  onRetry?: () => void;
  /** Optional cancel handler — fires when the user clicks Cancel. */
  onCancel?: () => void;
  className?: string;
}

const TIMEOUT_AFTER_MS = 10_000;

export function TypingIndicator({
  state,
  onRetry,
  onCancel,
  className,
}: TypingIndicatorProps) {
  // Local state — track whether the 10s timeout has elapsed so we
  // can swap from "thinking" → "timeout". We only count when state
  // is "thinking"; for "error" we render the error variant
  // immediately.
  const [elapsed, setElapsed] = React.useState(false);

  React.useEffect(() => {
    if (state !== 'thinking') {
      setElapsed(false);
      return;
    }
    const t = window.setTimeout(() => setElapsed(true), TIMEOUT_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [state]);

  // ── error variant ─────────────────────────────────────────────
  if (state === 'error') {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={cn(
          'mx-auto flex w-full max-w-[90%] items-start gap-2 rounded-[var(--radius-md)] border border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10 px-3 py-2 text-[var(--text-xs)] text-[var(--accent-rose)]',
          className,
        )}
        data-testid="copilot-typing-indicator"
        data-state="error"
      >
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1">
          Couldn't reach the AI service.{' '}
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="font-medium underline underline-offset-2 hover:text-[var(--accent-rose)]/80"
              data-testid="copilot-typing-retry"
            >
              Retry?
            </button>
          ) : null}
        </span>
      </div>
    );
  }

  // ── timeout variant ───────────────────────────────────────────
  if (state === 'timeout' || (state === 'thinking' && elapsed)) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'mx-auto flex w-full max-w-[90%] items-start gap-2 rounded-[var(--radius-md)] border border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 px-3 py-2 text-[var(--text-xs)] text-[var(--accent-amber)]',
          className,
        )}
        data-testid="copilot-typing-indicator"
        data-state="timeout"
      >
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1">This is taking longer than usual.</span>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1 text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
            aria-label="Cancel request"
            data-testid="copilot-typing-cancel"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            Cancel
          </button>
        ) : null}
      </div>
    );
  }

  // ── thinking variant (default) ─────────────────────────────────
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Forge Co-pilot is thinking"
      className={cn(
        'mx-auto flex w-full max-w-[90%] flex-col gap-2 text-[var(--text-xs)] text-[var(--fg-tertiary)]',
        className,
      )}
      data-testid="copilot-typing-indicator"
      data-state="thinking"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--accent-cyan)]"
        >
          <Sparkles className="h-3 w-3" strokeWidth={1.8} />
        </span>
        <span>Forge Co-pilot is thinking…</span>
      </div>
      <div
        aria-hidden="true"
        className="ml-7 flex items-center gap-1"
      >
        <span
          className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)]"
          style={{ animation: 'copilot-thinking-dot 1.4s ease-in-out infinite' }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)]"
          style={{ animation: 'copilot-thinking-dot 1.4s ease-in-out 0.2s infinite' }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)]"
          style={{ animation: 'copilot-thinking-dot 1.4s ease-in-out 0.4s infinite' }}
        />
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="ml-3 flex items-center gap-1 text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
            aria-label="Cancel request"
          >
            <Loader2 className="h-3 w-3" aria-hidden="true" />
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Re-export for backwards compat.
export { RefreshCw };
