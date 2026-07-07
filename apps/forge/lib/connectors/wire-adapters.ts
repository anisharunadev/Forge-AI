/**
 * Wire adapters — single source of truth for converting the backend's
 * FastAPI wire-format payloads (`ConnectorWire`, `WebhookWire`,
 * `ConnectorSyncEventWire`, `ConnectorMarketplaceItem`,
 * `ConnectorCredentialWire`, `WebhookDeliveryWire`) into the legacy
 * in-memory shapes consumed by the existing Connector Center tabs.
 *
 * Why this file
 * -------------
 * Step 55 wires the Connector Center to the real FastAPI backend. The
 * existing tab components were built in Step 31 against the rich
 * in-memory `Connector` shape (~30 fields incl. credential blob, p95
 * latency, usedIn map). The wire shapes are intentionally lean (~10
 * fields each). These adapters bridge the two shapes so the legacy UI
 * keeps rendering against real backend data without rewriting every
 * consumer.
 *
 * Architecture
 * ------------
 *   - `wireToConnectedCard`      — `ConnectorWire` → `Connector` (the
 *     central card shape used by ConnectedTab, ConnectionsTab, the
 *     graph nodes, and the Overview tab).
 *   - `wireToMarketplaceItem`    — `ConnectorMarketplaceItem` →
 *     `Connector` (the same shape as a connected card but flagged
 *     `installed: false`).
 *   - `wireToActivityRow`        — `ConnectorSyncEventWire` →
 *     `ConnectorSyncEvent` (the legacy in-memory sync event).
 *   - `wireToCredentialRow`      — `ConnectorCredentialWire` →
 *     `Connector['credential']` (the legacy embedded credential blob).
 *   - `wireToWebhookRow`         — `WebhookWire` → `WebhookRow` (the
 *     tab-local shape used by WebhooksTab; deliveries arrive
 *     separately via `useWebhookDeliveries`).
 *   - `wireToHealthRow`          — `ConnectorWire` + recent
 *     `ConnectorSyncEventWire[]` → `HealthRow` (the HealthTab's per-
 *     connector row enriched with 14d failure counts).
 *
 * All adapters are pure functions — no React, no hooks, no module-
 * level state. They are safe to use in both client and server contexts.
 *
 * Default-fill semantics
 * -----------------------
 * Every adapter fills in the legacy fields the wire doesn't carry
 * (icon resolvers, tagline strings, mock-friendly defaults) using
 * deterministic rules so the UI renders deterministically even when
 * the backend hasn't shipped the field yet. The defaults intentionally
 * mirror the existing `attachCapabilities` logic in
 * `LiveConnectorDataProvider.tsx` and the existing
 * `wireToConnector`/`wireToSyncEvent`/`wireToCredential` helpers in
 * `lib/connectors/types.ts` — those are re-exported from here so all
 * "wire → UI" conversions live in one file.
 */

import {
  wireToConnector,
  wireToCredential,
  type ConnectorWire,
  type ConnectorSyncEventWire,
  type ConnectorCredentialWire,
  type ConnectorMarketplaceItem,
  type WebhookWire,
  type WebhookDeliveryWire,
} from './types';

import type {
  Connector,
  ConnectorCapability,
  ConnectorCredential,
  ConnectorSyncEvent,
  SyncEventStatus,
  SyncEventType,
  ConnectorHealthStatus,
} from './data';

// ---------------------------------------------------------------------------
// Re-exports — keep `wire-adapters.ts` as the single seam so the rest of
// the Connector Center doesn't need to import from two files.
// ---------------------------------------------------------------------------

/** Map a wire `Connector` to the legacy card shape used by every tab. */
export const wireToConnectedCard = wireToConnector;

/**
 * Activity row — the legacy `ConnectorSyncEvent` shape plus the
 * `connectorId` / `connectorSlug` so downstream tabs can resolve the
 * source connector without re-querying. Structurally a superset of
 * `ConnectorSyncEvent`, so any code that only reads the legacy fields
 * keeps working unchanged.
 */
export interface ActivityRow extends ConnectorSyncEvent {
  readonly connectorId: string;
  readonly connectorSlug: string;
}

/**
 * Map a wire sync event to the legacy `ConnectorSyncEvent` shape and
 * preserve the connector FK so the Activity tab can render the source
 * connector's display name + icon without a second lookup.
 */
