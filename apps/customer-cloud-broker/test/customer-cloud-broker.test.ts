/**
 * End-to-end tests for the customer-cloud-broker (FORA-126 / 0.7.4).
 *
 * Covers the five FORA-126 acceptance bars:
 *   1. A `deploy-agent` action on a tenant whose trust is `active`
 *      succeeds and the audit event contains no credential material.
 *   2. A `deploy-agent` action for a deny-listed cloud action is
 *      rejected with `403 deny_listed_action` and a `cloud.brokered`
 *      event with `response_code = deny_listed`.
 *   3. Memory-dump credential-freeness — covered in
 *      `test/memory-dump-scan.test.ts`.
 *   4. A tenant whose trust is missing or wrong is in `cloud_disabled`
 *      state until repaired.
 *   5. Killing the broker halts all cloud-brokered actions. The unit
 *      test asserts the broker pipeline returns `unsupported_cloud`
 *      when no adapter is registered, simulating "broker cannot
 *      reach cloud" from the agent's perspective.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import { buildServer, type BuildServerDeps } from '../src/server.js';
import {
  loadDenyList,
  DenyListMatcher,
  InMemoryAuditSink,
  BrokerMetrics,
  TrustStore,
  buildAdapterRegistry,
  AwsAdapter,
  AzureAdapter,
  GcpAdapter,
  type BrokeredRequest,
  type TenantCloudTrust,
  type Cloud,
} from '../src/index.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

function buildDenyList(): DenyListMatcher {
  const list = loadDenyList(resolve(REPO_ROOT, 'config/customer-cloud-broker/deny_list.yaml'));
  return new DenyListMatcher(list);
}

function fakeTrust(tenant_id: string, cloud: Cloud, account: string, role_ref: string): TenantCloudTrust {
  return {
    tenant_id,
    cloud,
    account,
    role_ref,
    expected_issuer: 'https://identity-broker.fora.local/auth',
    expected_audience: 'customer-cloud-broker',
    trust_state: 'active',
    last_probed_at: new Date().toISOString(),
    disabled_reason: null,
  };
}

/**
 * Stub `assume_fn` for the AWS adapter. Returns a fake
 * `AssumeRoleWithWebIdentityResponse` that satisfies the holder
 * extraction in `aws.ts::newHolder`. The fake access key id is
 * deliberately NOT in the AKIA shape so the credential-scan
 * property test does not flag the stub output.
 *
 * The `Expiration` is set 14 minutes in the future — under the 15-min
 * cap so the broker's `credential_too_long` check passes even after
 * the small drift between `start` (top of brokerAction) and the
 * stub invocation (inside adapter.assume()).
 */
function stubAssumeFn() {
  return async () => ({
    Credentials: {
      AccessKeyId: 'ASIA-STUB-FOR-UNIT-TEST',
      SecretAccessKey: 'stub-secret-not-a-real-key',
      SessionToken: 'stub-session-token-not-real',
      Expiration: new Date(Date.now() + 14 * 60 * 1000),
    },
    AssumedRoleUser: { Arn: 'arn:aws:sts::111122223333:assumed-role/x', AssumedRoleId: 'AROA:stub' },
    PackedPolicySize: 0,
    SourceIdentity: undefined,
    SubjectFromWebIdentityToken: undefined,
    Provider: 'stub',
    ResponseMetadata: { requestId: 'stub' },
  });
}

/**
 * Stub `dispatch_fn` for the FORA-126.5 per-service dispatcher. The
 * broker's pipeline tests do not want a real AWS SDK call (we cannot
 * hit AWS from CI), and the test assertNoCredentials guard is the
 * actual subject of these tests — so we return a small, deliberately
 * credential-free response. The FORA-126.5 dispatch test file
 * (`test/aws-dispatch.test.ts`) wires its own dispatch_fn to assert
 * per-service behaviour.
 */
