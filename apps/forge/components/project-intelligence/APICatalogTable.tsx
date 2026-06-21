'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { APIEndpoint } from '@/lib/project-intelligence/data';

const METHOD_TONE: Record<APIEndpoint['method'], string> = {
  GET: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  POST: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  PUT: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  PATCH: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  DELETE: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

const AUTH_TONE: Record<APIEndpoint['auth'], string> = {
  none: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
  api_key: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  oauth2: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  jwt: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
};

export interface APICatalogTableProps {
  endpoints: ReadonlyArray<APIEndpoint>;
  filter?: string;
}

export function APICatalogTable({ endpoints, filter }: APICatalogTableProps) {
  const filtered = React.useMemo(() => {
    if (!filter) return endpoints;
    const q = filter.toLowerCase();
    return endpoints.filter(
      (e) =>
        e.path.toLowerCase().includes(q) ||
        e.service.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q),
    );
  }, [endpoints, filter]);

  return (
    <div
      className="overflow-hidden rounded-md border border-forge-700/40"
      data-testid="api-catalog-table"
    >
      <table className="w-full text-sm">
        <thead className="bg-forge-900/40 text-left text-xs uppercase tracking-wider text-forge-300">
          <tr>
            <th className="px-3 py-2">Method</th>
            <th className="px-3 py-2">Path</th>
            <th className="px-3 py-2">Service</th>
            <th className="px-3 py-2">Auth</th>
            <th className="px-3 py-2">Description</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((e) => (
            <tr
              key={e.id}
              data-testid="api-catalog-row"
              data-endpoint-id={e.id}
              className="border-t border-forge-700/40"
            >
              <td className="px-3 py-2">
                <span
                  className={cn(
                    'inline-flex rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide',
                    METHOD_TONE[e.method],
                  )}
                >
                  {e.method}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{e.path}</td>
              <td className="px-3 py-2 font-mono text-xs">{e.service}</td>
              <td className="px-3 py-2">
                <Badge variant="outline" className="text-[10px]">
                  <span
                    className={cn(
                      'mr-1 inline-block h-1.5 w-1.5 rounded-full',
                      e.auth === 'none' ? 'bg-forge-400' : 'bg-blue-400',
                    )}
                    aria-hidden="true"
                  />
                  {e.auth}
                </Badge>
              </td>
              <td className="px-3 py-2 text-xs text-forge-200">{e.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
