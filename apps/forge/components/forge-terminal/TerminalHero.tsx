'use client';

/**
 * Terminal — Hero band (Step 4 animated gradient border).
 *
 * Layout:
 *   - Eyebrow ("FORGE TERMINAL CENTER").
 *   - H1 with Terminal icon and the page title.
 *   - Top-right: workspace selector, agent selector, "+ New session".
 *
 * Skill influence:
 *   - ux-guideline (Swiss Modernism 2.0) — single accent (indigo),
 *     mathematical spacing (24/32/48 px scale), Inter, no decorations.
 *   - prefers-reduced-motion — Step 6 global media query zeros the
 *     `hero-border` conic animation.
 */

import * as React from 'react';
import { Plus, TerminalSquare, Minus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AgentSelector } from './AgentSelector';
import { WorkspaceSelector } from './WorkspaceSelector';
import { ConnectedBadge } from './SidecarBanner';
import type { TerminalConnectionState } from '@/hooks/use-terminal';

export interface TerminalHeroProps {
  /** Sidecar connection state — drives the badge color. */
  connectionState: TerminalConnectionState;
  /** Latency in ms when connected. */
  latencyMs?: number;
  /** Endpoint to surface in the Connected badge. */
  endpoint?: string;
  onNewSession: () => void;
  /** Optional hide handler — surfaces a collapse chevron so the user can
   * reclaim vertical space for the canvas. */
  onHide?: () => void;
}

export function TerminalHero({
  connectionState,
  latencyMs,
  endpoint,
  onNewSession,
  onHide,
}: TerminalHeroProps) {
  return (
    <section
      data-testid="terminal-hero"
      className={[
        'hero-border relative overflow-hidden rounded-[var(--radius-xl)]',
        'border border-[var(--border-default)] bg-[var(--bg-elevated)] px-8 py-7',
      ].join(' ')}
    >
      <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-tertiary)]">
            Forge Terminal Center
          </p>
          <h1 className="flex items-center gap-3 text-[var(--text-3xl)] font-bold leading-tight text-[var(--fg-primary)]">
            <TerminalSquare
              className="h-7 w-7 text-[var(--accent-primary)]"
              aria-hidden="true"
            />
            Live terminal sessions
          </h1>
          <p className="max-w-2xl text-[var(--text-sm)] text-[var(--fg-secondary)]">
            Persistent PTY-backed sessions for Claude Code, Codex, Aider, and your
            custom agents. Multi-tab, drag-to-reorder, and sidecar-aware.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ConnectedBadge
            connected={connectionState === 'connected'}
            latencyMs={latencyMs}
            endpoint={endpoint}
          />
          <div className="hidden h-6 w-px bg-[var(--border-subtle)] md:block" />
          <WorkspaceSelector />
          <AgentSelector />
          <Button
            onClick={onNewSession}
            data-testid="hero-new-session"
            className="bg-[var(--accent-primary)] text-white hover:opacity-90"
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            New session
          </Button>
          {onHide ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Hide hero band"
              title="Hide hero band"
              onClick={onHide}
              data-testid="hero-hide"
              className="h-7 w-7 text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
