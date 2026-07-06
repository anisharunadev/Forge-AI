/**
 * Sprint 3 — Crash #2 regression test.
 *
 * Contract: getConnectorAuditFeed returns a ConnectorAuditFeed whose
 * `isMockFallback` flag is true when the live TenantScopedAuditFetcher
 * is unreachable. The detail panel must surface this fact to the user
 * via a banner so they don't make decisions on synthetic data.
 *
 * We don't ship the live fetcher yet (no TenantScopedAuditFetcher in
 * the codebase per `rg "TenantScopedAuditFetcher"`). The contract is
 * therefore: the feed reports `isMockFallback: true` and consumers can
 * branch on it. Wiring the fetcher is Sprint 4 territory.
 */

import { describe, expect, it } from 'vitest';

import { getConnectorAuditFeed } from '@/lib/connectors/audit-feed';

describe('audit-feed mock fallback — Sprint 3 Crash #2', () => {
  it('reports isMockFallback=true so the UI can render the banner', async () => {
    const feed = await getConnectorAuditFeed('acme-corp', 'github', 5);
    expect(feed.isMockFallback).toBe(true);
  });

  it('still returns the requested number of entries', async () => {
    const feed = await getConnectorAuditFeed('acme-corp', 'github', 10);
    expect(feed.entries).toHaveLength(10);
    expect(feed.total).toBe(10);
  });

  it('bounds the count to the documented 100 max', async () => {
    const feed = await getConnectorAuditFeed('acme-corp', 'github', 9999);
    expect(feed.entries.length).toBe(100);
    expect(feed.total).toBe(100);
  });

  it('returns zero entries for count=0', async () => {
    const feed = await getConnectorAuditFeed('acme-corp', 'github', 0);
    expect(feed.entries).toHaveLength(0);
    expect(feed.isMockFallback).toBe(true);
  });

  it('keys entries on the connector id so the per-connector panel can fetch a deterministic batch', async () => {
    const a = await getConnectorAuditFeed('acme-corp', 'github', 3);
    const b = await getConnectorAuditFeed('acme-corp', 'jira', 3);
    expect(a.entries[0]?.id.startsWith('audit-github-')).toBe(true);
    expect(b.entries[0]?.id.startsWith('audit-jira-')).toBe(true);
    // ponytail: the AuditFeedFallbackBanner reads `feed.isMockFallback`;
    // this assertion is what locks the contract between the data layer
    // and the UI. If the field is ever renamed, both ends must move.
  });
});
