/**
 * Connector domain types — the wire-format the FastAPI backend
 * (`/api/v1/connectors/*` and `/api/v1/webhooks/*`) returns. These are
 * the canonical shapes consumed by the React Query hooks in
 * `lib/hooks/useConnectors.ts` and the Connector Center tabs.
 *
 * Step-55 wires the Connector Center to the real backend. The
 * in-memory shapes in `lib/connectors/data.ts` (the legacy mock layer
 * used through Step 31) continue to exist for offline / storybook
 * use; new components prefer the types exported here.
 */

import type { Connector, ConnectorSyncEvent, ConnectorCredential } from './data';

/**
 * Status of a connector's connection to the upstream system.
 * Mirrors the FastAPI `ConnectorStatus` enum.
 */
export type ConnectorStatus = 'connected' | 'disconnected' | 'error' | 'paused' | 'syncing';

/** Category of the upstream system a connector talks to. */
export type ConnectorCategoryBackend =
  | 'source-control'
  | 'project-mgmt'
  | 'comms'
  | 'cloud'
  | 'quality'
  | 'data'
  | 'design'
  | 'monitoring'
  | 'custom';

/** How the connector authenticates against the upstream system. */
export type ConnectorAuthType = 'oauth' | 'api-key' | 'pat' | 'webhook' | 'service-account' | 'none';

/** Wire-format `Connector` record returned by `GET /api/v1/connectors`. */
export interface ConnectorWire {
  id: string;
  tenant_id: string;
  project_id: string | null;
  slug: string;
  name: string;
  display_name: string;
  description: string;
  category: ConnectorCategoryBackend;
  icon: string;
  status: ConnectorStatus;

  /** Auth + connection. */
  auth_type: ConnectorAuthType;
  config: Record<string, unknown>;
  scopes: string[];

  /** Sync configuration + last result. */
  sync_enabled: boolean;
  sync_interval_minutes: number;
  last_sync_at: string | null;
  last_sync_status: 'ok' | 'error' | 'partial' | null;
  last_sync_records: number;

  /** Health counters (rolling 24h). */
  error_count_24h: number;
  success_count_24h: number;

  /** Metadata. */
  installed_at: string;
  installed_by: string;
  version: string;
  documentation_url?: string | null;
}

/** Wire-format item from `GET /api/v1/connectors/marketplace`. */
export interface ConnectorMarketplaceItem {
  slug: string;
  name: string;
  display_name: string;
  description: string;
  category: ConnectorCategoryBackend;
  icon: string;
  auth_type: ConnectorAuthType;

  /** Social proof. */
  install_count: number;
  rating: number;
  rating_count: number;

  /** Listing flags. */
  is_featured: boolean;
  is_official: boolean;

  screenshot_url?: string | null;
  documentation_url?: string | null;

  /** OAuth scope set + advertised capability tags. */
  required_scopes: string[];
  capabilities: string[];
}

/** Wire-format `ConnectorSyncEvent` returned by `GET /api/v1/connectors/activity`. */
export interface ConnectorSyncEventWire {
  id: string;
  connector_id: string;
  connector_slug: string;
  event_type: 'sync.started' | 'sync.completed' | 'sync.failed' | 'webhook.received' | 'config.updated' | 'auth.refreshed';
  status: 'ok' | 'error' | 'in-progress';
  records_processed: number;
  duration_ms: number;
  error_message?: string | null;
  started_at: string;
  completed_at: string | null;
}

/** Wire-format `ConnectorCredential` returned by `GET /api/v1/connectors/credentials`. */
export interface ConnectorCredentialWire {
  id: string;
  tenant_id: string;
  connector_id: string;
  name: string;
  type: 'api-key' | 'oauth-token' | 'pat' | 'webhook-secret' | 'service-account';
  scope: 'org' | 'project';
  preview: string;
  expires_at: string | null;
  last_rotated_at: string;
  last_used_at: string | null;
  rotation_reminder_days: number;
  created_by: string;
  created_at: string;
}

/** Wire-format `Webhook` returned by `GET /api/v1/webhooks`. */
export interface WebhookWire {
  id: string;
  tenant_id: string;
  name: string;
  direction: 'inbound' | 'outbound';
  url?: string | null;
  events: string[];
  auth_type: 'none' | 'basic' | 'bearer' | 'hmac' | 'signature';
  status: 'active' | 'paused' | 'failing';
  last_triggered_at: string | null;
  last_delivery_status: 'ok' | 'error' | null;
  success_count_24h: number;
  error_count_24h: number;
  created_at: string;
}

/** Wire-format `WebhookDelivery` returned by `GET /api/v1/webhooks/{id}/deliveries`. */
export interface WebhookDeliveryWire {
  id: string;
  webhook_id: string;
  event: string;
  status: 'ok' | 'error' | 'pending';
  response_code: number | null;
  duration_ms: number;
  attempted_at: string;
  payload_preview: string;
}

/** OAuth callback response shape. */
export interface OAuthCallbackResult {
  connector: ConnectorWire;
  redirect_to?: string;
}

/** Reveal-credential response shape — secret returned plain text. */
export interface RevealCredentialResult {
  id: string;
  secret: string;
  expires_at: string;
}

/** Webhook test ping response shape. */
export interface WebhookTestResult {
  status: 'ok' | 'error';
  response_code: number;
  message: string;
}

