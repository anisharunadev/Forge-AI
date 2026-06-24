/**
 * Plan F — `lib/seeds/data.ts` API client tests.
 *
 * The fetcher layer is the single contract surface between Plan G/H
 * UI and the Plan C backend (`backend/app/api/v1/seeds.py`). These
 * eight tests assert the request shape (URL + method + body) for
 * each endpoint so a backend rename or path drift is caught in CI.
 *
 * We use `vi.spyOn(globalThis, 'fetch')` — the established pattern
 * in this codebase (see `tests/connectors/connector-lifecycle.test.tsx`)
 * — and assert against the typed return shape so a return-type drift
 * also fails here.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applySeed,
  getSeed,
  getSeedDiff,
  getSeedRuns,
  getSeedStatus,
  listSeeds,
  resetSeed,
  rollbackSeed,
} from '@/lib/seeds/data';
import type {
  SeedDiffRead,
  SeedManifestRead,
  SeedManifestSummary,
  SeedRunRead,
  SeedStatusRead,
} from '@/lib/seeds/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listSeeds', () => {
  it('GETs /api/v1/seeds and parses the manifest summary array', async () => {
    const payload: SeedManifestSummary[] = [
      {
        name: 'kn-base',
        version: 1,
        tenant_type: 'reference',
        description: 'KnackForge baseline',
        depends_on: [],
      },
      {
        name: 'acme-corp',
        version: 2,
        tenant_type: 'demo',
        description: 'Acme Corp demo',
        depends_on: ['kn-base'],
      },
    ];
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(payload));

    const result = await listSeeds();

    const [url, init] = spy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/api/v1/seeds');
    expect(String(url)).not.toContain('?');
    expect(init.method ?? 'GET').toBe('GET');
    expect(result).toEqual(payload);
  });
});

describe('getSeed', () => {
  it('GETs /api/v1/seeds/{name} and parses the full manifest', async () => {
    const payload: SeedManifestRead = {
      name: 'acme-corp',
      version: 2,
      tenant_type: 'demo',
      description: 'Acme Corp demo',
      depends_on: ['kn-base'],
      data_files: [
        {
          file: '01_tenant.json',
          table: 'tenants',
          order: 1,
          idempotency_key: ['id'],
          description: 'Identity',
        },
      ],
      row_counts_expected: { tenants: 1 },
      production_safety: { allow_in_prod: false },
    };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(payload));

    const result = await getSeed('acme-corp');

    const [url, init] = spy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/api/v1/seeds/acme-corp');
    expect(init.method ?? 'GET').toBe('GET');
    expect(result).toEqual(payload);
  });

  it('encodes the seed name in the URL', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({}));

    await getSeed('acme corp/with spaces');
    const [url] = spy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain(encodeURIComponent('acme corp/with spaces'));
  });
});

describe('getSeedStatus', () => {
  it('GETs /api/v1/seeds/{name}/status and parses the status payload', async () => {
    const payload: SeedStatusRead = {
      seed_name: 'acme-corp',
      applied: true,
      applied_version: 2,
      last_run_at: '2026-06-25T00:00:00Z',
      last_run_status: 'completed',
      checksum: 'sha256:abc',
      checksum_match: true,
      drift: 'none',
      row_counts: { tenants: 1 },
      production_safe: false,
    };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(payload));

    const result = await getSeedStatus('acme-corp');

    const [url, init] = spy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/api/v1/seeds/acme-corp/status');
    expect(init.method ?? 'GET').toBe('GET');
    expect(result).toEqual(payload);
  });
});

describe('getSeedDiff', () => {
  it('GETs /api/v1/seeds/{name}/diff and parses the diff payload', async () => {
    const payload: SeedDiffRead = {
      seed_name: 'acme-corp',
      checksum_match: false,
      row_count_changes: { tenants: [1, 2] },
      missing_files: [],
      extra_rows: { tenants: 1 },
      summary: '1 extra row in tenants',
    };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(payload));

    const result = await getSeedDiff('acme-corp');

    const [url] = spy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/api/v1/seeds/acme-corp/diff');
    expect(result).toEqual(payload);
  });
});

describe('getSeedRuns', () => {
  it('GETs /api/v1/seeds/{name}/runs and parses the run array', async () => {
    const payload: SeedRunRead[] = [
      {
        id: 'run-1',
        seed_name: 'acme-corp',
        manifest_version: 2,
        operation: 'apply',
        status: 'completed',
        env: 'development',
        triggered_by: 'cli',
        actor_id: null,
        tenant_id: null,
        row_counts: { tenants: 1 },
        dropped_rows: {},
        checksum_after: 'sha256:abc',
        started_at: '2026-06-25T00:00:00Z',
        completed_at: '2026-06-25T00:00:01Z',
        duration_ms: 1000,
        error: {},
      },
    ];
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(payload));

    const result = await getSeedRuns('acme-corp');

    const [url] = spy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/api/v1/seeds/acme-corp/runs');
    expect(result).toEqual(payload);
  });
});

describe('applySeed', () => {
  it('POSTs the body to /api/v1/seeds/{name}/apply', async () => {
    const run: SeedRunRead = {
      id: 'run-1',
      seed_name: 'acme-corp',
      manifest_version: 2,
      operation: 'apply',
      status: 'completed',
      env: 'development',
      triggered_by: 'ui',
      actor_id: null,
      tenant_id: null,
      row_counts: {},
      dropped_rows: {},
      checksum_after: null,
      started_at: '2026-06-25T00:00:00Z',
      completed_at: null,
      duration_ms: null,
      error: {},
    };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(run));

    const result = await applySeed('acme-corp', { allow_in_prod: true });

    const [url, init] = spy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/api/v1/seeds/acme-corp/apply');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ allow_in_prod: true });
    expect(result).toEqual(run);
  });

  it('defaults to an empty body when no flag is supplied', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({}));

    await applySeed('acme-corp');
    const [, init] = spy.mock.calls[0]! as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({});
  });
});

describe('resetSeed', () => {
  it('POSTs the scope to /api/v1/seeds/{name}/reset', async () => {
    const run: SeedRunRead = {
      id: 'run-2',
      seed_name: 'acme-corp',
      manifest_version: 2,
      operation: 'reset',
      status: 'completed',
      env: 'development',
      triggered_by: 'ui',
      actor_id: null,
      tenant_id: null,
      row_counts: {},
      dropped_rows: { tenants: 1 },
      checksum_after: null,
      started_at: '2026-06-25T00:00:00Z',
      completed_at: null,
      duration_ms: null,
      error: {},
    };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(run));

    const result = await resetSeed('acme-corp', { scope: 'demo_only' });

    const [url, init] = spy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/api/v1/seeds/acme-corp/reset');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ scope: 'demo_only' });
    expect(result).toEqual(run);
  });
});

describe('rollbackSeed', () => {
  it('POSTs to /api/v1/seeds/{name}/rollback with no body', async () => {
    const run: SeedRunRead = {
      id: 'run-3',
      seed_name: 'acme-corp',
      manifest_version: 2,
      operation: 'rollback',
      status: 'rolled_back',
      env: 'development',
      triggered_by: 'ui',
      actor_id: null,
      tenant_id: null,
      row_counts: {},
      dropped_rows: {},
      checksum_after: null,
      started_at: '2026-06-25T00:00:00Z',
      completed_at: null,
      duration_ms: null,
      error: {},
    };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(run));

    const result = await rollbackSeed('acme-corp');

    const [url, init] = spy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/api/v1/seeds/acme-corp/rollback');
    expect(init.method).toBe('POST');
    // rollback has no body — `forgeFetch` still receives a serialized
    // empty object, which the backend ignores.
    expect(result).toEqual(run);
  });
});
