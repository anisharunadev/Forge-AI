'use client';

import * as React from 'react';
import { ChevronRight, FileText } from 'lucide-react';

import { cn } from '@/lib/utils';
import { CATEGORY_LABEL, type Standard, type StandardCategory } from '@/lib/org-knowledge/data';

export interface StandardsBrowserProps {
  standards: ReadonlyArray<Standard>;
  selectedId?: string;
  onSelect: (standard: Standard) => void;
}

const STATUS_TONE: Record<Standard['status'], string> = {
  draft: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
  'in-review': 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  deprecated: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

export function StandardsBrowser({
  standards,
  selectedId,
  onSelect,
}: StandardsBrowserProps) {
  const grouped = React.useMemo(() => {
    const map = new Map<StandardCategory, Standard[]>();
    for (const s of standards) {
      const list = map.get(s.category) ?? [];
      list.push(s);
      map.set(s.category, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [standards]);

  return (
    <nav
      aria-label="Standards tree"
      data-testid="standards-browser"
      className="card overflow-hidden p-0"
    >
      <ul role="tree" className="divide-y divide-forge-800">
        {grouped.map(([category, items]) => (
          <li key={category} data-testid={`standards-group-${category}`}>
            <header className="flex items-center gap-2 bg-forge-800 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-forge-300">
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
              {CATEGORY_LABEL[category]}
              <span className="ml-auto font-mono text-forge-400">
                {items.length}
              </span>
            </header>
            <ul role="group">
              {items.map((s) => {
                const active = s.id === selectedId;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(s)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-forge-800/60',
                        active && 'bg-accent text-accent-foreground',
                      )}
                      data-testid={`standards-item-${s.id}`}
                      data-selected={String(active)}
                    >
                      <span className="inline-flex items-center gap-2">
                        <FileText className="h-3 w-3 text-forge-300" aria-hidden="true" />
                        {s.title}
                      </span>
                      <span
                        className={cn(
                          'rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                          STATUS_TONE[s.status],
                        )}
                      >
                        {s.status}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
