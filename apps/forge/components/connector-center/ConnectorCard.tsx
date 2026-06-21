'use client';

import * as React from 'react';
import { Plug, Activity, Clock } from 'lucide-react';

import { HealthBadge } from '@/components/connector-center/HealthBadge';
import { CATEGORY_LABEL, type Connector } from '@/lib/connector-center/data';

export interface ConnectorCardProps {
  connector: Connector;
  onSelect?: (connector: Connector) => void;
}

function fmtRelative(iso: string): string {
  const ms = Date.parse(iso) - Date.parse('2026-06-21T09:30:00Z');
  const abs = Math.abs(ms);
  if (abs < 60_000) return 'just now';
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ago`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ago`;
  return `${Math.round(abs / 86_400_000)}d ago`;
}

export function ConnectorCard({ connector, onSelect }: ConnectorCardProps) {
  const c = connector;
  return (
    <article
      className="card flex flex-col gap-3"
      data-testid="connector-card"
      data-connector-id={c.id}
      data-connector-status={c.status}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-forge-700 bg-forge-800 text-forge-200">
            <Plug className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-semibold leading-tight">
              {c.displayName}
            </h3>
            <p className="text-[10px] uppercase tracking-wider text-forge-300">
              {CATEGORY_LABEL[c.category]}
            </p>
          </div>
        </div>
        <HealthBadge status={c.status} />
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="inline-flex items-center gap-1 text-forge-300">
          <Clock className="h-3 w-3" aria-hidden="true" />
          Last sync
        </dt>
        <dd className="font-mono text-forge-100">{fmtRelative(c.lastSyncAt)}</dd>
        <dt className="inline-flex items-center gap-1 text-forge-300">
          <Activity className="h-3 w-3" aria-hidden="true" />
          Calls (24h)
        </dt>
        <dd className="font-mono text-forge-100">
          {c.callCount24h.toLocaleString()}
        </dd>
        <dt className="text-forge-300">Error rate</dt>
        <dd className="font-mono text-forge-100">
          {(c.errorRate24h * 100).toFixed(1)}%
        </dd>
        <dt className="text-forge-300">Scopes</dt>
        <dd className="font-mono text-forge-100">{c.scopes.length}</dd>
      </dl>

      <footer className="flex items-center justify-between border-t border-forge-800 pt-2 text-[10px]">
        <span className="font-mono text-forge-300">{c.id}</span>
        <button
          type="button"
          onClick={() => onSelect?.(c)}
          className="rounded-sm border border-forge-700 bg-forge-800 px-2 py-0.5 font-medium text-forge-50 hover:border-forge-500"
          data-testid="connector-card-open"
        >
          Open →
        </button>
      </footer>
    </article>
  );
}
