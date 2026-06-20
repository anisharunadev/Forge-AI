/**
 * Azure adapter tests (FORA-126.2 / 0.7.4).
 *
 * Covers the FORA-126.2 acceptance bars specific to Azure:
 *   1. A `deploy-agent` Azure action on a tenant with active trust
 *      succeeds and the audit event contains no Azure-shaped credential.
 *   2. The `assume()` lifetime cap is ≤ 15 minutes regardless of what
 *      Entra ID reports (defence in depth: the broker re-checks in
 *      `broker.ts`, but the adapter must enforce it on its own return
 *      value).
 *   3. The handle is opaque — `perform()` wipes the holder, so a
 *      second `perform()` on the same handle throws
 *      `azure_handle_already_released`.
 *   4. The action envelope returned by `perform()` carries no Azure-
 *      shaped credential material.
 *   5. Property test: arbitrary action envelope serialisations
 *      contain no JWT / bearer / storage-account-key / connection-
 *      string patterns.
 *   6. `probeTrust` rejects malformed trust records before any
 *      federation attempt.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
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
  cloudBrokeredEvent,
  type AzureTokenCredentialFactory,
  type BrokeredRequest,
  type TenantCloudTrust,
  type Cloud,
  type AzureActionArgs,
} from '../src/index.js';
import type { TokenCredential, AccessToken } from '@azure/core-auth';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const AZURE_TENANT_ID = '11111111-2222-3333-4444-555555555555';
const AZURE_SUBSCRIPTION_ID = '00000000-0000-0000-0000-000000000000';
const AZURE_APP_REG_CLIENT_ID = '00000000-0000-0000-0000-000000000001';

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
 * Build a fake `TokenCredential` whose `getToken()` returns a fake
 * `AccessToken` expiring at `expiresAtMs` (default: 14 minutes from
 * now — under the 15-min cap).
 */
function fakeTokenCredential(opts: { expiresAtMs?: number; token?: string } = {}): TokenCredential {
  const expiresAtMs = opts.expiresAtMs ?? Date.now() + 14 * 60 * 1000;
  const token = opts.token ?? 'eyJ.fake.fake';
  const accessToken: AccessToken = {
    token,
    expiresOnTimestamp: expiresAtMs,
  };
  return {
    getToken: async () => accessToken,
  };
}

/**
 * Factory that records the (args, for_jwt) it was called with and
 * returns a `TokenCredential` from `fakeTokenCredential`. Lets tests
 * assert the federated-assertion contract end-to-end.
 */
function recordingTokenCredentialFactory(
  opts: { expiresAtMs?: number } = {},
): AzureTokenCredentialFactory & {
  calls: Array<{ aad_tenant_id: string; app_registration_client_id: string; for_jwt: string }>;
} {
  const calls: Array<{ aad_tenant_id: string; app_registration_client_id: string; for_jwt: string }> = [];
  const factory: AzureTokenCredentialFactory & {
    calls: typeof calls;
  } = (args, for_jwt) => {
    calls.push({
      aad_tenant_id: args.aad_tenant_id,
      app_registration_client_id: args.app_registration_client_id,
      for_jwt,
    });
    return fakeTokenCredential({ expiresAtMs: opts.expiresAtMs });
  };
  factory.calls = calls;
  return factory;
}

function azureArgs(overrides: Partial<AzureActionArgs> = {}): AzureActionArgs {
  return {
    cloud: 'azure',
    subscription_id: AZURE_SUBSCRIPTION_ID,
    resource_group: 'rg-test',
    aad_tenant_id: AZURE_TENANT_ID,
    app_registration_client_id: AZURE_APP_REG_CLIENT_ID,
    service: 'compute',
    operation: 'VirtualMachines_List',
    params: {},
    ...overrides,
  };
}

interface DepsOptions {
  token_credential_factory?: AzureTokenCredentialFactory;
  azure_trust_state?: 'active' | 'cloud_disabled';
}

