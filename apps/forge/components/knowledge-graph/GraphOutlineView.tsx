'use client';

import * as React from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { KIND_COLOR, KIND_ICON } from './graph-palette';
import type { NodeKind, SampleNode } from '@/src/data/sample-graph';

export interface GraphOutlineViewProps {
  nodes: ReadonlyArray<SampleNode>;
  onPick: (node: SampleNode) => void;
  selectedId: string | null;
}

/**
 * Zone 7 — hierarchical outline view: Kind → Author → Node.
 * Each branch is collapsible. Right-click context menu hooks into the
 * page-level handler.
 */
export function GraphOutlineView({ nodes, onPick, selectedId }: GraphOutlineViewProps) {
  // Group by kind, then by author.
  const tree = React.useMemo(() => {
    const byKind = new Map<NodeKind, Map<string, SampleNode[]>>();
    for (const n of nodes) {
      let byAuthor = byKind.get(n.kind);
      if (!byAuthor) {
        byAuthor = new Map();
        byKind.set(n.kind, byAuthor);
      }
      const list = byAuthor.get(n.author.name) ?? [];
      list.push(n);
      byAuthor.set(n.author.name, list);
    }
    return byKind;
  }, [nodes]);

  // Open state — by default everything is collapsed one level (just kinds).
  const [openKinds, setOpenKinds] = React.useState<ReadonlySet<NodeKind>>(
    () => new Set([nodes[0]?.kind].filter(Boolean) as NodeKind[]),
  );
  const [openAuthors, setOpenAuthors] = React.useState<ReadonlySet<string>>(new Set());

  return (
    <div
      className="thin-scrollbar h-full overflow-auto rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2"
      data-testid="graph-outline-view"
    >
      {Array.from(tree.entries()).map(([kind, byAuthor]) => {
        const kindOpen = openKinds.has(kind);
        return (
          <div key={kind} className="mb-1">
            <button
              type="button"
              onClick={() => {
                setOpenKinds((curr) => {
                  const next = new Set(curr);
                  if (next.has(kind)) next.delete(kind);
                  else next.add(kind);
                  return next;
                });
              }}
              data-testid="outline-kind"
              data-kind={kind}
              className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm font-semibold text-[var(--fg-primary)] hover:bg-[var(--bg-surface)]"
            >
              {kindOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
              )}
              <span aria-hidden="true">{KIND_ICON[kind]}</span>
              <span style={{ color: KIND_COLOR[kind] }}>{kind}</span>
              <span className="ml-auto font-mono text-[10px] text-[var(--fg-tertiary)]">
                {Array.from(byAuthor.values()).reduce((a, b) => a + b.length, 0)}
              </span>
            </button>

            {kindOpen && (
              <div className="ml-4 border-l border-[var(--border-subtle)] pl-3">
                {Array.from(byAuthor.entries()).map(([author, list]) => {
                  const key = `${kind}::${author}`;
                  const authorOpen = openAuthors.has(key);
                  return (
                    <div key={key} className="my-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenAuthors((curr) => {
                            const next = new Set(curr);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          });
                        }}
                        className="flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-left text-xs text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
                      >
                        {authorOpen ? (
                          <ChevronDown className="h-3 w-3 text-[var(--fg-tertiary)]" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-[var(--fg-tertiary)]" aria-hidden="true" />
                        )}
                        {author}
                        <span className="ml-auto font-mono text-[10px] text-[var(--fg-tertiary)]">{list.length}</span>
                      </button>

                      {authorOpen && (
                        <ul className="ml-4 border-l border-[var(--border-subtle)] pl-2">
                          {list.map((n) => {
                            const selected = selectedId === n.id;
                            return (
                              <li key={n.id}>
                                <button
                                  type="button"
                                  onClick={() => onPick(n)}
                                  data-testid="outline-node"
                                  data-id={n.id}
                                  className={cn(
                                    'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left text-xs',
                                    selected
                                      ? 'bg-[rgba(99,102,241,0.08)] text-[var(--accent-primary)]'
                                      : 'text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]',
                                  )}
                                >
                                  <span
                                    aria-hidden="true"
                                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                                    style={{ background: KIND_COLOR[kind] }}
                                  />
                                  {n.label}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {tree.size === 0 && (
        <p className="p-6 text-center text-sm text-[var(--fg-tertiary)]">No nodes to outline.</p>
      )}
    </div>
  );
}