'use client';

/**
 * React Query hooks for the Connector Center — Step 55.
 *
 * These hooks wrap the typed fetchers in `lib/connectors/api.ts` with
 * the canonical TanStack Query `useQuery` / `useMutation` pattern
 * already used across the codebase (`useSeeds.ts`, `useSettings.ts`,
 * `useConnectorLifecycle.ts`).
 *
 * Architecture
 * ------------
 *   - `useConnectors(status?)`           — list query (30s poll)
 *   - `useConnector(id)`                 — single detail
 *   - `useMarketplace(category?)`        — marketplace catalog (5m stale)
 *   - `useConnectorActivity(filters?)`   — near-realtime feed (10s poll)
 *   - `useCredentials()`                 — vault list
 *   - `useWebhooks(direction?)`          — webhook list
 *   - `useWebhookDeliveries(id)`         — delivery audit
 *
 *   - `useInstallConnector()`            — installs a marketplace item
 *   - `useOAuthFlow()`                   — start + complete OAuth round-trip
 *   - `useDisconnectConnector()`         — removes an installation
 *   - `useUpdateConnectorConfig()`       — patches config
 *   - `useSyncConnector()`               — triggers a manual sync
 *
 *   - `useCreateCredential()` / `useRevealCredential()` /
 *     `useRotateCredential()` / `useRevokeCredential()`
 *
 *   - `useCreateWebhook()` / `useTestWebhook()`
 *
 * All hooks invalidate the appropriate query keys after a successful
 * mutation so the UI re-renders against fresh data without manual
 * refetch calls. Toast notifications confirm user-visible actions.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { toast } from '@/hooks/use-toast';

import * as api from '@/lib/connectors/api';
import {
  connectorQueryKeys,
  type ConnectorStatus,
  wireToConnector,
  wireToCredential,
  wireToSyncEvent,
  type Connector,
  type ConnectorCredentialWire,
  type ConnectorSyncEventWire,
  type ConnectorWire,
  type WebhookDeliveryWire,
} from '@/lib/connectors/types';
import {
  ConnectorApiError,
} from '@/lib/connectors/api';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** List connectors. Pass a status to narrow (e.g. 'connected'). */
export function useConnectors(status?: ConnectorStatus) {
  return useQuery({
    queryKey: connectorQueryKeys.list(status),
    queryFn: () => api.listConnectors(status ? { status } : undefined),
    // Poll every 30s so the Overview KPIs stay fresh without manual
    // refresh. The page renders instantly from the cache.
    refetchInterval: 30_000,
    staleTime: 15_000,
    // Convert wire → legacy `Connector` for downstream consumers.
    select: (rows: ConnectorWire[]) => rows.map(wireToConnector),
  });
}

/** Single connector detail. */
export function useConnector(id: string | null | undefined) {
  return useQuery({
    queryKey: connectorQueryKeys.detail(id ?? ''),
    queryFn: () => api.getConnector(id as string),
    enabled: Boolean(id),
    staleTime: 15_000,
    select: (wire: ConnectorWire) => wireToConnector(wire),
  });
}

/** Marketplace catalog. */
export function useMarketplace(params?: { category?: string; search?: string }) {
  return useQuery({
    queryKey: connectorQueryKeys.marketplace(params?.category),
    queryFn: () => api.listMarketplace(params),
    // Marketplace catalog is slow-moving — cache for 5 minutes.
    staleTime: 5 * 60_000,
  });
}

/** Live activity feed (10s poll). */
export function useConnectorActivity(filters?: {
  connector_id?: string;
  event_type?: string;
  since?: string;
}) {
  return useQuery({
    queryKey: connectorQueryKeys.activity(filters),
    queryFn: () => api.listActivity(filters),
    refetchInterval: 10_000,
    staleTime: 5_000,
    select: (rows: ConnectorSyncEventWire[]) => rows.map(wireToSyncEvent),
  });
}

/** Credentials vault list (no secrets — only preview metadata). */
export function useCredentials() {
  return useQuery({
    queryKey: connectorQueryKeys.credentials(),
    queryFn: () => api.listCredentials(),
    staleTime: 15_000,
    select: (rows: ConnectorCredentialWire[]) => rows.map(wireToCredential),
  });
}

/** Webhook list, optionally filtered by direction. */
export function useWebhooks(direction?: 'inbound' | 'outbound') {
  return useQuery({
    queryKey: connectorQueryKeys.webhooks(direction),
    queryFn: () => api.listWebhooks(direction ? { direction } : undefined),
    staleTime: 30_000,
  });
}

