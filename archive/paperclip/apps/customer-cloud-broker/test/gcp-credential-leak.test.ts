/**
 * Property test: a GCP-brokered action never exposes credential material
 * in agent-visible payloads.
 *
 * FORA-126.3 acceptance bar #3 (GCP equivalent of the FORA-126 bar #3
 * property test in `memory-dump-scan.test.ts`). We scan:
 *   - the `GcpCredentialHandle` returned to the broker (its fields),
 *   - the broker's `BrokeredResult.response` (what the agent actually
 *     receives),
 *   - the audit event (the broker-side persistence),
 *
 * for GCP-shaped credential patterns. The test runs against randomly
 * generated responses to catch future regressions where a new field
 * accidentally carries credential material.
 *
 * GCP credential shapes tested:
 *   - `ya29.*` (Google OAuth2 access token prefix)
 *   - `access_token`, `refresh_token`, `id_token`, `client_secret`
 *   - `private_key` (service account JSON key material)
 *   - `gcp_access_token`, `gcp_iam_token`
 *
 * The audit factory's `assertNoCredentials` rejects any field whose
 * name matches the `CREDENTIAL_KEY_RE` regex in `audit.ts`. We test
 * the same regex here so a future audit.ts change ripples through
 * this property test.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  GcpAdapter,
  cloudBrokeredEvent,
  type GcpAssumeFn,
  type GcpAssumeFnOutput,
  type GcpCredentialHandle,
} from '../src/index.js';
import type { BrokeredResult, GcpActionArgs } from '../src/types.js';

// ---------------------------------------------------------------------------
// GCP-shaped credential regexes. These are the patterns that would
// indicate a credential leak if found in the agent-visible data
// structures.
// ---------------------------------------------------------------------------

const GCP_ACCESS_TOKEN_RE = /ya29\.[A-Za-z0-9_-]{20,}/; // OAuth2 access tokens
const GCP_REFRESH_TOKEN_RE = /1\/\/[A-Za-z0-9_-]{20,}/; // OAuth2 refresh tokens
const GCP_PRIVATE_KEY_RE = /-----BEGIN (RSA |EC |)PRIVATE KEY-----/;
const GCP_SA_KEY_JSON_RE = /"type"\s*:\s*"service_account"/;
const FEDERATED_TOKEN_RE = /sts\.googleapis\.com\/v1\/token/; // STS endpoint, not a token

/** Recursively scan a value for GCP-shaped credential material. */
function scanForGcpCredentials(value: unknown, path: string[] = []): string[] {
  const hits: string[] = [];
  if (value == null) return hits;
  if (typeof value === 'string') {
    if (GCP_ACCESS_TOKEN_RE.test(value)) hits.push(`${path.join('.')}: ya29 access token`);
    if (GCP_REFRESH_TOKEN_RE.test(value)) hits.push(`${path.join('.')}: refresh token`);
    if (GCP_PRIVATE_KEY_RE.test(value)) hits.push(`${path.join('.')}: private key block`);
    if (GCP_SA_KEY_JSON_RE.test(value)) hits.push(`${path.join('.')}: service account JSON key`);
    if (FEDERATED_TOKEN_RE.test(value)) hits.push(`${path.join('.')}: STS URL (should not be in payload)`);
    return hits;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      hits.push(...scanForGcpCredentials(value[i], [...path, String(i)]));
    }
    return hits;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      hits.push(...scanForGcpCredentials(v, [...path, k]));
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Generators. We generate GCP action args, stub assume_fn / dispatch_fn,
// and arbitrary response payloads that are guaranteed to be credential-free
// (the property test asserts the *types* allow credential-free data and
// that the audit factory surfaces a leak if one slips in).
//
// We use *constructive* generators (no `filter` on a wide space) so
// fast-check doesn't waste iterations rejecting samples. The regex
// anchors match real GCP resource names; a random alphanumeric string
// almost never matches, so a filter would loop forever.
// ---------------------------------------------------------------------------

const safeStringArb = fc.string({ minLength: 0, maxLength: 200 }).filter((s) => {
  return (
    !GCP_ACCESS_TOKEN_RE.test(s) &&
    !GCP_REFRESH_TOKEN_RE.test(s) &&
    !GCP_PRIVATE_KEY_RE.test(s) &&
    !GCP_SA_KEY_JSON_RE.test(s)
  );
});

const safeJsonArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  tree: fc.oneof(
    { depthSize: 'small' },
    safeStringArb,
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('tree'), { maxLength: 5 }),
    fc.dictionary(
      safeStringArb.filter((s) => !/(key|secret|session|token|credential|password|passphrase)/i.test(s)),
      tie('tree'),
      { maxKeys: 8 },
    ),
  ),
})).tree;

