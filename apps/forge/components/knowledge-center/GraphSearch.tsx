'use client';

import * as React from 'react';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import type { KGNode } from '@/lib/knowledge-center/data';

export interface GraphSearchProps {
  nodes: ReadonlyArray<KGNode>;
  onPick: (node: KGNode) => void;
}

export function GraphSearch({ nodes, onPick }: GraphSearchProps) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);

  const matches = React.useMemo(() => {
    if (query.trim().length === 0) return [];
    const q = query.toLowerCase();
    return nodes
      .filter(
        (n) => n.label.toLowerCase().includes(q) || n.kind.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [nodes, query]);

  return (
    <div
      className="relative w-72 max-w-full"
      data-testid="graph-search"
    >
      <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-forge-300" aria-hidden="true" />
      <Input
        value={query}
        placeholder="Search nodes…"
        className="pl-8"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        data-testid="graph-search-input"
      />
      {open && matches.length > 0 ? (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-forge-700/40 bg-forge-900/95 p-1 text-sm shadow-xl"
          data-testid="graph-search-results"
        >
          {matches.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(n);
                  setQuery(n.label);
                  setOpen(false);
                }}
                data-testid="graph-search-item"
                data-node-id={n.id}
                className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-left hover:bg-forge-800/60"
              >
                <span className="truncate">{n.label}</span>
                <span className="font-mono text-[10px] text-forge-300">{n.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
