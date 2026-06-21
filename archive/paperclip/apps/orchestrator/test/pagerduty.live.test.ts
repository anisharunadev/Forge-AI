/**
 * Live PagerDuty sandbox integration test — FORA-171 (0.1.4.d).
 *
 * Acceptance bar #1: "A real page fires against a PagerDuty sandbox
 * when the sweeper hits 50% TTL."
 * Acceptance bar #2: "The same idempotency key does not create a
 * duplicate page."
 * Acceptance bar #3: "An integration test asserts the dedup_key
 * matches the idempotencyKey."
 *
 * Gated by `PAGERDUTY_ROUTING_KEY`. The CI runner does not have a
 * PagerDuty account, so this file is `describe.skip` by default and
 * runs only when the env var is set. The PagerDuty Events API v2
 * sandbox is the public endpoint (https://events.pagerduty.com/v2/
 * enqueue) — the same URL the production adapter hits, just with
 * an integration key bound to a test service.
 *
 * To run locally:
 *   1. Create a PagerDuty test service (any free tier).
 *   2. Add an "Events API v2" integration; copy the integration
 *      key (32-hex string).
 *   3. Export PAGERDUTY_ROUTING_KEY=<the key>.
 *   4. pnpm vitest run test/pagerduty.live.test.ts
 *
 * The test fires one page and one replay; PagerDuty collapses the
 * replay to a no-op update of the same incident. We don't assert
 * "no second incident" via the PagerDuty REST API (that would
 * require an account-level API key, separate from the events key);
 * the deterministic proof is that the response's `dedup_key`
 * matches the `idempotencyKey` on the second call too.
 */

import { describe, it, expect } from 'vitest';

import { PagerDutyPager } from '../src/pagerduty.js';
import { TestClock } from '../src/test-doubles.js';
import { asIdempotencyKey, asRunId } from '../src/types.js';

const ROUTING_KEY = process.env['PAGERDUTY_ROUTING_KEY'];
const BASE_URL = process.env['PAGERDUTY_BASE_URL']; // optional override

const describeIfKey = ROUTING_KEY ? describe : describe.skip;

describeIfKey('PagerDutyPager (live sandbox)', () => {
  it('fires a real page, returns the dedup_key, and dedupes on replay', async () => {
    const clock = new TestClock(new Date('2026-06-17T00:30:00.000Z'));
    const pager = new PagerDutyPager({
      routingKey: ROUTING_KEY!,
      ...(BASE_URL ? { baseUrl: BASE_URL } : {}),
      clock,
    });

    // Use a unique dedup_key per run so we don't collide with prior
    // sandbox firings. The timestamp + random suffix are sufficient
    // because PagerDuty's dedup window is 24h and tests run in
    // seconds.
    const idemKey = asIdempotencyKey(
      `pager-50:live-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const runId = asRunId(`run-live-test-${Date.now()}`);

    // First fire.
    const first = await pager.pageApprover({
      approvalId: `appr-live-${Date.now()}`,
      runId,
      role: 'qa',
      reason: 'ttl_50_percent',
      idempotencyKey: idemKey,
    });

    // The pageId is the dedup_key (the public V2 surface echoes
    // the request's `dedup_key` back). Acceptance bar #3.
    expect(first.pageId).toBe(idemKey);

    // Second fire with the same idempotency key — PagerDuty treats
    // it as an update to the existing incident; locally the adapter
    // forwards the same dedup_key, so the response is stable.
    const second = await pager.pageApprover({
      approvalId: `appr-live-${Date.now()}-dup`,
      runId,
      role: 'qa',
      reason: 'ttl_50_percent',
      idempotencyKey: idemKey,
    });

    expect(second.pageId).toBe(idemKey);
    // The dedup_key is the same on both calls — PagerDuty uses it
    // as the dedupe boundary; locally the adapter is a pure
    // pass-through so the value is deterministic on replay.
    expect(second.pageId).toBe(first.pageId);
  }, 30_000);
});