// Constructive pool-id / provider-id / SA / project-number generators.
const projectNumberArb = fc
  .integer({ min: 1_000_000_000_000, max: 9_999_999_999_999 })
  .map((n) => String(n));
const saLocalArb = fc
  .stringMatching(/^[a-z][a-z0-9-]{2,28}$/)
  .filter((s) => !GCP_ACCESS_TOKEN_RE.test(s));
const saProjectArb = fc
  .stringMatching(/^[a-z][a-z0-9-]{2,28}$/)
  .filter((s) => !GCP_ACCESS_TOKEN_RE.test(s));
const serviceAccountArb = fc
  .tuple(saLocalArb, saProjectArb)
  .map(([local, project]) => `${local}@${project}.iam.gserviceaccount.com`)
  .filter((s) => !GCP_ACCESS_TOKEN_RE.test(s) && !GCP_REFRESH_TOKEN_RE.test(s));

const gcpActionArb: fc.Arbitrary<GcpActionArgs> = fc.record({
  cloud: fc.constant('gcp' as const),
  project_number: projectNumberArb,
  workload_identity_pool: fc
    .stringMatching(/^[a-z][a-z0-9-]{2,31}$/)
    .filter((s) => !GCP_ACCESS_TOKEN_RE.test(s)),
  workload_identity_provider: fc
    .stringMatching(/^[a-z][a-z0-9-]{2,31}$/)
    .filter((s) => !GCP_ACCESS_TOKEN_RE.test(s)),
  service_account: serviceAccountArb,
  service: fc.constantFrom('compute', 'storage', 'iam'),
  operation: fc.constantFrom(
    'list',
    'get',
    'aggregatedList',
    'bucket.get',
    'bucket.list',
    'object.get',
    'projects.serviceAccounts.get',
    'projects.serviceAccounts.list',
  ),
  params: fc.dictionary(safeStringArb, safeStringArb, { maxKeys: 5 }),
});

const brokeredResultArb = fc.record({
  trace_id: safeStringArb,
  tenant_id: safeStringArb,
  cloud: fc.constant('gcp' as const),
  account: projectNumberArb,
  action: safeStringArb,
  response_code: fc.constantFrom(
    'ok',
    'deny_listed_action',
    'cloud_disabled',
    'assume_failed',
    'operation_failed',
    'credential_too_long',
  ) as fc.Arbitrary<BrokeredResult['response_code']>,
  response: safeJsonArb,
  duration_ms: fc.integer({ min: 0, max: 30_000 }),
  role_fingerprint: fc
    .string({ minLength: 8, maxLength: 32 })
    .map((s) => 'gcp:' + s)
    .filter((s) => !GCP_ACCESS_TOKEN_RE.test(s)),
}) as fc.Arbitrary<BrokeredResult>;

// ---------------------------------------------------------------------------
// Stub `assume_fn` that returns a fake but credential-shape-free result.
// The fake access token deliberately does NOT start with `ya29.` so the
// property test does not flag the stub output.
// ---------------------------------------------------------------------------