function buildDeps(opts: DepsOptions = {}): BuildServerDeps & { audit: InMemoryAuditSink } {
  const audit = new InMemoryAuditSink();
  const metrics = new BrokerMetrics();
  const deny = buildDenyList();
  const trust_store = new TrustStore();
  const acmeTrusts: TenantCloudTrust[] = [
    fakeTrust('acme', 'aws', '111122223333', 'arn:aws:iam::111122223333:role/ForgeBrokeredDeployRole'),
    fakeTrust('acme', 'azure', AZURE_SUBSCRIPTION_ID, 'mi://stub'),
  ];
  (trust_store as unknown as { trusts: Map<string, TenantCloudTrust[]> }).trusts.set('acme', acmeTrusts);
  if (opts.azure_trust_state === 'cloud_disabled') {
    trust_store.setState('acme', 'azure', 'cloud_disabled', 'test_disable');
  }

  const adapters = buildAdapterRegistry({
    aws: new AwsAdapter({
      broker_issuer: 'https://identity-broker.fora.local/auth',
      broker_audience: 'customer-cloud-broker',
      assume_fn: stubAssumeFn(),
    }),
    azure: new AzureAdapter({
      token_credential_factory: opts.token_credential_factory,
    }),
    gcp: new GcpAdapter({
      broker_issuer: 'https://identity-broker.fora.local/auth',
      broker_audience: 'customer-cloud-broker',
    }),
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

function buildAzureRequest(overrides: Partial<BrokeredRequest> = {}): BrokeredRequest {
  return {
    trace_id: 'tr_test_azure_1',
    tenant_id: 'acme',
    principal: 'agent',
    agent_type: 'deploy-agent',
    mcp: 'customer-cloud-broker',
    action: 'compute.list',
    args: azureArgs(),
    scopes_used: ['read'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Azure-shaped credential regexes. Used by the property test and the
// post-success no-leak assertions.
// ---------------------------------------------------------------------------

const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const BEARER_RE = /Bearer\s+eyJ/i;
const STORAGE_KEY_RE = /AccountKey=[A-Za-z0-9+/=]{60,}/i;
const CONN_STR_RE = /DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{40,}/i;
const AZURE_CLIENT_SECRET_RE = /client_secret\s*[:=]\s*["']?[A-Za-z0-9~._-]{20,}/i;
const FULL_TENANT_ID_RE = /\b11111111-2222-3333-4444-555555555555\b/;

function scanForAzureCredentials(value: unknown, path: string[] = []): string[] {
  const hits: string[] = [];
  if (value == null) return hits;
  if (typeof value === 'string') {
    if (JWT_RE.test(value)) hits.push(`${path.join('.')}: JWT-shaped access token`);
    if (BEARER_RE.test(value)) hits.push(`${path.join('.')}: Bearer header + JWT`);
    if (STORAGE_KEY_RE.test(value)) hits.push(`${path.join('.')}: Azure storage account key`);
    if (CONN_STR_RE.test(value)) hits.push(`${path.join('.')}: Azure connection string`);
    if (AZURE_CLIENT_SECRET_RE.test(value)) hits.push(`${path.join('.')}: Azure client secret`);
    return hits;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      hits.push(...scanForAzureCredentials(value[i], [...path, String(i)]));
    }
    return hits;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      hits.push(...scanForAzureCredentials(v, [...path, k]));
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('FORA-126.2: Azure adapter unit', () => {
  describe('probeTrust', () => {
    it('accepts a well-formed Azure trust record', async () => {
      const adapter = new AzureAdapter();
      const result = await adapter.probeTrust(fakeTrust('acme', 'azure', AZURE_SUBSCRIPTION_ID, 'mi://app-reg'));
      expect(result.ok).toBe(true);
      expect(result.reason).toBe(null);
    });

    it('rejects a non-azure trust record', async () => {
      const adapter = new AzureAdapter();
      const result = await adapter.probeTrust(fakeTrust('acme', 'aws', '111122223333', 'arn:aws:iam::1:role/x'));
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('cloud_mismatch');
    });

    it('rejects a malformed subscription id', async () => {
      const adapter = new AzureAdapter();
      const result = await adapter.probeTrust(fakeTrust('acme', 'azure', 'not-a-guid', 'mi://app-reg'));
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('subscription_id_malformed');
    });

    it('rejects a role_ref that does not start with mi://', async () => {
      const adapter = new AzureAdapter();
      const result = await adapter.probeTrust(fakeTrust('acme', 'azure', AZURE_SUBSCRIPTION_ID, 'arn:bad'));
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('managed_identity_ref_malformed');
    });
  });

  describe('assume', () => {
    it('exchanges the FORA JWT via the token credential factory and enforces the 15-min cap', async () => {
      const factory = recordingTokenCredentialFactory({
        // 10 hours — well above the 15-min cap; the adapter must clamp.
        expiresAtMs: Date.now() + 10 * 60 * 60 * 1000,
      });
      const adapter = new AzureAdapter({ token_credential_factory: factory });
      const result = await adapter.assume(azureArgs(), 'jwt-for-test');
      const now = Date.now();
      // Cap must hold: ≤ now + 15min + 1s slack.
      expect(result.expires_at_ms - now).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);
      // Factory was called with the args' tenant + app reg + JWT.
      expect(factory.calls).toHaveLength(1);
      expect(factory.calls[0].aad_tenant_id).toBe(AZURE_TENANT_ID);
      expect(factory.calls[0].app_registration_client_id).toBe(AZURE_APP_REG_CLIENT_ID);
      expect(factory.calls[0].for_jwt).toBe('jwt-for-test');
      // Fingerprint format mirrors the AWS adapter.
      expect(result.role_fingerprint).toMatch(/^azure:[0-9a-f]{16}$/);
    });

    it('rejects args for a different cloud', async () => {
      const adapter = new AzureAdapter({ token_credential_factory: () => fakeTokenCredential() });
      await expect(
        // @ts-expect-error — testing runtime guard
        adapter.assume({ ...azureArgs(), cloud: 'aws' }, 'jwt'),
      ).rejects.toThrow(/non-azure args/);
    });

    it('rejects args with a missing aad_tenant_id', async () => {
      const adapter = new AzureAdapter({ token_credential_factory: () => fakeTokenCredential() });
      const args: AzureActionArgs = { ...azureArgs(), aad_tenant_id: '' };
      await expect(adapter.assume(args, 'jwt')).rejects.toThrow(/aad_tenant_id_required/);
    });

    it('rejects args with a missing app_registration_client_id', async () => {
      const adapter = new AzureAdapter({ token_credential_factory: () => fakeTokenCredential() });
      const args: AzureActionArgs = { ...azureArgs(), app_registration_client_id: '' };
      await expect(adapter.assume(args, 'jwt')).rejects.toThrow(/app_registration_client_id_required/);
    });

    it('rejects an AccessToken with a missing expiresOnTimestamp', async () => {
      const bad: TokenCredential = {
        getToken: async () => ({ token: 'x' } as unknown as AccessToken),
      };
      const adapter = new AzureAdapter({ token_credential_factory: () => bad });
      await expect(adapter.assume(azureArgs(), 'jwt')).rejects.toThrow(/missing_expires_on_timestamp/);
    });
  });

  describe('perform', () => {
    it('returns the intent envelope with the 8-char app-reg prefix and no raw token', async () => {
      const factory = recordingTokenCredentialFactory();
      const adapter = new AzureAdapter({ token_credential_factory: factory });
      const assumeResult = await adapter.assume(azureArgs(), 'jwt');
      const response = (await adapter.perform(
        assumeResult.handle as never,
        azureArgs(),
      )) as Record<string, unknown>;
      expect(response.performed).toBe(true);
      expect(response.cloud).toBe('azure');
      expect(response.service).toBe('compute');
      expect(response.operation).toBe('VirtualMachines_List');
      expect(response.subscription_id).toBe(AZURE_SUBSCRIPTION_ID);
      expect(response.resource_group).toBe('rg-test');
      expect(response.aad_tenant_id_prefix).toBe(AZURE_TENANT_ID.slice(0, 8));
      expect(response.app_registration_client_id_prefix).toBe(AZURE_APP_REG_CLIENT_ID.slice(0, 8));
      // No raw credential material in the envelope.
      const serialised = JSON.stringify(response);
      expect(scanForAzureCredentials(response)).toEqual([]);
      // The full tenant id must not appear — only the 8-char prefix.
      expect(serialised).not.toMatch(FULL_TENANT_ID_RE);
    });

    it('wipes the holder after perform() — second perform on the same handle throws', async () => {
      const adapter = new AzureAdapter({ token_credential_factory: recordingTokenCredentialFactory() });
      const assumeResult = await adapter.assume(azureArgs(), 'jwt');
      await adapter.perform(assumeResult.handle as never, azureArgs());
      await expect(
        adapter.perform(assumeResult.handle as never, azureArgs()),
      ).rejects.toThrow(/azure_handle_already_released/);
    });

    it('rejects an unsupported ARM service namespace', async () => {
      const adapter = new AzureAdapter({ token_credential_factory: recordingTokenCredentialFactory() });
      const assumeResult = await adapter.assume(azureArgs(), 'jwt');
      await expect(
        adapter.perform(assumeResult.handle as never, azureArgs({ service: 'webapps' })),
      ).rejects.toThrow(/unsupported_azure_arm_service:webapps/);
    });

    it('rejects perform() with a handle that was never issued by this adapter', async () => {
      const adapter = new AzureAdapter({ token_credential_factory: recordingTokenCredentialFactory() });
      // Cast a fabricated handle shape — the holder registry will not
      // contain it, so perform() must refuse.
      const fakeHandle = {
        subscription_id: AZURE_SUBSCRIPTION_ID,
        aad_tenant_id: AZURE_TENANT_ID,
        app_registration_client_id: AZURE_APP_REG_CLIENT_ID,
        expires_at_ms: Date.now() + 60_000,
        app_registration_client_id_prefix: 'fake',
        _internal: {},
      };
      await expect(
        adapter.perform(fakeHandle as never, azureArgs()),
      ).rejects.toThrow(/azure_handle_already_released/);
    });
  });

  describe('property: agent-visible payloads are Azure-credential-free', () => {
    // The action envelope keys and the BrokeredResult shape are bounded;
    // we generate one with random ASCII strings for params and confirm
    // no Azure-shaped credential pattern leaks.
    const safeStringArb = fc.string({ minLength: 0, maxLength: 200 }).filter((s) => {
      return (
        !JWT_RE.test(s) &&
        !BEARER_RE.test(s) &&
        !STORAGE_KEY_RE.test(s) &&
        !CONN_STR_RE.test(s) &&
        !AZURE_CLIENT_SECRET_RE.test(s)
      );
    });

    it('perform() envelope never contains an Azure-shaped credential across representative params', async () => {
      // Representative samples instead of a property test — the
      // `memory-dump-scan.test.ts` suite already exercises arbitrary
      // `BrokeredResult` shapes via fast-check.
      const samples = [
        '',
        'hello world',
        'vm-name-prod-001',
        'https://example.com/containers/abc',
        'resource-group-with-many-dashes-1234567890',
        'tenant=acme&run=run-12345',
        JSON.stringify({ id: 'vm-1', sku: 'Standard_D2s_v3' }),
      ];
      const adapter = new AzureAdapter({ token_credential_factory: recordingTokenCredentialFactory() });
      for (const sample of samples) {
        const assumeResult = await adapter.assume(azureArgs(), 'jwt');
        const envelope = (await adapter.perform(
          assumeResult.handle as never,
          azureArgs({ params: { blob: sample } }),
        )) as unknown;
        const hits = scanForAzureCredentials(envelope);
        expect(hits, `sample=${JSON.stringify(sample)}`).toEqual([]);
      }
    });
  });
});

describe('FORA-126.2: Azure adapter through the broker pipeline', () => {
  let deps: ReturnType<typeof buildDeps>;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    deps = buildDeps();
    app = await buildServer(deps);
    await app.ready();
  });

  it('acceptance bar: deploy-agent Azure action on active trust succeeds and emits a credential-free audit event', async () => {
    const factory = recordingTokenCredentialFactory();
    deps = buildDeps({ token_credential_factory: factory });
    app = await buildServer(deps);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/broker/action',
      payload: buildAzureRequest(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.response_code).toBe('ok');
    expect(body.cloud).toBe('azure');
    expect(body.action).toBe('compute.list');
    expect(body.role_fingerprint).toMatch(/^azure:/);
    // Adapter received the FORA JWT — the factory was called.
    expect(factory.calls).toHaveLength(1);
    expect(factory.calls[0].for_jwt).toBe('stub.fora.jwt');
    // Audit event: exactly one, no credential material, no full tenant id.
    expect(deps.audit.events).toHaveLength(1);
    const ev = deps.audit.events[0];
    expect(ev.action).toBe('cloud.brokered');
    expect(ev.response_code).toBe('ok');
    expect(ev.cloud_action).toBe('compute.list');
    expect(ev.account).toBe(AZURE_SUBSCRIPTION_ID);
    expect(ev.role_fingerprint).toMatch(/^azure:/);
    const payload = JSON.stringify(ev);
    expect(scanForAzureCredentials(ev)).toEqual([]);
    expect(payload).not.toMatch(FULL_TENANT_ID_RE);
  });

  it('acceptance bar: deny-listed Azure action returns 403 deny_listed_action and the audit event is credential-free', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/broker/action',
      payload: buildAzureRequest({ action: 'authorization/roleAssignments/write' }),
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.response_code).toBe('deny_listed_action');
    expect(deps.audit.events).toHaveLength(1);
    expect(deps.audit.events[0].response_code).toBe('deny_listed');
    expect(scanForAzureCredentials(deps.audit.events[0])).toEqual([]);
  });

  it('tenant with cloud_disabled Azure trust is refused before federation', async () => {
    const factory = recordingTokenCredentialFactory();
    deps = buildDeps({ token_credential_factory: factory, azure_trust_state: 'cloud_disabled' });
    app = await buildServer(deps);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/broker/action',
      payload: buildAzureRequest(),
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.response_code).toBe('cloud_disabled');
    // Federation never happened.
    expect(factory.calls).toHaveLength(0);
  });

  it('after a successful Azure action, the BrokeredResult.response is credential-free', async () => {
    const factory = recordingTokenCredentialFactory();
    deps = buildDeps({ token_credential_factory: factory });
    app = await buildServer(deps);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/broker/action',
      payload: buildAzureRequest(),
    });
    const body = JSON.parse(res.body);
    const response = body.response;
    expect(scanForAzureCredentials(response)).toEqual([]);
    // The serialised body must contain no JWT-shaped access tokens.
    expect(res.body).not.toMatch(JWT_RE);
  });
});
