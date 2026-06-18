/**
 * Tests for the Paperclip HTTP adapter (FORA-169).
 *
 * Verifies the wire contract:
 *   - Body shape: kind, idempotencyKey, target, continuationPolicy, payload.
 *   - Authorization: Bearer header from the configured api key.
 *   - Run-id propagation: X-Paperclip-Run-Id on every call.
 *   - Retry policy: 5xx retried with exponential backoff; 4xx fails loud.
 *   - Typed errors: VALIDATION / IDEMPOTENCY_CONFLICT / UPSTREAM_UNAVAILABLE / NETWORK.
 *   - reissue() carries `metadata.superseded_interaction_id`.
 *   - Duplicate `idempotencyKey` returns the same interactionId
 *     (the API is the dedupe boundary).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  PaperclipHttpClient,
  PaperclipHttpError,
} from '../src/paperclip-client-http.js';
import type { PaperclipInteraction } from '../src/router-types.js';

const ISSUE_ID = 'issue-orchestrator-1';
const RUN_ID = 'run-1234-5678';
const API_KEY = 'sk_test_abc123';
const API_URL = 'https://paperclip.example.test';

const BASE_INTERACTION: PaperclipInteraction = {
  kind: 'request_confirmation',
  idempotencyKey: 'approval:run-1:dev->qa',
  targetIssueId: ISSUE_ID,
  target: {
    type: 'issue_document',
    issueId: ISSUE_ID,
    key: 'plan',
    revisionId: 'rev-1-deadbeef',
  },
  continuationPolicy: 'wake_assignee',
  payload: {
    title: 'PR merged + CI green — advance to QA',
    prompt: 'Gate `dev->qa` for run `run-1`.\n\nArtefacts:\n- pr: https://github.com/fora/repo/pull/42',
    role: 'qa',
    artefactRefs: [
      { kind: 'pr', url: 'https://github.com/fora/repo/pull/42' },
    ],
    ttlSeconds: 3600,
  },
};

interface CapturedCall {
  url: string;
  init: RequestInit;
}

interface FetchStub {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
  calls: CapturedCall[];
  /** Programmable response sequence. Each entry is consumed in order. */
  responses: Array<() => Response>;
}

function makeFetchStub(): FetchStub {
  const stub = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    stub.calls.push({ url, init: init ?? {} });
    if (stub.responses.length === 0) {
      throw new Error(
        `fetchStub: no programmed response left (call #${stub.calls.length} to ${url})`,
      );
    }
    const next = stub.responses.shift();
    if (!next) {
      throw new Error('unreachable: shift returned undefined');
    }
    return next();
  }) as FetchStub;
  stub.calls = [];
  stub.responses = [];
  return stub;
}

function jsonResponse(status: number, body: unknown): () => Response {
  return () => {
    const r = new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
    // Sanity check the stub constructed what the adapter expects.
    if (typeof (r as Response).json !== 'function') {
      throw new Error(
        `jsonResponse: stub Response lacks .json() — got ${typeof r}, constructor ${r.constructor?.name}`,
      );
    }
    return r;
  };
}

function noopSleep(): Promise<void> {
  return Promise.resolve();
}

function makeClient(overrides: Partial<Parameters<typeof PaperclipHttpClient>[0]> = {}) {
  const fetchImpl = overrides.fetchImpl ?? makeFetchStub();
  const client = new PaperclipHttpClient({
    apiUrl: API_URL,
    apiKey: API_KEY,
    runId: RUN_ID,
    fetchImpl,
    sleep: noopSleep,
    ...overrides,
  });
  return { client, fetchImpl: fetchImpl as FetchStub };
}

