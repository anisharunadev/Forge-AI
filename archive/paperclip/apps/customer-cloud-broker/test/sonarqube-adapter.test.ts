/**
 * SonarQube adapter tests (FORA-321).
 *
 * Mock-backed smoke coverage for the FORA-321 acceptance bar:
 *
 *   1. `assume()` mints a fresh SonarQube user token via the
 *      `assume_fn` seam, clamps the lifetime to ≤ 15 minutes, and
 *      never returns the raw token.
 *   2. `perform()` issues a GET against the right `/api/...` path
 *      for each of the 6 allow-listed service.operation pairs and
 *      returns the redacted body.
 *   3. The opaque handle is wiped after `perform()` — a second
 *      `perform()` on the same handle throws
 *      `sonarqube_handle_already_released`.
 *   4. Cross-tenant deny-by-default: a holder pinned to project A
 *      refuses to serve a request for project B, even if the handle
 *      is the one originally returned by `assume()`. The
 *      `project_scope_mismatch` error fires before the dispatcher is
 *      touched.
 *   5. Read-only: an unsupported `service` / `operation` is rejected
 *      before any network call lands.
 *   6. `releaseHandle()` is idempotent and best-effort — releasing
 *      a handle twice does not throw, and `release_fn` is invoked
 *      exactly once per `perform()` to rotate the token.
 *   7. The audit envelope returned from the broker carries no
 *      SonarQube-shaped credential pattern.
 *   8. `probeTrust` rejects malformed trust records before any
 *      network call.
 *
 * The test fixtures mirror the AWS / Azure adapter test shapes so a
 * reader familiar with one adapter finds the same scaffolding in the
 * other.
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
  SonarQubeAdapter,
  type BrokeredRequest,
  type TenantCloudTrust,
  type Cloud,
  type SonarQubeActionArgs,
  type SonarQubeAssumeFnInput,
  type SonarQubeAssumeFnOutput,
  type SonarQubeDispatchFn,
  type SonarQubeReleaseFn,
  type SonarQubeUserTokenHandle,
} from '../src/index.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const SONARQUBE_INSTANCE_URL = 'https://sonar.acme.example';
const SONARQUBE_PROJECT_KEY = 'acme-foo';

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
 * Recording `assume_fn`. Returns a fake token with the requested
 * expiration (default 14 min, under the 15-min cap) and records every
 * call so tests can assert the mint contract end-to-end.
 */
function recordingAssumeFn(
  opts: { expirationMs?: number; token?: string } = {},
): ((input: SonarQubeAssumeFnInput) => Promise<SonarQubeAssumeFnOutput>) & {
  calls: SonarQubeAssumeFnInput[];
} {
  const calls: SonarQubeAssumeFnInput[] = [];
  const fn = async (input: SonarQubeAssumeFnInput) => {
    calls.push(input);
    return {
      token: opts.token ?? `sq-stub-token-${calls.length}`,
      expiration_ms: opts.expirationMs ?? Date.now() + 14 * 60 * 1000,
    };
  };
  (fn as { calls: SonarQubeAssumeFnInput[] }).calls = calls;
  return fn as never;
}

/**
 * Recording `dispatch_fn`. Returns the canned `body` and records every
 * call so tests can assert the URL + method + Authorization header.
 */
function recordingDispatchFn(
  canned: { status?: number; body?: unknown } = {},
): SonarQubeDispatchFn & {
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const status = canned.status ?? 200;
  const body = canned.body ?? { components: [{ key: SONARQUBE_PROJECT_KEY }] };
  const fn: SonarQubeDispatchFn = async (url, init) => {
    calls.push({ url, init });
    return { status, body };
  };
  (fn as { calls: typeof calls }).calls = calls;
  return fn as never;
}

/**
 * Recording `release_fn`. Records every call so tests can assert that
 * `perform()` invokes it exactly once per action.
 */
