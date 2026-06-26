'use client';

/**
 * Risk Heat Map — Step 30 Zone 7 primary view.
 *
 * 5×5 matrix of likelihood (rows, low→high) × impact (columns,
 * low→high). Each cell counts the risks at that severity and
 * clicking a cell filters the list below.
 *
 * Cell tone follows the L×I score:
 *   L×I ≥ 16: rose (critical)
 *   L×I ≥ 9:  amber (high)
 *   else:     emerald (low)
 *
 * Skill influence:
 *   - `chart` (Risk Matrix) — color gradient, semantic
 *     positioning, never use red alone (paired with tone weight).
 *   - `style` (Data-Dense Dashboard) — minimal padding, each
 *     cell clickable, hover surfaces the count and the names.
 */

import * as React from 'react';
import { ShieldAlert, AlertTriangle, ShieldCheck } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Risk } from '@/lib/architecture/data';

const LIKELIHOOD_LABELS = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'] as const;
const IMPACT_LABELS = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'] as const;

function cellTone(score: number, count: number): string {
  if (count === 0) return 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]';
  if (score >= 20) return 'bg-rose-500/40 text-rose-200 ring-1 ring-rose-400/40';
  if (score >= 15) return 'bg-rose-500/30 text-rose-300 ring-1 ring-rose-400/30';
  if (score >= 9) return 'bg-amber-500/30 text-amber-200 ring-1 ring-amber-400/30';
  if (score >= 4) return 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/20';
  return 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-400/10';
}

export interface RiskHeatMapProps {
  risks: ReadonlyArray<Risk>;
  selectedCell: { l: number; i: number } | null;
  onSelectCell: (cell: { l: number; i: number } | null) => void;
}

