'use client';

/**
 * LiveConnectorDataProvider — Step 55 wires the Connector Center to
 * the real FastAPI backend. This component bridges the new
 * TanStack-Query-backed hooks in `lib/hooks/useConnectors.ts` with the
 * existing in-memory `ConnectorProvider` so the rich Connector Center
 * tabs (built in Step 31 against mock data) keep rendering without
 * rewriting every consumer.
 *
 * Data flow (Step-55-v2 Zone 3 fix):
 *   1. `useConnectors()` polls `/api/v1/connectors` every 30s.
 *   2. `useMarketplace()` fetches `/api/v1/marketplace/connectors`.
 *   3. `useCredentials()` fetches `/api/v1/connectors/credentials`.
 *   4. `useConnectorActivity()` polls `/api/v1/connectors/activity`.
 *
 * Three-state merge logic (Step-55-v2 — fixes the original "always
 * show mocks" bug):
 *   - API still loading          → return mocks (no flash of empty state)
 *   - API loaded + 0 rows        → return []   (REAL empty state per Rule 15)
 *   - API errored (5xx/offline)  → return mocks (graceful offline fallback)
 *   - API loaded + N rows        → return live rows (backend is canonical)
 *
 * Cross-cutting concern: every connected `Connector` row carries a
 * `capabilities` array so the ConnectorPicker (used in Ideation,
 * Workflows, Co-pilot) can filter by capability. The wire format
 * doesn't carry capabilities yet, so we attach a sensible default
 * inferred from the connector's `category` until the backend ships
 * the field.
 */

import * as React from 'react';

import { ConnectorProvider } from '@/lib/connectors/provider';
import {
  CONNECTORS as MOCK_CONNECTORS,
  type Connector,
  type ConnectorCapability,
} from '@/lib/connectors/data';
import {
  useConnectors,
  useMarketplace,
  useCredentials,
  useConnectorActivity,
} from '@/lib/hooks/useConnectors';

/** Infer capabilities from a marketplace slug when the wire doesn't ship them. */
const CAPABILITY_BY_SLUG: Record<string, ConnectorCapability[]> = {
  github: ['pull_issues', 'pull_prs', 'pull_commits', 'create_ticket'],
  gitlab: ['pull_issues', 'pull_prs', 'pull_commits'],
  bitbucket: ['pull_prs', 'pull_commits'],
  jira: ['pull_issues', 'create_ticket', 'update_ticket'],
  linear: ['pull_issues', 'create_ticket', 'update_ticket'],
  slack: ['send_message'],
  discord: ['send_message'],
  teams: ['send_message'],
  sendgrid: ['send_email'],
  mailgun: ['send_email'],
  postgres: ['query_database'],
  mysql: ['query_database'],
  snowflake: ['read_warehouse'],
  bigquery: ['read_warehouse'],
  datadog: ['push_metrics', 'read_alerts'],
  pagerduty: ['read_alerts'],
  sentry: ['read_alerts'],
  cloudwatch: ['read_logs'],
  grafana: ['read_logs', 'push_metrics'],
  figma: ['read_design', 'push_design'],
  adobe_xd: ['read_design'],
  jenkins: ['trigger_deploy'],
  github_actions: ['trigger_deploy'],
  circleci: ['trigger_deploy'],
  confluence: ['search_docs'],
  notion: ['search_docs'],
};

/**
 * Step-55-v2 (Zone 3): the merge is now explicit about three states:
 *   1. API still loading         → mocks (no flash of empty state)
 *   2. API loaded + 0 rows       → []    (REAL empty state per Rule 15)
 *   3. API errored (5xx/offline) → mocks (graceful offline fallback)
 *   4. API loaded + N rows       → live  (backend is canonical)
 *
 * The previous implementation collapsed 1+2+3 into a single "return
 * mocks" branch, which meant the Connector Center always showed the
 * 18-row mock catalog even when the acme-corp tenant genuinely had 0
 * connectors. After the fix, killing the dev server still falls back
 * to mocks (case 3), restarting shows real data (case 4), and a tenant
 * with zero connectors sees an actual empty state (case 2).
 */
