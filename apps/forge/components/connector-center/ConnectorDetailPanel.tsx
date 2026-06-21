'use client';

import * as React from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { HealthBadge } from '@/components/connector-center/HealthBadge';
import { SyncHistoryTable } from '@/components/connector-center/SyncHistoryTable';
import { useApiData } from '@/hooks/use-api-data';
import {
  CATEGORY_LABEL,
  type Connector,
  type SyncRecord,
} from '@/lib/connector-center/data';

export interface ConnectorDetailPanelProps {
  connector: Connector | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectorDetailPanel({
  connector,
  open,
  onOpenChange,
}: ConnectorDetailPanelProps) {
  // Pull the latest sync history; client-filter to the selected
  // connector. Renders an empty table on miss so the panel never
  // blocks on a stale snapshot.
  const historyQ = useApiData<SyncRecord[]>('/v1/connector-center/sync-history');
  const history: ReadonlyArray<SyncRecord> = historyQ.data ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 sm:max-w-2xl"
        data-testid="connector-detail-panel"
      >
        {connector ? (
          <>
            <SheetHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SheetTitle>{connector.displayName}</SheetTitle>
                  <SheetDescription>
                    <span className="font-mono text-xs">{connector.id}</span>
                    {' · '}
                    {CATEGORY_LABEL[connector.category]}
                  </SheetDescription>
                </div>
                <HealthBadge status={connector.status} />
              </div>
            </SheetHeader>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-forge-300">
                Config
              </h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-forge-300">Last sync</dt>
                <dd className="font-mono text-forge-100">{connector.lastSyncAt}</dd>
                <dt className="text-forge-300">Next sync</dt>
                <dd className="font-mono text-forge-100">{connector.nextSyncAt}</dd>
                <dt className="text-forge-300">Calls (24h)</dt>
                <dd className="font-mono text-forge-100">
                  {connector.callCount24h.toLocaleString()}
                </dd>
                <dt className="text-forge-300">Error rate</dt>
                <dd className="font-mono text-forge-100">
                  {(connector.errorRate24h * 100).toFixed(1)}%
                </dd>
              </dl>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-forge-300">
                Granted scopes
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {connector.scopes.map((s) => (
                  <span
                    key={s}
                    className="rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-200"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-forge-300">
                Sync history
              </h3>
              <SyncHistoryTable
                records={history.filter((s) => s.connectorId === connector.id).slice(0, 10)}
              />
            </section>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-forge-300">
            Select a connector to view details.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
