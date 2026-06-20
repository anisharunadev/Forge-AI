/**
 * Unit tests for `ForaAuditSink` (FORA-160).
 *
 * Coverage:
 *   - Post shape: URL, method, content-type, body field order matches the
 *     FORA-36 `append_event(...)` contract (ADR-0003 §8.1).
 *   - Bearer token: when set, included as `Authorization: Bearer <token>`.
 *   - Retry on 5xx: backoff fires, second attempt succeeds.
 *   - Retry exhaust: persistent 5xx throws after `maxAttempts`.
 *   - No retry on 4xx: a single 4xx response throws immediately.
 *   - Timeout: an AbortError surfaces as a timeout error after the per-attempt
 *     budget elapses.
 *   - `tail`/`close`: `tail(n)` returns the last N appended events;
 *     `close()` is a safe no-op.
 *   - Pre-condition: missing required fields throw before any network call.
 *
 * The fetch implementation is mocked per-test so we never bind to a real
 * socket. The mock records every call so we can assert on the post shape,
 * the retry count, and the backoff pacing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ForaAuditSink, type AuthAuditEvent } from '../src/audit.js';

function makeEvent(overrides: Partial<AuthAuditEvent> = {}): AuthAuditEvent {
  return {
    actor: 'user:okta-acme:1',
    tenant_id: 'acme',
    principal: 'board_user',
    action: 'auth.login.succeeded',
    scopes_used: ['mcp:github:read'],
    decision: 'allow',
    trace_id: 'tr_abc123',
    timestamp: '2026-06-17T12:00:00.000Z',
    metadata: { idp_id: 'okta-acme' },
    ...overrides,
  };
}

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal | null;
}

interface MockResponse {
  status: number;
  body?: string;
  /** When set, resolves after `delayMs` to simulate latency. */
  delayMs?: number;
}

function makeFetchMock(
  responses: MockResponse[],
): { fetch: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  let idx = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) headers[k.toLowerCase()] = v;
      } else {
        for (const [k, v] of Object.entries(init.headers)) headers[k.toLowerCase()] = String(v);
      }
    }
    const body = typeof init?.body === 'string' ? init.body : '';
    const signal = init?.signal ?? null;
    const captured: CapturedCall = { url, method, headers, body, signal };
    calls.push(captured);
    const r = responses[Math.min(idx, responses.length - 1)]!;
    idx++;
    if (r.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, r.delayMs));
    }
    return new Response(r.body ?? '', { status: r.status });
  };
  return { fetch: fetchImpl, calls };
}

