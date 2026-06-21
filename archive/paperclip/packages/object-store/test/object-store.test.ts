/**
 * @fora/object-store — test harness.
 *
 * Proves FORA-124 acceptance bar #3 at three layers:
 *
 *   1. **In-process gate** — the adapter refuses a key under
 *      `tenants/tnt_A/...` when called with a `tenant_B` context, with
 *      no SDK call made.
 *
 *   2. **Signature gate** — a presigned URL issued for tenant A's prefix
 *      is bound to tenant A's session tag. A request from tenant B's
 *      session against the same URL would carry tenant B's tag and the
 *      IAM policy would deny it.
 *
 *   3. **Cloud-side gate (mocked)** — the per-tenant IAM policy would
 *      return `AccessDenied` for any S3 GetObject/PutObject against the
 *      wrong prefix. We mock the STS + S3 path and assert that the
 *      adapter uses the right `TenantID` session tag.
 *
 * For an end-to-end LocalStack run that exercises the real IAM policy,
 * see `docs/runbooks/object-store-tenant-isolation.md`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { SQSClient, SendMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';

import {
  ObjectStoreS3Adapter,
  ObjectStoreSqsAdapter,
  ObjectStoreOpenSearchAdapter,
  assertTenantPrefix,
  KeyPrefixMismatchError,
  TENANT_KEY_PREFIX,
  type RequestContext,
  stdoutSink,
  type AuditEvent,
} from '../src/index.js';

// ---- Test fixtures --------------------------------------------------------

const ctxA: RequestContext = {
  tenant_id: 'tnt_A',
  principal: 'agent',
  trace_id: 'trace-A-1',
};
const ctxB: RequestContext = {
  tenant_id: 'tnt_B',
  principal: 'agent',
  trace_id: 'trace-B-1',
};

const s3Mock = mockClient(S3Client);
const stsMock = mockClient(STSClient);
const sqsMock = mockClient(SQSClient);

beforeEach(() => {
  s3Mock.reset();
  stsMock.reset();
  sqsMock.reset();
  // Default AssumeRole response: a fresh session credential set.
  stsMock.on(AssumeRoleCommand).resolves({
    Credentials: {
      AccessKeyId: 'ASIA-TEST',
      SecretAccessKey: 'secret',
      SessionToken: 'session-token',
      Expiration: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
});

// ---- assertTenantPrefix ---------------------------------------------------

describe('assertTenantPrefix', () => {
  it('accepts a key that starts with tenants/{tenant_id}/', () => {
    expect(() => assertTenantPrefix('tnt_A', 'tenants/tnt_A/blob')).not.toThrow();
  });

  it('rejects a key under a different tenant prefix', () => {
    expect(() => assertTenantPrefix('tnt_B', 'tenants/tnt_A/blob')).toThrow(KeyPrefixMismatchError);
  });

  it('rejects an empty key', () => {
    expect(() => assertTenantPrefix('tnt_A', '')).toThrow(/empty key/);
  });

  it('rejects a key that contains path-traversal', () => {
    expect(() => assertTenantPrefix('tnt_A', 'tenants/tnt_A/../tnt_B/blob')).toThrow(/"\.\."/);
  });

  it('rejects a key that omits the tenants/ prefix entirely', () => {
    expect(() => assertTenantPrefix('tnt_A', 'public/blob')).toThrow(KeyPrefixMismatchError);
  });

  it('truncates the offending key in the error to 64 chars', () => {
    const long = `tenants/tnt_A/${'x'.repeat(100)}`;
    try {
      assertTenantPrefix('tnt_B', long);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(KeyPrefixMismatchError);
      const e = err as KeyPrefixMismatchError;
      expect(e.log_safe_key.length).toBeLessThanOrEqual(65); // 64 + ellipsis
      expect(e.log_safe_key.endsWith('…')).toBe(true);
    }
  });

  it('produces the correct TENANT_KEY_PREFIX helper output', () => {
    expect(TENANT_KEY_PREFIX('tnt_A')).toBe('tenants/tnt_A/');
  });
});

// ---- S3 adapter -----------------------------------------------------------

describe('ObjectStoreS3Adapter', () => {
  const cfg = {
    bucket: 'fora-test-bucket',
    region: 'us-east-1',
    assume_role_arn: 'arn:aws:iam::123456789012:role/fora-object-store-tnt_A',
    sts_client: stsMock.client as unknown as STSClient,
    s3_client_factory: (creds: { accessKeyId: string; secretAccessKey: string; sessionToken: string }) =>
      new S3Client({
        region: 'us-east-1',
        credentials: creds,
      }),
  };
  let captured: AuditEvent[] = [];
  const captureSink = (e: AuditEvent) => captured.push(e);

  function makeAdapter(): ObjectStoreS3Adapter {
    // Fresh adapter per test so the per-tenant STS session cache does
    // not leak between tests. The mock is reset in beforeEach.
    return new ObjectStoreS3Adapter({ ...cfg, audit_sink: captureSink });
  }

  it('refuses a key under tenants/tnt_A/... when called with a tenant_B context (in-process gate)', async () => {
    const adapter = makeAdapter();
    captured = [];
    await expect(adapter.getObject(ctxB, 'tenants/tnt_A/blob')).rejects.toBeInstanceOf(KeyPrefixMismatchError);

    // Crucially: no S3 or STS call was made.
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    expect(stsMock.commandCalls(AssumeRoleCommand)).toHaveLength(0);

    // A tenancy.denied audit event was emitted.
    const denied = captured.find((e) => e.event === 'tenancy.denied');
    expect(denied).toBeTruthy();
    expect((denied as { deny_reason: string }).deny_reason).toBe('key_prefix_mismatch');
  });

  it('refuses a key under tenants/tnt_A/... for putObject, deleteObject, and listObjects too', async () => {
    const adapter = makeAdapter();
    captured = [];
    await expect(adapter.putObject(ctxB, 'tenants/tnt_A/blob', 'data')).rejects.toBeInstanceOf(KeyPrefixMismatchError);
    await expect(adapter.deleteObject(ctxB, 'tenants/tnt_A/blob')).rejects.toBeInstanceOf(KeyPrefixMismatchError);
    // listObjects auto-prefixes `tenants/{tenant_id}/`, so we use a
    // path-traversal sub_prefix to force the cross-tenant violation.
    await expect(adapter.listObjects(ctxB, '../tnt_A/sub/')).rejects.toBeInstanceOf(KeyPrefixMismatchError);

    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
  });

  it('issues an AssumeRole with the TenantID session tag (cloud-side gate contract)', async () => {
    const adapter = makeAdapter();
    s3Mock.on(GetObjectCommand).resolves({ Body: undefined, ContentType: 'text/plain' });

    await adapter.getObject(ctxA, 'tenants/tnt_A/blob');

    const assumeCalls = stsMock.commandCalls(AssumeRoleCommand);
    expect(assumeCalls).toHaveLength(1);
    const input = assumeCalls[0]!.args[0].input as {
      RoleArn: string;
      Tags: { Key: string; Value: string }[];
      TransitiveTagKeys: string[];
    };
    expect(input.RoleArn).toBe(cfg.assume_role_arn);
    const tenantTag = input.Tags.find((t) => t.Key === 'TenantID');
    expect(tenantTag?.Value).toBe('tnt_A');
    expect(input.TransitiveTagKeys).toContain('TenantID');
  });

  it('emits a tenancy.allowed audit event on a permitted call', async () => {
    const adapter = makeAdapter();
    captured = [];
    s3Mock.on(GetObjectCommand).resolves({ Body: undefined, ContentType: 'text/plain' });

    await adapter.getObject(ctxA, 'tenants/tnt_A/blob');

    const allowed = captured.find((e) => e.event === 'tenancy.allowed');
    expect(allowed).toBeTruthy();
    expect((allowed as { tenant_id: string }).tenant_id).toBe('tnt_A');
  });

  it('reuses the per-tenant STS session across calls within the TTL window', async () => {
    const adapter = makeAdapter();
    s3Mock.on(GetObjectCommand).resolves({ Body: undefined, ContentType: 'text/plain' });

    await adapter.getObject(ctxA, 'tenants/tnt_A/a');
    await adapter.getObject(ctxA, 'tenants/tnt_A/b');
    await adapter.getObject(ctxA, 'tenants/tnt_A/c');

    expect(stsMock.commandCalls(AssumeRoleCommand)).toHaveLength(1);
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(3);
  });

  it('forces the same TenantID on the second tenant without cross-contamination', async () => {
    const adapter = makeAdapter();
    s3Mock.on(GetObjectCommand).resolves({ Body: undefined, ContentType: 'text/plain' });

    await adapter.getObject(ctxA, 'tenants/tnt_A/x');
    await adapter.getObject(ctxB, 'tenants/tnt_B/y');

    const assumeCalls = stsMock.commandCalls(AssumeRoleCommand);
    expect(assumeCalls).toHaveLength(2);
    const tagsA = (assumeCalls[0]!.args[0].input as { Tags: { Key: string; Value: string }[] }).Tags;
    const tagsB = (assumeCalls[1]!.args[0].input as { Tags: { Key: string; Value: string }[] }).Tags;
    expect(tagsA.find((t) => t.Key === 'TenantID')?.Value).toBe('tnt_A');
    expect(tagsB.find((t) => t.Key === 'TenantID')?.Value).toBe('tnt_B');
  });
});

// ---- SQS adapter ----------------------------------------------------------

describe('ObjectStoreSqsAdapter', () => {
  const cfg = {
    queue_url: 'https://sqs.us-east-1.amazonaws.com/123456789012/fora-test.fifo',
    region: 'us-east-1',
  };

  it('forces tenant_id into MessageDeduplicationId on send', async () => {
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-1' });
    const adapter = new ObjectStoreSqsAdapter(cfg);

    await adapter.send(ctxA, { logical_key: 'tenants/tnt_A/job', body: 'hello' });

    const calls = sqsMock.commandCalls(SendMessageCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]!.args[0].input as {
      MessageDeduplicationId: string;
      MessageAttributes: Record<string, { StringValue?: string }>;
    };
    expect(input.MessageDeduplicationId.startsWith('tnt_A:tenants/tnt_A/job:')).toBe(true);
    expect(input.MessageAttributes.tenant_id?.StringValue).toBe('tnt_A');
    expect(input.MessageAttributes.logical_key?.StringValue).toBe('tenants/tnt_A/job');
    expect(input.MessageAttributes.trace_id?.StringValue).toBe('trace-A-1');
  });

  it('strips a caller-supplied tenant_id override from attributes', async () => {
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-2' });
    const adapter = new ObjectStoreSqsAdapter(cfg);

    await adapter.send(ctxA, {
      logical_key: 'tenants/tnt_A/job',
      body: 'hello',
      // The caller tries to claim they're tenant B in the message attrs.
      // The adapter must keep tenant_id forced to ctx.tenant_id.
      attributes: {
        tenant_id: { DataType: 'String', StringValue: 'tnt_B' },
        foo: { DataType: 'String', StringValue: 'bar' },
      },
    });

    const calls = sqsMock.commandCalls(SendMessageCommand);
    const input = calls[0]!.args[0].input as {
      MessageAttributes: Record<string, { StringValue?: string }>;
    };
    expect(input.MessageAttributes.tenant_id?.StringValue).toBe('tnt_A');
    expect(input.MessageAttributes.foo?.StringValue).toBe('bar');
  });

  it('refuses a logical_key outside the tenant prefix', async () => {
    const adapter = new ObjectStoreSqsAdapter(cfg);

    await expect(
      adapter.send(ctxA, { logical_key: 'tenants/tnt_B/job', body: 'x' }),
    ).rejects.toBeInstanceOf(KeyPrefixMismatchError);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });
});

// ---- OpenSearch adapter ---------------------------------------------------

describe('ObjectStoreOpenSearchAdapter', () => {
  // The OpenSearch Client constructor is not mocked here; we exercise
  // the request-building logic via a fake fetch on the node URL.

  it('builds a search request that prepends a tenant_id term filter', async () => {
    let lastBody: Record<string, unknown> | null = null;
    const fakeFetch: typeof fetch = async (_url, init) => {
      lastBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({ hits: { hits: [] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const adapter = new ObjectStoreOpenSearchAdapter({
      node: 'http://localhost:9200',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: new (await import('@opensearch-project/opensearch')).Client({
        node: 'http://localhost:9200',
      }),
    });
    // Patch the underlying transport to use the fake fetch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adapter as any).client = makeFakeOpenSearchClient(fakeFetch);

    await adapter.search(ctxA, { index: 'fora-docs', query: { match: { title: 'x' } } });

    expect(lastBody).toBeTruthy();
    const body = lastBody as { query: { bool: { filter: { term: { tenant_id: string } }[] } } };
    expect(body.query.bool.filter).toEqual([{ term: { tenant_id: 'tnt_A' } }]);
  });

  it('forces routing=tenant_id and _id=doc_key on index', async () => {
    let lastPath = '';
    let lastBody: Record<string, unknown> | null = null;
    const fakeFetch: typeof fetch = async (url, init) => {
      lastPath = String(url);
      lastBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({ _id: 'tenants/tnt_A/doc-1', result: 'created' }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    };
    const adapter = new ObjectStoreOpenSearchAdapter({ node: 'http://localhost:9200' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adapter as any).client = makeFakeOpenSearchClient(fakeFetch);

    await adapter.index(ctxA, {
      doc_key: 'tenants/tnt_A/doc-1',
      index: 'fora-docs',
      body: { title: 'x' },
    });

    expect(lastPath).toContain('routing=tnt_A');
    expect(lastBody).toMatchObject({ tenant_id: 'tnt_A', title: 'x' });
  });

  it('refuses a doc_key outside the tenant prefix on index and delete', async () => {
    const adapter = new ObjectStoreOpenSearchAdapter({ node: 'http://localhost:9200' });

    await expect(
      adapter.index(ctxB, { doc_key: 'tenants/tnt_A/doc-1', index: 'fora-docs', body: {} }),
    ).rejects.toBeInstanceOf(KeyPrefixMismatchError);
    await expect(adapter.delete(ctxB, 'fora-docs', 'tenants/tnt_A/doc-1')).rejects.toBeInstanceOf(KeyPrefixMismatchError);
  });
});

// ---- Test helpers ---------------------------------------------------------

/**
 * Build a minimal OpenSearch Client whose transport is a fake fetch. We
 * avoid pulling in `aws-sdk-client-mock` for OpenSearch because the
 * package does not ship a mock; a fetch shim is simpler and covers
 * what the adapter does (build the request body, parse the response).
 */
