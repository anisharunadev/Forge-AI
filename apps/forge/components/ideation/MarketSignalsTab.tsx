'use client';

/**
 * `<MarketSignalsTab>` — Step 28.
 *
 * Live feed of market intelligence (competitor launches, industry
 * trends, tech updates). Each signal carries an AI annotation
 * ("Why this matters for us"). Filter by kind (All / Competitor /
 * Trend / Tech).
 */

import * as React from 'react';
import {
  Building2,
  ExternalLink,
  Filter,
  Newspaper,
  Plus,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { MARKET_SIGNALS, type MarketSignal, type MarketSignalKind } from '@/lib/ideation/pipeline-data';

type Filter = 'all' | MarketSignalKind;

const FILTERS: ReadonlyArray<{ value: Filter; label: string; testId: string }> = [
  { value: 'all', label: 'All', testId: 'market-filter-all' },
  { value: 'competitor', label: 'Competitor', testId: 'market-filter-competitor' },
  { value: 'trend', label: 'Trend', testId: 'market-filter-trend' },
  { value: 'tech', label: 'Tech', testId: 'market-filter-tech' },
];

function iconForKind(kind: MarketSignalKind): React.ReactNode {
  switch (kind) {
    case 'competitor':
      return <Building2 className="h-4 w-4" aria-hidden="true" />;
    case 'trend':
      return <TrendingUp className="h-4 w-4" aria-hidden="true" />;
    case 'tech':
      return <Newspaper className="h-4 w-4" aria-hidden="true" />;
  }
}

function accentForKind(kind: MarketSignalKind): string {
  switch (kind) {
    case 'competitor':
      return 'text-[var(--accent-amber)] bg-[rgba(245,158,11,0.12)] ring-[rgba(245,158,11,0.35)]';
    case 'trend':
      return 'text-[var(--accent-rose)] bg-[rgba(244,63,94,0.12)] ring-[rgba(244,63,94,0.35)]';
    case 'tech':
      return 'text-[var(--accent-cyan)] bg-[rgba(34,211,238,0.12)] ring-[rgba(34,211,238,0.35)]';
  }
}

function priorityDot(p: MarketSignal['priority']): string {
  if (p === 'high') return 'bg-[var(--accent-rose)]';
  if (p === 'medium') return 'bg-[var(--accent-amber)]';
  return 'bg-[var(--fg-muted)]';
}

export interface MarketSignalsTabProps {
  readonly onAddCustom?: () => void;
  readonly onGenerateIdea?: (signal: MarketSignal) => void;
}

export function MarketSignalsTab({ onAddCustom, onGenerateIdea }: MarketSignalsTabProps) {
  const [filter, setFilter] = React.useState<Filter>('all');
  const filtered = React.useMemo(
    () => (filter === 'all' ? MARKET_SIGNALS : MARKET_SIGNALS.filter((s) => s.kind === filter)),
    [filter],
  );

  const today = MARKET_SIGNALS.length;
  const weekCount = 28; // mocked for KPI strip — the seed file does not track this
  const actionable = MARKET_SIGNALS.filter((s) => s.priority !== 'low').length;

  return (
    <section aria-label="Market signals" data-testid="market-signals-tab" className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
            Market Signals
          </p>
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
            What the market is telling us
          </h2>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddCustom ?? (() => toast.info('Add a custom market source (e.g., RSS, saved search).'))}
          className="border-dashed border-[var(--border-default)] bg-transparent text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add custom source
        </Button>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">Signals today</div>
          <div className="mt-1 font-mono text-xl text-[var(--fg-primary)]">{today}</div>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">This week</div>
          <div className="mt-1 font-mono text-xl text-[var(--fg-primary)]">{weekCount}</div>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">Actionable</div>
          <div className="mt-1 font-mono text-xl text-[var(--accent-amber)]">{actionable}</div>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">From signals</div>
          <div className="mt-1 font-mono text-xl text-[var(--accent-violet)]">2 ideas</div>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter signals">
        <Filter className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            data-testid={f.testId}
            onClick={() => setFilter(f.value)}
            className={cn(
              'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2.5 py-1 text-[11px] font-medium transition-colors',
              filter === f.value
                ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.12)] text-[var(--accent-primary)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-secondary)] hover:border-[var(--border-default)] hover:text-[var(--fg-primary)]',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Feed */}
      <ol className="flex flex-col gap-3" data-testid="market-feed">
        {filtered.map((s) => (
          <li
            key={s.id}
            data-testid="market-signal"
            data-signal-kind={s.kind}
            data-signal-priority={s.priority}
            className="group flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 transition-[border,transform] duration-200 ease-out-soft hover:-translate-y-px hover:border-[var(--border-default)]"
          >
            <header className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <span
                  className={cn(
                    'mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md ring-1',
                    accentForKind(s.kind),
                  )}
                >
                  {iconForKind(s.kind)}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
                    {s.title}
                  </h3>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--fg-tertiary)]">
                    <span className="font-mono">{s.source}</span>
                    <span aria-hidden="true">·</span>
                    <span>{s.publishedAt}</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <span className={cn('h-1.5 w-1.5 rounded-full', priorityDot(s.priority))} />
                      {s.priority}
                    </span>
                  </div>
                </div>
              </div>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                aria-label={`Open ${s.title} at ${s.source}`}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </header>

            <div className="rounded-[var(--radius-md)] border border-[rgba(168,85,247,0.20)] bg-[rgba(168,85,247,0.06)] p-2.5 text-[11px] leading-relaxed text-[var(--fg-secondary)]">
              <span className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-violet)]">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                AI annotation
              </span>
              <p>{s.aiAnnotation}</p>
            </div>

            <footer className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-2">
              <span className="text-[10px] text-[var(--fg-tertiary)]">
                Press G to generate an idea from this signal.
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid={`market-generate-${s.id}`}
                onClick={() => {
                  onGenerateIdea?.(s);
                  toast.success(`Idea drafted from "${s.source}"`, {
                    description: 'Pre-fills the new-idea form with the signal insight.',
                  });
                }}
                className="text-[var(--accent-violet)] hover:bg-[rgba(168,85,247,0.10)] hover:text-[var(--accent-violet)]"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Generate idea
              </Button>
            </footer>
          </li>
        ))}

        {filtered.length === 0 ? (
          <li className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] p-6 text-center text-sm text-[var(--fg-tertiary)]">
            No signals match the current filter.
          </li>
        ) : null}
      </ol>
    </section>
  );
}