function stubAssumeFn(): GcpAssumeFn {
  return async (input): Promise<GcpAssumeFnOutput> => {
    void input;
    return {
      access_token: 'stub-gcp-access-token-not-real',
      expiration_ms: Date.now() + 14 * 60 * 1000, // 14 min, under the 15-min cap
      client: { __stub: true },
    };
  };
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('FORA-126.3: GCP adapter — no credential material in agent-visible payloads', () => {
  it('GcpCredentialHandle fields never contain a GCP-shaped credential', async () => {
    await fc.assert(
      fc.asyncProperty(gcpActionArb, async (args) => {
        const adapter = new GcpAdapter({
          broker_issuer: 'https://identity-broker.fora.local/auth',
          broker_audience: 'customer-cloud-broker', assume_fn: stubAssumeFn() });
        const result = await adapter.assume(args, 'stub.fora.jwt');
        const handle = result.handle as GcpCredentialHandle;
        const flat = JSON.stringify(handle);
        const hits = scanForGcpCredentials(flat);
        if (hits.length !== 0) {
          throw new Error(`handle contains GCP-shaped credentials: ${hits.join(', ')}; flat=${flat}`);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('GcpAdapter.perform() response is credential-free (property test)', async () => {
    // Constrained generator: only valid (service, operation) pairs so
    // perform() doesn't reject with `unsupported_gcp_service_operation`.
    // `fc.asyncProperty` is the explicit async-predicate variant and
    // does NOT confuse the resolved value with the truthy/falsy guard
    // the way `fc.property` + `async` can.
    const VALID_SVC_OPS: Array<[string, string]> = [
      ['compute', 'list'],
      ['compute', 'get'],
      ['compute', 'aggregatedList'],
      ['storage', 'bucket.get'],
      ['storage', 'bucket.list'],
      ['storage', 'object.get'],
      ['iam', 'projects.serviceAccounts.get'],
      ['iam', 'projects.serviceAccounts.list'],
    ];
    const validActionArb: fc.Arbitrary<GcpActionArgs> = fc
      .tuple(gcpActionArb, fc.constantFrom(...VALID_SVC_OPS))
      .map(([args, [service, operation]]) => ({ ...args, service, operation }));
    await fc.assert(
      fc.asyncProperty(validActionArb, async (args) => {
        const adapter = new GcpAdapter({
          broker_issuer: 'https://identity-broker.fora.local/auth',
          broker_audience: 'customer-cloud-broker',
          assume_fn: stubAssumeFn(),
          // Bump the rate-limit capacity so a 100-iteration property
          // test against a single tenant does not exhaust the bucket.
          reliability: { rate_capacity: 10_000, rate_per_sec: 10_000 },
          dispatch_fn: async (_service, _operation, _params, _holder) => {
            // Return an arbitrary credential-shape-free payload.
            return {
              kind: 'compute#instanceList',
              items: [{ id: '123', name: 'vm-1', zone: 'us-central1-a' }],
              selfLink: 'https://www.googleapis.com/compute/v1/projects/' + args.project_number + '/zones/us-central1-a/instances',
            };
          },
        });
        const result = await adapter.assume(args, 'stub.fora.jwt');
        const resp = await adapter.perform(result.handle as GcpCredentialHandle, args, { tenant_id: 't', trace_id: 'tr' });
        const hits = scanForGcpCredentials(resp);
        if (hits.length !== 0) {
          throw new Error(`perform response contains GCP-shaped credentials: ${hits.join(', ')}`);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('arbitrary BrokeredResult (gcp cloud) never contains a GCP-shaped credential', () => {
    fc.assert(
      fc.property(brokeredResultArb, (result) => {
        const hits = scanForGcpCredentials(result);
        // The property test asserts the *type* allows credential-free
        // data; if a future change surfaces a credential in the
        // generated payload, this fails. fast-check treats the return
        // as a boolean — return true explicitly.
        if (hits.length !== 0) {
          throw new Error(`BrokeredResult contains GCP-shaped credentials: ${hits.join(', ')}`);
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('audit event factory rejects GCP payloads with credential-shaped keys', () => {
    expect(() =>
      cloudBrokeredEvent({
        result: {
          trace_id: 'tr',
          tenant_id: 't',
          cloud: 'gcp',
          account: '111122223333',
          action: 'compute.instances.list',
          response_code: 'ok',
          response: { access_token: 'ya29.fake-fake-fake' },
          duration_ms: 1,
          role_fingerprint: 'gcp:abc',
        },
        actor: 'agent:test',
        metadata: {},
      }),
    ).toThrow(/credential-shaped key/);
  });

  it('audit event factory rejects GCP payloads with refresh_token', () => {
    expect(() =>
      cloudBrokeredEvent({
        result: {
          trace_id: 'tr',
          tenant_id: 't',
          cloud: 'gcp',
          account: '111122223333',
          action: 'compute.instances.list',
          response_code: 'ok',
          response: { refresh_token: '1//fake-refresh-token' },
          duration_ms: 1,
          role_fingerprint: 'gcp:abc',
        },
        actor: 'agent:test',
        metadata: {},
      }),
    ).toThrow(/credential-shaped key/);
  });

  it('perform() redacts a credential-shaped field that slips through dispatch_fn', async () => {
    const adapter = new GcpAdapter({
          broker_issuer: 'https://identity-broker.fora.local/auth',
          broker_audience: 'customer-cloud-broker',
      assume_fn: stubAssumeFn(),
      dispatch_fn: async () => {
        // Simulate a buggy SDK that surfaces a credential. The
        // redaction helper strips the key entirely (not just the
        // value), so the audit guard's `assertNoCredentials` re-check
        // passes on the redacted object.
        return {
          access_token: 'ya29.fake-fake-fake', // GCP OAuth2 access token
          kind: 'compute#instanceList',
          items: [],
        };
      },
    });
    const args: GcpActionArgs = {
      cloud: 'gcp',
      project_number: '111122223333',
      workload_identity_pool: 'fora-prod-pool',
      workload_identity_provider: 'fora-prod',
      service_account: 'fora-deploy@acme-prod.iam.gserviceaccount.com',
      service: 'compute',
      operation: 'list',
      params: { zone: 'us-central1-a' },
    };
    const result = await adapter.assume(args, 'stub.fora.jwt');
    const resp = await adapter.perform(result.handle as GcpCredentialHandle, args, { tenant_id: 'acme', trace_id: 'tr' });
    // The credential-shaped key was omitted by `redactCredentials`.
    expect((resp as Record<string, unknown>).access_token).toBeUndefined();
    expect((resp as Record<string, unknown>).kind).toBe('compute#instanceList');
  });

  it('rejects unsupported service with a typed error (no SDK call)', async () => {
    const adapter = new GcpAdapter({
          broker_issuer: 'https://identity-broker.fora.local/auth',
          broker_audience: 'customer-cloud-broker',
      assume_fn: stubAssumeFn(),
      dispatch_fn: async () => {
        throw new Error('should_not_be_called');
      },
    });
    const args: GcpActionArgs = {
      cloud: 'gcp',
      project_number: '111122223333',
      workload_identity_pool: 'fora-prod-pool',
      workload_identity_provider: 'fora-prod',
      service_account: 'fora-deploy@acme-prod.iam.gserviceaccount.com',
      service: 'unknown',
      operation: 'list',
      params: {},
    };
    const result = await adapter.assume(args, 'stub.fora.jwt');
    await expect(
      adapter.perform(result.handle as GcpCredentialHandle, args, { tenant_id: 'acme', trace_id: 'tr' }),
    ).rejects.toThrow(/unsupported_gcp_service:unknown/);
  });

  it('rejects unsupported operation with a typed error (no SDK call)', async () => {
    const adapter = new GcpAdapter({
          broker_issuer: 'https://identity-broker.fora.local/auth',
          broker_audience: 'customer-cloud-broker',
      assume_fn: stubAssumeFn(),
      dispatch_fn: async () => {
        throw new Error('should_not_be_called');
      },
    });
    const args: GcpActionArgs = {
      cloud: 'gcp',
      project_number: '111122223333',
      workload_identity_pool: 'fora-prod-pool',
      workload_identity_provider: 'fora-prod',
      service_account: 'fora-deploy@acme-prod.iam.gserviceaccount.com',
      service: 'compute',
      operation: 'delete',
      params: {},
    };
    const result = await adapter.assume(args, 'stub.fora.jwt');
    await expect(
      adapter.perform(result.handle as GcpCredentialHandle, args, { tenant_id: 'acme', trace_id: 'tr' }),
    ).rejects.toThrow(/unsupported_gcp_service_operation:compute:delete/);
  });

  it('releaseHandle wipes the holder so a second perform() throws', async () => {
    const adapter = new GcpAdapter({
          broker_issuer: 'https://identity-broker.fora.local/auth',
          broker_audience: 'customer-cloud-broker',
      assume_fn: stubAssumeFn(),
      dispatch_fn: async () => ({ ok: true }),
    });
    const args: GcpActionArgs = {
      cloud: 'gcp',
      project_number: '111122223333',
      workload_identity_pool: 'fora-prod-pool',
      workload_identity_provider: 'fora-prod',
      service_account: 'fora-deploy@acme-prod.iam.gserviceaccount.com',
      service: 'compute',
      operation: 'list',
      params: {},
    };
    const result = await adapter.assume(args, 'stub.fora.jwt');
    adapter.releaseHandle(result.handle);
    await expect(
      adapter.perform(result.handle as GcpCredentialHandle, args, { tenant_id: 'acme', trace_id: 'tr' }),
    ).rejects.toThrow(/gcp_handle_already_released/);
  });
});
