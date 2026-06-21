'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import type { NodeKind } from '@/lib/knowledge-center/data';

const COLOR: Record<NodeKind, string> = {
  Repo: '#2563eb',
  Service: '#059669',
  Component: '#0891b2',
  ADR: '#7c3aed',
  Idea: '#ea580c',
  Risk: '#dc2626',
  Task: '#ca8a04',
  Test: '#0d9488',
};

export interface GraphLegendProps {
  visibleKinds: ReadonlyArray<NodeKind>;
  onToggle?: (kind: NodeKind) => void;
}

const ALL_KINDS: ReadonlyArray<NodeKind> = [
  'Repo',
  'Service',
  'Component',
  'ADR',
  'Idea',
  'Risk',
  'Task',
  'Test',
];

export function GraphLegend({ visibleKinds, onToggle }: GraphLegendProps) {
  return (
    <ul
      aria-label="Node kinds"
      className="flex flex-wrap gap-2 text-xs"
      data-testid="graph-legend"
    >
      {ALL_KINDS.map((k) => {
        const active = visibleKinds.includes(k);
        return (
          <li key={k}>
            <button
              type="button"
              onClick={() => onToggle?.(k)}
              data-testid="legend-item"
              data-kind={k}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors',
                active
                  ? 'border-forge-300 bg-forge-800/60'
                  : 'border-forge-700/40 bg-forge-900/40 opacity-50 hover:opacity-80',
              )}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: COLOR[k] }}
                aria-hidden="true"
              />
              {k}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export { COLOR as NODE_COLOR };