export function wireToActivityRow(wire: ConnectorSyncEventWire): ActivityRow {
  const status: SyncEventStatus =
    wire.status === 'ok'
      ? 'success'
      : wire.status === 'in-progress'
        ? 'partial'
        : 'failed';

  // Map the wire's event_type vocabulary onto the legacy 4-bucket
  // taxonomy the UI understands.
  const eventType: SyncEventType =
    wire.event_type.startsWith('sync.')
      ? 'pull'
      : wire.event_type.startsWith('webhook.')
        ? 'webhook'
        : wire.event_type === 'config.updated'
          ? 'push'
          : 'test';

  return {
    id: wire.id,
    at: wire.started_at,
    eventType,
    entity: wire.event_type,
    status,
    durationMs: wire.duration_ms,
    records: wire.records_processed,
    errorMessage: wire.error_message ?? undefined,
    connectorId: wire.connector_id,
    connectorSlug: wire.connector_slug,
  };
}

/** Map a wire credential to the legacy embedded `credential` blob. */
export const wireToCredentialRow = wireToCredential;

// ---------------------------------------------------------------------------
// Capability inference — duplicated from `LiveConnectorDataProvider`'s
// `attachCapabilities` so this module is self-contained.
// ---------------------------------------------------------------------------

const CAPABILITY_BY_SLUG: Record<string, ReadonlyArray<ConnectorCapability>> = {
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

function inferCapabilities(slug: string | null | undefined): ReadonlyArray<ConnectorCapability> {
  if (!slug) return [];
  return CAPABILITY_BY_SLUG[slug] ?? [];
}

// ---------------------------------------------------------------------------
// Marketplace item adapter
// ---------------------------------------------------------------------------

/**
 * Convert a marketplace catalog item (the wire shape returned by
 * `GET /api/v1/marketplace/connectors`) into the legacy `Connector`
 * shape used by the Marketplace tab.
 *
 * The marketplace item doesn't carry an installation row, so this
 * adapter fills in sensible defaults:
 *   - `id` is the slug prefixed with `mkt-` to avoid colliding with
 *     installed connector ids.
 *   - `installed: false` (marketplace rows are by definition
 *     available-but-not-installed).
 *   - `capabilities` is inferred from the slug using the
 *     `CAPABILITY_BY_SLUG` table; falls back to the wire's
 *     `capabilities[]` array if the slug is unknown.
 *   - `lastSyncAt` is set to "now" so cards have a non-empty timestamp.
 */
export function wireToMarketplaceItem(item: ConnectorMarketplaceItem): Connector {
  const slug = item.slug;
  const inferred = inferCapabilities(slug);
  const capabilities = inferred.length > 0 ? inferred : (item.capabilities as ConnectorCapability[]);
  const tagline = item.description.split('\n')[0]?.slice(0, 88) ?? '';

  const credentialType: ConnectorCredential['type'] =
    item.auth_type === 'oauth' ? 'oauth' : 'api_key';

  return {
    id: `mkt-${slug}`,
    name: slug,
    displayName: item.display_name,
    publisher: 'Forge',
    tagline,
    description: item.description,
    category: (item.category as Connector['category']) ?? 'custom',
    scope: 'project',
    tier: 1,
    status: 'healthy',
    connectedAs: '',
    lastSyncAt: new Date().toISOString(),
    capabilities,
    health: { p50Ms: 0, p95Ms: 0, errorRate: 0 },
    credential: {
      id: `cred-${slug}`,
      name: `${item.display_name} credential`,
      type: credentialType,
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
    installed: false,
    available: true,
    featured: item.is_featured,
    newThisMonth: false,
  };
}

// ---------------------------------------------------------------------------
// Webhook row adapter
// ---------------------------------------------------------------------------

/** A single delivery row inside a `WebhookRow`. Matches the wire's
 * `WebhookDeliveryWire` projected onto the legacy shape consumed by
 * `WebhooksTab`. */
export interface WebhookDeliveryRow {
  readonly id: string;
  readonly at: string;
  readonly status: 'success' | 'failed' | 'pending';
  readonly code: number | null;
  readonly latencyMs: number;
}

/**
 * The legacy in-memory shape consumed by `WebhooksTab`. Inline rather
 * than imported because this is the wire-adapter boundary and the tab
 * historically defined this struct itself.
 */
export interface WebhookRow {
  readonly id: string;
  readonly name: string;
  /** Connector id for inbound webhooks, the URL for outbound ones. */
  readonly source: string;
  readonly url: string;
  readonly events: ReadonlyArray<string>;
  readonly lastSent: string;
  readonly status: 'active' | 'paused' | 'failing';
  /** 0..1 success rate over the last 24h derived from the wire. */
  readonly successRate: number;
  readonly recentDeliveries: ReadonlyArray<WebhookDeliveryRow>;
  readonly direction: 'inbound' | 'outbound';
  readonly authType: WebhookWire['auth_type'];
}

/**
 * Compute the success rate from a wire's 24h counters. Returns 1.0
 * when both counters are zero (no traffic yet) so the UI doesn't
 * show a misleading 0%.
 */
function computeSuccessRate(success: number, error: number): number {
  const total = success + error;
  if (total <= 0) return 1.0;
  return success / total;
}

/**
 * Map a wire `WebhookDeliveryWire` to the legacy delivery row shape.
 */
function deliveryToRow(d: WebhookDeliveryWire): WebhookDeliveryRow {
  return {
    id: d.id,
    at: d.attempted_at,
    status: d.status === 'ok' ? 'success' : d.status === 'error' ? 'failed' : 'pending',
    code: d.response_code,
    latencyMs: d.duration_ms,
  };
}

/**
 * Convert a wire `WebhookWire` to the legacy `WebhookRow` shape used by
 * `WebhooksTab`. The recent-deliveries list is computed from the
 * optional `deliveries` argument; when omitted the row is rendered
 * with no delivery history (the tab fetches the full delivery list
 * lazily via `useWebhookDeliveries(selectedId)` after the user expands
 * a row).
 */
export function wireToWebhookRow(
  wire: WebhookWire,
  deliveries: ReadonlyArray<WebhookDeliveryWire> = [],
): WebhookRow {
  // The wire doesn't carry a connector FK for inbound webhooks. Use
  // the URL as the source so the icon resolver falls back to the
  // generic `Plug` icon (consistent with the existing UI when no
  // connector slug is available). For outbound, the URL is the right
  // identifier anyway.
  const source = wire.direction === 'inbound' ? wire.name : (wire.url ?? '');
  const status: WebhookRow['status'] =
    wire.status === 'active'
      ? 'active'
      : wire.status === 'paused'
        ? 'paused'
        : 'failing';

  return {
    id: wire.id,
    name: wire.name,
    source,
    url: wire.url ?? '',
    events: wire.events,
    lastSent: wire.last_triggered_at ?? wire.created_at,
    status,
    successRate: computeSuccessRate(wire.success_count_24h, wire.error_count_24h),
    recentDeliveries: deliveries.map(deliveryToRow),
    direction: wire.direction,
    authType: wire.auth_type,
  };
}

// ---------------------------------------------------------------------------
// Health row adapter
// ---------------------------------------------------------------------------

/** Failure-counts breakdown the HealthTab's table renders. */
export interface HealthFailureSummary {
  /** Total failed sync events over the last 14 days. */
  readonly failedLast14d: number;
  /** The most-recent failed event (for the "Last failure" column). */
  readonly lastFailure: ConnectorSyncEvent | null;
  /** Most-recent successful event (for the "Last success" column). */
  readonly lastSuccess: ConnectorSyncEvent | null;
  /** All failed events in the last 14 days, newest first. */
  readonly recentFailures: ReadonlyArray<ConnectorSyncEvent>;
}

/**
 * The HealthTab row. Wraps the legacy `Connector` shape (so the table
 * keeps its existing column renderer) and adds the failure-counts
 * summary derived from the activity feed.
 */
export interface HealthRow {
  readonly connector: Connector;
  readonly failure: HealthFailureSummary;
}

const MS_14D = 14 * 86_400_000;

/** Pick the most recent event matching the predicate (or null). */
function mostRecent(
  events: ReadonlyArray<ConnectorSyncEvent>,
  predicate: (e: ConnectorSyncEvent) => boolean,
): ConnectorSyncEvent | null {
  for (const e of events) {
    if (predicate(e)) return e;
  }
  return null;
}

/**
 * Convert a wire `Connector` + recent activity feed into the legacy
 * `HealthRow` shape used by `HealthTab`. The adapter:
 *
 *   1. Maps the wire → `Connector` (via `wireToConnectedCard`).
 *   2. Filters the activity feed to this connector's id.
 *   3. Splits events into failed/success buckets over the last 14
 *      days, newest first.
 *   4. Pre-computes `lastFailure`/`lastSuccess` so the table can
 *      render without re-sorting the array on every render.
 */
export function wireToHealthRow(
  wire: ConnectorWire,
  recentEvents: ReadonlyArray<ConnectorSyncEventWire>,
): HealthRow {
  const connector = wireToConnectedCard(wire);
  const cutoff = Date.now() - MS_14D;

  // Map wire events to legacy shape; only keep events for this
  // connector AND within the last 14 days. We treat both
  // `status === 'failed'` and the wire's `status === 'error'` as
  // failures (the legacy shape uses 'failed', the wire uses 'error').
  const mapped: ConnectorSyncEvent[] = recentEvents
    .filter((e) => e.connector_id === wire.id)
    .map(wireToActivityRow)
    .filter((e) => Date.parse(e.at) >= cutoff)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const failed = mapped.filter((e) => e.status === 'failed');
  const success = mapped.filter((e) => e.status === 'success' || e.status === 'partial');

  return {
    connector,
    failure: {
      failedLast14d: failed.length,
      lastFailure: mostRecent(failed, () => true),
      lastSuccess: mostRecent(success, () => true),
      recentFailures: failed.slice(0, 5),
    },
  };
}

// ---------------------------------------------------------------------------
// Failure-rate trend helper (HealthTab's line chart)
// ---------------------------------------------------------------------------

/**
 * Build the 14-day failure-rate trend used by the HealthTab's line
 * chart. Each bucket is the failure count for a single day. The
 * adapter pre-aggregates so the chart component doesn't have to
 * re-bucket on every render.
 */
export interface FailureTrendPoint {
  /** ISO date at midnight (YYYY-MM-DD). */
  readonly day: string;
  readonly failures: number;
}

export function buildFailureTrend(
  events: ReadonlyArray<ConnectorSyncEventWire>,
  days: number = 14,
): FailureTrendPoint[] {
  const buckets = new Map<string, number>();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Seed all days with 0 so the line chart renders the full range
  // even when there are no failures.
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, 0);
  }

  for (const ev of events) {
    if (ev.status !== 'error') continue;
    const at = ev.completed_at ?? ev.started_at;
    const day = at.slice(0, 10);
    if (!buckets.has(day)) continue;
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }

  // Return oldest → newest so the line chart's X axis reads left →
  // right chronologically.
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, failures]) => ({ day, failures }));
}