/** Delivery audit for a single webhook. */
export function useWebhookDeliveries(webhookId: string | null | undefined) {
  return useQuery({
    queryKey: connectorQueryKeys.webhookDeliveries(webhookId ?? ''),
    queryFn: () => api.listWebhookDeliveries(webhookId as string),
    enabled: Boolean(webhookId),
    staleTime: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Connector lifecycle mutations
// ---------------------------------------------------------------------------

/** Install a connector from the marketplace catalog. */
export function useInstallConnector() {
  const qc = useQueryClient();
  return useMutation<ConnectorWire, ConnectorApiError, api.InstallConnectorInput>({
    mutationFn: (input) => api.installConnector(input),
    onSuccess: (connector) => {
      void qc.invalidateQueries({ queryKey: connectorQueryKeys.all });
      toast({
        title: 'Connector installed',
        description: `${connector.display_name} is now connected.`,
      });
    },
    onError: (err) => {
      toast({
        title: 'Install failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * OAuth round-trip helpers. Two mutations:
 *   - `start()` — request the provider's authorize URL (server
 *     echoes back the CSRF `state`).
 *   - `complete()` — exchange the `code` returned by the redirect
 *     for a connected `ConnectorWire`.
 *
 * The Connector Center's marketplace tab calls `start()`, the OAuth
 * callback page calls `complete()`. We keep them as separate hooks so
 * the React Query cache keys don't fight (start vs complete have
 * different inputs).
 */
export function useStartOAuth() {
  return useMutation<api.OAuthStartResult, ConnectorApiError, { slug: string; redirectUri: string }>({
    mutationFn: ({ slug, redirectUri }) => api.startOAuth(slug, redirectUri),
  });
}

export function useCompleteOAuth() {
  const qc = useQueryClient();
  return useMutation<api.OAuthCallbackResult, ConnectorApiError, { code: string; state: string; slug: string }>({
    mutationFn: (input) => api.completeOAuth(input),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: connectorQueryKeys.all });
      toast({
        title: 'OAuth connected',
        description: `${result.connector.display_name} is now linked.`,
      });
    },
    onError: (err) => {
      toast({
        title: 'OAuth failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });
}

/** Disconnect (soft-delete) an installed connector. */
export function useDisconnectConnector() {
  const qc = useQueryClient();
  return useMutation<ConnectorWire, ConnectorApiError, string>({
    mutationFn: (id) => api.disconnectConnector(id),
    onSuccess: (_connector, id) => {
      void qc.invalidateQueries({ queryKey: connectorQueryKeys.all });
      void qc.invalidateQueries({ queryKey: connectorQueryKeys.detail(id) });
      toast({ title: 'Connector disconnected' });
    },
    onError: (err) => {
      toast({
        title: 'Disconnect failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });
}

/** Patch the connector's config / sync settings. */
export function useUpdateConnectorConfig() {
  const qc = useQueryClient();
  return useMutation<
    ConnectorWire,
    ConnectorApiError,
    { id: string } & Partial<Pick<ConnectorWire, 'config' | 'sync_enabled' | 'sync_interval_minutes' | 'scopes'>>
  >({
    mutationFn: ({ id, ...data }) => api.updateConnectorConfig(id, data),
    onSuccess: (connector, { id }) => {
      void qc.invalidateQueries({ queryKey: connectorQueryKeys.all });
      void qc.invalidateQueries({ queryKey: connectorQueryKeys.detail(id) });
      toast({
        title: 'Configuration saved',
        description: `${connector.display_name} updated.`,
      });
    },
    onError: (err) => {
      toast({
        title: 'Save failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });
}

/** Trigger a manual sync. */
export function useSyncConnector() {
  const qc = useQueryClient();
  return useMutation<{ job_id: string }, ConnectorApiError, string>({
    mutationFn: (id) => api.syncConnector(id),
    onSuccess: () => {
      toast({ title: 'Sync started', description: 'It will appear in the activity feed.' });
      // Refresh connector state and activity after a short delay so
      // the server has time to record the job.
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: connectorQueryKeys.all });
      }, 2_000);
    },
    onError: (err) => {
      toast({
        title: 'Sync failed to start',
        description: err.message,
        variant: 'destructive',
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Credentials vault mutations
// ---------------------------------------------------------------------------

/** Create a new credential (secret only sent once on the wire). */
export function useCreateCredential() {
  const qc = useQueryClient();
  return useMutation<ConnectorCredentialWire, ConnectorApiError, api.CreateCredentialInput>({
    mutationFn: (input) => api.createCredential(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: connectorQueryKeys.credentials() });
      toast({ title: 'Credential stored' });
    },
    onError: (err) => {
      toast({
        title: 'Create failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Reveal a credential's secret. Returns the plain-text secret — the
 * caller is responsible for showing it ephemerally (auto-hide after
 * 30s). The secret is never cached by React Query.
 */
export function useRevealCredential() {
  return useMutation<api.RevealCredentialResult, ConnectorApiError, string>({
    mutationFn: (id) => api.revealCredential(id),
    onError: (err) => {
      toast({
        title: 'Reveal failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });
}

/** Rotate (replace) a credential's secret. */
export function useRotateCredential() {
  const qc = useQueryClient();
  return useMutation<ConnectorCredentialWire, ConnectorApiError, { id: string; newSecret: string }>({
    mutationFn: ({ id, newSecret }) => api.rotateCredential(id, newSecret),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: connectorQueryKeys.credentials() });
      toast({ title: 'Credential rotated', description: 'Workflows using this credential will need to refresh.' });
    },
    onError: (err) => {
      toast({
        title: 'Rotate failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });
}

/** Revoke (hard-delete) a credential. */
export function useRevokeCredential() {
  const qc = useQueryClient();
  return useMutation<void, ConnectorApiError, string>({
    mutationFn: (id) => api.revokeCredential(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: connectorQueryKeys.credentials() });
      toast({ title: 'Credential revoked' });
    },
    onError: (err) => {
      toast({
        title: 'Revoke failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Webhook mutations
// ---------------------------------------------------------------------------

/** Create a new webhook. */
export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation<WebhookWire, ConnectorApiError, api.CreateWebhookInput>({
    mutationFn: (input) => api.createWebhook(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: connectorQueryKeys.webhooks() });
      toast({ title: 'Webhook created' });
    },
    onError: (err) => {
      toast({
        title: 'Create failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });
}

/** Send a test ping. */
export function useTestWebhook() {
  return useMutation<api.WebhookTestResult, ConnectorApiError, string>({
    mutationFn: (id) => api.testWebhook(id),
    onSuccess: (result) => {
      toast({
        title: result.status === 'ok' ? 'Webhook OK' : 'Webhook failed',
        description: result.message,
        variant: result.status === 'ok' ? 'default' : 'destructive',
      });
    },
    onError: (err) => {
      toast({
        title: 'Test failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });
}