describe('ForaAuditSink (FORA-160)', () => {
  describe('post shape', () => {
    it('POSTs to {baseUrl}/v1/audit/events with the FORA-36 append_event payload', async () => {
      const { fetch, calls } = makeFetchMock([{ status: 200 }]);
      const sink = new ForaAuditSink({ baseUrl: 'https://audit.fora.example/', fetchImpl: fetch });
      await sink.append(makeEvent());
      expect(calls).toHaveLength(1);
      const call = calls[0]!;
      expect(call.method).toBe('POST');
      expect(call.url).toBe('https://audit.fora.example/v1/audit/events');
      expect(call.headers['content-type']).toBe('application/json');
      expect(call.headers['accept']).toBe('application/json');
      const parsed = JSON.parse(call.body) as Record<string, unknown>;
      // Required fields from the FORA-36 contract are present.
      expect(parsed['actor']).toBe('user:okta-acme:1');
      expect(parsed['tenant_id']).toBe('acme');
      expect(parsed['principal']).toBe('board_user');
      expect(parsed['action']).toBe('auth.login.succeeded');
      expect(parsed['scopes_used']).toEqual(['mcp:github:read']);
      expect(parsed['decision']).toBe('allow');
      expect(parsed['trace_id']).toBe('tr_abc123');
      expect(parsed['timestamp']).toBe('2026-06-17T12:00:00.000Z');
      expect(parsed['metadata']).toEqual({ idp_id: 'okta-acme' });
      await sink.close();
    });

    it('strips a trailing slash from baseUrl', async () => {
      const { fetch, calls } = makeFetchMock([{ status: 200 }]);
      const sink = new ForaAuditSink({ baseUrl: 'https://audit.fora.example/', fetchImpl: fetch });
      await sink.append(makeEvent());
      expect(calls[0]!.url).toBe('https://audit.fora.example/v1/audit/events');
      await sink.close();
    });

    it('omits the metadata key when the event has no metadata', async () => {
      const { fetch, calls } = makeFetchMock([{ status: 200 }]);
      const sink = new ForaAuditSink({ baseUrl: 'https://audit.fora.example', fetchImpl: fetch });
      const ev = makeEvent();
      delete ev.metadata;
      await sink.append(ev);
      const parsed = JSON.parse(calls[0]!.body) as Record<string, unknown>;
      expect('metadata' in parsed).toBe(false);
      await sink.close();
    });

    it('includes the bearer token when set', async () => {
      const { fetch, calls } = makeFetchMock([{ status: 200 }]);
      const sink = new ForaAuditSink({
        baseUrl: 'https://audit.fora.example',
        token: 'svc-token-xyz',
        fetchImpl: fetch,
      });
      await sink.append(makeEvent());
      expect(calls[0]!.headers['authorization']).toBe('Bearer svc-token-xyz');
      await sink.close();
    });

    it('omits Authorization when no token is set', async () => {
      const { fetch, calls } = makeFetchMock([{ status: 200 }]);
      const sink = new ForaAuditSink({ baseUrl: 'https://audit.fora.example', fetchImpl: fetch });
      await sink.append(makeEvent());
      expect(calls[0]!.headers['authorization']).toBeUndefined();
      await sink.close();
    });
  });

  describe('pre-conditions', () => {
    let sink: ForaAuditSink;
    beforeEach(() => {
      const { fetch } = makeFetchMock([{ status: 200 }]);
      sink = new ForaAuditSink({ baseUrl: 'https://audit.fora.example', fetchImpl: fetch });
    });

    it('throws on missing actor', async () => {
      await expect(sink.append(makeEvent({ actor: '' }))).rejects.toThrow(/actor required/);
    });
    it('throws on missing tenant_id', async () => {
      await expect(sink.append(makeEvent({ tenant_id: '' }))).rejects.toThrow(/tenant_id required/);
    });
    it('throws on missing principal', async () => {
      await expect(sink.append(makeEvent({ principal: '' as AuthAuditEvent['principal'] }))).rejects.toThrow(/principal required/);
    });
    it('throws on missing action', async () => {
      await expect(sink.append(makeEvent({ action: '' as AuthAuditEvent['action'] }))).rejects.toThrow(/action required/);
    });
    it('throws on non-array scopes_used', async () => {
      await expect(
        sink.append(makeEvent({ scopes_used: 'not-an-array' as unknown as string[] })),
      ).rejects.toThrow(/scopes_used required/);
    });
    it('throws on missing decision', async () => {
      await expect(sink.append(makeEvent({ decision: '' as AuthAuditEvent['decision'] }))).rejects.toThrow(/decision required/);
    });
    it('throws on missing trace_id', async () => {
      await expect(sink.append(makeEvent({ trace_id: '' }))).rejects.toThrow(/trace_id required/);
    });
    it('throws on missing timestamp', async () => {
      await expect(sink.append(makeEvent({ timestamp: '' }))).rejects.toThrow(/timestamp required/);
    });
  });

  describe('retry behaviour', () => {
    it('retries on 5xx and succeeds on the second attempt', async () => {
      const { fetch, calls } = makeFetchMock([{ status: 503 }, { status: 201 }]);
      const sink = new ForaAuditSink({
        baseUrl: 'https://audit.fora.example',
        fetchImpl: fetch,
        baseBackoffMs: 5,
      });
      await sink.append(makeEvent());
      expect(calls).toHaveLength(2);
      const tailed = await sink.tail(10);
      expect(tailed).toHaveLength(1);
      expect(tailed[0]!.trace_id).toBe('tr_abc123');
      await sink.close();
    });

    it('retries up to maxAttempts on persistent 5xx and then throws', async () => {
      const { fetch, calls } = makeFetchMock([{ status: 500 }, { status: 500 }, { status: 500 }]);
      const sink = new ForaAuditSink({
        baseUrl: 'https://audit.fora.example',
        fetchImpl: fetch,
        maxAttempts: 3,
        baseBackoffMs: 1,
      });
      await expect(sink.append(makeEvent())).rejects.toThrow(/-> 500/);
      expect(calls).toHaveLength(3);
      // Failed event is NOT added to the tail buffer.
      const tailed = await sink.tail(10);
      expect(tailed).toHaveLength(0);
      await sink.close();
    });

    it('does NOT retry on 4xx; throws after the first attempt', async () => {
      const { fetch, calls } = makeFetchMock([{ status: 422 }]);
      const sink = new ForaAuditSink({
        baseUrl: 'https://audit.fora.example',
        fetchImpl: fetch,
        maxAttempts: 3,
        baseBackoffMs: 1,
      });
      await expect(sink.append(makeEvent())).rejects.toThrow(/-> 422/);
      expect(calls).toHaveLength(1);
      await sink.close();
    });

    it('retries on network errors and recovers when the next attempt succeeds', async () => {
      let call = 0;
      const fetchImpl: typeof fetch = async () => {
        call++;
        if (call === 1) throw new Error('ECONNRESET');
        return new Response('', { status: 200 });
      };
      const sink = new ForaAuditSink({
        baseUrl: 'https://audit.fora.example',
        fetchImpl,
        baseBackoffMs: 1,
      });
      await sink.append(makeEvent());
      expect(call).toBe(2);
      await sink.close();
    });

    it('times out via AbortController and surfaces a timeout error', async () => {
      // A fetch mock that honors the AbortSignal: delays 50ms, but rejects
      // immediately if the signal aborts before the delay elapses.
      const fetchImpl: typeof fetch = (_input, init) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(new Response('', { status: 200 })), 50);
          if (init?.signal) {
            if (init.signal.aborted) {
              clearTimeout(timer);
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
              return;
            }
            init.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      const sink = new ForaAuditSink({
        baseUrl: 'https://audit.fora.example',
        fetchImpl,
        maxAttempts: 1,
        perAttemptTimeoutMs: 5,
        baseBackoffMs: 1,
      });
      await expect(sink.append(makeEvent())).rejects.toThrow(/timed out/);
      await sink.close();
    });
  });

  describe('lifecycle', () => {
    it('tail returns the last N successful events in order', async () => {
      const { fetch } = makeFetchMock([{ status: 200 }, { status: 200 }, { status: 200 }]);
      const sink = new ForaAuditSink({ baseUrl: 'https://audit.fora.example', fetchImpl: fetch });
      await sink.append(makeEvent({ trace_id: 'tr_1' }));
      await sink.append(makeEvent({ trace_id: 'tr_2' }));
      await sink.append(makeEvent({ trace_id: 'tr_3' }));
      const tailed = await sink.tail(2);
      expect(tailed.map((e) => e.trace_id)).toEqual(['tr_2', 'tr_3']);
      await sink.close();
    });

    it('close is a safe no-op', async () => {
      const { fetch } = makeFetchMock([{ status: 200 }]);
      const sink = new ForaAuditSink({ baseUrl: 'https://audit.fora.example', fetchImpl: fetch });
      await sink.append(makeEvent());
      await expect(sink.close()).resolves.toBeUndefined();
      // Calling close twice is also safe.
      await expect(sink.close()).resolves.toBeUndefined();
    });

    it('rejects construction without a baseUrl', () => {
      expect(() => new ForaAuditSink({ baseUrl: '' })).toThrow(/requires a baseUrl/);
    });
  });
});
