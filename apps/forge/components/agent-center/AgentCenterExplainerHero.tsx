'use client';

/**
 * Agent Center — Explainer hero (Step 43 / Addition 1 + 5 CTA).
 *
 * Shown only on the "first run" state (no agents, providers, runtimes,
 * or assignments registered yet). Replaces the lean PageHeader with an
 * educational hero that answers "what is this?" and pushes users into
 * either the guided wizard or straight to the catalog.
 *
 * Constraints adopted from skill searches:
 *   - Dark mode only — every color comes from the design tokens
 *     (--bg-base, --bg-elevated, --accent-cyan, --fg-tertiary).
 *   - Aurora / animated gradient border uses an inline conic-gradient
 *     masked to the explainer box (mirrors AgentCenterBento's hero
 *     so the two first-run surfaces feel like siblings).
 *   - prefers-reduced-motion: the border animation is paused via the
 *     global rule in `app/globals.css`.
 *   - Lucide icons only — no emojis.
 *   - Chip group (4 inline chips) communicates scope at a glance.
 */

import * as React from 'react';
import { Sparkles, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const STAT_CHIPS: ReadonlyArray<{ label: string; testId: string }> = [
  { label: '63 forge-* commands', testId: 'chip-commands' },
  { label: '13 categories', testId: 'chip-categories' },
  { label: 'Multi-tenant', testId: 'chip-multitenant' },
  { label: 'Audit-everything', testId: 'chip-audit' },
];

export interface AgentCenterExplainerHeroProps {
  /** Optional override for the description below the explainer box. */
  description?: string;
  /** CTA to open the guided-setup wizard. */
  onGuidedSetup: () => void;
  /** CTA to jump straight to the catalog (scrolls to the agents tab). */
  onSkipToCatalog: () => void;
  /** Optional override for the CTA labels (e.g. once items exist). */
  primaryLabel?: string;
  secondaryLabel?: string;
}

export function AgentCenterExplainerHero({
  description = 'Manage the AI agents, model providers, and task assignments available to this tenant.',
  onGuidedSetup,
  onSkipToCatalog,
  primaryLabel = 'Guided setup',
  secondaryLabel = 'Skip to catalog',
}: AgentCenterExplainerHeroProps) {
  return (
    <section
      aria-labelledby="agent-center-explainer-heading"
      data-testid="agent-center-explainer"
      className="aurora-frame relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-6 md:p-8"
    >
      <div className="relative z-10 flex flex-col gap-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fg-tertiary)]">
          Agent Center
        </p>

        <h1
          id="agent-center-explainer-heading"
          className="text-[var(--text-3xl)] font-bold leading-tight text-[var(--fg-primary)]"
        >
          Agent Center
        </h1>

        {/* Explainer box */}
        <div
          className="rounded-[var(--radius-xl)] bg-[var(--bg-elevated)] p-6"
          data-testid="agent-center-what-is-this"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles
                  className="h-4 w-4 text-[var(--accent-cyan)]"
                  aria-hidden="true"
                />
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-cyan)]">
                  What is this?
                </span>
              </div>

              <p className="max-w-2xl text-sm leading-relaxed text-[var(--fg-secondary)]">
                Agents are AI workers that execute forge-* commands. Each agent is
                powered by a model, runs in a runtime, and is assigned to
                projects. Together they form your AI workforce — your team of AI
                collaborators that automate the SDLC.
              </p>

              <ul
                role="list"
                aria-label="Agent Center scope"
                className="flex flex-wrap gap-2"
                data-testid="agent-center-stat-chips"
              >
                {STAT_CHIPS.map((chip) => (
                  <li key={chip.testId}>
                    <span
                      className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--fg-secondary)]"
                      data-testid={chip.testId}
                    >
                      {chip.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex shrink-0 flex-col gap-2 md:items-end">
              <Button
                type="button"
                onClick={onGuidedSetup}
                data-testid="guided-setup-primary"
                aria-label="Start guided setup"
                className={cn(
                  'h-11 gap-2 px-5 text-[var(--text-md)] font-medium',
                  'bg-[var(--accent-primary)] text-white',
                  'shadow-[0_8px_24px_-6px_rgb(99_102_241_/_0.55)]',
                  'hover:bg-[var(--accent-primary)] hover:opacity-95',
                  'focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-elevated)]',
                )}
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {primaryLabel}
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={onSkipToCatalog}
                data-testid="guided-setup-skip"
                className="h-9 px-3 text-sm text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
              >
                {secondaryLabel}
              </Button>
            </div>
          </div>
        </div>

        <p className="max-w-3xl text-sm text-[var(--fg-tertiary)]">{description}</p>
      </div>
    </section>
  );
}
