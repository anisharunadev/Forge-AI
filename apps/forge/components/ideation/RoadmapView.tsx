'use client';

import { RoadmapItem } from './RoadmapItem';
import type {
  RoadmapColumn,
  RoadmapItem as RoadmapItemType,
} from '@/lib/ideation/data';

const COLUMNS: ReadonlyArray<{ key: RoadmapColumn; label: string }> = [
  { key: 'now', label: 'Now' },
  { key: 'next', label: 'Next' },
  { key: 'later', label: 'Later' },
  { key: 'future', label: 'Future' },
];

export interface RoadmapViewProps {
  items: ReadonlyArray<RoadmapItemType>;
  onSelect?: (item: RoadmapItemType) => void;
}

export function RoadmapView({ items, onSelect }: RoadmapViewProps) {
  return (
    <div
      className="grid grid-cols-1 gap-3 md:grid-cols-4"
      data-testid="roadmap-view"
    >
      {COLUMNS.map((col) => {
        const columnItems = items.filter((i) => i.column === col.key);
        return (
          <section
            key={col.key}
            aria-label={col.label}
            data-testid={`roadmap-column-${col.key}`}
            className="flex flex-col gap-2 rounded-lg border border-forge-700/40 bg-forge-900/20 p-3"
          >
            <header className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-forge-200">
                {col.label}
              </h3>
              <span className="rounded-sm bg-forge-800 px-1.5 py-0.5 font-mono text-[10px] text-forge-300">
                {columnItems.length}
              </span>
            </header>
            <div className="flex flex-col gap-2">
              {columnItems.length === 0 ? (
                <p className="text-xs text-forge-400">No items in this column.</p>
              ) : (
                columnItems.map((item) => (
                  <RoadmapItem key={item.id} item={item} onSelect={onSelect} />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
