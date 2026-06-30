'use client';

/**
 * Connector API client — typed fetchers for `/api/v1/connectors/*` and
 * `/api/v1/webhooks/*`. Step-55 wires the Connector Center to the real
 * FastAPI backend; this file is the single seam between the React
 * Query hooks and the wire-format payloads.
 *
 * Design notes
 * ------------
 *   - The base URL is read from `NEXT_PUBLIC_FORGE_API_URL` in the
 *     browser, or the existing `FORA_FORGE_API_URL` on the server.
 *     This matches the convention in `lib/api.ts` (orchestrator
 *     client). Falls back to `http://localhost:8000` which is the
 *     FastAPI dev port — same default used by `docker-compose.yml`.
 *   - Every mutating call carries a fresh `Idempotency-Key` so the
 *     orchestrator's audit log records the operator's click and the
 *     server can dedupe accidental retries.
 *   - Errors are surfaced as `ConnectorApiError` so React Query
 *     consumers can pattern-match status codes (e.g. distinguish
 *     `404` from a transport failure).
 */

import { DEV_TENANT_UUID } from '@/config/dev-seeds';

import type {
  ConnectorCredentialWire,
  ConnectorMarketplaceItem,
  ConnectorSyncEventWire,
  ConnectorWire,
  OAuthCallbackResult,
  RevealCredentialResult,
  WebhookDeliveryWire,
  WebhookTestResult,
  WebhookWire,
} from './types';

const ENV_BASE =
  process.env.NEXT_PUBLIC_FORGE_API_URL ?? process.env.FORA_FORGE_API_URL;

const BASE_URL = ENV_BASE ?? 'http://localhost:8000';

export class ConnectorApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ConnectorApiError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('x-forge-tenant-id')) {
    headers.set('x-forge-tenant-id', DEV_TENANT_UUID);
  }
  if (init.idempotencyKey) {
    headers.set('Idempotency-Key', init.idempotencyKey);
  }
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...init, headers, cache: 'no-store' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConnectorApiError(`connector API unreachable: ${message}`, 0, null);
  }

  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body — keep as text */
  }

  if (!res.ok) {
    const message =
      typeof body === 'object' && body !== null && 'detail' in body
        ? String((body as { detail: unknown }).detail)
        : `connector API returned ${res.status}`;
    throw new ConnectorApiError(message, res.status, body);
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

export interface ListConnectorsParams {
  status?: 'connected' | 'disconnected' | 'error' | 'paused' | 'syncing';
  project_id?: string;
}

export function listConnectors(params?: ListConnectorsParams): Promise<ConnectorWire[]> {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.project_id) search.set('project_id', params.project_id);
  const qs = search.toString();
  return request<ConnectorWire[]>(`/api/v1/connectors${qs ? `?${qs}` : ''}`);
}

export function getConnector(id: string): Promise<ConnectorWire> {
  return request<ConnectorWire>(`/api/v1/connectors/${encodeURIComponent(id)}`);
}

export interface InstallConnectorInput {
  slug: string;
  /** Display name (required by the backend's connector row). */
  name?: string;
  config?: Record<string, unknown>;
  scopes?: string[];
  /** OAuth `code` returned by the upstream provider redirect. */
  code?: string;
  /** OAuth `state` for CSRF validation on the backend. */
  state?: string;
}

export function installConnector(input: InstallConnectorInput): Promise<ConnectorWire> {
  const key = crypto.randomUUID();
  // Step-55-v2 Zone 2 — backend resolves slug→type via the marketplace
  // catalog. Falls back to the body shape used by /marketplace/connectors
  // /{slug}/install so OAuth callbacks can re-use this client.
  return request<ConnectorWire>('/api/v1/connectors/install', {
    method: 'POST',
    idempotencyKey: key,
    body: JSON.stringify({
      slug: input.slug,
      name: input.name ?? input.slug,
      config: input.config ?? {},
      ...(input.scopes ? { scopes: input.scopes } : {}),
      ...(input.code ? { code: input.code } : {}),
      ...(input.state ? { state: input.state } : {}),
    }),
  });
}

export function disconnectConnector(id: string): Promise<ConnectorWire> {
  const key = crypto.randomUUID();
  return request<ConnectorWire>(
    `/api/v1/connectors/${encodeURIComponent(id)}/disconnect`,
    { method: 'POST', idempotencyKey: key },
  );
}