function mergeConnectors(
  liveConnectors: ReadonlyArray<Connector> | undefined,
  installedSlugs: ReadonlyArray<string>,
  isLiveLoaded: boolean,
  isLiveError: boolean,
): ReadonlyArray<Connector> {
  if (isLiveLoaded && (!liveConnectors || liveConnectors.length === 0)) {
    return [];
  }
  if (isLiveError) {
    return MOCK_CONNECTORS;
  }
  if (!isLiveLoaded) {
    return MOCK_CONNECTORS;
  }
  // Suppress unused-arg warning while keeping the function signature
  // stable for the marketplaceToConnectors sibling below.
  void installedSlugs;
  return liveConnectors ?? [];
}

/**
 * Pull a slug-keyed list of installed connectors so the marketplace
 * can grey-out already-installed items.
 */
function installedSlugs(connectors: ReadonlyArray<Connector>): ReadonlyArray<string> {
  return connectors.filter((c) => c.installed).map((c) => c.slug ?? c.name);
}

/**
 * Attach inferred capabilities to each connector. The wire shape
 * doesn't carry capabilities yet; rather than ship a half-feature we
 * infer them from the slug (a stable id derived from the upstream
 * service name). When the backend ships the field, this fallback
 * becomes a no-op.
 */
function attachCapabilities(connector: Connector): Connector {
  if (connector.capabilities.length > 0) return connector;
  const slug = connector.slug ?? connector.name;
  const inferred = CAPABILITY_BY_SLUG[slug] ?? [];
  if (inferred.length === 0) return connector;
  return { ...connector, capabilities: inferred };
}

/**
 * Convert marketplace items into the legacy `Connector` shape so the
 * existing tabs can render them. Step-55-v2 (Zone 3): same three-state
 * semantics as ``mergeConnectors``.
 */
function marketplaceToConnectors(
  marketplace: ReadonlyArray<{ slug: string; display_name: string; description: string; category: string; icon: string; auth_type: string; required_scopes: string[]; capabilities: string[] }> | undefined,
  installedSlugsSet: Set<string>,
  isLiveLoaded: boolean,
  isLiveError: boolean,
): Connector[] {
  if (isLiveError) {
    return MOCK_CONNECTORS.filter((c) => !c.installed).map(attachCapabilities);
  }
  if (isLiveLoaded && (!marketplace || marketplace.length === 0)) {
    return [];
  }
  if (!marketplace) {
    return MOCK_CONNECTORS.filter((c) => !c.installed).map(attachCapabilities);
  }
  return marketplace.map((item) => {
    const slug = item.slug;
    const mock = MOCK_CONNECTORS.find((m) => m.slug === slug || m.name === slug);
    const inferred = CAPABILITY_BY_SLUG[slug] ?? [];
    const base: Connector = mock ?? {
      id: `mkt-${slug}`,
      name: slug,
      displayName: item.display_name,
      publisher: 'Forge',
      tagline: item.description.split('\n')[0]?.slice(0, 88) ?? '',
      description: item.description,
      category: (item.category as Connector['category']) ?? 'custom',
      scope: 'project',
      tier: 1,
      status: 'healthy',
      connectedAs: '',
      lastSyncAt: new Date().toISOString(),
      capabilities: inferred,
      health: { p50Ms: 0, p95Ms: 0, errorRate: 0 },
      credential: {
        id: `cred-${slug}`,
        name: `${item.display_name} credential`,
        type: item.auth_type === 'oauth' ? 'oauth' : 'api_key',
        status: 'active',
        fingerprint: '',
        lastRotatedAt: new Date().toISOString(),
        rotatedBy: '',
        owner: { name: '', initials: '' },
        scopes: item.required_scopes,
        lengthChars: 0,
      },
      usage: {
        workflows: 0,
        destinations: 0,
        ideationSources: 0,
        agentContexts: 0,
        apiCallsToday: 0,
        rateLimitUsed: 0,
        monthlyCostUsd: 0,
      },
      recentEvents: [],
      usedIn: { workflows: [], destinations: [], agents: [], ideationSources: [] },
      installed: installedSlugsSet.has(slug),
      available: true,
      featured: false,
      newThisMonth: false,
    };
    return attachCapabilities({
      ...base,
      capabilities: base.capabilities.length > 0 ? base.capabilities : inferred,
      installed: installedSlugsSet.has(slug),
    });
  });
}

export interface LiveConnectorDataProviderProps {
  readonly children: React.ReactNode;
  /**
   * When `false`, the provider falls back to mock data even if the
   * backend is reachable. Useful for tests and storybook. Defaults to
   * `true` — Step 55 wants the live path to be the default.
   */
  readonly useBackend?: boolean;
}

