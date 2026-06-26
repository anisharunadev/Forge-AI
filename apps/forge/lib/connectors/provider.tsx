/**
 * Connector Provider — cross-cutting connector context for the entire app.
 *
 * Wraps the app so any page can:
 *   - pick a connector with `<ConnectorPicker capability="send_message" />`
 *   - trigger a connector action with `<ConnectorActionButton />`
 *   - show a small live health dot with `<ConnectorHealthIndicator />`
 *   - show "Connect X to use this" with `<ConnectorCredentialsBadge />`
 *
 * Real backend calls are not required for the spec — these all read from
 * the in-memory `CONNECTORS` dataset and dispatch no-op actions. The seam
 * (`invoke()`) is shaped so a future PR can wire it to the real
 * orchestrator endpoint without touching consumers.
 */

'use client';

import * as React from 'react';

import {
  CONNECTORS,
  computeRollup,
  listConnected,
  listByCapability,
  type Connector,
  type ConnectorCapability,
  type ConnectorHealthStatus,
} from './data';

export interface ConnectorInvokeRequest {
  readonly connectorId: string;
  readonly action: string;          // e.g. 'send_message', 'pull_issues'
  readonly params: Readonly<Record<string, unknown>>;
}

export interface ConnectorInvokeResult {
  readonly ok: boolean;
  readonly message: string;
  readonly durationMs: number;
  readonly records?: number;
}

interface ConnectorContextValue {
  readonly connectors: ReadonlyArray<Connector>;
  readonly installed: ReadonlyArray<Connector>;
  /** Look up a connector by id. */
  readonly get: (id: string) => Connector | undefined;
  /** Pick installed connectors that support a capability. */
  readonly byCapability: (cap: ConnectorCapability) => ReadonlyArray<Connector>;
  /** Mock-invoke a connector action. */
  readonly invoke: (req: ConnectorInvokeRequest) => Promise<ConnectorInvokeResult>;
  /** Live rollup used by Overview KPIs. */
  readonly rollup: ReturnType<typeof computeRollup>;
  /** Live snapshot of the most recent N events across all connectors. */
  readonly liveEvents: ReadonlyArray<{
    connectorId: string;
    connectorName: string;
    at: string;
    label: string;
    status: ConnectorHealthStatus;
  }>;
}

const ConnectorContext = React.createContext<ConnectorContextValue | null>(null);

export interface ConnectorProviderProps {
  readonly children: React.ReactNode;
  /** Override the connector dataset (useful for tests or API-backed data). */
  readonly overrides?: ReadonlyArray<Connector>;
}

/**
 * `<ConnectorProvider>` — wraps the app at the layout level. The default
 * layout (`apps/forge/app/layout.tsx`) already wraps in `<AdminShell>`,
 * so this provider is exposed via the `useConnectors()` hook and is safe
 * to mount near the top of any page tree.
 */
export function ConnectorProvider({ children, overrides }: ConnectorProviderProps) {
  const connectors = overrides ?? CONNECTORS;
  const installed = React.useMemo(() => connectors.filter((c) => c.installed), [connectors]);

  const get = React.useCallback(
    (id: string) => connectors.find((c) => c.id === id),
    [connectors],
  );
  const byCapability = React.useCallback(
    (cap: ConnectorCapability) =>
      connectors.filter((c) => c.installed && c.capabilities.includes(cap)),
    [connectors],
  );

  const invoke = React.useCallback(
    async (req: ConnectorInvokeRequest): Promise<ConnectorInvokeResult> => {
      // Mock execution: simulate latency + occasional failure so the
      // action surfaces feedback per skill rule "Loading → success/error".
      const delay = 380 + Math.round(Math.random() * 380);
      await new Promise((r) => setTimeout(r, delay));
      const ok = Math.random() > 0.08;
      return {
        ok,
        message: ok
          ? `${req.action} succeeded via ${req.connectorId}`
          : `${req.action} failed — connector returned 5xx`,
        durationMs: delay,
        records: ok ? 1 + Math.round(Math.random() * 5) : 0,
      };
    },
    [],
  );

  const rollup = React.useMemo(() => computeRollup(), []);

  const liveEvents = React.useMemo(() => {
    const out: ConnectorContextValue['liveEvents'][number][] = [];
    for (const c of installed) {
      for (const e of c.recentEvents.slice(0, 3)) {
        out.push({
          connectorId: c.id,
          connectorName: c.displayName,
          at: e.at,
          label: `${e.eventType.toUpperCase()} · ${e.entity}`,
          status: e.status === 'failed' ? 'failed' : c.status,
        });
      }
    }
    return out
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 30);
  }, [installed]);

  const value = React.useMemo<ConnectorContextValue>(
    () => ({ connectors, installed, get, byCapability, invoke, rollup, liveEvents }),
    [connectors, installed, get, byCapability, invoke, rollup, liveEvents],
  );

  return <ConnectorContext.Provider value={value}>{children}</ConnectorContext.Provider>;
}

/** Hook: read the connector context. Throws if no provider is mounted. */
export function useConnectors(): ConnectorContextValue {
  const ctx = React.useContext(ConnectorContext);
  if (!ctx) {
    throw new Error('useConnectors must be used inside <ConnectorProvider>');
  }
  return ctx;
}

/**
 * Optional hook: returns `null` instead of throwing when no provider is
 * present. Use in components that may render in a context without the
 * provider (e.g. tests, isolated pages).
 */
export function useConnectorsOptional(): ConnectorContextValue | null {
  return React.useContext(ConnectorContext);
}

// Re-export the data layer so consumers can import everything from
// `@/lib/connectors` instead of two paths.
export {
  CONNECTORS,
  listConnected,
  listByCapability,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  STATUS_LABEL,
  STATUS_ORDER,
  SCOPE_LABEL,
  CREDENTIAL_TYPE_LABEL,
  resolveIcon,
  RECOMMENDED,
  sparklineFor,
  SYNC_HISTORY_24H,
  topByUsage,
  listCredentials,
  listMarketplace,
  getConnectorById,
  computeRollup,
  type Connector,
  type ConnectorCapability,
  type ConnectorCategory,
  type ConnectorHealthStatus,
  type ConnectorScope,
  type ConnectorSyncEvent,
  type ConnectorUsage,
  type ConnectorCredential,
  type SyncEventStatus,
  type SyncEventType,
  type CredentialType,
  type CredentialStatus,
  type RecommendedConnector,
  type ConnectorRollup,
} from './data';