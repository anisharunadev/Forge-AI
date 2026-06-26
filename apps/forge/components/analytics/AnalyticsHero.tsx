'use client'

/**
 * AnalyticsHero — Step 4 animated gradient border band.
 *
 * Reuses the global `.hero-border` class (defined in
 * `app/globals.css`) so the conic-gradient ring is identical to
 * Architecture and Governance centers. The action slot is composed
 * via the parent so date-range, compare, and export controls all
 * live in one place.
 *
 * Skill influence:
 *   - `ux` (Color Only) — the active range pill is signaled both
 *     by color (indigo fill) and `aria-pressed` text. The
 *     "30-day platform metrics" description is rendered as muted
 *     text, never as color alone.
 *   - `prefers-reduced-motion` — `globals.css` cancels the
 *     `hero-border` rotation when the user opts out.
 */

import * as React from 'react'
import { BarChart3 } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface AnalyticsHeroProps {
  /** Right-side action slot (date range, compare, export). */
  action?: React.ReactNode
  className?: string
}

export function AnalyticsHero({ action, className }: AnalyticsHeroProps) {
  return (
    <section
      className={cn(
        'hero-border relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-8 py-7',
        className,
      )}
      data-testid="analytics-hero"
      aria-labelledby="analytics-hero-title"
    >
      <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--accent-primary)]">
            Center
          </p>
          <h1
            id="analytics-hero-title"
            className="flex items-center gap-3 text-[var(--text-3xl)] font-bold leading-tight text-[var(--fg-primary)]"
          >
            <span
              aria-hidden="true"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[rgba(99,102,241,0.12)] text-[var(--accent-primary)]"
            >
              <BarChart3 className="h-5 w-5" />
            </span>
            Analytics Center
          </h1>
          <p className="max-w-2xl text-sm text-[var(--fg-secondary)]">
            30-day platform metrics across cost, throughput, acceptance, and
            knowledge reuse. All dashboards read live from the orchestrator.
          </p>
        </div>
        {action ? (
          <div
            className="flex flex-wrap items-center gap-2"
            data-testid="analytics-hero-action"
          >
            {action}
          </div>
        ) : null}
      </div>
    </section>
  )
}