function stubDispatchFn() {
  return async (
    _service: string,
    _operation: string,
    _params: Record<string, unknown>,
    _holder: { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration_ms: number },
    _region: string,
  ): Promise<unknown> => {
    return { stubbed: true, service: _service, operation: _operation };
  };
}

interface DepsOptions {
  registerAzureAdapter?: boolean;
  registerGcpAdapter?: boolean;
  addAzureTrust?: boolean;
}

function buildDeps(opts: DepsOptions = {}): BuildServerDeps & { audit: InMemoryAuditSink } {
  const audit = new InMemoryAuditSink();
  const metrics = new BrokerMetrics();
  const deny = buildDenyList();
  const trust_store = new TrustStore();
  // Inject both AWS and (optionally) Azure trust records for acme.
  const acmeTrusts: TenantCloudTrust[] = [
    fakeTrust('acme', 'aws', '111122223333', 'arn:aws:iam::111122223333:role/ForgeBrokeredDeployRole'),
  ];
  if (opts.addAzureTrust) {
    acmeTrusts.push(fakeTrust('acme', 'azure', '00000000-0000-0000-0000-000000000000', 'mi://stub'));
  }
  (trust_store as unknown as { trusts: Map<string, TenantCloudTrust[]> }).trusts.set('acme', acmeTrusts);

  const adapters = buildAdapterRegistry({
    aws: new AwsAdapter({
      broker_issuer: 'https://identity-broker.fora.local/auth',
      broker_audience: 'customer-cloud-broker',
      assume_fn: stubAssumeFn(),
      // The FORA-126.5 dispatcher does not run a real AWS SDK call in
      // tests — the per-service dispatch is stubbed. FORA-126.5 has
      // its own focused test file that exercises the real dispatcher
      // against canned responses.
      dispatch_fn: stubDispatchFn(),
    }),
    azure: opts.registerAzureAdapter ? new AzureAdapter() : undefined,
    gcp: opts.registerGcpAdapter
      ? new GcpAdapter({
          broker_issuer: 'https://identity-broker.fora.local/auth',
          broker_audience: 'customer-cloud-broker',
        })
      : undefined,
  });

  return {
    config: {
      listen_host: '127.0.0.1',
      listen_port: 0,
      public_url: 'http://localhost:7100',
      issuer: 'https://identity-broker.fora.local/auth',
      audience: 'customer-cloud-broker',
      deny_list_path: 'config/customer-cloud-broker/deny_list.yaml',
      tenant_trust_root: 'tenants',
      audit_log_path: '/tmp/test.jsonl',
      env: 'test',
      broker_audience: 'customer-cloud-broker',
    },
    audit,
    metrics,
    trust_store,
    deny_list: deny,
    adapters,
    async mint_fora_jwt(_req) {
      return 'stub.fora.jwt';
    },
  };
}

function buildRequest(overrides: Partial<BrokeredRequest>): BrokeredRequest {
  return {
    trace_id: 'tr_test_1',
    tenant_id: 'acme',
    principal: 'agent',
    agent_type: 'deploy-agent',
    mcp: 'customer-cloud-broker',
    action: 's3:GetObject',
    args: {
      cloud: 'aws',
      role_arn: 'arn:aws:iam::111122223333:role/ForgeBrokeredDeployRole',
      region: 'us-east-1',
      service: 's3',
      operation: 'GetObject',
      params: { Bucket: 'acme-prod', Key: 'index.html' },
    },
    scopes_used: ['read'],
    ...overrides,
  };
}

