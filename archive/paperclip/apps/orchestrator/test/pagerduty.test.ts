/**
 * PagerDuty adapter tests — FORA-171 (0.1.4.d).
 *
 * Acceptance bars:
 *   1. `pageApprover()` POSTs to /v2/enqueue with `dedup_key` =
 *      `idempotencyKey` (so a replay is a PagerDuty no-op).
 *   2. Severity is `warning` for `ttl_50_percent` and `error` for
 *      `ttl_100_percent_expired`.
 *   3. 2xx → `{ pageId }` (the pageId is the dedup_key, stable on
 *      replay).
 *   4. 4xx raises `PagerDutyClientError` with no retry.
 *   5. 5xx raises `PagerDutyServerError` after the retry budget.
 *   6. The dedup_key matches the idempotencyKey verbatim (the
 *      integration test in `pagerduty.live.test.ts` proves this
 *      against a real PagerDuty sandbox; this file proves the
 *      adapter wires the right key on the wire).
 *
 * The fetch implementation is a stub; we never make a real network
 * call in CI. The live test (`*.live.test.ts`) covers the
 * sandbox-callable end of the contract and is gated on
 * PAGERDUTY_ROUTING_KEY.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  PagerDutyClientError,
  PagerDutyPager,
  PagerDutyServerError,
  severityForReason,
} from '../src/pagerduty.js';
import { TestClock } from '../src/test-doubles.js';
import { asIdempotencyKey, asRunId } from '../src/types.js';

const ROUTING_KEY = 'routing-key-test-0123456789abcdef0123456789abcdef';
const APPROVAL_ID = 'appr-test-1';
const RUN_ID = asRunId('run-test-1');
const IDEMPOTENCY_KEY = asIdempotencyKey('pager-50:appr-test-1');

/**
 * Build a fetch stub that returns a pre-canned response. The stub
 * records every call so tests can assert on URL, method, body, and
 * the request count (used to prove retry behaviour).
 */
