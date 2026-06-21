'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { RoadmapItem as RoadmapItemType } from '@/lib/ideation/data';

const EFFORT_TONE: Record<RoadmapItemType['effort'], string> = {
  S: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  M: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  L: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

export interface RoadmapItemProps {
  item: RoadmapItemType;
  onSelect?: (item: RoadmapItemType) => void;
}

export function RoadmapItem({ item, onSelect }: RoadmapItemProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(item)}
      data-testid="roadmap-item"
      data-item-id={item.id}
      data-column={item.column}
      className={cn(
        'flex w-full flex-col gap-2 rounded-md border border-forge-700/40 bg-forge-900/40 p-3 text-left text-sm transition-colors',
        'hover:border-forge-500 hover:bg-forge-800/40 focus:outline-none focus:ring-2 focus:ring-ring',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium leading-snug">{item.title}</span>
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold',
            EFFORT_TONE[item.effort],
          )}
          aria-label={`Effort ${item.effort}`}
        >
          {item.effort}
        </span>
      </div>
      <div className="flex items-center justify-between text-[11px] text-forge-300">
        <span>{item.owner}</span>
        <span className="font-mono">{item.quarter}</span>
      </div>
    </button>
  );
}