describe('FORA-126: customer-cloud-broker pipeline', () => {
  let deps: ReturnType<typeof buildDeps>;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    deps = buildDeps();
    app = await buildServer(deps);
    await app.ready();
  });

  it('acceptance bar 1: granted action succeeds and emits a credential-free audit event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/broker/action',
      payload: buildRequest({}),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.response_code).toBe('ok');
    expect(body.cloud).toBe('aws');
    expect(body.action).toBe('s3:GetObject');
    expect(body.duration_ms).toBeGreaterThanOrEqual(0);
    expect(body.role_fingerprint).toMatch(/^aws:/);
    // Audit event: exactly one, no credential material.
    expect(deps.audit.events).toHaveLength(1);
    const ev = deps.audit.events[0];
    expect(ev.action).toBe('cloud.brokered');
    expect(ev.response_code).toBe('ok');
    expect(ev.cloud_action).toBe('s3:GetObject');
    expect(ev.account).toBe('111122223333');
    expect(ev.role_fingerprint).toMatch(/^aws:/);
    const payload = JSON.stringify(ev);
    expect(payload).not.toMatch(/AKIA[0-9A-Z]{16}/);
    expect(payload).not.toMatch(/aws_secret_access_key/i);
    expect(payload).not.toMatch(/session_token/i);
    expect(payload).not.toMatch(/x-amz-security-token/i);
  });

  it('acceptance bar 2: deny-list hit returns 403 deny_listed_action', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/broker/action',
      payload: buildRequest({ action: 'iam:CreateUser' }),
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.response_code).toBe('deny_listed_action');
    expect(deps.audit.events).toHaveLength(1);
    expect(deps.audit.events[0].response_code).toBe('deny_listed');
  });

  it('acceptance bar 2b: deny-list partial-prefix does not deny (anchored match)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/broker/action',
      payload: buildRequest({ action: 'iam:CreateUserV2' }),
    });
    const body = JSON.parse(res.body);
    expect(body.response_code).not.toBe('deny_listed_action');
  });

  it('acceptance bar 4: tenant with cloud_disabled trust is refused', async () => {
    deps.trust_store.setState('acme', 'aws', 'cloud_disabled', 'test_disable');
    const res = await app.inject({
      method: 'POST',
      url: '/broker/action',
      payload: buildRequest({}),
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.response_code).toBe('cloud_disabled');
  });

  it('acceptance bar 4b: tenant with no trust record is refused', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/broker/action',
      payload: buildRequest({ tenant_id: 'no-such-tenant' }),
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.response_code).toBe('cloud_disabled');
  });

  it('azure requests with active azure trust return unsupported_cloud when no adapter is registered', async () => {
    // Rebuild with: azure trust present + NO azure adapter registered.
    deps = buildDeps({ addAzureTrust: true, registerAzureAdapter: false });
    app = await buildServer(deps);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/broker/action',
      payload: buildRequest({
        args: {
          cloud: 'azure',
          subscription_id: '00000000-0000-0000-0000-000000000000',
          aad_tenant_id: '11111111-2222-3333-4444-555555555555',
          app_registration_client_id: '00000000-0000-0000-0000-000000000001',
          service: 'compute',
          operation: 'list',
          params: {},
        },
      }),
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.response_code).toBe('unsupported_cloud');
  });

  it('azure requests without azure trust return cloud_disabled', async () => {
    // Default: no azure trust, azure adapter registered. The trust
    // gate fires first.
    const res = await app.inject({
      method: 'POST',
      url: '/broker/action',
      payload: buildRequest({
        args: {
          cloud: 'azure',
          subscription_id: '00000000-0000-0000-0000-000000000000',
          aad_tenant_id: '11111111-2222-3333-4444-555555555555',
          app_registration_client_id: '00000000-0000-0000-0000-000000000001',
          service: 'compute',
          operation: 'list',
          params: {},
        },
      }),
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.response_code).toBe('cloud_disabled');
  });

  it('emits exactly one audit event per request, even on failure', async () => {
    await app.inject({ method: 'POST', url: '/broker/action', payload: buildRequest({}) });
    await app.inject({ method: 'POST', url: '/broker/action', payload: buildRequest({ action: 'iam:CreateUser' }) });
    expect(deps.audit.events).toHaveLength(2);
    expect(deps.audit.events[0].response_code).toBe('ok');
    expect(deps.audit.events[1].response_code).toBe('deny_listed');
  });
});