function buildFetchStub(
  responses: Array<{ status: number; body: unknown }>,
): { fetchImpl: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let next = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    const r = responses[next] ?? responses[responses.length - 1];
    if (!r) {
      throw new Error('fetchStub exhausted (no more responses)');
    }
    next++;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe('PagerDutyPager', () => {
  let clock: TestClock;

  beforeEach(() => {
    clock = new TestClock(new Date('2026-06-17T00:30:00.000Z'));
  });

  describe('severityForReason', () => {
    it('maps ttl_50_percent → warning', () => {
      expect(severityForReason('ttl_50_percent')).toBe('warning');
    });

    it('maps ttl_100_percent_expired → error', () => {
      expect(severityForReason('ttl_100_percent_expired')).toBe('error');
    });
  });

  describe('pageApprover', () => {
    it('POSTs to {baseUrl}/v2/enqueue with Content-Type application/json', async () => {
      const { fetchImpl, calls } = buildFetchStub([
        {
          status: 202,
          body: { status: 'success', message: 'Event processed', dedup_key: IDEMPOTENCY_KEY },
        },
      ]);
      const pager = new PagerDutyPager({ routingKey: ROUTING_KEY, fetchImpl, clock });

      await pager.pageApprover({
        approvalId: APPROVAL_ID,
        runId: RUN_ID,
        role: 'qa',
        reason: 'ttl_50_percent',
        idempotencyKey: IDEMPOTENCY_KEY,
      });

      expect(calls).toHaveLength(1);
      const call = calls[0]!;
      expect(call.url).toBe('https://events.pagerduty.com/v2/enqueue');
      expect(call.init.method).toBe('POST');
      const headers = call.init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Accept']).toBe('application/json');
    });

    it('forwards idempotencyKey as the PagerDuty dedup_key (acceptance bar #1)', async () => {
      const { fetchImpl, calls } = buildFetchStub([
        {
          status: 202,
          body: { status: 'success', message: 'Event processed', dedup_key: IDEMPOTENCY_KEY },
        },
      ]);
      const pager = new PagerDutyPager({ routingKey: ROUTING_KEY, fetchImpl, clock });

      await pager.pageApprover({
        approvalId: APPROVAL_ID,
        runId: RUN_ID,
        role: 'qa',
        reason: 'ttl_50_percent',
        idempotencyKey: IDEMPOTENCY_KEY,
      });

      const call = calls[0]!;
      const body = JSON.parse(call.init.body as string);
      expect(body.dedup_key).toBe(IDEMPOTENCY_KEY);
      expect(body.routing_key).toBe(ROUTING_KEY);
      expect(body.event_action).toBe('trigger');
    });

    it('maps ttl_50_percent → warning severity', async () => {
      const { fetchImpl, calls } = buildFetchStub([
        { status: 202, body: { status: 'success', message: 'ok', dedup_key: IDEMPOTENCY_KEY } },
      ]);
      const pager = new PagerDutyPager({ routingKey: ROUTING_KEY, fetchImpl, clock });

      await pager.pageApprover({
        approvalId: APPROVAL_ID,
        runId: RUN_ID,
        role: 'qa',
        reason: 'ttl_50_percent',
        idempotencyKey: IDEMPOTENCY_KEY,
      });

      const body = JSON.parse(calls[0]!.init.body as string);
      expect(body.payload.severity).toBe('warning');
      expect(body.payload.source).toBe('orchestrator-approvals');
      expect(body.payload.custom_details.reason).toBe('ttl_50_percent');
    });

    it('maps ttl_100_percent_expired → error severity', async () => {
      const { fetchImpl, calls } = buildFetchStub([
        { status: 202, body: { status: 'success', message: 'ok', dedup_key: IDEMPOTENCY_KEY } },
      ]);
      const pager = new PagerDutyPager({ routingKey: ROUTING_KEY, fetchImpl, clock });

      await pager.pageApprover({
        approvalId: APPROVAL_ID,
        runId: RUN_ID,
        role: 'qa',
        reason: 'ttl_100_percent_expired',
        idempotencyKey: asIdempotencyKey('pager-exp:appr-test-1'),
      });

      const body = JSON.parse(calls[0]!.init.body as string);
      expect(body.payload.severity).toBe('error');
      expect(body.payload.custom_details.reason).toBe('ttl_100_percent_expired');
    });

    it('returns { pageId } = dedup_key (stable on replay)', async () => {
      const { fetchImpl } = buildFetchStub([
        { status: 202, body: { status: 'success', message: 'ok', dedup_key: IDEMPOTENCY_KEY } },
      ]);
      const pager = new PagerDutyPager({ routingKey: ROUTING_KEY, fetchImpl, clock });

      const result = await pager.pageApprover({
        approvalId: APPROVAL_ID,
        runId: RUN_ID,
        role: 'qa',
        reason: 'ttl_50_percent',
        idempotencyKey: IDEMPOTENCY_KEY,
      });

      expect(result.pageId).toBe(IDEMPOTENCY_KEY);
    });

    it('stamps the summary, source, and custom_details on the payload', async () => {
      const { fetchImpl, calls } = buildFetchStub([
        { status: 202, body: { status: 'success', message: 'ok', dedup_key: IDEMPOTENCY_KEY } },
      ]);
      const pager = new PagerDutyPager({ routingKey: ROUTING_KEY, fetchImpl, clock });

      await pager.pageApprover({
        approvalId: APPROVAL_ID,
        runId: RUN_ID,
        role: 'qa',
        reason: 'ttl_50_percent',
        idempotencyKey: IDEMPOTENCY_KEY,
      });

      const body = JSON.parse(calls[0]!.init.body as string);
      expect(body.payload.summary).toContain(APPROVAL_ID);
      expect(body.payload.summary).toContain('needs review');
      expect(body.payload.source).toBe('orchestrator-approvals');
      expect(body.payload.custom_details).toMatchObject({
        approvalId: APPROVAL_ID,
        runId: RUN_ID,
        role: 'qa',
        reason: 'ttl_50_percent',
        idempotencyKey: IDEMPOTENCY_KEY,
        firedAt: clock.now().toISOString(),
      });
    });

    it('uses the custom baseUrl when supplied (sandbox / private deployment)', async () => {
      const { fetchImpl, calls } = buildFetchStub([
        { status: 202, body: { status: 'success', message: 'ok', dedup_key: IDEMPOTENCY_KEY } },
      ]);
      const pager = new PagerDutyPager({
        routingKey: ROUTING_KEY,
        fetchImpl,
        clock,
        baseUrl: 'https://sandbox.events.pagerduty.com',
      });

      await pager.pageApprover({
        approvalId: APPROVAL_ID,
        runId: RUN_ID,
        role: 'qa',
        reason: 'ttl_50_percent',
        idempotencyKey: IDEMPOTENCY_KEY,
      });

      expect(calls[0]!.url).toBe('https://sandbox.events.pagerduty.com/v2/enqueue');
    });

    it('raises PagerDutyClientError on 4xx with no retry', async () => {
      const { fetchImpl, calls } = buildFetchStub([
        { status: 400, body: { status: 'invalid event', message: 'bad routing_key' } },
      ]);
      const pager = new PagerDutyPager({
        routingKey: ROUTING_KEY,
        fetchImpl,
        clock,
        maxRetries: 5,
      });

      await expect(
        pager.pageApprover({
          approvalId: APPROVAL_ID,
          runId: RUN_ID,
          role: 'qa',
          reason: 'ttl_50_percent',
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      ).rejects.toBeInstanceOf(PagerDutyClientError);

      // 4xx → no retry.
      expect(calls).toHaveLength(1);
    });

    it('retries on 5xx up to maxRetries, then raises PagerDutyServerError', async () => {
      const { fetchImpl, calls } = buildFetchStub([
        { status: 500, body: { status: 'server error' } },
        { status: 502, body: { status: 'bad gateway' } },
        { status: 503, body: { status: 'unavailable' } },
      ]);
      const pager = new PagerDutyPager({
        routingKey: ROUTING_KEY,
        fetchImpl,
        clock,
        maxRetries: 3,
        retryBaseMs: 0, // skip backoff in tests
      });

      await expect(
        pager.pageApprover({
          approvalId: APPROVAL_ID,
          runId: RUN_ID,
          role: 'qa',
          reason: 'ttl_50_percent',
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      ).rejects.toBeInstanceOf(PagerDutyServerError);

      expect(calls).toHaveLength(3);
    });

    it('retries on network error (fetch throws)', async () => {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      let attempts = 0;
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        calls.push({ url, init: init ?? {} });
        attempts++;
        if (attempts < 3) {
          throw new Error('ECONNRESET');
        }
        return new Response(
          JSON.stringify({ status: 'success', message: 'ok', dedup_key: IDEMPOTENCY_KEY }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const pager = new PagerDutyPager({
        routingKey: ROUTING_KEY,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        clock,
        maxRetries: 3,
        retryBaseMs: 0,
      });

      const result = await pager.pageApprover({
        approvalId: APPROVAL_ID,
        runId: RUN_ID,
        role: 'qa',
        reason: 'ttl_50_percent',
        idempotencyKey: IDEMPOTENCY_KEY,
      });

      expect(result.pageId).toBe(IDEMPOTENCY_KEY);
      expect(calls).toHaveLength(3);
    });

    it('rejects construction with an empty routing key', () => {
      expect(() => new PagerDutyPager({ routingKey: '' })).toThrow(/routingKey is required/);
    });

    it('strips trailing slashes from the baseUrl', async () => {
      const { fetchImpl, calls } = buildFetchStub([
        { status: 202, body: { status: 'success', message: 'ok', dedup_key: IDEMPOTENCY_KEY } },
      ]);
      const pager = new PagerDutyPager({
        routingKey: ROUTING_KEY,
        fetchImpl,
        clock,
        baseUrl: 'https://sandbox.events.pagerduty.com///',
      });

      await pager.pageApprover({
        approvalId: APPROVAL_ID,
        runId: RUN_ID,
        role: 'qa',
        reason: 'ttl_50_percent',
        idempotencyKey: IDEMPOTENCY_KEY,
      });

      expect(calls[0]!.url).toBe('https://sandbox.events.pagerduty.com/v2/enqueue');
    });
  });
});
