'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { APIContract } from '@/lib/architecture/data';

const KIND_TONE: Record<APIContract['kind'], string> = {
  openapi: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  graphql: 'border-pink-500/40 bg-pink-500/10 text-pink-300',
  grpc: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  asyncapi: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
};

const STATUS_TONE: Record<APIContract['status'], string> = {
  draft: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
  published: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  deprecated: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

export interface APIContractListProps {
  contracts: ReadonlyArray<APIContract>;
  selectedId?: string;
  onSelect?: (contract: APIContract) => void;
}

export function APIContractList({
  contracts,
  selectedId,
  onSelect,
}: APIContractListProps) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-forge-700/40"
      data-testid="api-contract-list"
    >
      <table className="w-full text-sm">
        <thead className="bg-forge-900/40 text-left text-xs uppercase tracking-wider text-forge-300">
          <tr>
            <th className="px-3 py-2">Title</th>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Service</th>
            <th className="px-3 py-2">Version</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => (
            <tr
              key={c.id}
              onClick={() => onSelect?.(c)}
              data-testid="api-contract-row"
              data-contract-id={c.id}
              className={cn(
                'cursor-pointer border-t border-forge-700/40 transition-colors',
                selectedId === c.id
                  ? 'bg-forge-800/60'
                  : 'hover:bg-forge-900/60',
              )}
            >
              <td className="px-3 py-2 font-medium">{c.title}</td>
              <td className="px-3 py-2">
                <span
                  className={cn(
                    'inline-flex rounded-sm border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide',
                    KIND_TONE[c.kind],
                  )}
                >
                  {c.kind}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{c.service}</td>
              <td className="px-3 py-2 font-mono text-xs">{c.version}</td>
              <td className="px-3 py-2">
                <Badge variant="outline" className="text-[10px]">
                  <span
                    className={cn(
                      'mr-1 inline-block h-1.5 w-1.5 rounded-full',
                      c.status === 'published'
                        ? 'bg-emerald-400'
                        : c.status === 'draft'
                          ? 'bg-amber-400'
                          : 'bg-rose-400',
                    )}
                    aria-hidden="true"
                  />
                  {c.status}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
