'use client'

/**
 * ProviderLeaderboard — Top 3 model providers by spend, with
 * horizontal bars and a textual count of invocations.
 *
 * Compact companion to `ProviderCostBreakdown`. Where the stacked
 * bar shows how each provider's cost is split across services /
 * days, the leaderboard shows *who's* on top, with a click
 * affordance to filter the rest of the dashboard.
 *
 * Skill influence:
 *   - `ux` (Color Only) — the rank (1/2/3) is also rendered as a
 *     numeric label, not just a colored bar.
 *   - `ux` (Drill-Down) — clicking a row raises `onSelectProvider`
 *     so the parent can filter other charts (Row 1 / Row 4) to
 *     the chosen provider.
 */

import * as React from 'react'
import { ArrowUpRight, Cpu } from 'lucide-react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface ProviderRow {
  provider: string
  spend: number
  invocations: number
}

export interface ProviderLeaderboardProps {
  title: string
  description?: string
  data: ReadonlyArray<ProviderRow>
  /** Top N to render. Defaults to 3. */
  limit?: number
  onSelectProvider?: (provider: string) => void
  className?: string
}

function fmtSpend(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toFixed(2)}`
}

export function ProviderLeaderboard({
  title,
  description,
  data,
  limit = 3,
  onSelectProvider,
  className,
}: ProviderLeaderboardProps) {
  const top = React.useMemo(
    () => [...data].sort((a, b) => b.spend - a.spend).slice(0, limit),
    [data, limit],
  )
  const max = Math.max(1, ...top.map((p) => p.spend))
  return (
    <Card data-testid="provider-leaderboard" className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-14 font-semibold">{title}</CardTitle>
        {description ? (
          <CardDescription className="text-12">{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <p
            className="text-xs text-[var(--fg-tertiary)]"
            data-testid="provider-leaderboard-empty"
          >
            No provider data yet.
          </p>
        ) : (
          <ul role="list" className="flex flex-col gap-3">
            {top.map((p, i) => {
              const pct = (p.spend / max) * 100
              const rankColors = [
                'var(--accent-amber)',
                'var(--accent-violet)',
                'var(--accent-cyan)',
              ] as const
              return (
                <li key={p.provider}>
                  <button
                    type="button"
                    onClick={() => onSelectProvider?.(p.provider)}
                    data-testid={`provider-leaderboard-${p.provider}`}
                    className={cn(
                      'group flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2 py-1.5 text-left transition-colors duration-150 ease-out-soft',
                      'hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-black"
                      style={{ background: rankColors[i] ?? 'var(--accent-primary)' }}
                    >
                      {i + 1}
                    </span>
                    <span
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--bg-inset)] text-[var(--fg-secondary)]"
                      aria-hidden="true"
                    >
                      <Cpu className="h-3.5 w-3.5" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-[var(--fg-primary)]">
                          {p.provider}
                        </span>
                        <span className="font-mono text-xs text-[var(--fg-secondary)]">
                          {fmtSpend(p.spend)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-[var(--radius-pill)] bg-[var(--bg-inset)]">
                        <div
                          className="h-full rounded-[var(--radius-pill)] transition-[width] duration-200 ease-out-soft"
                          style={{
                            width: `${pct}%`,
                            background: rankColors[i] ?? 'var(--accent-primary)',
                          }}
                          aria-hidden="true"
                        />
                      </div>
                      <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                        {p.invocations.toLocaleString()} invocations
                      </span>
                    </div>
                    <ArrowUpRight
                      className="h-3.5 w-3.5 shrink-0 text-[var(--fg-tertiary)] transition-colors duration-150 ease-out-soft group-hover:text-[var(--fg-primary)]"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