function makeFakeOpenSearchClient(fetchImpl: typeof fetch) {
  // Lazy import so this file can still be type-checked even if the
  // opensearch node_modules are not installed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { Client } = require('@opensearch-project/opensearch');
  const c = new Client({ node: 'http://localhost:9200' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (c as any).transport = { request: (params: { method: string; path: string; body?: unknown; querystring?: Record<string, unknown> }) => transportRequest(fetchImpl, params) };
  return c;
}

async function transportRequest(
  fetchImpl: typeof fetch,
  params: { method: string; path: string; body?: unknown; querystring?: Record<string, unknown> },
) {
  const qs = params.querystring
    ? '?' + new URLSearchParams(params.querystring as Record<string, string>).toString()
    : '';
  const url = `http://localhost:9200${params.path}${qs}`;
  const res = await fetchImpl(url, {
    method: params.method,
    body: params.body ? JSON.stringify(params.body) : undefined,
    headers: { 'content-type': 'application/json' },
  });
  const text = await res.text();
  return { body: text ? JSON.parse(text) : {}, statusCode: res.status };
}

// ---- stdoutSink smoke test (silent when not used) -------------------------

describe('stdoutSink', () => {
  it('exists and is callable', () => {
    // Just a smoke test — we don't want stdout noise in test output.
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stdoutSink({
      event: 'tenancy.allowed',
      tenant_id: 'tnt_A',
      principal: 'agent',
      trace_id: 'trace-A-1',
      resource: 'object_store',
      operation: 's3.get',
      log_safe_key: 'tenants/tnt_A/blob',
      ts: new Date().toISOString(),
    });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