function recordingReleaseFn(): SonarQubeReleaseFn & {
  calls: Array<{ instance_url: string; token_name: string }>;
} {
  const calls: Array<{ instance_url: string; token_name: string }> = [];
  const fn: SonarQubeReleaseFn = async (instance_url, token_name) => {
    calls.push({ instance_url, token_name });
  };
  (fn as { calls: typeof calls }).calls = calls;
  return fn as never;
}

function sonarqubeArgs(overrides: Partial<SonarQubeActionArgs> = {}): SonarQubeActionArgs {
  return {
    cloud: 'sonarqube',
    instance_url: SONARQUBE_INSTANCE_URL,
    project_key: SONARQUBE_PROJECT_KEY,
    token_name: 'fora-acme-deploy',
    service: 'projects',
    operation: 'search',
    params: {},
    ...overrides,
  };
}

interface DepsOptions {
  assume_fn?: SonarQubeAdapter['assume_fn'];
  dispatch_fn?: SonarQubeDispatchFn;
  release_fn?: SonarQubeReleaseFn;
  sonarqube_trust_state?: 'active' | 'cloud_disabled';
}

function buildDeps(opts: DepsOptions = {}): BuildServerDeps & { audit: InMemoryAuditSink } {
  const audit = new InMemoryAuditSink();
  const metrics = new BrokerMetrics();
  const deny = buildDenyList();
  const trust_store = new TrustStore();
  const acmeTrusts: TenantCloudTrust[] = [
    fakeTrust('acme', 'aws', '111122223333', 'arn:aws:iam::111122223333:role/ForgeBrokeredDeployRole'),
    fakeTrust('acme', 'sonarqube', SONARQUBE_INSTANCE_URL, `project:${SONARQUBE_PROJECT_KEY}`),
  ];
  (trust_store as unknown as { trusts: Map<string, TenantCloudTrust[]> }).trusts.set('acme', acmeTrusts);
  if (opts.sonarqube_trust_state === 'cloud_disabled') {
    trust_store.setState('acme', 'sonarqube', 'cloud_disabled', 'test_disable');
  }

  const adapters = buildAdapterRegistry({
    aws: new AwsAdapter({
      broker_issuer: 'https://identity-broker.fora.local/auth',
      broker_audience: 'customer-cloud-broker',
      assume_fn: stubAssumeFn(),
    }),
    azure: new AzureAdapter(),
    gcp: new GcpAdapter({
      broker_issuer: 'https://identity-broker.fora.local/auth',
      broker_audience: 'customer-cloud-broker',
    }),
    sonarqube: new SonarQubeAdapter({
      ...(opts.assume_fn ? { assume_fn: opts.assume_fn } : {}),
      ...(opts.dispatch_fn ? { dispatch_fn: opts.dispatch_fn } : {}),
      ...(opts.release_fn ? { release_fn: opts.release_fn } : {}),
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

function buildSonarQubeRequest(overrides: Partial<BrokeredRequest> = {}): BrokeredRequest {
  return {
    trace_id: 'tr_test_sonarqube_1',
    tenant_id: 'acme',
    principal: 'agent',
    agent_type: 'security-engineer',
    mcp: 'customer-cloud-broker',
    action: 'projects.search',
    args: sonarqubeArgs(),
    scopes_used: ['read'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SonarQube-shaped credential regexes. Used by the no-leak assertions.
// ---------------------------------------------------------------------------

const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const BEARER_RE = /Bearer\s+sq-/i;
const SONAR_TOKEN_RE = /\bsq-stub-token-\d+\b/;
const FULL_PROJECT_KEY_RE = new RegExp(SONARQUBE_PROJECT_KEY);

function scanForSonarQubeCredentials(value: unknown, path: string[] = []): string[] {
  const hits: string[] = [];
  if (value == null) return hits;
  if (typeof value === 'string') {
    if (JWT_RE.test(value)) hits.push(`${path.join('.')}: JWT-shaped token`);
    if (BEARER_RE.test(value)) hits.push(`${path.join('.')}: Bearer + sq token`);
    if (SONAR_TOKEN_RE.test(value)) hits.push(`${path.join('.')}: stub SonarQube token`);
    return hits;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      hits.push(...scanForSonarQubeCredentials(value[i], [...path, String(i)]));
    }
    return hits;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      hits.push(...scanForSonarQubeCredentials(v, [...path, k]));
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('FORA-321: SonarQube adapter unit', () => {
  describe('probeTrust', () => {
    it('accepts a well-formed SonarQube trust record', async () => {
      const adapter = new SonarQubeAdapter({ assume_fn: recordingAssumeFn() });
      const result = await adapter.probeTrust(
        fakeTrust('acme', 'sonarqube', SONARQUBE_INSTANCE_URL, `project:${SONARQUBE_PROJECT_KEY}`),
      );
      expect(result.ok).toBe(true);
      expect(result.reason).toBe(null);
    });

    it('rejects a non-sonarqube trust record', async () => {
      const adapter = new SonarQubeAdapter({ assume_fn: recordingAssumeFn() });
      const result = await adapter.probeTrust(
        fakeTrust('acme', 'aws', '111122223333', 'arn:aws:iam::1:role/x'),
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('cloud_mismatch');
    });

    it('rejects an instance_url that is not an http(s) URL', async () => {
      const adapter = new SonarQubeAdapter({ assume_fn: recordingAssumeFn() });
      const result = await adapter.probeTrust(
        fakeTrust('acme', 'sonarqube', 'sonar.acme.example', `project:${SONARQUBE_PROJECT_KEY}`),
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('instance_url_malformed');
    });

    it('rejects a role_ref that does not start with project:', async () => {
      const adapter = new SonarQubeAdapter({ assume_fn: recordingAssumeFn() });
      const result = await adapter.probeTrust(
        fakeTrust('acme', 'sonarqube', SONARQUBE_INSTANCE_URL, 'application:foo'),
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('project_ref_malformed');
    });
  });

  describe('assume', () => {
    it('mints a fresh token, clamps the lifetime to ≤ 15 minutes, never returns the raw token', async () => {
      const assume_fn = recordingAssumeFn({
        expirationMs: Date.now() + 10 * 60 * 60 * 1000, // 10h — well above the cap
      });
      const adapter = new SonarQubeAdapter({ assume_fn });
      const result = await adapter.assume(sonarqubeArgs(), 'jwt-for-test');
      const now = Date.now();
      expect(result.expires_at_ms - now).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);
      // The assume_fn was called with the right pin.
      expect(assume_fn.calls).toHaveLength(1);
      expect(assume_fn.calls[0].instance_url).toBe(SONARQUBE_INSTANCE_URL);
      expect(assume_fn.calls[0].token_name).toBe('fora-acme-deploy');
      expect(assume_fn.calls[0].for_jwt).toBe('jwt-for-test');
      // The handle is opaque: no raw token, no full project key in the
      // typed shape (only the fingerprint is logged).
      expect(result.role_fingerprint).toMatch(/^sonarqube:[0-9a-f]{16}$/);
      // The handle itself does NOT carry the raw token.
      const handle = result.handle as SonarQubeUserTokenHandle;
      expect(handle.token_name_prefix).toBe('fora-acm');
      expect(handle.project_key).toBe(SONARQUBE_PROJECT_KEY);
      expect(handle.instance_url).toBe(SONARQUBE_INSTANCE_URL);
      const serialised = JSON.stringify(handle);
      expect(serialised).not.toMatch(JWT_RE);
      expect(serialised).not.toMatch(SONAR_TOKEN_RE);
    });

    it('rejects args for a different cloud', async () => {
      const adapter = new SonarQubeAdapter({ assume_fn: recordingAssumeFn() });
      await expect(
        // @ts-expect-error — testing runtime guard
        adapter.assume({ ...sonarqubeArgs(), cloud: 'aws' }, 'jwt'),
      ).rejects.toThrow(/non-sonarqube args/);
    });

    it('rejects an empty token from the assume_fn', async () => {
      const adapter = new SonarQubeAdapter({
        assume_fn: async () => ({ token: '', expiration_ms: Date.now() + 60_000 }),
      });
      await expect(adapter.assume(sonarqubeArgs(), 'jwt')).rejects.toThrow(/empty_token/);
    });
  });

  describe('perform', () => {
    it('issues a GET against the right /api path with the bearer token for each allow-listed operation', async () => {
      const cases: Array<{
        service: SonarQubeActionArgs['service'];
        operation: SonarQubeActionArgs['operation'];
        expected_path: string;
        params?: SonarQubeActionArgs['params'];
      }> = [
        { service: 'projects', operation: 'search', expected_path: '/api/projects/search' },
        { service: 'projects', operation: 'show', expected_path: '/api/projects/show', params: { project: SONARQUBE_PROJECT_KEY } },
        { service: 'issues', operation: 'search', expected_path: '/api/issues/search' },
        { service: 'qualitygates', operation: 'project_status', expected_path: '/api/qualitygates/project_status', params: { projectKey: SONARQUBE_PROJECT_KEY } },
        { service: 'webhooks', operation: 'deliveries', expected_path: '/api/webhooks/deliveries' },
        { service: 'components', operation: 'search', expected_path: '/api/components/search' },
        { service: 'measures', operation: 'component', expected_path: '/api/measures/component', params: { component: `${SONARQUBE_PROJECT_KEY}:src/foo.ts`, metricKeys: ['coverage', 'complexity'] } },
      ];

      for (const c of cases) {
        const assume_fn = recordingAssumeFn();
        const dispatch_fn = recordingDispatchFn({ body: { ok: true, op: `${c.service}.${c.operation}` } });
        const release_fn = recordingReleaseFn();
        const adapter = new SonarQubeAdapter({ assume_fn, dispatch_fn, release_fn });
        const assume = await adapter.assume(
          sonarqubeArgs({ service: c.service, operation: c.operation, params: c.params ?? {} }),
          'jwt',
        );
        const response = await adapter.perform(assume.handle as never, sonarqubeArgs({ service: c.service, operation: c.operation, params: c.params ?? {} }));
        expect(dispatch_fn.calls).toHaveLength(1);
        const { url, init } = dispatch_fn.calls[0];
        // URL: instance_url + path, no double slashes
        expect(url.startsWith(`${SONARQUBE_INSTANCE_URL}${c.expected_path}`)).toBe(true);
        // Method is GET — read-only mandate from FORA-290.
        expect(init.method).toBe('GET');
        // Bearer header carries the token from `assume_fn`.
        const headers = init.headers as Record<string, string>;
        expect(headers.authorization).toBe(`Bearer sq-stub-token-1`);
        // release_fn was called exactly once with the token name.
        expect(release_fn.calls).toHaveLength(1);
        expect(release_fn.calls[0].token_name).toBe('fora-acme-deploy');
        expect(release_fn.calls[0].instance_url).toBe(SONARQUBE_INSTANCE_URL);
        // Response payload returns to the broker intact (no credential
        // material because the canned body has none).
        expect(response).toEqual({ ok: true, op: `${c.service}.${c.operation}` });
      }
    });

    it('refuses a non-GET / non-allow-listed operation before any network call', async () => {
      const assume_fn = recordingAssumeFn();
      const dispatch_fn = recordingDispatchFn();
      const release_fn = recordingReleaseFn();
      const adapter = new SonarQubeAdapter({ assume_fn, dispatch_fn, release_fn });
      const assume = await adapter.assume(sonarqubeArgs(), 'jwt');
      // Unknown service
      await expect(
        adapter.perform(assume.handle as never, sonarqubeArgs({ service: 'user_tokens', operation: 'search' })),
      ).rejects.toThrow(/unsupported_sonarqube_service:user_tokens/);
      // Unknown operation on a known service
      await expect(
        adapter.perform(assume.handle as never, sonarqubeArgs({ service: 'projects', operation: 'delete' })),
      ).rejects.toThrow(/unsupported_sonarqube_operation:projects:delete/);
      // No network call landed.
      expect(dispatch_fn.calls).toHaveLength(0);
    });

    it('wipes the holder after perform() — a second perform on the same handle throws', async () => {
      const assume_fn = recordingAssumeFn();
      const dispatch_fn = recordingDispatchFn();
      const release_fn = recordingReleaseFn();
      const adapter = new SonarQubeAdapter({ assume_fn, dispatch_fn, release_fn });
      const assume = await adapter.assume(sonarqubeArgs(), 'jwt');
      await adapter.perform(assume.handle as never, sonarqubeArgs());
      await expect(
        adapter.perform(assume.handle as never, sonarqubeArgs()),
      ).rejects.toThrow(/sonarqube_handle_already_released/);
    });

    it('cross-tenant deny-by-default: a handle pinned to project A refuses to serve project B', async () => {
      const assume_fn = recordingAssumeFn();
      const dispatch_fn = recordingDispatchFn();
      const release_fn = recordingReleaseFn();
      const adapter = new SonarQubeAdapter({ assume_fn, dispatch_fn, release_fn });
      const assume = await adapter.assume(sonarqubeArgs({ project_key: 'acme-foo' }), 'jwt');
      // Same tenant, different project: refused.
      await expect(
        adapter.perform(assume.handle as never, sonarqubeArgs({ project_key: 'acme-bar' })),
      ).rejects.toThrow(/sonarqube_project_scope_mismatch/);
      // No network call landed.
      expect(dispatch_fn.calls).toHaveLength(0);
    });

    it('rejects perform() with a handle that was never issued by this adapter', async () => {
      const adapter = new SonarQubeAdapter({ assume_fn: recordingAssumeFn(), dispatch_fn: recordingDispatchFn() });
      const fakeHandle = {
        instance_url: SONARQUBE_INSTANCE_URL,
        project_key: SONARQUBE_PROJECT_KEY,
        token_name_prefix: 'fake',
        expires_at_ms: Date.now() + 60_000,
        _internal: {},
      };
      await expect(
        adapter.perform(fakeHandle as never, sonarqubeArgs()),
      ).rejects.toThrow(/sonarqube_handle_already_released/);
    });

    it('releases the handle even when the dispatcher throws (fail-closed)', async () => {
      const assume_fn = recordingAssumeFn();
      const dispatch_fn: SonarQubeDispatchFn = async () => {
        throw new Error('upstream_down');
      };
      const release_fn = recordingReleaseFn();
      const adapter = new SonarQubeAdapter({ assume_fn, dispatch_fn, release_fn });
      const assume = await adapter.assume(sonarqubeArgs(), 'jwt');
      await expect(adapter.perform(assume.handle as never, sonarqubeArgs())).rejects.toThrow(/upstream_down/);
      // release_fn still ran (rotation happens in finally).
      expect(release_fn.calls).toHaveLength(1);
    });

    it('releaseHandle() is idempotent', async () => {
      const adapter = new SonarQubeAdapter({ assume_fn: recordingAssumeFn() });
      const assume = await adapter.assume(sonarqubeArgs(), 'jwt');
      adapter.releaseHandle(assume.handle);
      // Calling it twice does not throw.
      expect(() => adapter.releaseHandle(assume.handle)).not.toThrow();
    });
  });
});

describe('FORA-321: SonarQube adapter through the broker pipeline', () => {
  let deps: ReturnType<typeof buildDeps>;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    deps = buildDeps();
    app = await buildServer(deps);
    await app.ready();
  });

  it('acceptance bar: security-engineer SonarQube action on active trust succeeds and the audit event is credential-free', async () => {
    const assume_fn = recordingAssumeFn();
    const dispatch_fn = recordingDispatchFn({ body: { projects: [{ key: SONARQUBE_PROJECT_KEY }] } });
    const release_fn = recordingReleaseFn();
    deps = buildDeps({ assume_fn, dispatch_fn, release_fn });
    app = await buildServer(deps);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/broker/action',
      payload: buildSonarQubeRequest(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.response_code).toBe('ok');
    expect(body.cloud).toBe('sonarqube');
    expect(body.action).toBe('projects.search');
    expect(body.role_fingerprint).toMatch(/^sonarqube:/);
    // Assume ran.
    expect(assume_fn.calls).toHaveLength(1);
    // Dispatch ran with the right URL.
    expect(dispatch_fn.calls).toHaveLength(1);
    expect(dispatch_fn.calls[0].url).toContain('/api/projects/search');
    // Release ran exactly once.
    expect(release_fn.calls).toHaveLength(1);
    // Audit envelope: exactly one event, no SonarQube-shaped credential.
    expect(deps.audit.events).toHaveLength(1);
    const ev = deps.audit.events[0];
    expect(ev.action).toBe('cloud.brokered');
    expect(ev.response_code).toBe('ok');
    expect(ev.cloud).toBe('sonarqube');
    expect(ev.cloud_action).toBe('projects.search');
    expect(ev.role_fingerprint).toMatch(/^sonarqube:/);
    expect(scanForSonarQubeCredentials(ev)).toEqual([]);
    const serialised = JSON.stringify(ev);
    expect(serialised).not.toMatch(JWT_RE);
    expect(serialised).not.toMatch(SONAR_TOKEN_RE);
  });

  it('acceptance bar: deny-listed SonarQube action returns 403 deny_listed_action and the audit event is credential-free', async () => {
    const assume_fn = recordingAssumeFn();
    const dispatch_fn = recordingDispatchFn();
    const release_fn = recordingReleaseFn();
    deps = buildDeps({ assume_fn, dispatch_fn, release_fn });
    app = await buildServer(deps);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/broker/action',
      // `projects.create` is on the deny-list (write path).
      payload: buildSonarQubeRequest({
        action: 'projects.create',
        args: sonarqubeArgs({ service: 'projects', operation: 'create' }),
      }),
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.response_code).toBe('deny_listed_action');
    // The federation token was never minted.
    expect(assume_fn.calls).toHaveLength(0);
    expect(dispatch_fn.calls).toHaveLength(0);
    expect(release_fn.calls).toHaveLength(0);
    expect(deps.audit.events).toHaveLength(1);
    expect(deps.audit.events[0].response_code).toBe('deny_listed');
    expect(scanForSonarQubeCredentials(deps.audit.events[0])).toEqual([]);
  });

  it('tenant with cloud_disabled SonarQube trust is refused before any token mint', async () => {
    const assume_fn = recordingAssumeFn();
    const dispatch_fn = recordingDispatchFn();
    const release_fn = recordingReleaseFn();
    deps = buildDeps({ assume_fn, dispatch_fn, release_fn, sonarqube_trust_state: 'cloud_disabled' });
    app = await buildServer(deps);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/broker/action',
      payload: buildSonarQubeRequest(),
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.response_code).toBe('cloud_disabled');
    expect(assume_fn.calls).toHaveLength(0);
    expect(dispatch_fn.calls).toHaveLength(0);
    expect(release_fn.calls).toHaveLength(0);
  });

  it('after a successful SonarQube action, the BrokeredResult.response is credential-free', async () => {
    const dispatch_fn = recordingDispatchFn({ body: { projects: [{ key: SONARQUBE_PROJECT_KEY }] } });
    deps = buildDeps({ dispatch_fn });
    app = await buildServer(deps);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/broker/action',
      payload: buildSonarQubeRequest(),
    });
    const body = JSON.parse(res.body);
    expect(scanForSonarQubeCredentials(body.response)).toEqual([]);
    expect(res.body).not.toMatch(JWT_RE);
    // The full project key may appear (it's not a secret), but the
    // raw token never does.
    void FULL_PROJECT_KEY_RE;
  });
});