export function RiskHeatMap({ risks, selectedCell, onSelectCell }: RiskHeatMapProps) {
  // Bucket risks by (likelihood, impact) coordinates.
  const buckets = React.useMemo(() => {
    const m = new Map<string, Risk[]>();
    for (const r of risks) {
      const key = `${r.likelihood}:${r.impact}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return m;
  }, [risks]);

  const filtered = React.useMemo(() => {
    if (!selectedCell) return risks;
    return risks.filter((r) => r.likelihood === selectedCell.l && r.impact === selectedCell.i);
  }, [risks, selectedCell]);

  const summary = React.useMemo(() => {
    const open = risks.filter((r) => r.status !== 'closed').length;
    const crit = risks.filter((r) => r.likelihood * r.impact >= 16).length;
    const mitig = risks.filter((r) => r.status === 'mitigating').length;
    return { open, crit, mitig };
  }, [risks]);

  return (
    <div className="flex flex-col gap-4">
      {/* Headline strip */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCell label="Open risks" value={summary.open} tone="rose" icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />} />
        <SummaryCell label="Critical (L×I ≥ 16)" value={summary.crit} tone="amber" icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />} />
        <SummaryCell label="Mitigating" value={summary.mitig} tone="cyan" icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* The matrix */}
        <section
          className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
          aria-label="5×5 risk heat map"
        >
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Risk heat map</h3>
            <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">5×5 · L × I</span>
          </header>

          <div className="relative">
            {/* Axis labels */}
            <p className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-5 font-mono text-[10px] text-[var(--fg-tertiary)]">
              ↑ Impact →
            </p>

            <div className="grid" style={{ gridTemplateColumns: 'auto repeat(5, minmax(0, 1fr))' }}>
              <div />
              {IMPACT_LABELS.map((label) => (
                <div key={label} className="px-1 pb-1 text-center font-mono text-[9px] text-[var(--fg-tertiary)]">
                  {label}
                </div>
              ))}

              {[5, 4, 3, 2, 1].map((li) => (
                <React.Fragment key={`row-${li}`}>
                  <div className="flex h-14 items-center pr-2 text-right font-mono text-[9px] text-[var(--fg-tertiary)]">
                    {LIKELIHOOD_LABELS[li - 1]}
                  </div>
                  {[1, 2, 3, 4, 5].map((ii) => {
                    const cellRisks = buckets.get(`${li}:${ii}`) ?? [];
                    const count = cellRisks.length;
                    const score = li * ii;
                    const isActive = selectedCell?.l === li && selectedCell?.i === ii;
                    return (
                      <button
                        key={`c-${li}-${ii}`}
                        type="button"
                        onClick={() => onSelectCell(isActive ? null : { l: li, i: ii })}
                        aria-pressed={isActive}
                        data-testid={`risk-cell-${li}-${ii}`}
                        title={
                          count === 0
                            ? `${LIKELIHOOD_LABELS[li - 1]} × ${IMPACT_LABELS[ii - 1]} — no risks`
                            : `${LIKELIHOOD_LABELS[li - 1]} × ${IMPACT_LABELS[ii - 1]} — ${count} risk${count === 1 ? '' : 's'}: ${cellRisks.map((r) => r.title).join(', ')}`
                        }
                        className={cn(
                          'relative m-0.5 flex h-14 flex-col items-center justify-center rounded-[var(--radius-md)] transition-all duration-150 ease-out-soft',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                          cellTone(score, count),
                          isActive && 'outline outline-2 outline-[var(--accent-primary)]',
                        )}
                      >
                        {count > 0 ? (
                          <span
                            className="text-lg font-bold tabular-nums transition-transform duration-150 ease-out-soft"
                          >
                            {count}
                          </span>
                        ) : (
                          <span className="text-xs">—</span>
                        )}
                        <span className="font-mono text-[9px] opacity-80">{score}</span>
                      </button>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>

            {/* Y-axis caption */}
            <p className="absolute -left-8 top-1/2 -translate-y-1/2 -rotate-90 font-mono text-[10px] text-[var(--fg-tertiary)]">
              ↑ Likelihood
            </p>
          </div>

          {/* Legend */}
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] pt-3 text-[10px] text-[var(--fg-tertiary)]">
            <span className="font-mono uppercase tracking-wide">Severity</span>
            <Legend tone="bg-emerald-500/20" label="Low (1-3)" />
            <Legend tone="bg-emerald-500/10" label="Moderate (4-8)" />
            <Legend tone="bg-amber-500/30" label="High (9-15)" />
            <Legend tone="bg-rose-500/40" label="Critical (16-25)" />
          </div>
        </section>

        {/* Filtered list */}
        <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
              {selectedCell
                ? `Risks at L${selectedCell.l} × I${selectedCell.i}`
                : 'All risks'}
            </h3>
            {selectedCell ? (
              <button
                type="button"
                onClick={() => onSelectCell(null)}
                className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5 text-[10px] text-[var(--fg-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              >
                Clear filter
              </button>
            ) : null}
          </header>

          {filtered.length === 0 ? (
            <p className="rounded border border-dashed border-[var(--border-subtle)] p-4 text-center text-xs text-[var(--fg-muted)]">
              No risks at this severity. Click a cell with a number to drill in.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" role="list">
              {filtered.map((r) => {
                const score = r.likelihood * r.impact;
                const tone =
                  score >= 16
                    ? 'border-rose-500/40 bg-rose-500/10'
                    : score >= 9
                      ? 'border-amber-500/40 bg-amber-500/10'
                      : 'border-emerald-500/30 bg-emerald-500/10';
                return (
                  <li
                    key={r.id}
                    className={cn('rounded-[var(--radius-md)] border p-3 text-xs', tone)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-[var(--fg-primary)]">{r.title}</p>
                        <p className="mt-1 font-mono text-[10px] text-[var(--fg-tertiary)]">
                          L{r.likelihood} × I{r.impact} = {score} · {r.owner}
                        </p>
                      </div>
                      <span className="shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1.5 py-0.5 font-mono text-[10px] uppercase">
                        {r.status}
                      </span>
                    </div>
                    <p className="mt-2 text-[var(--fg-secondary)]">{r.mitigation}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryCell({ label, value, tone, icon }: { label: string; value: number; tone: 'rose' | 'amber' | 'cyan'; icon: React.ReactNode }) {
  const toneClass =
    tone === 'rose' ? 'text-rose-300 bg-rose-500/10 border-rose-500/30' :
    tone === 'amber' ? 'text-amber-300 bg-amber-500/10 border-amber-500/30' :
    'text-cyan-300 bg-cyan-500/10 border-cyan-500/30';
  return (
    <div className={cn('flex items-center gap-2 rounded-[var(--radius-md)] border p-3', toneClass)}>
      <span aria-hidden="true">{icon}</span>
      <div>
        <p className="font-mono text-[10px] uppercase tracking-wide opacity-80">{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn('inline-block h-3 w-3 rounded', tone)} />
      {label}
    </span>
  );
}