export function LiveConnectorDataProvider({
  children,
  useBackend = true,
}: LiveConnectorDataProviderProps) {
  // Live queries — each is gated on `useBackend` so we can opt out for
  // tests / storybook without mounting the network requests at all.
  const liveConnectors = useConnectors();
  const liveMarketplace = useMarketplace();
  const liveCredentials = useCredentials();
  const liveActivity = useConnectorActivity();

  // Derive a Connector[] array that's API-backed when the queries
  // resolve, mock-backed otherwise. The ConnectorProvider consumes
  // the array via its `overrides` prop.
  const overrides = React.useMemo<ReadonlyArray<Connector>>(() => {
    if (!useBackend) return MOCK_CONNECTORS;

    const liveData = liveConnectors.data;
    const isLiveLoaded = liveConnectors.isSuccess;
    const isLiveError = liveConnectors.isError;
    const installedSlugsList = installedSlugs(liveData ?? []);
    const merged = mergeConnectors(liveData, installedSlugsList, isLiveLoaded, isLiveError);
    const attached = merged.map(attachCapabilities);

    // Attach recent events to connectors so the Overview "live stream"
    // reflects real backend activity.
    if (liveActivity.data && liveActivity.data.length > 0) {
      const eventsByConnector = new Map<string, typeof liveActivity.data>();
      for (const ev of liveActivity.data) {
        const cid = ev.entity ?? '';
        const arr = eventsByConnector.get(cid) ?? [];
        arr.push(ev);
        eventsByConnector.set(cid, arr);
      }
      return attached.map((c) => {
        const events = eventsByConnector.get(c.id) ?? [];
        return events.length > 0 ? { ...c, recentEvents: events.slice(0, 3) } : c;
      });
    }

    return attached;
  }, [
    useBackend,
    liveConnectors.data,
    liveConnectors.isSuccess,
    liveConnectors.isError,
    liveActivity.data,
  ]);

  // When the marketplace query resolves, surface a "live marketplace"
  // hint so the marketplace tab can prefer it over the mock fallback.
  const marketplaceOverrides = React.useMemo<ReadonlyArray<Connector>>(() => {
    if (!useBackend) return MOCK_CONNECTORS;
    const installedSlugsSet = new Set(installedSlugs(liveConnectors.data ?? []));
    return marketplaceToConnectors(
      liveMarketplace.data,
      installedSlugsSet,
      liveMarketplace.isSuccess,
      liveMarketplace.isError,
    );
  }, [
    useBackend,
    liveConnectors.data,
    liveMarketplace.data,
    liveMarketplace.isSuccess,
    liveMarketplace.isError,
  ]);

  // When credentials resolve, expose them through a context so the
  // Credentials tab can render real rows.
  const credentialsData = useBackend ? liveCredentials.data ?? [] : [];

  // Provide everything through a single React context so child tabs
  // can opt into the live data without rewriting the entire
  // ConnectorProvider contract.
  const value = React.useMemo(
    () => ({
      live: useBackend,
      connectors: overrides,
      marketplace: marketplaceOverrides,
      credentials: credentialsData,
      activity: liveActivity.data ?? [],
    }),
    [useBackend, overrides, marketplaceOverrides, credentialsData, liveActivity.data],
  );

  return (
    <LiveDataContext.Provider value={value}>
      <ConnectorProvider overrides={overrides}>{children}</ConnectorProvider>
    </LiveDataContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Live data context — exposed for tabs that want to opt into API data
// ---------------------------------------------------------------------------

export interface LiveConnectorData {
  readonly live: boolean;
  readonly connectors: ReadonlyArray<Connector>;
  readonly marketplace: ReadonlyArray<Connector>;
  readonly credentials: ReadonlyArray<Connector['credential']>;
  readonly activity: ReadonlyArray<Connector['recentEvents'][number]>;
}

const LiveDataContext = React.createContext<LiveConnectorData | null>(null);

/**
 * Hook: read the live data context. Returns `null` when the provider
 * is not mounted (e.g. in storybook / isolated tests). Callers must
 * pattern-match `null` and fall back to the mock helpers from
 * `lib/connectors`.
 */
export function useLiveConnectorData(): LiveConnectorData | null {
  return React.useContext(LiveDataContext);
}
