/**
 * FORA-126.5 — per-service AWS SDK dispatch.
 *
 * Acceptance bars:
 *   1. `s3:GetObject` against a (mock) AWS returns the S3 object's
 *      metadata — the real `client.send(new Command(params))` shape
 *      is preserved and the response is redacted of credential-shaped
 *      fields.
 *   2. The credential holder is wiped from `HOLDER_REGISTRY` after
 *      `perform()` returns — a second `perform()` with the same
 *      handle throws `aws_handle_already_released`.
 *   3. Per-tenant+service rate limiting: a burst beyond the bucket
 *      capacity fails fast with `aws_rate_limited:<service>`, and
 *      the limit is per-tenant (one tenant's burst does not consume
 *      another tenant's tokens).
 *   4. Per-tenant+service circuit breaker: consecutive failures trip
 *      the breaker open; subsequent calls fail fast with
 *      `aws_circuit_open:<service>`; cooldown + half-open probe
 *      behaviour. Crucially, a breaker that is open for tenant A
 *      does not affect tenant B.
 *   5. Audit event payload contains the response minus any
 *      credential-shaped fields (the existing `assertNoCredentials`
 *      factory guard is the second-line check).
 *
 * The tests use the adapter's `dispatch_fn` test seam to inject
 * canned responses (or canned failures) without contacting AWS.
 * A separate integration test (FORA-126.5 follow-up) wires the
 * default `dispatch_fn` against a local HTTP mock that speaks both
 * the query protocol (CloudFormation) and JSON 1.1 (Cloud Control).
 */

import { describe, it, expect } from 'vitest';
import {
  AwsAdapter,
  TokenBucket,
  CircuitBreaker,
  type DispatchFn,
  type AwsAdapterOptions,
} from '../src/adapters/aws.js';
import type { AwsActionArgs } from '../src/types.js';

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

function stubAssumeResponse() {
  return {
    Credentials: {
      AccessKeyId: 'ASIA-TEST-KEY-DO-NOT-USE',
      SecretAccessKey: 'test-secret-not-real',
      SessionToken: 'test-session-not-real',
      Expiration: new Date(Date.now() + 14 * 60 * 1000),
    },
    AssumedRoleUser: { Arn: 'arn:aws:sts::111122223333:assumed-role/x', AssumedRoleId: 'AROA:stub' },
    PackedPolicySize: 0,
    SourceIdentity: undefined,
    SubjectFromWebIdentityToken: undefined,
    Provider: 'stub',
    ResponseMetadata: { requestId: 'stub' },
  };
}

function defaultArgs(overrides: Partial<AwsActionArgs> = {}): AwsActionArgs {
  return {
    cloud: 'aws',
    role_arn: 'arn:aws:iam::111122223333:role/ForgeBrokeredDeployRole',
    region: 'us-east-1',
    service: 's3',
    operation: 'GetObject',
    params: { Bucket: 'acme-prod', Key: 'index.html' },
    ...overrides,
  };
}

/**
 * Build a fresh `AwsAdapter` for a single test. Each test gets its
 * own adapter so per-tenant+service state is isolated.
 *
 * The default dispatch_fn returns a credential-free success response.
 * Tests that need custom dispatch behaviour pass `opts.dispatch`.
 */
function makeAdapter(opts: {
  dispatch?: DispatchFn;
  reliability?: AwsAdapterOptions['reliability'];
} = {}): AwsAdapter {
  const defaultDispatch: DispatchFn = async (service, operation) => ({
    stub: true,
    service,
    operation,
  });
  return new AwsAdapter({
    broker_issuer: 'https://identity-broker.fora.local/auth',
    broker_audience: 'customer-cloud-broker',
    assume_fn: async () => stubAssumeResponse(),
    dispatch_fn: opts.dispatch ?? defaultDispatch,
    reliability: opts.reliability,
  });
}

/**
 * Build an assume_fn whose `AccessKeyId` encodes the FORA JWT
 * (anything after the last `.`). The dispatch_fn can then inspect the
 * holder's accessKeyId to attribute each call to a "tenant". This is
 * the simplest way to test per-tenant isolation without threading
 * tenant_id through every test helper.
 *
 * The encoding uses the *full* tenant id (no truncation) so the
 * fixture can distinguish `tenantA` from `tenantB` (which both start
 * with "tenant"). The real adapter uses the real accessKeyId; this
 * encoding is test-only.
 */
