'use client';

/**
 * GraphStatsStrip — Phase 6, step 67.
 *
 * A read-only KPI row that surfaces `useKGStats()` results so the
 * stats query isn't discarded. Lives just below `NodeKindFilterBar`.
 *
 * Four pills:
 *   1. total nodes
 *   2. total edges
 *   3. top node type + its count
 *   4. (when present) a freshness-aware accent — green/amber/red dot
 *
 * Skeleton variants mirror `GraphSkeleton` so the layout doesn't pop
 * on first load.
 */

import * as React from 'react';
import { Activity } from 'lucide-react';

import { useKGStats } from '@/lib/hooks/useKnowledgeGraph';
import { KIND_COLOR, KIND_ICON } from './graph-palette';
import type { NodeKind } from '@/src/data/sample-graph';

export function GraphStatsStrip() {
  const { data, isLoading, isError } = useKGStats();

  if (isLoading) {
    return (
      <section
        aria-label="Knowledge graph stats"
        data-testid="graph-stats-strip"
        data-state="loading"
        className="flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
      >
        <span className="mr-1 text-xs font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
          Stats
        </span>
        <PillSkeleton />
        <PillSkeleton />
        <PillSkeleton />
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section
        aria-label="Knowledge graph stats"
        data-testid="graph-stats-strip"
        data-state="error"
        className="flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
      >
        <Activity className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
        <span className="text-xs text-[var(--fg-tertiary)]">
          Stats unavailable — backend unreachable
        </span>
      </section>
    );
  }

  const topType = topEntry(data.node_types);

  return (
    <section
      aria-label="Knowledge graph stats"
      data-testid="graph-stats-strip"
      data-state="ready"
      className="flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
    >
      <span className="mr-1 text-xs font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
        Stats
      </span>

      <Pill label="nodes" value={data.node_count} />
      <Pill label="edges" value={data.edge_count} />

      {topType ? (
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-transparent px-2.5 py-1 text-xs"
          data-testid="graph-stats-top-type"
          title={`Top node type: ${topType.kind}`}
        >
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full"
            style={{
              background: KIND_COLOR[topType.kind as NodeKind] ?? 'var(--fg-tertiary)',
              boxShadow: `inset 0 0 0 1px ${KIND_COLOR[topType.kind as NodeKind] ?? 'var(--fg-tertiary)'}`,
            }}
          />
          <span aria-hidden="true" className="text-[13px] leading-none">
            {KIND_ICON[topType.kind as NodeKind] ?? '◇'}
          </span>
          <span className="font-medium text-[var(--fg-secondary)]">{topType.kind}</span>
          <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{topType.count}</span>
        </span>
      ) : null}

      <span className="ml-auto font-mono text-[10px] text-[var(--fg-muted)]">
        {Object.keys(data.node_types).length} types · {Object.keys(data.edge_types).length} relations
      </span>
    </section>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface TopType {
  kind: string;
  count: number;
}

function topEntry(nodeTypes: Record<string, number>): TopType | null {
  const entries = Object.entries(nodeTypes).filter(([, c]) => c > 0);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const head = entries[0];
  return head ? { kind: head[0], count: head[1] } : null;
}

function Pill({ label, value }: { label: string; value: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-transparent px-2.5 py-1 text-xs"
      data-testid="graph-stats-pill"
      data-label={label}
    >
      <span className="font-medium text-[var(--fg-secondary)]">{label}</span>
      <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{value}</span>
    </span>
  );
}

function PillSkeleton() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-5 w-16 animate-pulse rounded-full bg-[var(--bg-elevated)]"
    />
  );
}