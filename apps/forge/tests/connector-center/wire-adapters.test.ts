/**
 * FORA / M3-G21 — Unit tests for wire-adapters.ts.
 *
 * 6 cases, one per adapter in apps/forge/lib/connectors/wire-adapters.ts.
 * Validates that the canonical wire→UI conversion preserves the
 * constraints the tab UIs depend on (no nulls, redacted credentials,
 * status mapping).
 */

import { describe, expect, it } from 'vitest';

import {
  wireToActivityRow,
  wireToConnectedCard,
  wireToCredentialRow,
  wireToHealthRow,
  wireToMarketplaceItem,
  wireToWebhookRow,
} from '@/lib/connectors/wire-adapters';

import type {
  ConnectorWire,
  ConnectorMarketplaceItemWire,
  ConnectorCredentialWire,
  ConnectorSyncEventWire,
  WebhookWire,
} from '@/lib/connectors/types';

// ---------------------------------------------------------------------------
// Test fixtures — minimal wire payloads that exercise each branch.
// ---------------------------------------------------------------------------

const baseConnectorWire: ConnectorWire = {
  id: 'conn-1',
  name: 'acme-github',
  display_name: 'Acme GitHub',
  category: 'source-control',
  status: 'healthy',
  last_sync_at: '2026-07-04T08:30:00Z',
  next_sync_at: '2026-07-04T20:30:00Z',
  call_count_24h: 142,
  error_rate_24h: 0.02,
  scopes: ['repo', 'read:org'],
};

const baseMarketplaceWire: ConnectorMarketplaceItemWire = {
  slug: 'github',
  display_name: 'GitHub',
  description: 'Repos, PRs, issues, webhooks, Actions.',
  category: 'source-control',
  publisher: 'GitHub Inc.',
  icon: 'gitbranch',
  auth_type: 'oauth',
  required_scopes: ['repo', 'read:org'],
  capabilities: ['pull_issues', 'pull_prs'],
  installed: false,
};

const baseCredentialWire: ConnectorCredentialWire = {
  id: 'cred-1',
  connector_id: 'conn-1',
  name: 'github-oauth',
  type: 'api_key',
  fingerprint: 'abcd1234...efgh',
  status: 'active',
  last_rotated_at: '2026-06-01T08:00:00Z',
  rotated_by: 'user-1',
  scopes: ['repo'],
};

const baseActivityWire: ConnectorSyncEventWire = {
  id: 'evt-1',
  connector_id: 'conn-1',
  tenant_id: 'tenant-1',
  event_type: 'sync',
  status: 'failed',
  started_at: '2026-07-04T08:30:00Z',
  finished_at: '2026-07-04T08:30:11Z',
  records_affected: 0,
  actor_id: null,
  error_message: 'rate limit exceeded',
  event_metadata: { retry_after: 60 },
};

const baseWebhookWire: WebhookWire = {
  id: 'wh-1',
  connector_id: 'conn-1',
  name: 'github-pr-events',
  direction: 'inbound',
  url: 'https://forge.example/webhooks/in/gh_abc',
  events: ['pull_request', 'push'],
  auth_type: 'hmac_sha256',
  status: 'active',
};

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('wire-adapters', () => {
  it('wireToConnectedCard — full wire maps every Connector field', () => {
    const card = wireToConnectedCard(baseConnectorWire);
    expect(card.id).toBe('conn-1');
    expect(card.name).toBe('acme-github');
    expect(card.displayName).toBe('Acme GitHub');
    expect(card.status).toBe('healthy');
    expect(card.scopes).toEqual(['repo', 'read:org']);
    expect(card.capabilities).toBeDefined();
    expect(card.capabilities.length).toBeGreaterThan(0);
  });

  it('wireToConnectedCard — missing description gets sensible default', () => {
    const sparse: ConnectorWire = {
      ...baseConnectorWire,
      // simulate missing/empty fields the wire may drop on partial responses
      scopes: [],
      call_count_24h: 0,
      error_rate_24h: 0,
    };
    const card = wireToConnectedCard(sparse);
    expect(card.description).toBe('');
    expect(card.tagline.length).toBeLessThan(120);
    expect(card.status).toBe('healthy'); // preserved
  });

  it('wireToMarketplaceItem — installed flag carried through', () => {
    const installed: ConnectorMarketplaceItemWire = {
      ...baseMarketplaceWire,
      installed: true,
    };
    const item = wireToMarketplaceItem(installed);
    expect(item.installed).toBe(true);
    expect(item.slug).toBe('github');
    expect(item.publisher).toBe('GitHub Inc.');
  });

  it('wireToCredentialRow — fingerprint is redacted to bullet form', () => {
    const row = wireToCredentialRow(baseCredentialWire);
    expect(row.id).toBe('cred-1');
    // Either fully redacted or preview-suffix; never raw fingerprint
    expect(row.fingerprint).not.toBe('abcd1234...efgh');
    expect(row.fingerprint).toMatch(/^[•…]+/);
  });

  it('wireToActivityRow — failed status maps to error SyncEventStatus', () => {
    const row = wireToActivityRow(baseActivityWire);
    expect(row.id).toBe('evt-1');
    expect(row.status).toBe('error');
    expect(row.errorMessage).toBe('rate limit exceeded');
    expect(row.connectorId).toBe('conn-1');
  });

  it('wireToWebhookRow — direction is preserved through conversion', () => {
    const row = wireToWebhookRow(baseWebhookWire);
    expect(row.id).toBe('wh-1');
    expect(row.direction).toBe('inbound');
    expect(row.events).toEqual(['pull_request', 'push']);
  });

  it('wireToHealthRow — health row bundles connector + activity', () => {
    const row = wireToHealthRow(baseConnectorWire, [baseActivityWire]);
    expect(row.connectorId).toBe('conn-1');
    expect(row.status).toBe('healthy');
    expect(row.recentEvents.length).toBe(1);
    expect(row.recentEvents[0].id).toBe('evt-1');
  });
});