function tenantAwareAssumeFn() {
  return async (input: { WebIdentityToken: string }) => {
    const jwt = input.WebIdentityToken;
    const tenant = jwt.split('.').pop() ?? 'unknown';
    // Replace the entire access key id with a tenant-prefixed stub
    // that does NOT match the AKIA shape (so the credential-scan
    // property test in memory-dump-scan.test.ts does not flag it).
    const res = stubAssumeResponse();
    res.Credentials.AccessKeyId = `TEST-${tenant}-KEY`;
    return res;
  };
}

// ---------------------------------------------------------------------------
// Per-service dispatch — exercises every service+operation listed in
// the FORA-126.5 acceptance bar. The test does not contact AWS; the
// `dispatch_fn` returns a canned response which the adapter redacts
// before returning.
// ---------------------------------------------------------------------------

describe('FORA-126.5 per-service dispatch', () => {
  it.each([
    ['s3', 'GetObject', { ContentLength: 42, ContentType: 'text/html' }],
    ['s3', 'PutObject', { ETag: '"abc123"', VersionId: 'v1' }],
    ['s3', 'ListBuckets', { Buckets: [{ Name: 'acme-prod' }] }],
    ['ec2', 'DescribeInstances', { Reservations: [] }],
    ['iam', 'GetUser', { User: { UserName: 'svc-deploy', UserId: 'AIDAEXAMPLE' } }],
    ['iam', 'ListUsers', { Users: [] }],
    ['cloudformation', 'DescribeStacks', { Stacks: [] }],
    ['cloudcontrol', 'GetResource', { ResourceDescription: { Identifier: 'my-bucket' } }],
    ['cloudcontrol', 'ListResources', { ResourceDescriptions: [] }],
  ])('dispatches %s:%s and returns the canned response', async (service, operation, canned) => {
    const calls: Array<{ service: string; operation: string; region: string }> = [];
    const adapter = makeAdapter({
      dispatch: async (svc, op, _params, _holder, region) => {
        calls.push({ service: svc, operation: op, region });
        return canned;
      },
    });
    const { handle } = await adapter.assume(defaultArgs({ service, operation }), 'stub.fora.jwt');
    const result = await adapter.perform(handle, defaultArgs({ service, operation }), { tenant_id: 'acme' });
    expect(result).toEqual(canned);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ service, operation, region: 'us-east-1' });
  });

  it('rejects an unsupported service before touching the dispatcher', async () => {
    const adapter = makeAdapter({
      dispatch: async () => {
        throw new Error('dispatch_should_not_be_called');
      },
    });
    const { handle } = await adapter.assume(defaultArgs(), 'stub.fora.jwt');
    await expect(
      adapter.perform(handle, defaultArgs({ service: 'lambda' }), { tenant_id: 'acme' }),
    ).rejects.toThrow(/unsupported_aws_service:lambda/);
  });

  it('rejects an unsupported operation before touching the dispatcher', async () => {
    const adapter = makeAdapter({
      dispatch: async () => {
        throw new Error('dispatch_should_not_be_called');
      },
    });
    const { handle } = await adapter.assume(defaultArgs(), 'stub.fora.jwt');
    await expect(
      adapter.perform(handle, defaultArgs({ service: 's3', operation: 'DeleteBucket' }), {
        tenant_id: 'acme',
      }),
    ).rejects.toThrow(/unsupported_aws_service_operation:s3:DeleteBucket/);
  });

  it('strips credential-shaped fields from the response', async () => {
    const leaky = {
      ETag: '"abc"',
      // The SDK does not normally return these, but a buggy mock or a
      // future service response could. The redaction guard catches it
      // before the audit factory asserts.
      AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'aws_secret_access_key=AAAA',
      session_token: 'FwoGZXIvYXdzEXAMPLE',
    };
    const adapter = makeAdapter({
      dispatch: async () => leaky,
    });
    const { handle } = await adapter.assume(
      defaultArgs({ service: 's3', operation: 'PutObject' }),
      'stub.fora.jwt',
    );
    const result = (await adapter.perform(
      handle,
      defaultArgs({ service: 's3', operation: 'PutObject' }),
      { tenant_id: 'acme' },
    )) as Record<string, unknown>;
    // Non-credential fields are preserved.
    expect(result.ETag).toBe('"abc"');
    // Credential-shaped keys are removed entirely.
    expect('AccessKeyId' in result).toBe(false);
    expect('secretAccessKey' in result).toBe(false);
    expect('session_token' in result).toBe(false);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toMatch(/AKIA/);
    expect(serialised).not.toMatch(/aws_secret_access_key/);
  });

  it('releases the handle after perform() (no leak to a second call)', async () => {
    const adapter = makeAdapter();
    const { handle } = await adapter.assume(defaultArgs(), 'stub.fora.jwt');
    await adapter.perform(handle, defaultArgs(), { tenant_id: 'acme' });
    await expect(
      adapter.perform(handle, defaultArgs(), { tenant_id: 'acme' }),
    ).rejects.toThrow(/aws_handle_already_released/);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting — per-tenant+service token bucket.
// ---------------------------------------------------------------------------

describe('FORA-126.5 per-tenant+service rate limiting', () => {
  it('TokenBucket: permits up to capacity then fails fast', () => {
    let now = 0;
    const b = new TokenBucket({ capacity: 3, refill_per_sec: 0, now: () => now });
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    expect(b.take()).toBe(false);
  });

  it('TokenBucket: refills at the configured rate', () => {
    let now = 0;
    const b = new TokenBucket({ capacity: 2, refill_per_sec: 1, now: () => now });
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    now += 1000; // 1 second elapsed → 1 token refilled
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });

  it('performs up to N calls in a burst, then fails fast with aws_rate_limited', async () => {
    const adapter = makeAdapter({
      reliability: { rate_capacity: 3, rate_per_sec: 0, breaker_threshold: 999, breaker_cooldown_ms: 60_000 },
    });
    for (let i = 0; i < 3; i++) {
      const { handle } = await adapter.assume(defaultArgs(), 'stub.fora.jwt');
      await adapter.perform(handle, defaultArgs(), { tenant_id: 'acme' });
    }
    // 4th call: fresh handle, but the per-tenant+service bucket is empty.
    const { handle } = await adapter.assume(defaultArgs(), 'stub.fora.jwt');
    await expect(
      adapter.perform(handle, defaultArgs(), { tenant_id: 'acme' }),
    ).rejects.toThrow(/aws_rate_limited:s3/);
  });

  it('rate limit is per-tenant: one tenant burst does not starve another', async () => {
    const adapter = makeAdapter({
      reliability: { rate_capacity: 2, rate_per_sec: 0, breaker_threshold: 999, breaker_cooldown_ms: 60_000 },
    });
    // Tenant A burns its bucket.
    for (let i = 0; i < 2; i++) {
      const { handle } = await adapter.assume(defaultArgs(), 'stub.fora.jwt');
      await adapter.perform(handle, defaultArgs(), { tenant_id: 'tenantA' });
    }
    const { handle: handleA } = await adapter.assume(defaultArgs(), 'stub.fora.jwt');
    await expect(
      adapter.perform(handleA, defaultArgs(), { tenant_id: 'tenantA' }),
    ).rejects.toThrow(/aws_rate_limited:s3/);
    // Tenant B is unaffected.
    const { handle: handleB } = await adapter.assume(defaultArgs(), 'stub.fora.jwt');
    const result = await adapter.perform(handleB, defaultArgs(), { tenant_id: 'tenantB' });
    expect(result).toBeTruthy();
  });

  it('rate limit is per-service: one service burst does not starve another', async () => {
    const adapter = makeAdapter({
      reliability: { rate_capacity: 1, rate_per_sec: 0, breaker_threshold: 999, breaker_cooldown_ms: 60_000 },
    });
    // Burn s3 bucket.
    let res = await adapter.assume(defaultArgs({ service: 's3', operation: 'GetObject' }), 'stub.fora.jwt');
    await adapter.perform(res.handle, defaultArgs({ service: 's3', operation: 'GetObject' }), {
      tenant_id: 'acme',
    });
    res = await adapter.assume(defaultArgs({ service: 's3', operation: 'GetObject' }), 'stub.fora.jwt');
    await expect(
      adapter.perform(res.handle, defaultArgs({ service: 's3', operation: 'GetObject' }), {
        tenant_id: 'acme',
      }),
    ).rejects.toThrow(/aws_rate_limited:s3/);
    // ec2 has its own bucket.
    const { handle } = await adapter.assume(
      defaultArgs({ service: 'ec2', operation: 'DescribeInstances' }),
      'stub.fora.jwt',
    );
    const result = await adapter.perform(
      handle,
      defaultArgs({ service: 'ec2', operation: 'DescribeInstances' }),
      { tenant_id: 'acme' },
    );
    expect(result).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Circuit breaker — per-tenant+service isolation.
// ---------------------------------------------------------------------------

describe('FORA-126.5 per-tenant+service circuit breaker', () => {
  it('CircuitBreaker: trips open after failure_threshold consecutive failures', () => {
    let now = 0;
    const cb = new CircuitBreaker({ failure_threshold: 3, cooldown_ms: 1000, now: () => now });
    expect(cb.state).toBe('closed');
    cb.onFailure();
    cb.onFailure();
    expect(cb.state).toBe('closed');
    cb.onFailure();
    expect(cb.state).toBe('open');
    expect(cb.canPass()).toBe(false);
  });

  it('CircuitBreaker: half-open after cooldown, success closes', () => {
    let now = 0;
    const cb = new CircuitBreaker({ failure_threshold: 2, cooldown_ms: 100, now: () => now });
    cb.onFailure();
    cb.onFailure();
    expect(cb.state).toBe('open');
    expect(cb.canPass()).toBe(false);
    now += 150;
    expect(cb.canPass()).toBe(true); // → half_open, probe allowed
    expect(cb.state).toBe('half_open');
    expect(cb.canPass()).toBe(false); // a second caller during half-open is rejected
    cb.onSuccess();
    expect(cb.state).toBe('closed');
  });

  it('CircuitBreaker: failure during half-open re-opens the breaker', () => {
    let now = 0;
    const cb = new CircuitBreaker({ failure_threshold: 1, cooldown_ms: 100, now: () => now });
    cb.onFailure();
    now += 150;
    cb.canPass(); // → half_open probe allowed
    cb.onFailure(); // probe failed
    expect(cb.state).toBe('open');
    expect(cb.canPass()).toBe(false);
  });

  it('perform() trips the breaker after consecutive dispatcher errors', async () => {
    const adapter = makeAdapter({
      reliability: { rate_capacity: 999, rate_per_sec: 999, breaker_threshold: 3, breaker_cooldown_ms: 60_000 },
      dispatch: async () => {
        throw new Error('AccessDenied');
      },
    });
    for (let i = 0; i < 3; i++) {
      const { handle } = await adapter.assume(defaultArgs(), 'stub.fora.jwt');
      await expect(
        adapter.perform(handle, defaultArgs(), { tenant_id: 'acme' }),
      ).rejects.toThrow(/AccessDenied/);
    }
    // The breaker is now open — a fresh handle+call fails fast with
    // circuit-open, NOT with the underlying error.
    const { handle } = await adapter.assume(defaultArgs(), 'stub.fora.jwt');
    await expect(
      adapter.perform(handle, defaultArgs(), { tenant_id: 'acme' }),
    ).rejects.toThrow(/aws_circuit_open:s3/);
  });

  it('circuit breaker is per-tenant: tenantA degraded does not affect tenantB', async () => {
    // The dispatch fails for tenantA only. The adapter uses the
    // tenant-aware assume_fn so the holder's accessKeyId encodes
    // the tenant (the dispatch_fn inspects it to decide whether to
    // fail). tenantB's dispatch returns a success response.
    const dispatch: DispatchFn = async (_service, _operation, _params, holder) => {
      if (holder.accessKeyId.includes('tenantA')) {
        throw new Error('AccessDenied');
      }
      return { ok: true };
    };
    const adapter = new AwsAdapter({
      broker_issuer: 'https://identity-broker.fora.local/auth',
      broker_audience: 'customer-cloud-broker',
      assume_fn: tenantAwareAssumeFn(),
      dispatch_fn: dispatch,
      reliability: { rate_capacity: 999, rate_per_sec: 999, breaker_threshold: 2, breaker_cooldown_ms: 60_000 },
    });
    // Trip tenantA's breaker.
    for (let i = 0; i < 2; i++) {
      const { handle } = await adapter.assume(defaultArgs(), 'stub.fora.jwt.tenantA');
      await expect(
        adapter.perform(handle, defaultArgs(), { tenant_id: 'tenantA' }),
      ).rejects.toThrow(/AccessDenied/);
    }
    const { handle: handleA } = await adapter.assume(defaultArgs(), 'stub.fora.jwt.tenantA');
    await expect(
      adapter.perform(handleA, defaultArgs(), { tenant_id: 'tenantA' }),
    ).rejects.toThrow(/aws_circuit_open:s3/);
    // tenantB has its own breaker; still in closed state.
    const { handle: handleB } = await adapter.assume(defaultArgs(), 'stub.fora.jwt.tenantB');
    const result = await adapter.perform(handleB, defaultArgs(), { tenant_id: 'tenantB' });
    expect(result).toBeTruthy();
  });

  it('circuit breaker is per-service: s3 degraded does not affect ec2', async () => {
    let s3Count = 0;
    const adapter = makeAdapter({
      reliability: { rate_capacity: 999, rate_per_sec: 999, breaker_threshold: 2, breaker_cooldown_ms: 60_000 },
      dispatch: async (service) => {
        if (service === 's3') {
          s3Count++;
          throw new Error('AccessDenied');
        }
        return { ok: true, service };
      },
    });
    for (let i = 0; i < 2; i++) {
      const { handle } = await adapter.assume(defaultArgs({ service: 's3' }), 'stub.fora.jwt');
      await expect(
        adapter.perform(handle, defaultArgs({ service: 's3' }), { tenant_id: 'acme' }),
      ).rejects.toThrow(/AccessDenied/);
    }
    const { handle: handleA } = await adapter.assume(defaultArgs({ service: 's3' }), 'stub.fora.jwt');
    await expect(
      adapter.perform(handleA, defaultArgs({ service: 's3' }), { tenant_id: 'acme' }),
    ).rejects.toThrow(/aws_circuit_open:s3/);
    // ec2 breaker is independent.
    const { handle: handleB } = await adapter.assume(
      defaultArgs({ service: 'ec2', operation: 'DescribeInstances' }),
      'stub.fora.jwt',
    );
    const result = await adapter.perform(
      handleB,
      defaultArgs({ service: 'ec2', operation: 'DescribeInstances' }),
      { tenant_id: 'acme' },
    );
    expect(result).toBeTruthy();
    expect(s3Count).toBe(2); // Only the s3 attempts hit the dispatch.
  });
});

// ---------------------------------------------------------------------------
// Default dispatch function — exercises the real lazy SDK loader with a
// fake holder. We do not assert on the SDK response shape (the AWS SDK
// would attempt a real network call), but we DO assert that an
// unsupported service is rejected before any SDK import is attempted.
// ---------------------------------------------------------------------------

describe('FORA-126.5 default dispatch function (lazy SDK import)', () => {
  it('rejects unsupported service before importing the SDK package', async () => {
    const adapter = new AwsAdapter({
      broker_issuer: 'https://identity-broker.fora.local/auth',
      broker_audience: 'customer-cloud-broker',
      assume_fn: async () => stubAssumeResponse(),
      // No dispatch_fn override → defaultDispatchFn is used.
    });
    const { handle } = await adapter.assume(defaultArgs(), 'stub.fora.jwt');
    await expect(
      adapter.perform(handle, defaultArgs({ service: 'totally-fake-service' }), { tenant_id: 'acme' }),
    ).rejects.toThrow(/unsupported_aws_service:totally-fake-service/);
  });

  it('rejects unsupported operation before instantiating a client', async () => {
    const adapter = new AwsAdapter({
      broker_issuer: 'https://identity-broker.fora.local/auth',
      broker_audience: 'customer-cloud-broker',
      assume_fn: async () => stubAssumeResponse(),
    });
    const { handle } = await adapter.assume(defaultArgs(), 'stub.fora.jwt');
    await expect(
      adapter.perform(handle, defaultArgs({ service: 's3', operation: 'DeleteEverything' }), {
        tenant_id: 'acme',
      }),
    ).rejects.toThrow(/unsupported_aws_service_operation:s3:DeleteEverything/);
  });
});