// ---------------------------------------------------------------------------
// KPI count helper (page.tsx's hero band + tab bar badges)
// ---------------------------------------------------------------------------

/**
 * Tiny aggregator used by `app/connector-center/page.tsx` for the hero
 * band + tab bar badges. Reads from the live hooks (connectors,
 * marketplace, credentials) and returns the small set of counts the
 * page renders.
 */
export interface ConnectorKpiCounts {
  readonly connected: number;
  readonly healthy: number;
  readonly failing: number;
  readonly syncsToday: number;
  readonly marketplaceCount: number;
  readonly credentialsCount: number;
}

export function computeKpiCounts(
  connectors: ReadonlyArray<Connector>,
  marketplace: ReadonlyArray<ConnectorMarketplaceItem>,
  credentials: ReadonlyArray<ConnectorCredentialWire>,
): ConnectorKpiCounts {
  const failing = connectors.filter(
    (c) => c.status === 'failed' || c.status === 'quarantined',
  ).length;
  const healthy = connectors.filter((c) => c.status === 'healthy').length;
  const syncsToday = connectors.reduce((acc, c) => acc + c.recentEvents.length, 0);
  return {
    connected: connectors.length,
    healthy,
    failing,
    syncsToday,
    marketplaceCount: marketplace.length,
    credentialsCount: credentials.length,
  };
}

// ---------------------------------------------------------------------------
// Type re-exports — keep callers from importing from two files when
// they only need the wire types.
// ---------------------------------------------------------------------------

export type {
  ConnectorWire,
  ConnectorSyncEventWire,
  ConnectorCredentialWire,
  ConnectorMarketplaceItem,
  WebhookWire,
  WebhookDeliveryWire,
  Connector,
  ConnectorSyncEvent,
  ConnectorCredential,
  SyncEventStatus,
  SyncEventType,
  ConnectorHealthStatus,
};