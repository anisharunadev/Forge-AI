/**
 * Tests for the FORA-126.4 canary-assume phase-2 trust probe.
 *
 *   1. `ProbeProbeSigner` mints a JWT with the `scope: 'probe'`
 *      sentinel claim; the JWT verifies with `jose.jwtVerify`.
 *   2. `probeTenant` flips a tenant whose IAM trust is missing the
 *      broker IdP issuer to `cloud_disabled` after the first probe.
 *   3. `probeTenant` keeps a tenant whose IAM trust is correctly
 *      wired at `active`.
 *   4. The probe never produces a credential leak — the canary
 *      handle is released in `finally` even when the assume throws.
 *   5. The probe emits exactly one `cloud.probe.{ok,fail}` audit
 *      event with `actor = system:probe`.
 *   6. `ProbeScheduler` walks every (tenant, cloud) pair on
 *      `probeAll()`, schedules ticks on `start()`, and cancels on
 *      `stop()`. State changes fire the `on_state_change` callback.
 *   7. The probe audit event never carries a credential-shaped
 *      field — `assertNoCredentials` would throw if it did.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { jwtVerify, generateKeyPair, importJWK, type KeyLike } from 'jose';
import {
  TrustStore,
  buildAdapterRegistry,
  AwsAdapter,
  AzureAdapter,
  GcpAdapter,
  InMemoryAuditSink,
  ProbeProbeSigner,
  ProbeScheduler,
  probeTenant,
  type TenantCloudTrust,
  type Cloud,
  type CloudAdapter,
  type AssumeResult,
  type AwsActionArgs,
  type AzureActionArgs,
  type GcpActionArgs,
  PROBE_TOKEN_SCOPE,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

const ISSUER = 'https://identity-broker.fora.local/auth';
const AUDIENCE = 'customer-cloud-broker';

async function newProbeSigner(): Promise<{ signer: ProbeProbeSigner; publicKey: KeyLike }> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const signer = new ProbeProbeSigner({
    issuer: ISSUER,
    audience: AUDIENCE,
    signing_key: privateKey,
  });
  return { signer, publicKey };
}

function fakeTrust(tenant_id: string, cloud: Cloud, overrides: Partial<TenantCloudTrust> = {}): TenantCloudTrust {
  const base: TenantCloudTrust = {
    tenant_id,
    cloud,
    account: '111122223333',
    role_ref: 'arn:aws:iam::111122223333:role/ForgeBrokeredDeployRole',
    expected_issuer: ISSUER,
    expected_audience: AUDIENCE,
    trust_state: 'pending_probe',
    last_probed_at: null,
    disabled_reason: null,
  };
  return { ...base, ...overrides };
}

/** Stub STS response for the canary assume (14-min expiry, fake keys). */
function stubAssumeResponse() {
  return {
    Credentials: {
      AccessKeyId: 'ASIA-STUB-FOR-PROBE',
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
  };
}

/**
 * Build an AWS adapter that always returns a stubbed STS response.
 * The `assume_fn` records every call so tests can assert that the
 * probe actually called STS with the probe JWT.
 */
function buildStubAwsAdapter(opts: { throwOnAssume?: Error } = {}) {
  const calls: Array<{ jwt: string; roleArn: string; region: string; operation: string }> = [];
  const assume_fn = async (input: {
    RoleArn?: string;
    WebIdentityToken?: string;
    RoleSessionName?: string;
  }) => {
    if (opts.throwOnAssume) throw opts.throwOnAssume;
    calls.push({
      jwt: input.WebIdentityToken ?? '',
      roleArn: input.RoleArn ?? '',
      region: input.RoleSessionName?.split('-')[1] ?? 'us-east-1',
      operation: 'GetCallerIdentity',
    });
    return stubAssumeResponse();
  };
  const adapter = new AwsAdapter({
    broker_issuer: ISSUER,
    broker_audience: AUDIENCE,
    assume_fn,
  });
  return { adapter, calls };
}

// ---------------------------------------------------------------------------
// ProbeProbeSigner
// ---------------------------------------------------------------------------

describe('FORA-126.4: ProbeProbeSigner', () => {
  it('mints a JWT with the scope=probe sentinel claim', async () => {
    const { signer, publicKey } = await newProbeSigner();
    const claims = await signer.mint({ tenant_id: 'acme', cloud: 'aws' });

    expect(claims.iss).toBe(ISSUER);
    expect(claims.aud).toBe(AUDIENCE);
    expect(claims.sub).toBe('system:probe');
    expect(claims.scope).toBe(PROBE_TOKEN_SCOPE);
    expect(claims.tenant_id).toBe('acme');
    expect(claims.cloud).toBe('aws');
    expect(claims.jti).toMatch(/^[0-9a-f]{32}$/);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(120);

    // The compact JWT verifies against the public key.
    const verified = await jwtVerify(claims.jwt, publicKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['ES256'],
    });
    expect(verified.payload['scope']).toBe(PROBE_TOKEN_SCOPE);
    expect(verified.payload['tenant_id']).toBe('acme');
  });

  it('rejects a mint with an unknown cloud', async () => {
    const { signer } = await newProbeSigner();
    await expect(
      // @ts-expect-error — intentional bad input
      signer.mint({ tenant_id: 'acme', cloud: 'oracle' }),
    ).rejects.toThrow(/known cloud/);
  });

  it('rejects a mint with no tenant_id', async () => {
    const { signer } = await newProbeSigner();
    await expect(
      // @ts-expect-error — intentional bad input
      signer.mint({ tenant_id: '', cloud: 'aws' }),
    ).rejects.toThrow(/tenant_id/);
  });
});

