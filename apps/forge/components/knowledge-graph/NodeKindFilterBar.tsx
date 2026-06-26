'use client';

import * as React from 'react';
import { X, Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ALL_KINDS, KIND_COLOR, KIND_ICON } from './graph-palette';
import type { NodeKind } from '@/src/data/sample-graph';

export interface NodeKindFilterBarProps {
  visibleKinds: ReadonlyArray<NodeKind>;
  onToggle: (kind: NodeKind) => void;
  counts: Record<NodeKind, number>;
}

/**
 * Zone 2 — toggleable chips for every node kind. Active kinds get a
 * tinted background + filled dot; inactive get a hollow dot. Right-side
 * controls: Hide all / Show all / Reset.
 */
export function NodeKindFilterBar({
  visibleKinds,
  onToggle,
  counts,
}: NodeKindFilterBarProps) {
  const activeSet = React.useMemo(() => new Set(visibleKinds), [visibleKinds]);

  const allHidden = visibleKinds.length === 0;
  const allShown = visibleKinds.length === ALL_KINDS.length;

  return (
    <section
      aria-label="Node kinds"
      className="flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
      data-testid="node-kind-filter-bar"
    >
      <span className="mr-1 text-xs font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
        Node kinds
      </span>

      <div className="flex flex-wrap items-center gap-1.5">
        {ALL_KINDS.map((kind) => {
          const active = activeSet.has(kind);
          const color = KIND_COLOR[kind];
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onToggle(kind)}
              aria-pressed={active}
              data-testid="kind-chip"
              data-kind={kind}
              data-active={active}
              className={cn(
                'group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors duration-150',
                active
                  ? 'border-transparent bg-[rgba(99,102,241,0.10)]'
                  : 'border-[var(--border-subtle)] bg-transparent opacity-60 hover:opacity-100',
              )}
              style={
                active
                  ? { color }
                  : { color: 'var(--fg-tertiary)' }
              }
            >
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  background: active ? color : 'transparent',
                  boxShadow: active ? `0 0 0 1px ${color}` : `inset 0 0 0 1px ${color}`,
                }}
              />
              <span aria-hidden="true" className="text-[13px] leading-none">{KIND_ICON[kind]}</span>
              <span className="font-medium">{kind}</span>
              <span className="font-mono text-[10px] opacity-70">{counts[kind] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => {
            // Hide everything that is currently shown — toggle each.
            visibleKinds.forEach((k) => onToggle(k));
          }}
          disabled={allHidden}
          className="text-[var(--fg-tertiary)] underline-offset-2 hover:text-[var(--fg-primary)] hover:underline disabled:opacity-40"
        >
          Hide all
        </button>
        <span className="text-[var(--fg-muted)]">/</span>
        <button
          type="button"
          onClick={() => {
            // Show every kind — toggle on each missing one.
            const missing = ALL_KINDS.filter((k) => !activeSet.has(k));
            missing.forEach((k) => onToggle(k));
          }}
          disabled={allShown}
          className="text-[var(--fg-tertiary)] underline-offset-2 hover:text-[var(--fg-primary)] hover:underline disabled:opacity-40"
        >
          Show all
        </button>
        <button
          type="button"
          onClick={() => {
            // Reset = show all.
            const missing = ALL_KINDS.filter((k) => !activeSet.has(k));
            missing.forEach((k) => onToggle(k));
          }}
          className="ml-1 inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[var(--fg-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
        >
          {allShown ? <Check className="h-3 w-3" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}
          Reset
        </button>
      </div>
    </section>
  );
}