'use client';

import * as React from 'react';
import { Cloud, AlertTriangle, CheckCircle2, Clock, PlugZap } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ModelProvider, ProviderStatus } from '@/lib/agent-center/data';

const STATUS_TONE: Record<ProviderStatus, string> = {
  connected: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  'rate-limited': 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  error: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  pending: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
};

const STATUS_ICON: Record<ProviderStatus, React.ComponentType<{ className?: string }>> = {
  connected: CheckCircle2,
  'rate-limited': AlertTriangle,
  error: AlertTriangle,
  pending: Clock,
};

export interface ModelProviderCardProps {
  provider: ModelProvider;
}

export function ModelProviderCard({ provider }: ModelProviderCardProps) {
  const Icon = STATUS_ICON[provider.status];
  return (
    <article
      className="card space-y-3"
      data-testid="provider-card"
      data-provider-id={provider.id}
      data-provider-status={provider.status}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-forge-700 bg-forge-800 text-forge-200">
            <Cloud className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-semibold leading-tight">
              {provider.displayName}
            </h3>
            <p className="font-mono text-xs text-forge-300">
              {provider.region} · {provider.defaultModel}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            STATUS_TONE[provider.status],
          )}
          aria-label={`Status: ${provider.status}`}
        >
          <Icon className="h-3 w-3" aria-hidden="true" />
          {provider.status}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-forge-300">Models</dt>
        <dd className="text-forge-100">{provider.models.length}</dd>
        <dt className="text-forge-300">Cost / 1k tok</dt>
        <dd className="font-mono text-forge-100">${provider.costPer1kTokensUsd.toFixed(4)}</dd>
        <dt className="text-forge-300">Error rate (24h)</dt>
        <dd className="font-mono text-forge-100">
          {(provider.errorRate24h * 100).toFixed(1)}%
        </dd>
        <dt className="text-forge-300">Calls (24h)</dt>
        <dd className="font-mono text-forge-100">{provider.calls24h}</dd>
      </dl>

      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-forge-300">
        <PlugZap className="h-3 w-3" aria-hidden="true" />
        {provider.models.join(' · ')}
      </div>
    </article>
  );
}