export function updateConnectorConfig(
  id: string,
  data: Partial<Pick<ConnectorWire, 'config' | 'sync_enabled' | 'sync_interval_minutes' | 'scopes'>>,
): Promise<ConnectorWire> {
  return request<ConnectorWire>(`/api/v1/connectors/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function syncConnector(id: string): Promise<{ job_id: string }> {
  const key = crypto.randomUUID();
  return request<{ job_id: string }>(
    `/api/v1/connectors/${encodeURIComponent(id)}/sync`,
    { method: 'POST', idempotencyKey: key },
  );
}

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------

export interface ListMarketplaceParams {
  category?: string;
  search?: string;
}

export function listMarketplace(params?: ListMarketplaceParams): Promise<ConnectorMarketplaceItem[]> {
  const search = new URLSearchParams();
  if (params?.category && params.category !== 'all') search.set('category', params.category);
  if (params?.search) search.set('q', params.search);
  const qs = search.toString();
  // Step-55-v2 Zone 2 — backend exposes the catalog under
  // /api/v1/marketplace/connectors (the original /connectors/marketplace
  // path was a frontend-only convention that no backend route served).
  return request<ConnectorMarketplaceItem[]>(
    `/api/v1/marketplace/connectors${qs ? `?${qs}` : ''}`,
  );
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export interface ListActivityParams {
  connector_id?: string;
  event_type?: string;
  since?: string;
}

export function listActivity(params?: ListActivityParams): Promise<ConnectorSyncEventWire[]> {
  const search = new URLSearchParams();
  if (params?.connector_id) search.set('connector_id', params.connector_id);
  if (params?.event_type) search.set('event_type', params.event_type);
  if (params?.since) search.set('since', params.since);
  const qs = search.toString();
  return request<ConnectorSyncEventWire[]>(
    `/api/v1/connectors/activity${qs ? `?${qs}` : ''}`,
  );
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export interface OAuthStartResult {
  /** URL the browser should redirect to (provider consent screen). */
  authorize_url: string;
  /** Echoed back so the callback page can cross-check CSRF state. */
  state: string;
}

export function startOAuth(slug: string, redirectUri: string): Promise<OAuthStartResult> {
  const search = new URLSearchParams({
    slug,
    redirect_uri: redirectUri,
  });
  return request<OAuthStartResult>(`/api/v1/connectors/oauth/start?${search.toString()}`);
}

export function completeOAuth(input: {
  code: string;
  state: string;
  slug: string;
}): Promise<OAuthCallbackResult> {
  return request<OAuthCallbackResult>('/api/v1/connectors/oauth/callback', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Credentials vault
// ---------------------------------------------------------------------------

export function listCredentials(): Promise<ConnectorCredentialWire[]> {
  return request<ConnectorCredentialWire[]>('/api/v1/connectors/credentials');
}

export interface CreateCredentialInput {
  connector_id: string;
  name: string;
  type: ConnectorCredentialWire['type'];
  scope?: 'org' | 'project';
  /** Plain-text secret — sent only on create/rotate. Never stored client-side. */
  secret: string;
  expires_at?: string | null;
  rotation_reminder_days?: number;
}

export function createCredential(input: CreateCredentialInput): Promise<ConnectorCredentialWire> {
  const key = crypto.randomUUID();
  return request<ConnectorCredentialWire>('/api/v1/connectors/credentials', {
    method: 'POST',
    idempotencyKey: key,
    body: JSON.stringify(input),
  });
}

export function revealCredential(id: string): Promise<RevealCredentialResult> {
  const key = crypto.randomUUID();
  return request<RevealCredentialResult>(
    `/api/v1/connectors/credentials/${encodeURIComponent(id)}/reveal`,
    { method: 'POST', idempotencyKey: key },
  );
}

export function rotateCredential(
  id: string,
  newSecret: string,
): Promise<ConnectorCredentialWire> {
  const key = crypto.randomUUID();
  return request<ConnectorCredentialWire>(
    `/api/v1/connectors/credentials/${encodeURIComponent(id)}/rotate`,
    {
      method: 'POST',
      idempotencyKey: key,
      body: JSON.stringify({ secret: newSecret }),
    },
  );
}

export function revokeCredential(id: string): Promise<void> {
  const key = crypto.randomUUID();
  return request<void>(`/api/v1/connectors/credentials/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    idempotencyKey: key,
  });
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface ListWebhooksParams {
  direction?: 'inbound' | 'outbound';
}

export function listWebhooks(params?: ListWebhooksParams): Promise<WebhookWire[]> {
  const search = new URLSearchParams();
  if (params?.direction) search.set('direction', params.direction);
  const qs = search.toString();
  return request<WebhookWire[]>(`/api/v1/webhooks${qs ? `?${qs}` : ''}`);
}

export interface CreateWebhookInput {
  name: string;
  direction: 'inbound' | 'outbound';
  url?: string;
  events: string[];
  auth_type: WebhookWire['auth_type'];
  auth_secret?: string;
}

export function createWebhook(input: CreateWebhookInput): Promise<WebhookWire> {
  const key = crypto.randomUUID();
  return request<WebhookWire>('/api/v1/webhooks', {
    method: 'POST',
    idempotencyKey: key,
    body: JSON.stringify(input),
  });
}

export function testWebhook(id: string): Promise<WebhookTestResult> {
  const key = crypto.randomUUID();
  return request<WebhookTestResult>(
    `/api/v1/webhooks/${encodeURIComponent(id)}/test`,
    { method: 'POST', idempotencyKey: key },
  );
}

export function listWebhookDeliveries(id: string): Promise<WebhookDeliveryWire[]> {
  return request<WebhookDeliveryWire[]>(
    `/api/v1/webhooks/${encodeURIComponent(id)}/deliveries`,
  );
}