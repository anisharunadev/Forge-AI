'use client';

import * as React from 'react';
import { FileText } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ApprovalStatusBadge } from './ApprovalStatusBadge';
import type { ADR } from '@/lib/architecture/data';

export interface ADRSidebarProps {
  adrs: ReadonlyArray<ADR>;
  selectedId?: string;
  onSelect?: (adr: ADR) => void;
}

export function ADRSidebar({ adrs, selectedId, onSelect }: ADRSidebarProps) {
  return (
    <aside
      aria-label="ADR list"
      className="flex h-full flex-col gap-2 overflow-y-auto rounded-lg border border-forge-700/40 bg-forge-900/30 p-3"
      data-testid="adr-sidebar"
    >
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
        ADRs ({adrs.length})
      </h2>
      <ul role="list" className="flex flex-col gap-1">
        {adrs.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onSelect?.(a)}
              data-testid="adr-sidebar-item"
              data-adr-id={a.id}
              className={cn(
                'flex w-full flex-col gap-1 rounded-md border p-2 text-left text-xs transition-colors',
                selectedId === a.id
                  ? 'border-forge-300 bg-forge-800/40'
                  : 'border-forge-700/40 hover:border-forge-500',
              )}
            >
              <div className="flex items-start gap-2">
                <FileText className="mt-0.5 h-3 w-3 shrink-0 text-forge-300" aria-hidden="true" />
                <span className="font-mono text-[10px] text-forge-300">
                  ADR-{String(a.number).padStart(4, '0')}
                </span>
              </div>
              <span className="line-clamp-2 text-sm font-medium text-forge-50">
                {a.title}
              </span>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-forge-400">
                  {a.owner}
                </span>
                <ApprovalStatusBadge status={a.status} />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