describe('PaperclipHttpClient.issue', () => {
  let fetchStub: FetchStub;
  let client: PaperclipHttpClient;

  beforeEach(() => {
    const m = makeClient();
    client = m.client;
    fetchStub = m.fetchImpl;
  });

  it('POSTs to /api/issues/{issueId}/interactions with the wire body', async () => {
    fetchStub.responses.push(
      jsonResponse(201, {
        id: 'pc-12345',
      }),
    );

    const out = await client.issue({
      issueId: ISSUE_ID,
      interaction: BASE_INTERACTION,
    });

    expect(out.interactionId).toBe('pc-12345');
    expect(fetchStub.calls).toHaveLength(1);
    const call = fetchStub.calls[0]!;
    expect(call.url).toBe(
      `${API_URL}/api/issues/${ISSUE_ID}/interactions`,
    );
    expect(call.init.method).toBe('POST');

    const headers = call.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['authorization']).toBe(`Bearer ${API_KEY}`);
    expect(headers['x-paperclip-run-id']).toBe(RUN_ID);

    const body = JSON.parse(call.init.body as string);
    expect(body).toEqual({
      kind: 'request_confirmation',
      idempotencyKey: BASE_INTERACTION.idempotencyKey,
      target: BASE_INTERACTION.target,
      continuationPolicy: 'wake_assignee',
      payload: {
        ...BASE_INTERACTION.payload,
        version: 1,
      },
    });
    // `targetIssueId` lives in the URL path, not the body.
    expect(body).not.toHaveProperty('targetIssueId');
    expect(body).not.toHaveProperty('metadata');
  });

  it('supports the direct { interactionId: ... } response format', async () => {
    fetchStub.responses.push(
      jsonResponse(201, { interactionId: 'pc-new-format' }),
    );

    const out = await client.issue({
      issueId: ISSUE_ID,
      interaction: BASE_INTERACTION,
    });
    expect(out.interactionId).toBe('pc-new-format');
  });

  it('honors the trailing-slash on apiUrl and does not double-slash', async () => {
    const trailing = makeClient({ apiUrl: `${API_URL}/` });
    trailing.fetchImpl.responses.push(
      jsonResponse(201, { id: 'pc-x' }),
    );
    await trailing.client.issue({
      issueId: ISSUE_ID,
      interaction: BASE_INTERACTION,
    });
    expect(trailing.fetchImpl.calls[0]!.url).toBe(
      `${API_URL}/api/issues/${ISSUE_ID}/interactions`,
    );
  });

  it('uses request_board_approval wire kind for the board gate', async () => {
    fetchStub.responses.push(
      jsonResponse(201, { id: 'pc-board-1' }),
    );
    await client.issue({
      issueId: ISSUE_ID,
      interaction: {
        ...BASE_INTERACTION,
        kind: 'request_board_approval',
        continuationPolicy: 'wake_assignee_on_accept',
        idempotencyKey: 'approval:run-1:launch',
      },
    });
    const body = JSON.parse(fetchStub.calls[0]!.init.body as string);
    expect(body.kind).toBe('request_board_approval');
    expect(body.continuationPolicy).toBe('wake_assignee_on_accept');
  });

  it('returns the same interactionId for a duplicate idempotencyKey (API is the dedupe boundary)', async () => {
    // First call: API returns pc-1.
    fetchStub.responses.push(
      jsonResponse(201, { id: 'pc-1' }),
    );
    // Second call with the same key: API returns the original id.
    fetchStub.responses.push(
      jsonResponse(201, { id: 'pc-1' }),
    );

    const a = await client.issue({
      issueId: ISSUE_ID,
      interaction: BASE_INTERACTION,
    });
    const b = await client.issue({
      issueId: ISSUE_ID,
      interaction: BASE_INTERACTION,
    });
    expect(a.interactionId).toBe('pc-1');
    expect(b.interactionId).toBe('pc-1');
    // The router is allowed to call the API twice with the same key;
    // the API does not stack a second card.
    expect(fetchStub.calls).toHaveLength(2);
    expect(JSON.parse(fetchStub.calls[1]!.init.body as string).idempotencyKey).toBe(
      BASE_INTERACTION.idempotencyKey,
    );
  });

  it('retries 5xx with exponential backoff and succeeds on the second attempt', async () => {
    fetchStub.responses.push(jsonResponse(503, { error: { code: 'UNAVAILABLE', message: 'down' } }));
    fetchStub.responses.push(
      jsonResponse(201, { id: 'pc-recovered' }),
    );

    const sleeps: number[] = [];
    const m = makeClient({
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    m.fetchImpl.responses.push(
      jsonResponse(503, { error: { code: 'UNAVAILABLE', message: 'down' } }),
    );
    m.fetchImpl.responses.push(
      jsonResponse(201, { id: 'pc-recovered' }),
    );

    const out = await m.client.issue({
      issueId: ISSUE_ID,
      interaction: BASE_INTERACTION,
    });
    expect(out.interactionId).toBe('pc-recovered');
    expect(m.fetchImpl.calls).toHaveLength(2);
    expect(sleeps).toEqual([250]); // first attempt failed → sleep 250ms → retry
  });

  it('retries through the full budget with exponential backoff', async () => {
    const sleeps: number[] = [];
    const m = makeClient({
      maxAttempts: 3,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    m.fetchImpl.responses.push(jsonResponse(502, {}));
    m.fetchImpl.responses.push(jsonResponse(502, {}));
    m.fetchImpl.responses.push(jsonResponse(502, {}));

    await expect(
      m.client.issue({ issueId: ISSUE_ID, interaction: BASE_INTERACTION }),
    ).rejects.toMatchObject({
      name: 'PaperclipHttpError',
      code: 'UPSTREAM_UNAVAILABLE',
      httpStatus: 502,
    });
    expect(m.fetchImpl.calls).toHaveLength(3);
    expect(sleeps).toEqual([250, 500]); // backoff doubles each time
  });

  it('surfaces 4xx as PaperclipHttpError with code VALIDATION (do NOT retry)', async () => {
    fetchStub.responses.push(
      jsonResponse(400, { error: { code: 'VALIDATION', message: 'bad target' } }),
    );

    await expect(
      client.issue({ issueId: ISSUE_ID, interaction: BASE_INTERACTION }),
    ).rejects.toBeInstanceOf(PaperclipHttpError);

    // Verify retry budget was 1 (no retry on 400).
    expect(fetchStub.calls).toHaveLength(1);
  });

  it('maps IDEMPOTENCY_CONFLICT api code to the typed error code', async () => {
    const m = makeClient();
    m.fetchImpl.responses.push(
      jsonResponse(409, { error: { code: 'IDEMPOTENCY_CONFLICT', message: 'reused' } }),
    );
    await expect(
      m.client.issue({ issueId: ISSUE_ID, interaction: BASE_INTERACTION }),
    ).rejects.toMatchObject({
      name: 'PaperclipHttpError',
      code: 'IDEMPOTENCY_CONFLICT',
      apiCode: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('surfaces a 2xx without an interactionId as VALIDATION', async () => {
    fetchStub.responses.push(jsonResponse(200, { data: { foo: 'bar' } }));
    await expect(
      client.issue({ issueId: ISSUE_ID, interaction: BASE_INTERACTION }),
    ).rejects.toMatchObject({
      name: 'PaperclipHttpError',
      code: 'VALIDATION',
      httpStatus: 200,
    });
  });

  it('maps fetch network failures to NETWORK (retry then throw)', async () => {
    const m = makeClient({
      sleep: noopSleep,
    });
    // Make fetch itself throw (DNS / TLS / abort).
    m.fetchImpl.responses.push(() => {
      throw new TypeError('fetch failed: ECONNREFUSED');
    });
    m.fetchImpl.responses.push(() => {
      throw new TypeError('fetch failed: ECONNREFUSED');
    });
    m.fetchImpl.responses.push(() => {
      throw new TypeError('fetch failed: ECONNREFUSED');
    });

    await expect(
      m.client.issue({ issueId: ISSUE_ID, interaction: BASE_INTERACTION }),
    ).rejects.toMatchObject({
      name: 'PaperclipHttpError',
      code: 'NETWORK',
    });
    expect(m.fetchImpl.calls).toHaveLength(3);
  });
});

describe('PaperclipHttpClient.reissue', () => {
  it('records superseded_interaction_id in the body metadata', async () => {
    const m = makeClient();
    m.fetchImpl.responses.push(
      jsonResponse(201, { id: 'pc-rev2' }),
    );

    const out = await m.client.reissue({
      issueId: ISSUE_ID,
      interaction: {
        ...BASE_INTERACTION,
        idempotencyKey: 'approval:run-1:dev->qa:rev2',
      },
      supersededInteractionId: 'pc-original-1234',
    });

    expect(out.interactionId).toBe('pc-rev2');
    expect(m.fetchImpl.calls).toHaveLength(1);
    const body = JSON.parse(m.fetchImpl.calls[0]!.init.body as string);
    expect(body.idempotencyKey).toBe('approval:run-1:dev->qa:rev2');
    expect(body.metadata).toEqual({
      superseded_interaction_id: 'pc-original-1234',
    });
  });

  it('omits metadata on a plain issue() call', async () => {
    const m = makeClient();
    m.fetchImpl.responses.push(
      jsonResponse(201, { id: 'pc-fresh' }),
    );
    await m.client.issue({
      issueId: ISSUE_ID,
      interaction: BASE_INTERACTION,
    });
    const body = JSON.parse(m.fetchImpl.calls[0]!.init.body as string);
    expect(body).not.toHaveProperty('metadata');
  });
});

describe('PaperclipHttpClient construction', () => {
  it('rejects missing apiUrl', () => {
    expect(() =>
      new PaperclipHttpClient({
        apiUrl: '',
        apiKey: API_KEY,
        runId: RUN_ID,
      }),
    ).toThrow(/apiUrl/);
  });

  it('rejects missing apiKey', () => {
    expect(() =>
      new PaperclipHttpClient({
        apiUrl: API_URL,
        apiKey: '',
        runId: RUN_ID,
      }),
    ).toThrow(/apiKey/);
  });

  it('rejects missing runId', () => {
    expect(() =>
      new PaperclipHttpClient({
        apiUrl: API_URL,
        apiKey: API_KEY,
        runId: '',
      }),
    ).toThrow(/runId/);
  });
});
