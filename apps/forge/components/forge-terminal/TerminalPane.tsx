'use client';

/**
 * Terminal — Pane.
 *
 * Wraps `useTerminal` with the empty / loading / error states that
 * surface in front of the xterm canvas. The actual canvas lives in the
 * `useTerminal` hook; this component is only the chrome around it.
 *
 * Skill influence:
 *   - ux-guideline (loading indicators) — show spinner/skeleton for
 *     operations > 300ms; sessions in 'creating' state show an animated
 *     ASCII spinner + status text instead of an empty void.
 *   - ux-guideline (status indicator) — colored status dot paired with
 *     label text in every state.
 */

import * as React from 'react';
import { Loader2, Terminal as TerminalIcon, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTerminal } from '@/hooks/use-terminal';
import type { SessionStatus } from '@/lib/store';

export interface TerminalPaneProps {
  sessionId: string;
  agent: string;
  workspace: string;
  wsPath?: string;
  /** Lifecycle state — controls the empty/loading/error overlay. */
  status: SessionStatus;
  /** When true, focuses the xterm canvas once mounted. */
  focusOnMount?: boolean;
  className?: string;
}

// Spinner characters cycled by the Connecting overlay. xterm.js handles
// ASCII art fine; this just rotates glyphs in a normal <span>.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function ConnectingOverlay({ message }: { message: string }) {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(() => setI((n) => (n + 1) % SPINNER.length), 90);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div
      data-testid="terminal-connecting"
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#000000]/80 text-[var(--accent-cyan)]"
    >
      <pre
        aria-hidden="true"
        className="font-mono text-2xl leading-none"
      >
{`  ╭──────────────────────╮
  │  ${SPINNER[i]}  CONNECTING  │
  ╰──────────────────────╯`}
      </pre>
      <p className="text-xs text-[var(--fg-secondary)]">{message}</p>
    </div>
  );
}

function ErrorOverlay({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      data-testid="terminal-error"
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#000000]/85 px-6 text-center"
    >
      <XCircle className="h-6 w-6 text-[var(--accent-rose)]" aria-hidden="true" />
      <p className="text-sm font-medium text-[var(--fg-primary)]">
        Terminal connection error
      </p>
      <p className="max-w-sm text-xs text-[var(--fg-secondary)]">
        Could not attach to the PTY sidecar. Check the sidecar banner above and retry.
      </p>
      <Button
        size="sm"
        variant="ghost"
        onClick={onRetry}
        className="mt-1 h-7 px-3 text-xs text-[var(--accent-rose)] hover:bg-[rgba(244,63,94,0.12)]"
        data-testid="terminal-retry-inline"
      >
        Try again
      </Button>
    </div>
  );
}

export function TerminalPane({
  sessionId,
  agent,
  workspace,
  wsPath,
  status,
  focusOnMount,
  className,
}: TerminalPaneProps) {
  const { containerRef, connectionState, focus, clear, search } = useTerminal({
    wsPath,
    welcome: `Session ${sessionId.slice(0, 12)} — agent: ${agent} — workspace: ${workspace}`,
    sessionId,
  });

  React.useEffect(() => {
    if (focusOnMount && connectionState === 'connected') focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusOnMount, connectionState]);

  // Global event listeners — the toolbar dispatches these so any pane
  // can react without prop drilling.
  React.useEffect(() => {
    const onPaste = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text ?? '';
      if (!text) return;
      window.dispatchEvent(
        new CustomEvent('forge:terminal:ws-send', {
          detail: { sessionId, text },
        }),
      );
    };
    const onClear = () => clear();
    const onSearch = (e: Event) => {
      const detail = (e as CustomEvent<{ query: string; direction: 'next' | 'prev' }>).detail;
      if (!detail?.query) return;
      // Try to find a match in this pane; report back via search-result.
      // (Multiple panes can run search; the panel surfaces the active
      // session's result.)
      const result = search(detail.query, detail.direction);
      if (result) {
        window.dispatchEvent(
          new CustomEvent('forge:terminal:search-result', {
            detail: { current: 1, total: 1, sessionId },
          }),
        );
      } else {
        window.dispatchEvent(
          new CustomEvent('forge:terminal:search-result', {
            detail: { current: 0, total: 0, sessionId },
          }),
        );
      }
    };
    window.addEventListener('forge:terminal:paste', onPaste);
    window.addEventListener('forge:terminal:clear', onClear);
    window.addEventListener('forge:terminal:search', onSearch);
    return () => {
      window.removeEventListener('forge:terminal:paste', onPaste);
      window.removeEventListener('forge:terminal:clear', onClear);
      window.removeEventListener('forge:terminal:search', onSearch);
    };
  }, [clear, search, sessionId]);

  return (
    <div
      className={cn(
        'relative flex h-full w-full flex-col overflow-hidden rounded-md border border-[var(--border-default)] bg-black',
        className,
      )}
      data-session-id={sessionId}
      data-status={status}
    >
      {status === 'creating' ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center gap-3 bg-black/85">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-cyan)]" aria-hidden="true" />
          <span className="text-xs text-[var(--fg-secondary)]">
            Initializing session…
          </span>
        </div>
      ) : null}
      {status === 'error' ? <ErrorOverlay onRetry={() => window.location.reload()} /> : null}
      {connectionState === 'connecting' && status === 'active' ? (
        <ConnectingOverlay message="Connecting to ws://localhost:4001…" />
      ) : null}
      <div ref={containerRef} className="min-h-0 flex-1 p-2" />
      {/* Decorative header strip — keeps a brand affordance inside the
          pane even though xterm paints over most of it. */}
      <div className="pointer-events-none absolute left-3 top-2 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
        <TerminalIcon className="h-3 w-3" aria-hidden="true" />
        <span className="font-mono">{sessionId.slice(0, 14)}</span>
      </div>
    </div>
  );
}
