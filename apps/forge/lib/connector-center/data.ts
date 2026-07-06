/**
 * Connector Center (M2 — FORA-591) — async data seam.
 *
 * Replaces the sync `lib/connector-center/mock-data.ts` for live
 * rendering. Server components import the fetchers here; client
 * components use `useApiData` from `hooks/use-api-data.ts`.
 *
 * API endpoints (from `bin/orchestrator-stub.py`):
 *   GET /v1/connector-center/connectors     → Connector[]
 *   GET /v1/connector-center/marketplace    → MarketplaceConnector[]
 *   GET /v1/connector-center/sync-history   → SyncRecord[]
 */

import { ConnectorCategory, ConnectorHealthStatus } from '../connectors';

// Re-export the canonical ConnectorCategory and ConnectorHealthStatus
// from the connectors data module so consumers in both directories
// share the same type (the original lib/connector-center enum was
// missing 'monitoring' and 'paused'/'quarantined', which caused
// assignability errors in the marketplace + health tabs).
export type {
  ConnectorCategory,
  ConnectorHealthStatus,
} from '@/lib/connectors/data';

export interface Connector {
  id: string;
  name: string;
  displayName: string;
  category: ConnectorCategory;
  status: ConnectorHealthStatus;
  lastSyncAt: string;
  nextSyncAt: string;
  callCount24h: number;
  errorRate24h: number;
  scopes: ReadonlyArray<string>;
}

export interface MarketplaceConnector {
  id: string;
  name: string;
  displayName: string;
  category: ConnectorCategory;
  publisher: string;
  shortDescription: string;
  rating: number;
  installs: number;
}

export interface SyncRecord {
  id: string;
  connectorId: string;
  startedAt: string;
  finishedAt: string;
  status: 'success' | 'partial' | 'failed';
  recordsSynced: number;
  errorMessage?: string;
  triggeredBy: 'schedule' | 'manual' | 'webhook';
}

const BASE_URL =
  process.env.FORA_FORGE_API_URL ?? 'http://localhost:4000';

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** List connected connectors (the grid). */
export async function listConnectors(): Promise<ReadonlyArray<Connector>> {
  const rows = await getJson<Connector[]>('/v1/connector-center/connectors');
  return rows ?? [];
}

/** Single connector by id. */
export async function getConnector(
  id: string,
): Promise<Connector | undefined> {
  const rows = await listConnectors();
  return rows.find((c) => c.id === id);
}

/** Marketplace catalog (installable but not currently connected). */
export async function listMarketplace(): Promise<ReadonlyArray<MarketplaceConnector>> {
  const rows = await getJson<MarketplaceConnector[]>(
    '/v1/connector-center/marketplace',
  );
  return rows ?? [];
}

export async function getMarketplaceConnector(
  id: string,
): Promise<MarketplaceConnector | undefined> {
  const rows = await listMarketplace();
  return rows.find((m) => m.id === id);
}

/**
 * Sync history. When `connectorId` is provided the server returns the
 * full list; the page filters client-side today to keep the API
 * surface narrow. Future PRs may add a query param.
 */
export async function listSyncHistory(
  _connectorId?: string,
): Promise<ReadonlyArray<SyncRecord>> {
  const rows = await getJson<SyncRecord[]>('/v1/connector-center/sync-history');
  return rows ?? [];
}

export const CATEGORY_LABEL: Record<ConnectorCategory, string> = {
  'source-control': 'Source control',
  'project-mgmt': 'Project mgmt',
  design: 'Design',
  comms: 'Comms',
  cloud: 'Cloud',
  quality: 'Quality',
  data: 'Data',
};