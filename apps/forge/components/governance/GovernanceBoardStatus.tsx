'use client';

/**
 * GovernanceBoardStatus — Hero pill + status banner for the
 * Governance Center page (Phase 0.5-08).
 *
 * Exports two composed surfaces:
 *   - <BoardTokenPill />   — top-right of the hero band
 *   - <BoardTokenBanner /> — full-width status strip below the hero
 *
 * Per the Paperclip interaction schema, Accept / Decline on
 * `request_confirmation` interactions requires the active Board token.
 * The persona cookie drives `boardTokenPresent`; if missing, the user
 * can reconnect (mock) to flip the state.
 *
 * Both surfaces share one toast hook + reconnect simulation so the
 * page layout can render them side-by-side without prop-drilling a
 * callback.
 */

import * as React from 'react';
import { ShieldCheck, Settings, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface SharedProps {
  boardTokenPresent: boolean;
}

/* ──────────────────────────────────────────────────────────────────
 *  BoardTokenPill — top-right of the hero band.
 * ────────────────────────────────────────────────────────────────── */
export function BoardTokenPill({ boardTokenPresent }: SharedProps) {
  const { toast } = useToast();
  const [connecting, setConnecting] = React.useState(false);

  const handleReconnect = React.useCallback(() => {
    if (connecting) return;
    setConnecting(true);
    // Mock reconnect: simulate network round-trip so the spinner is
    // visible (Constraint: every action button has loading state).
    window.setTimeout(() => {
      setConnecting(false);
      toast({
        title: 'Board token reconnected',
        description: 'Accept actions re-enabled for this session.',
      });
    }, 600);
  }, [connecting, toast]);

  return (
    <span
      className={
        boardTokenPresent
          ? 'inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-[var(--text-xs)] text-[var(--fg-secondary)]'
          : 'inline-flex items-center gap-2 rounded-full border border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/10 px-3 py-1.5 text-[var(--text-xs)] text-[var(--fg-secondary)]'
      }
      data-testid={
        boardTokenPresent
          ? 'board-token-pill-healthy'
          : 'board-token-pill-missing'
      }
    >
      {boardTokenPresent ? (
        <>
          <span aria-hidden="true" className="relative inline-flex h-2 w-2">
            <span className="absolute inset-0 animate-pulse-agent rounded-full bg-[var(--accent-emerald)]/40" />
            <span className="relative inline-block h-2 w-2 rounded-full bg-[var(--accent-emerald)]" />
          </span>
          <span className="font-medium text-[var(--fg-primary)]">
            Board token
          </span>
          <span aria-hidden="true" className="text-[var(--fg-muted)]">·</span>
          <span>Healthy</span>
          <button
            type="button"
            aria-label="Manage Board token"
            className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-[var(--fg-tertiary)] transition-colors hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
            data-testid="board-token-settings"
          >
            <Settings className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </>
      ) : (
        <>
          <AlertTriangle
            className="h-3.5 w-3.5 text-[var(--accent-amber)]"
            aria-hidden="true"
          />
          <span className="font-medium text-[var(--fg-primary)]">
            Token missing
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReconnect}
            disabled={connecting}
            className="h-6 px-2 text-[11px]"
            data-testid="board-token-reconnect"
          >
            {connecting ? 'Reconnecting…' : 'Reconnect'}
          </Button>
        </>
      )}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────────
 *  BoardTokenBanner — full-width status strip below the hero.
 * ────────────────────────────────────────────────────────────────── */
export function BoardTokenBanner({ boardTokenPresent }: SharedProps) {
  const { toast } = useToast();

  const handleDisconnect = React.useCallback(() => {
    toast({
      title: 'Board token disconnected',
      description: 'Accept actions are now disabled for this session.',
      variant: 'destructive',
    });
  }, [toast]);

  if (boardTokenPresent) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
        data-testid="board-token-present"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]"
        >
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <p className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
            Board token present
          </p>
          <p className="mt-0.5 text-[var(--text-xs)] text-[var(--fg-secondary)]">
            Board token present for this session — Accept actions are
            enabled for{' '}
            <span className="font-mono text-[var(--fg-primary)]">
              request_confirmation
            </span>{' '}
            interactions.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDisconnect}
          data-testid="board-token-disconnect"
        >
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/5 p-4"
      data-testid="board-token-missing"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]"
      >
        <AlertTriangle className="h-5 w-5" />
      </span>
      <div className="flex-1">
        <p className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
          Board token missing
        </p>
        <p className="mt-0.5 text-[var(--text-xs)] text-[var(--fg-secondary)]">
          No Board token in this session — Accept actions will surface a
          re-auth prompt. Decline remains enabled so the persona can
          refuse its own prompts.
        </p>
      </div>
    </div>
  );
}

/* Back-compat default export so older imports don't break. */
export default function GovernanceBoardStatus(props: SharedProps) {
  return <BoardTokenBanner {...props} />;
}