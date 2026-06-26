'use client';

import * as React from 'react';
import { ArrowUpDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { KIND_COLOR, KIND_ICON } from './graph-palette';
import type { NodeKind, SampleEdge, SampleNode } from '@/src/data/sample-graph';

type SortKey = 'kind' | 'name' | 'connections' | 'updated' | 'author';

export interface GraphListViewProps {
  nodes: ReadonlyArray<SampleNode>;
  edges: ReadonlyArray<SampleEdge>;
  onPick: (node: SampleNode) => void;
  selectedId: string | null;
  search: string;
}

/**
 * Zone 7 — virtualized-feel table (no virtualizer dep — we cap to 200
 * rows by default and slice from the search-filtered set). Sortable
 * columns. Clicking a row selects + jumps to the node on the graph.
 */
export function GraphListView({ nodes, edges, onPick, selectedId, search }: GraphListViewProps) {
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'connections',
    dir: 'desc',
  });

  const degreeById = React.useMemo(() => {
    const m = new Map<string, number>();
    nodes.forEach((n) => m.set(n.id, 0));
    edges.forEach((e) => {
      m.set(e.source, (m.get(e.source) ?? 0) + 1);
      m.set(e.target, (m.get(e.target) ?? 0) + 1);
    });
    return m;
  }, [nodes, edges]);

  const q = search.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    if (!q) return nodes;
    return nodes.filter(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        n.kind.toLowerCase().includes(q) ||
        n.preview.toLowerCase().includes(q),
    );
  }, [nodes, q]);

  const sorted = React.useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av: number | string =
        sort.key === 'name'
          ? a.label
          : sort.key === 'kind'
            ? a.kind
            : sort.key === 'connections'
              ? degreeById.get(a.id) ?? 0
              : sort.key === 'updated'
                ? a.updatedAt
                : a.author.name;
      const bv: number | string =
        sort.key === 'name'
          ? b.label
          : sort.key === 'kind'
            ? b.kind
            : sort.key === 'connections'
              ? degreeById.get(b.id) ?? 0
              : sort.key === 'updated'
                ? b.updatedAt
                : b.author.name;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sort, degreeById]);

  const toggle = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  const header = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => toggle(key)}
      data-testid="list-sort"
      data-key={key}
      className={cn(
        'inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest',
        sort.key === key ? 'text-[var(--accent-primary)]' : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
      )}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
    </button>
  );

  return (
    <div
      className="thin-scrollbar h-full overflow-auto rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
      data-testid="graph-list-view"
    >
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)]">
          <tr className="border-b border-[var(--border-subtle)] text-left">
            <th className="px-3 py-2">{header('kind', 'Kind')}</th>
            <th className="px-3 py-2">{header('name', 'Name')}</th>
            <th className="px-3 py-2">{header('connections', 'Connections')}</th>
            <th className="px-3 py-2">{header('updated', 'Last activity')}</th>
            <th className="px-3 py-2">{header('author', 'Author')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 200).map((n) => {
            const degree = degreeById.get(n.id) ?? 0;
            const selected = selectedId === n.id;
            return (
              <tr
                key={n.id}
                onClick={() => onPick(n)}
                data-testid="list-row"
                data-id={n.id}
                className={cn(
                  'cursor-pointer border-b border-[var(--border-subtle)] transition-colors',
                  selected ? 'bg-[rgba(99,102,241,0.06)]' : 'hover:bg-[var(--bg-surface)]',
                )}
              >
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true">{KIND_ICON[n.kind]}</span>
                    <span
                      className="rounded-full px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                      style={{ color: KIND_COLOR[n.kind], background: `${KIND_COLOR[n.kind]}14` }}
                    >
                      {n.kind}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2 font-medium text-[var(--fg-primary)]">{n.label}</td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--fg-secondary)]">{degree}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-[var(--fg-tertiary)]">
                  {new Date(n.updatedAt).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--fg-secondary)]">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                      style={{ background: KIND_COLOR[n.kind] }}
                    >
                      {n.author.initials}
                    </span>
                    {n.author.name}
                  </span>
                </td>
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-10 text-center text-sm text-[var(--fg-tertiary)]">
                No nodes match &ldquo;{search}&rdquo;.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {sorted.length > 200 && (
        <p className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-center text-[11px] text-[var(--fg-tertiary)]">
          Showing 200 of {sorted.length}. Refine search to narrow.
        </p>
      )}
    </div>
  );
}