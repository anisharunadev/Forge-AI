'use client';

import * as React from 'react';
import { Database, Key, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DBSchema } from '@/lib/project-intelligence/data';

export interface DBMapViewerProps {
  schema: DBSchema;
}

export function DBMapViewer({ schema }: DBMapViewerProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="db-map-viewer" data-db={schema.name}>
      <p className="text-xs text-forge-300">
        Engine: <span className="font-mono">{schema.engine}</span> · {schema.tables.length} tables
      </p>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {schema.tables.map((t) => (
          <li
            key={`${t.schema}.${t.name}`}
            data-testid="db-table"
            data-table={t.name}
            className="card flex flex-col gap-2"
          >
            <header className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-forge-300" aria-hidden="true" />
                <h3 className="font-mono text-sm font-semibold">
                  {t.schema}.{t.name}
                </h3>
              </div>
              <span className="font-mono text-[10px] text-forge-300">
                {t.columns.length} cols
              </span>
            </header>
            <ul className="flex flex-col gap-0.5">
              {t.columns.map((c) => (
                <li
                  key={c.name}
                  className="flex items-center justify-between gap-2 rounded-sm border border-forge-700/40 bg-forge-900/30 px-2 py-1 text-xs"
                >
                  <div className="flex items-center gap-2">
                    {c.primaryKey ? (
                      <Key className="h-3 w-3 text-amber-300" aria-hidden="true" />
                    ) : (
                      <Circle className="h-2.5 w-2.5 text-forge-500" aria-hidden="true" />
                    )}
                    <span className="font-mono">{c.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-forge-300">{c.type}</span>
                    <span
                      className={cn(
                        'rounded-sm border px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide',
                        c.nullable
                          ? 'border-forge-700/40 bg-forge-800/40 text-forge-300'
                          : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
                      )}
                    >
                      {c.nullable ? 'NULL' : 'NOT NULL'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