/**
 * Map a wire `Connector` to the legacy in-memory `Connector` shape used
 * by the existing UI (icons, groupby-by-category, etc.). Centralised
 * here so the Connector Center doesn't have to repeat the field
 * remapping in every consumer. The legacy `Connector` carries a rich
 * surface (credential blob, p95 latency, usedIn map, …) that the wire
 * shape doesn't carry; those fields are filled with safe defaults so
 * the existing UI keeps rendering without touching every consumer.
 */
export function wireToConnector(wire: ConnectorWire): Connector {
  const status: Connector['status'] =
    wire.status === 'connected'
      ? 'healthy'
      : wire.status === 'syncing'
        ? 'syncing'
        : wire.status === 'error'
          ? 'failed'
          : wire.status === 'paused'
            ? 'paused'
            : 'stale';

  const tagline = (wire.description ?? '').split('\n')[0]?.slice(0, 88) ?? '';
  const lastSyncAt = wire.last_sync_at ?? wire.installed_at;
  const isLive = wire.status !== 'disconnected';

  return {
    id: wire.id,
    name: wire.name,
    displayName: wire.display_name,
    publisher: 'Forge',
    tagline,
    description: wire.description,
    category: (wire.category as Connector['category']) ?? 'custom',
    scope: 'project',
    tier: 1,
    status,
    connectedAs: wire.installed_by,
    lastSyncAt,
    capabilities: [],
    health: { p50Ms: 0, p95Ms: 0, errorRate: 0 },
    credential: {
      id: `cred-${wire.id}`,
      name: `${wire.display_name} credential`,
      type: wire.auth_type === 'api-key' ? 'api_key' : wire.auth_type === 'oauth' ? 'oauth' : 'service_account',
      status: 'active',
      fingerprint: '',
      lastRotatedAt: wire.installed_at,
      rotatedBy: wire.installed_by,
      owner: { name: wire.installed_by, initials: wire.installed_by.slice(0, 2).toUpperCase() },
      scopes: wire.scopes,
      lengthChars: 0,
    },
    usage: {
      workflows: 0,
      destinations: 0,
      ideationSources: 0,
      agentContexts: 0,
      apiCallsToday: wire.success_count_24h,
      rateLimitUsed: 0,
      monthlyCostUsd: 0,
    },
    recentEvents: [],
    usedIn: { workflows: [], destinations: [], agents: [], ideationSources: [] },
    installed: isLive,
    available: true,
    featured: false,
    newThisMonth: false,
  };
}

/** Map a wire sync event to the legacy in-memory shape. */
export function wireToSyncEvent(wire: ConnectorSyncEventWire): ConnectorSyncEvent {
  return {
    id: wire.id,
    at: wire.started_at,
    eventType: wire.event_type.startsWith('sync.') ? 'pull' : 'webhook',
    entity: wire.event_type,
    records: wire.records_processed,
    durationMs: wire.duration_ms,
    status: wire.status === 'ok' ? 'success' : wire.status === 'in-progress' ? 'success' : 'failed',
    errorMessage: wire.error_message ?? undefined,
  };
}

/** Map a wire credential to the legacy in-memory shape. */
export function wireToCredential(wire: ConnectorCredentialWire): ConnectorCredential {
  return {
    id: wire.id,
    name: wire.name,
    type: wire.type === 'api-key'
      ? 'api_key'
      : wire.type === 'oauth-token'
        ? 'oauth'
        : wire.type === 'pat'
          ? 'service_account'
          : wire.type === 'webhook-secret'
            ? 'webhook'
            : 'service_account',
    scope: wire.scope,
    preview: wire.preview,
    lengthChars: 32,
    expiresAt: wire.expires_at ?? undefined,
    lastRotatedAt: wire.last_rotated_at,
    rotatedBy: wire.created_by,
    status: wire.expires_at && new Date(wire.expires_at).getTime() < Date.now()
      ? 'expired'
      : wire.expires_at && new Date(wire.expires_at).getTime() - Date.now() < 14 * 86_400_000
        ? 'expiring'
        : 'active',
  };
}

/**
 * Query-key factory. Single source of truth — keep cache invalidation
 * symmetrical with the `invalidateQueries({ queryKey: ... })` calls
 * inside the mutation hooks.
 */
export const connectorQueryKeys = {
  all: ['connectors'] as const,
  list: (status?: ConnectorStatus) => [...connectorQueryKeys.all, 'list', status ?? 'all'] as const,
  detail: (id: string) => [...connectorQueryKeys.all, 'detail', id] as const,
  marketplace: (category?: string) => [...connectorQueryKeys.all, 'marketplace', category ?? 'all'] as const,
  activity: (filters?: { connector_id?: string; event_type?: string; since?: string }) =>
    [...connectorQueryKeys.all, 'activity', filters ?? {}] as const,
  credentials: () => [...connectorQueryKeys.all, 'credentials'] as const,
  credential: (id: string) => [...connectorQueryKeys.all, 'credentials', id] as const,
  webhooks: (direction?: 'inbound' | 'outbound') =>
    [...connectorQueryKeys.all, 'webhooks', direction ?? 'all'] as const,
  webhookDeliveries: (webhookId: string) =>
    [...connectorQueryKeys.all, 'webhooks', webhookId, 'deliveries'] as const,
};