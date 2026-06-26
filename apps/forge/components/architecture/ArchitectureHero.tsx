'use client';

/**
 * Architecture Center — hero band (Step 4 animated gradient border).
 *
 * Skill influence:
 *   - `style` (Swiss Modernism 2.0) — single accent (indigo), mathematical
 *     spacing (24/32/48 px scale), Inter, no decorations.
 *   - `08-empty-ux.md` — even the hero's "all good" state pairs a
 *     count badge with descriptive copy (no color-only signal).
 *   - `prefers-reduced-motion` — Step 6 global media query zeros the
 *     `hero-border` conic animation.
 */

import * as React from 'react';
import { Network, AlertTriangle, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

export interface ArchitectureHeroProps {
  demoConflicts: number;
  onCreateADR: () => void;
  onResolveConflicts?: () => void;
  className?: string;
}

export function ArchitectureHero({
  demoConflicts,
  onCreateADR,
  onResolveConflicts,
  className,
}: ArchitectureHeroProps) {
  return (
    <section
      className={[
        'hero-border relative overflow-hidden rounded-[var(--radius-xl)]',
        'border border-[var(--border-default)] bg-[var(--bg-elevated)] px-8 py-7',
        className ?? '',
      ].join(' ')}
      data-testid="architecture-hero"
    >
      <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-tertiary)]">
            Center
          </p>
          <h1 className="flex items-center gap-3 text-[var(--text-3xl)] font-bold leading-tight text-[var(--fg-primary)]">
            <Network
              className="h-7 w-7 text-[var(--accent-primary)]"
              aria-hidden="true"
            />
            Architecture Center
          </h1>
          <p className="max-w-2xl text-[var(--text-sm)] text-[var(--fg-secondary)]">
            ADRs, API contracts, task breakdowns, risk registers, and full
            traceability from requirement to test.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {demoConflicts > 0 ? (
            <div
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[rgba(244,63,94,0.30)] bg-[rgba(244,63,94,0.10)] px-3 py-1.5"
              data-testid="architecture-conflict-badge"
              aria-label={`${demoConflicts} intentional demo conflicts`}
            >
              <AlertTriangle
                className="h-3 w-3 text-[var(--accent-rose)]"
                aria-hidden="true"
              />
              <span className="text-xs text-[var(--accent-rose)]">
                Demo: {demoConflicts} intentional conflicts
              </span>
              {onResolveConflicts ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onResolveConflicts}
                  data-testid="architecture-resolve-conflicts"
                  className="h-6 px-2 text-xs text-[var(--accent-rose)] hover:bg-[rgba(244,63,94,0.10)]"
                >
                  Resolve
                </Button>
              ) : null}
            </div>
          ) : null}
          <Button
            onClick={onCreateADR}
            data-testid="hero-new-adr"
            className="bg-[var(--accent-primary)] text-white hover:opacity-90"
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            New ADR
          </Button>
        </div>
      </div>
    </section>
  );
}