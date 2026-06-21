'use client';

import * as React from 'react';
import { Plug, ShoppingBag, Stethoscope, History } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { ConnectorGrid } from '@/components/connector-center/ConnectorGrid';
import { ConnectorDetailPanel } from '@/components/connector-center/ConnectorDetailPanel';
import { MarketplaceGrid } from '@/components/connector-center/MarketplaceGrid';
import { AddConnectorDialog } from '@/components/connector-center/AddConnectorDialog';
import { HealthBadge } from '@/components/connector-center/HealthBadge';
import { SyncHistoryTable } from '@/components/connector-center/SyncHistoryTable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useApiData } from '@/hooks/use-api-data';
import type {
  Connector,
  ConnectorHealthStatus,
  MarketplaceConnector,
  SyncRecord,
} from '@/lib/connector-center/data';
import { listMarketplaceFromRegistry } from '@/lib/connector-center/mcp-adapter';

const STATUS_OPTIONS: ReadonlyArray<ConnectorHealthStatus | 'all'> = [
  'all',
  'healthy',
  'syncing',
  'stale',
  'failed',
  'quarantined',
];

export default function ConnectorCenterM2Page() {
  const [statusFilter, setStatusFilter] = React.useState<ConnectorHealthStatus | 'all'>(
    'all',
  );
  const [selected, setSelected] = React.useState<Connector | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);

  // Live data from the orchestrator proxy. Empty state surfaces an
  // info card when the API is unreachable.
  const connectorsQ = useApiData<Connector[]>('/v1/connector-center/connectors');
  const historyQ = useApiData<SyncRecord[]>('/v1/connector-center/sync-history');

  const connectors: ReadonlyArray<Connector> = connectorsQ.data ?? [];
  const history: ReadonlyArray<SyncRecord> = historyQ.data ?? [];

  // Marketplace is sourced from the MCP registry (real catalog of 13
  // servers). The orchestrator marketplace endpoint is the secondary
  // fallback when the registry is empty (e.g., during UI-only demos).
  const marketplaceFromRegistry = listMarketplaceFromRegistry();
  const [marketplaceFromApi, setMarketplaceFromApi] =
    React.useState<ReadonlyArray<MarketplaceConnector>>([]);
  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/proxy/v1/connector-center/marketplace', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ReadonlyArray<MarketplaceConnector>) => {
        if (!cancelled) setMarketplaceFromApi(rows);
      })
      .catch(() => {
        if (!cancelled) setMarketplaceFromApi([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const marketplace: ReadonlyArray<MarketplaceConnector> =
    marketplaceFromRegistry.length > 0
      ? marketplaceFromRegistry
      : marketplaceFromApi;

  const filteredConnectors = React.useMemo(() => {
    if (statusFilter === 'all') return connectors;
    return connectors.filter((c) => c.status === statusFilter);
  }, [connectors, statusFilter]);

  const healthBreakdown = React.useMemo(() => {
    const out: Record<ConnectorHealthStatus, number> = {
      healthy: 0,
      syncing: 0,
      stale: 0,
      failed: 0,
      quarantined: 0,
    };
    for (const c of connectors) out[c.status] += 1;
    return out;
  }, [connectors]);

  const handleSelect = (c: Connector) => {
    setSelected(c);
    setDetailOpen(true);
  };

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="connector-center-m2">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Center
          </p>
          <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Plug className="h-5 w-5" aria-hidden="true" />
              Connector Center
            </h1>
            <AddConnectorDialog
              onAdd={(input) => {
                // M2 — live wiring pending. Local-only acknowledgement.
                // eslint-disable-next-line no-console
                console.info('[connector-center] add', input);
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Manage integrations with external systems, browse the marketplace,
            and review connector health.
          </p>
        </header>

        <Tabs defaultValue="connected" className="w-full">
          <TabsList aria-label="Connector Center sections">
            <TabsTrigger value="connected" data-testid="tab-connected">
              Connected
            </TabsTrigger>
            <TabsTrigger value="marketplace" data-testid="tab-marketplace">
              <ShoppingBag className="h-3 w-3" aria-hidden="true" />
              Marketplace
            </TabsTrigger>
            <TabsTrigger value="health" data-testid="tab-health">
              <Stethoscope className="h-3 w-3" aria-hidden="true" />
              Health
            </TabsTrigger>
            <TabsTrigger value="activity" data-testid="tab-activity">
              <History className="h-3 w-3" aria-hidden="true" />
              Activity
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connected" className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Status:</span>
              <Select
                value={statusFilter}
                onValueChange={(v) =>
                  setStatusFilter(v as ConnectorHealthStatus | 'all')
                }
              >
                <SelectTrigger
                  className="w-40"
                  data-testid="connector-status-filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === 'all' ? 'All statuses' : s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ConnectorGrid connectors={filteredConnectors} onSelect={handleSelect} />
          </TabsContent>

          <TabsContent value="marketplace">
            <MarketplaceGrid
              connectors={marketplace}
              onInstall={(c: MarketplaceConnector) => {
                // M2 — install flow wired in a future PR.
                // eslint-disable-next-line no-console
                console.info('[connector-center] install', c.id);
              }}
            />
          </TabsContent>

          <TabsContent value="health" className="space-y-4">
            <div className="grid gap-3 md:grid-cols-5">
              {(Object.keys(healthBreakdown) as ReadonlyArray<ConnectorHealthStatus>).map(
                (k) => (
                  <div
                    key={k}
                    className="card flex items-center justify-between"
                    data-testid={`health-cell-${k}`}
                  >
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-forge-300">
                        {k}
                      </p>
                      <p className="text-2xl font-semibold text-forge-50">
                        {healthBreakdown[k]}
                      </p>
                    </div>
                    <HealthBadge status={k} />
                  </div>
                ),
              )}
            </div>
          </TabsContent>

          <TabsContent value="activity">
            <SyncHistoryTable records={history} />
          </TabsContent>
        </Tabs>

        <ConnectorDetailPanel
          connector={selected}
          open={detailOpen}
          onOpenChange={setDetailOpen}
        />
      </div>
    </AdminShell>
  );
}