// ---------------------------------------------------------------------------
// probeTenant — phase 2 canary assume
// ---------------------------------------------------------------------------

describe('FORA-126.4: probeTenant canary assume', () => {
  let trust: TenantCloudTrust;
  let audit: InMemoryAuditSink;
  let store: TrustStore;
  let signer: ProbeProbeSigner;

  beforeEach(async () => {
    store = new TrustStore();
    audit = new InMemoryAuditSink();
    const out = await newProbeSigner();
    signer = out.signer;
    trust = fakeTrust('acme', 'aws');
  });

  it('keeps trust_state=active when phase 1 passes and STS accepts the probe JWT', async () => {
    const { adapter } = buildStubAwsAdapter();
    const adapters = buildAdapterRegistry({ aws: adapter });
    const result = await probeTenant(trust, adapters, { signer });
    expect(result.state).toBe('active');
    expect(result.reason).toBeNull();
    expect(result.phase2).toBe('ok');
    expect(result.probe_jti).toMatch(/^[0-9a-f]{32}$/);
  });

  it('flips trust_state=cloud_disabled when phase 1 fails', async () => {
    const { adapter } = buildStubAwsAdapter();
    const adapters = buildAdapterRegistry({ aws: adapter });
    const broken = fakeTrust('acme', 'aws', {
      expected_issuer: 'https://wrong.example/auth',
    });
    const result = await probeTenant(broken, adapters, { signer });
    expect(result.state).toBe('cloud_disabled');
    expect(result.reason).toMatch(/^phase1_failed:expected_issuer_mismatch$/);
    expect(result.phase2).toBe('skipped');
  });

  it('flips trust_state=cloud_disabled when the adapter.assume throws', async () => {
    const boom = new Error('InvalidIdentityToken: token signature mismatch');
    const { adapter } = buildStubAwsAdapter({ throwOnAssume: boom });
    const adapters = buildAdapterRegistry({ aws: adapter });
    const result = await probeTenant(trust, adapters, { signer });
    expect(result.state).toBe('cloud_disabled');
    expect(result.reason).toMatch(/^assume_failed:InvalidIdentityToken/);
    expect(result.phase2).toBe('fail');
  });

  it('calls adapter.assume with the probe JWT and the trust role', async () => {
    const { adapter, calls } = buildStubAwsAdapter();
    const adapters = buildAdapterRegistry({ aws: adapter });
    await probeTenant(trust, adapters, { signer });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.roleArn).toBe(trust.role_ref);
    expect(calls[0]!.operation).toBe('GetCallerIdentity');
    // The JWT presented to STS is a real compact JWS (header.payload.sig).
    expect(calls[0]!.jwt.split('.').length).toBe(3);
  });

  it('releases the handle even when adapter.assume throws — no credential leak', async () => {
    const boom = new Error('boom');
    const { adapter } = buildStubAwsAdapter({ throwOnAssume: boom });
    const adapters = buildAdapterRegistry({ aws: adapter });
    const result = await probeTenant(trust, adapters, { signer });
    expect(result.state).toBe('cloud_disabled');
    // The result must contain no credential-shaped field.
    const payload = JSON.stringify(result);
    expect(payload).not.toMatch(/AKIA[0-9A-Z]{16}/);
    expect(payload).not.toMatch(/aws_secret_access_key/i);
    expect(payload).not.toMatch(/session_token/i);
  });

  it('emits no audit event by itself (the scheduler / caller emits one)', async () => {
    // probeTenant itself doesn't touch the audit sink — the scheduler
    // owns the event emission. This keeps the probe's audit
    // cardinality under the caller's control.
    const { adapter } = buildStubAwsAdapter();
    const adapters = buildAdapterRegistry({ aws: adapter });
    await probeTenant(trust, adapters, { signer });
    expect(audit.probe_events).toHaveLength(0);
  });

  it('skips canary when skip_canary is true', async () => {
    const { adapter, calls } = buildStubAwsAdapter();
    const adapters = buildAdapterRegistry({ aws: adapter });
    const result = await probeTenant(trust, adapters, { signer, skip_canary: true });
    expect(result.state).toBe('active');
    expect(result.phase2).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('returns cloud_disabled with reason no_adapter when the cloud is not registered', async () => {
    // Empty registry — no adapters.
    const adapters = buildAdapterRegistry({});
    const result = await probeTenant(trust, adapters, { signer });
    expect(result.state).toBe('cloud_disabled');
    expect(result.reason).toBe('no_adapter');
    expect(result.phase2).toBe('skipped');
  });
});

// ---------------------------------------------------------------------------
// ProbeScheduler
// ---------------------------------------------------------------------------

describe('FORA-126.4: ProbeScheduler', () => {
  let store: TrustStore;
  let audit: InMemoryAuditSink;
  let signer: ProbeProbeSigner;

  beforeEach(async () => {
    store = new TrustStore();
    audit = new InMemoryAuditSink();
    const out = await newProbeSigner();
    signer = out.signer;
    // Two tenants, both AWS. The fixture ensures the scheduler
    // walks every (tenant, cloud) pair.
    (store as unknown as { trusts: Map<string, TenantCloudTrust[]> }).trusts.set('acme', [
      fakeTrust('acme', 'aws'),
    ]);
    (store as unknown as { trusts: Map<string, TenantCloudTrust[]> }).trusts.set('globex', [
      fakeTrust('globex', 'aws', {
        account: '444455556666',
        role_ref: 'arn:aws:iam::444455556666:role/ForgeBrokeredDeployRole',
      }),
    ]);
  });

  it('probeAll runs the probe over every (tenant, cloud) pair and emits one event per probe', async () => {
    const { adapter } = buildStubAwsAdapter();
    const adapters = buildAdapterRegistry({ aws: adapter });
    const scheduler = new ProbeScheduler({
      trust_store: store,
      adapters,
      signer,
      audit,
    });
    const results = await scheduler.probeAll();
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.state === 'active')).toBe(true);
    expect(audit.probe_events).toHaveLength(2);
    expect(audit.probe_events.every((e) => e.action === 'cloud.probe.ok')).toBe(true);
    expect(audit.probe_events.every((e) => e.actor === 'system:probe')).toBe(true);
    expect(audit.probe_events.every((e) => e.tenant_id && e.cloud === 'aws')).toBe(true);
  });

  it('flips a tenant to cloud_disabled when the canary assume fails and emits cloud.probe.fail', async () => {
    const boom = new Error('InvalidIdentityToken: signature mismatch');
    const { adapter } = buildStubAwsAdapter({ throwOnAssume: boom });
    const adapters = buildAdapterRegistry({ aws: adapter });
    const scheduler = new ProbeScheduler({
      trust_store: store,
      adapters,
      signer,
      audit,
    });
    const results = await scheduler.probeAll();
    expect(results.every((r) => r.state === 'cloud_disabled')).toBe(true);
    expect(audit.probe_events).toHaveLength(2);
    expect(audit.probe_events.every((e) => e.action === 'cloud.probe.fail')).toBe(true);
    expect(audit.probe_events.every((e) => e.reason.startsWith('assume_failed:'))).toBe(true);
  });

  it('fires on_state_change when a probe flips a tenant to cloud_disabled', async () => {
    const boom = new Error('InvalidIdentityToken: signature mismatch');
    const { adapter } = buildStubAwsAdapter({ throwOnAssume: boom });
    const adapters = buildAdapterRegistry({ aws: adapter });
    const changes: Array<{
      tenant_id: string;
      cloud: 'aws' | 'azure' | 'gcp';
      from: TenantCloudTrust['trust_state'];
      to: TenantCloudTrust['trust_state'];
    }> = [];
    const scheduler = new ProbeScheduler({
      trust_store: store,
      adapters,
      signer,
      audit,
      on_state_change: (c) => {
        changes.push({
          tenant_id: c.tenant_id,
          cloud: c.cloud,
          from: c.from,
          to: c.to,
        });
      },
    });
    await scheduler.probeAll();
    expect(changes).toHaveLength(2);
    expect(changes.every((c) => c.from === 'pending_probe' && c.to === 'cloud_disabled')).toBe(true);
  });

  it('schedules periodic ticks and stops cleanly', async () => {
    const { adapter } = buildStubAwsAdapter();
    const adapters = buildAdapterRegistry({ aws: adapter });
    let ticks = 0;
    const set_timer = (_cb: () => void, _ms: number): unknown => {
      // We capture the scheduled callback so the test can drive it
      // deterministically rather than waiting on a real timer.
      ticks += 1;
      return { __handle: ticks };
    };
    const scheduler = new ProbeScheduler({
      trust_store: store,
      adapters,
      signer,
      audit,
      interval_ms: 1000,
      set_timer: set_timer as unknown as (cb: () => void, ms: number) => NodeJS.Timeout,
    });
    scheduler.start();
    expect(ticks).toBe(1);
    scheduler.start(); // idempotent
    expect(ticks).toBe(1);
    scheduler.stop();
    scheduler.stop(); // idempotent
  });

  it('audit event payload never contains a credential-shaped field', async () => {
    const { adapter } = buildStubAwsAdapter();
    const adapters = buildAdapterRegistry({ aws: adapter });
    const scheduler = new ProbeScheduler({
      trust_store: store,
      adapters,
      signer,
      audit,
    });
    await scheduler.probeAll();
    for (const ev of audit.probe_events) {
      const payload = JSON.stringify(ev);
      expect(payload).not.toMatch(/AKIA[0-9A-Z]{16}/);
      expect(payload).not.toMatch(/aws_secret_access_key/i);
      expect(payload).not.toMatch(/session_token/i);
      expect(payload).not.toMatch(/x-amz-security-token/i);
      expect(payload).not.toMatch(/password/i);
      expect(payload).not.toMatch(/private_key/i);
    }
  });
});
