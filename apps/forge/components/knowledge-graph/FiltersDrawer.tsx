'use client';

import * as React from 'react';
import { X, Filter as FilterIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ALL_KINDS, ALL_EDGE_KINDS, EDGE_COLOR, EDGE_LABEL, KIND_COLOR, KIND_ICON } from './graph-palette';
import type { EdgeKind, NodeKind } from '@/src/data/sample-graph';

export type TimeRange = '7d' | '30d' | '90d' | 'all';

export interface FiltersState {
  visibleKinds: ReadonlyArray<NodeKind>;
  hiddenEdgeKinds: ReadonlyArray<EdgeKind>;
  timeRange: TimeRange;
  authors: ReadonlyArray<string>;
  tags: ReadonlyArray<string>;
  hideIsolated: boolean;
}

export interface FiltersDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: FiltersState;
  onChange: (next: Partial<FiltersState>) => void;
  /** Total counts per kind — supplied by the parent so the chip counts stay stable. */
  counts: Record<NodeKind, number>;
  authors: ReadonlyArray<string>;
  tags: ReadonlyArray<string>;
  onReset: () => void;
  onApply: () => void;
}

/**
 * Zone 5 — right-side drawer with three sections: kinds, edge types, time
 * range + authors + tags + isolated toggle.
 */
export function FiltersDrawer({
  open,
  onOpenChange,
  state,
  onChange,
  counts,
  authors,
  tags,
  onReset,
  onApply,
}: FiltersDrawerProps) {
  if (!open) return null;

  const toggleKind = (k: NodeKind) => {
    const next = state.visibleKinds.includes(k)
      ? state.visibleKinds.filter((x) => x !== k)
      : [...state.visibleKinds, k];
    onChange({ visibleKinds: next });
  };

  const toggleEdgeKind = (k: EdgeKind) => {
    const next = state.hiddenEdgeKinds.includes(k)
      ? state.hiddenEdgeKinds.filter((x) => x !== k)
      : [...state.hiddenEdgeKinds, k];
    onChange({ hiddenEdgeKinds: next });
  };

  const toggleAuthor = (a: string) => {
    const next = state.authors.includes(a)
      ? state.authors.filter((x) => x !== a)
      : [...state.authors, a];
    onChange({ authors: next });
  };

  const toggleTag = (t: string) => {
    const next = state.tags.includes(t)
      ? state.tags.filter((x) => x !== t)
      : [...state.tags, t];
    onChange({ tags: next });
  };

  return (
    <div
      className="fixed inset-0 z-50"
      data-testid="filters-drawer"
      role="dialog"
      aria-label="Filters"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[var(--scrim)]"
        onClick={() => onOpenChange(false)}
      />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-[380px] flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-xl">
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] p-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--fg-primary)]">
            <FilterIcon className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
            Filters
          </h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close filters"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="thin-scrollbar flex-1 space-y-5 overflow-y-auto p-4">
          {/* A. Node kinds */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
              Node kinds
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {ALL_KINDS.map((k) => {
                const active = state.visibleKinds.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleKind(k)}
                    aria-pressed={active}
                    data-testid="filter-kind"
                    data-kind={k}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                      active
                        ? 'border-transparent bg-[rgba(99,102,241,0.10)]'
                        : 'border-[var(--border-subtle)] bg-transparent opacity-50 hover:opacity-100',
                    )}
                    style={{ color: active ? KIND_COLOR[k] : 'var(--fg-tertiary)' }}
                  >
                    <span aria-hidden="true">{KIND_ICON[k]}</span>
                    {k}
                    <span className="font-mono text-[10px] opacity-70">{counts[k] ?? 0}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* B. Edge types */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
              Edge types
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {ALL_EDGE_KINDS.map((k) => {
                const hidden = state.hiddenEdgeKinds.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleEdgeKind(k)}
                    aria-pressed={!hidden}
                    data-testid="filter-edge-kind"
                    data-edge-kind={k}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                      hidden
                        ? 'border-[var(--border-subtle)] bg-transparent opacity-40 line-through'
                        : 'border-transparent bg-[var(--bg-surface)]',
                    )}
                    style={{ color: hidden ? 'var(--fg-tertiary)' : EDGE_COLOR[k] }}
                  >
                    <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: EDGE_COLOR[k] }} />
                    {EDGE_LABEL[k]}
                  </button>
                );
              })}
            </div>
          </section>

          {/* C. Time range */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
              Time
            </h3>
            <div className="inline-flex flex-wrap gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-0.5">
              {(['7d', '30d', '90d', 'all'] as ReadonlyArray<TimeRange>).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => onChange({ timeRange: r })}
                  data-testid="filter-time"
                  data-range={r}
                  className={cn(
                    'rounded-[var(--radius-sm)] px-3 py-1 text-xs font-medium transition-colors',
                    state.timeRange === r
                      ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-sm'
                      : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
                  )}
                >
                  {r === 'all' ? 'All time' : `Last ${r}`}
                </button>
              ))}
            </div>
          </section>

          {/* D. Authors */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
              Authors
            </h3>
            {authors.length === 0 ? (
              <p className="text-[11px] text-[var(--fg-tertiary)]">No authors to filter.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {authors.map((a) => {
                  const active = state.authors.includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => toggleAuthor(a)}
                      aria-pressed={active}
                      data-testid="filter-author"
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        active
                          ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.10)] text-[var(--accent-primary)]'
                          : 'border-[var(--border-subtle)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
                      )}
                    >
                      {a}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* E. Tags */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
              Tags
            </h3>
            {tags.length === 0 ? (
              <p className="text-[11px] text-[var(--fg-tertiary)]">No tags found.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.slice(0, 24).map((t) => {
                  const active = state.tags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(t)}
                      aria-pressed={active}
                      data-testid="filter-tag"
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                        active
                          ? 'border-[var(--accent-emerald)] bg-[rgba(16,185,129,0.10)] text-[var(--accent-emerald)]'
                          : 'border-[var(--border-subtle)] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
                      )}
                    >
                      #{t}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* F. Isolated nodes */}
          <section>
            <label className="flex cursor-pointer items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <span className="text-sm text-[var(--fg-primary)]">Hide isolated nodes</span>
              <input
                type="checkbox"
                checked={state.hideIsolated}
                onChange={(e) => onChange({ hideIsolated: e.target.checked })}
                data-testid="filter-hide-isolated"
                className="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] bg-[var(--bg-elevated)] accent-[var(--accent-primary)]"
              />
            </label>
          </section>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] p-4">
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-[var(--fg-tertiary)] underline-offset-2 hover:text-[var(--fg-primary)] hover:underline"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => {
              onApply();
              onOpenChange(false);
            }}
            data-testid="filters-apply"
            className="inline-flex h-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Apply
          </button>
        </footer>
      </div>
    </div>
  );
}