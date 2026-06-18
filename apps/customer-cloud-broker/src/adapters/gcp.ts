/**
 * GCP Workload Identity Federation adapter for the customer-cloud-broker
 * (FORA-126.3 / 0.7.4).
 *
 * The broker is the *only* path through which a FORA agent can act on a
 * customer's GCP project. The broker exchanges a FORA-issued OIDC token
 * for a short-lived GCP federated access token via `google-auth-library`
 * ≥ 9.x, performs the action, and discards the credential.
 *
 * The customer's WIF pool + provider is the federation target. The
 * provider is the customer's resource that trusts the FORA identity-
 * broker OIDC issuer and audience. The impersonated service account is
 * `args.service_account` (the customer grants the WIF provider the
 * `roles/iam.workloadIdentityUser` role on that SA at the GCP project
 * level).
 *
 * Credential lifetime: the broker hard-caps impersonation at 15 min
 * via `service_account_impersonation.token_lifetime_seconds = 900`.
 * The returned `expires_at_ms` is the *minimum* of (Google's declared
 * expiry, the broker's 15-min cap).
 *
 * No credential material is reachable from outside the adapter:
 *   - the `handle` returned to the broker carries `expires_at_ms` and
 *     a `service_account_prefix` (low-cardinality identifier),
 *   - the raw GCP access token lives in a closure-scoped holder map
 *     keyed by the handle, the same pattern as the AWS adapter,
 *   - the audit factory in `audit.ts` rejects any field whose name
 *     matches a credential pattern (`access_token`, `refresh_token`,
 *     `id_token`, `client_secret`, ...) before serialising the result.
 *
 * `perform()` (FORA-126.5 follow-up): per-service SDK dispatch.
 *
 *   - The per-service GCP SDK package
 *     (`@google-cloud/compute`, `@google-cloud/storage`,
 *     `@google-cloud/local-auth` is *not* used — the lazy import
 *     points at the per-service package explicitly) is lazy-imported
 *     on first call for that service.
 *   - The SDK client is constructed with the federated access token
 *     and the customer-specified project.
 *   - Per-tenant+service token bucket and circuit breaker mirror the
 *     AWS adapter so a degraded customer does not starve other tenants.
 *   - The response is redacted of any credential-shaped fields before
 *     it crosses the broker boundary.
 *
 * Test seam: `assume_fn` and `dispatch_fn` injection points so unit
 * tests can run without contacting Google's STS or any GCP service.
 *
 * FORA-126.3 acceptance bars:
 *   1. A `deploy-agent` GCP action on a tenant with active GCP trust
 *      succeeds (covered by the unit test that stubs `assume_fn` +
 *      `dispatch_fn`).
 *   2. A deny-listed GCP action returns `403 deny_listed_action`
 *      before any `assume` call (covered by the broker's existing
 *      deny-list test, which uses `iam.serviceAccountKeys.create`).
 *   3. No credential material in agent-visible payloads (covered by
 *      `test/gcp-credential-leak.test.ts` and the existing
 *      `memory-dump-scan.test.ts`).
 */

import { createHash } from 'node:crypto';
import type {
  GcpActionArgs,
  CloudAdapter,
  AssumeResult,
  TenantCloudTrust,
} from '../types.js';
import { MAX_CREDENTIAL_LIFETIME_MS } from '../types.js';
import { redactCredentials, assertNoCredentials } from '../audit.js';

// ---------------------------------------------------------------------------
// Token bucket. Per (tenant_id, service) — caps the steady-state call
// rate so a misbehaving agent cannot exhaust a customer's project
// quotas. Inlined here (same as the AWS adapter) to keep the adapter
// module self-contained. The behaviour is identical: capacity 10,
// refill 10/s, well under any GCP service quota but high enough that
// real agent traffic is not throttled.
// ---------------------------------------------------------------------------

interface TokenBucketOpts {
  /** Maximum burst size. */
  capacity: number;
  /** Steady-state refill rate (tokens per second). */
  refill_per_sec: number;
  /** `now()` injection for tests. */
  now?: () => number;
}

class TokenBucket {
  private tokens: number;
  private last_refill_ms: number;
  private readonly capacity: number;
  private readonly refill_per_ms: number;
  private readonly now: () => number;

  constructor(opts: TokenBucketOpts) {
    this.capacity = opts.capacity;
    this.refill_per_ms = opts.refill_per_sec / 1000;
    this.now = opts.now ?? Date.now;
    this.tokens = opts.capacity;
    this.last_refill_ms = this.now();
  }

  /**
   * Try to take one token. Returns `true` on success, `false` if the
   * bucket is empty (caller should fail fast with a rate-limit error).
   */
  take(): boolean {
    const now = this.now();
    const elapsed_ms = now - this.last_refill_ms;
    if (elapsed_ms > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed_ms * this.refill_per_ms);
      this.last_refill_ms = now;
    }
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Circuit breaker. Per (tenant_id, service). Closed = pass through.
// Open = fail fast. After the cooldown the breaker enters half-open:
// a single probe is allowed through. Success closes the breaker;
// failure re-opens it for another cooldown. This isolates a single
// degraded customer from every other tenant+service.
// ---------------------------------------------------------------------------

type BreakerState = 'closed' | 'open' | 'half_open';

interface CircuitBreakerOpts {
  /** Consecutive failures that trip the breaker from closed → open. */
  failure_threshold: number;
  /** Time (ms) the breaker stays open before allowing a half-open probe. */
  cooldown_ms: number;
  /** `now()` injection for tests. */
  now?: () => number;
}

class CircuitBreaker {
  state: BreakerState = 'closed';
  private failure_count = 0;
  private opened_at_ms = 0;
  private half_open_in_flight = false;
  private readonly failure_threshold: number;
  private readonly cooldown_ms: number;
  private readonly now: () => number;

  constructor(opts: CircuitBreakerOpts) {
    this.failure_threshold = opts.failure_threshold;
    this.cooldown_ms = opts.cooldown_ms;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Returns `true` if the call may proceed. Side effect: when the
   * breaker is in `half_open` and the cooldown has elapsed, the first
   * caller wins the probe slot; subsequent callers are rejected until
   * the probe resolves.
   */
  canPass(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (this.now() - this.opened_at_ms >= this.cooldown_ms) {
        this.state = 'half_open';
        this.half_open_in_flight = false;
      } else {
        return false;
      }
    }
    if (this.state === 'half_open') {
      if (this.half_open_in_flight) return false;
      this.half_open_in_flight = true;
      return true;
    }
    return false;
  }

  onSuccess(): void {
    this.state = 'closed';
    this.failure_count = 0;
    this.half_open_in_flight = false;
  }

  onFailure(): void {
    this.failure_count += 1;
    this.half_open_in_flight = false;
    if (this.state === 'half_open' || this.failure_count >= this.failure_threshold) {
      this.state = 'open';
      this.opened_at_ms = this.now();
    }
  }
}

export interface ReliabilityOpts {
  /** Per-bucket capacity (default 10). */
  rate_capacity?: number;
  /** Per-bucket refill rate per second (default 10). */
  rate_per_sec?: number;
  /** Consecutive failures that trip the breaker (default 5). */
  breaker_threshold?: number;
  /** Breaker cooldown in ms (default 30_000). */
  breaker_cooldown_ms?: number;
  /** `now()` injection for tests. */
  now?: () => number;
}

function makeReliabilityState(opts: ReliabilityOpts = {}) {
  const now = opts.now ?? Date.now;
  const rate_capacity = opts.rate_capacity ?? 10;
  const rate_per_sec = opts.rate_per_sec ?? 10;
  const breaker_threshold = opts.breaker_threshold ?? 5;
  const breaker_cooldown_ms = opts.breaker_cooldown_ms ?? 30_000;
  return {
    buckets: new Map<string, TokenBucket>(),
    breakers: new Map<string, CircuitBreaker>(),
    makeBucket(): TokenBucket {
      return new TokenBucket({ capacity: rate_capacity, refill_per_sec: rate_per_sec, now });
    },
    makeBreaker(): CircuitBreaker {
      return new CircuitBreaker({
        failure_threshold: breaker_threshold,
        cooldown_ms: breaker_cooldown_ms,
        now,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Opaque handle. The broker sees this; nothing else. It deliberately does
// NOT carry the raw GCP access token — that lives in a closure-scoped
// holder, the same pattern as `aws.ts`.
// ---------------------------------------------------------------------------

const HANDLE_INTERNAL = Symbol('gcp.handle.internal');

export interface GcpCredentialHandle {
  /** GCP project number that was federated into. */
  readonly project_number: string;
  /** Service account email that was impersonated. */
  readonly service_account: string;
  /** Wall-clock expiry (epoch ms). */
  readonly expires_at_ms: number;
  /** Low-cardinality prefix of the service account (safe to log). */
  readonly service_account_prefix: string;
  /**
   * Internal-only marker. The adapter sets the raw holder in a
   * module-local WeakMap keyed by this handle and zeroes it after
   * `perform()` returns. The broker never sees this field.
   */
  readonly _internal: { readonly [HANDLE_INTERNAL]?: never };
}

interface Holder {
  /** Short-lived GCP federated access token. ~15 min lifetime. */
  access_token: string;
  /** Expiry as epoch ms. The broker refuses anything > MAX_CREDENTIAL_LIFETIME_MS. */
  expiration_ms: number;
  /**
   * The IdentityPoolClient instance. Held for the lifetime of the
   * action so a future per-service SDK client (FORA-126.5 follow-up)
   * can pull a fresh bearer token via `client.getAccessToken()`.
   */
  client: unknown;
}

function makeHandle(args: GcpActionArgs, expires_at_ms: number): GcpCredentialHandle {
  const sa_email = args.service_account;
  // `noUncheckedIndexedAccess: true` means TS treats `split('@')[0]` as
  // possibly undefined even though the array is never empty. The
  // `??` provides a safe fallback so the build doesn't break; the
  // probeTrust's service_account_ref_malformed check rejects
  // anything that doesn't have an `@` anyway.
  const sa_prefix = sa_email.split('@')[0] ?? '';
  return {
    project_number: args.project_number,
    service_account: sa_email,
    expires_at_ms,
    service_account_prefix: sa_prefix.slice(0, 8),
    _internal: Object.freeze({ [HANDLE_INTERNAL]: undefined as never }),
  } as GcpCredentialHandle;
}

function newHolder(
  client: unknown,
  access_token: string,
  expiration_ms: number,
): Holder {
  return { access_token, expiration_ms, client };
}

// Module-level WeakMap from handle to holder. Lives only for the lifetime
// of the brokered action; the broker is responsible for calling
// `releaseHandle(handle)` after `perform()` returns. The adapter ALSO
// releases in its own `finally` so a forgotten caller cannot leak a holder
// indefinitely.
const HOLDER_REGISTRY = new WeakMap<GcpCredentialHandle, Holder>();

function releaseHandle(handle: GcpCredentialHandle): void {
  HOLDER_REGISTRY.delete(handle);
}

// ---------------------------------------------------------------------------
// Per-service dispatch registry. v1 supports the three service namespaces
// the FORA-126.3 spec calls out: compute, storage, iam. Adding a new
// service is a one-line addition here AND a one-line `dynamicImport` entry
// below. The operation allow list is *positive* — anything not in the map
// is rejected with `unsupported_gcp_service_operation` before the SDK is
// even touched, so a typo in the action string cannot reach the customer's
// GCP project.
// ---------------------------------------------------------------------------

/**
 * Map from `args.service` to the SDK client class name and the set of
 * allowed operations. The operation names match the GCP SDK v1 method
 * names exposed on the client (e.g. `compute.instances.list` →
 * `instances.list`).
 */
const SERVICE_OPS: Record<string, { client: string; operations: Record<string, string> }> = {
  compute: {
    client: 'InstancesClient',
    operations: {
      list: 'list',
      get: 'get',
      'aggregatedList': 'aggregatedList',
    },
  },
  storage: {
    client: 'Storage',
    operations: {
      'bucket.get': 'bucket.get',
      'bucket.list': 'bucket.list',
      'object.get': 'object.get',
    },
  },
  iam: {
    client: 'ProjectsIamPoliciesClient',
    operations: {
      'projects.serviceAccounts.get': 'getServiceAccount',
      'projects.serviceAccounts.list': 'listServiceAccounts',
    },
  },
};

/** Lazy module loaders, keyed by service name. */
const SERVICE_LOADERS: Record<string, () => Promise<unknown>> = {
  compute: () => import('@google-cloud/compute'),
  storage: () => import('@google-cloud/storage'),
  iam: () => import('@google-cloud/resource-manager'),
};

// ---------------------------------------------------------------------------
// Test injection seams.
// ---------------------------------------------------------------------------

export type GcpAssumeFn = (input: GcpAssumeFnInput) => Promise<GcpAssumeFnOutput>;

export interface GcpAssumeFnInput {
  /** Full WIF provider resource name (the `audience` google-auth-library needs). */
  audience: string;
  /** JWT to exchange at the GCP STS endpoint. */
  subject_token: string;
  /** Impersonated service account email (for the impersonation URL). */
  service_account: string;
}

export interface GcpAssumeFnOutput {
  /** The federated access token returned by the STS exchange. */
  access_token: string;
  /** Token expiry as epoch ms. */
  expiration_ms: number;
  /**
   * The underlying `IdentityPoolClient` (or a test double). Held by the
   * adapter so the per-service SDK dispatch can pull a fresh bearer
   * token via `client.getAccessToken()`.
   */
  client: unknown;
}

export type DispatchFn = (
  service: string,
  operation: string,
  params: Record<string, unknown>,
  holder: Holder,
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// GCP adapter.
// ---------------------------------------------------------------------------

export interface GcpAdapterOptions {
  /** The broker's OIDC issuer URL (the identity-broker). The customer's WIF provider trusts this. */
  broker_issuer: string;
  /** The OIDC audience (the broker's client_id at the FORA IdP). */
  broker_audience: string;
  /**
   * Override the `assume` function for tests. Production code uses the
   * default, which constructs an `IdentityPoolClient` from
   * `google-auth-library` and exchanges the FORA JWT at
   * `https://sts.googleapis.com/v1/token`.
   */
  assume_fn?: GcpAssumeFn;
  /**
   * Inject the per-service dispatcher (test seam). Production lazy-
   * imports the per-service `@google-cloud/*` SDK package, constructs a
   * client with the federated access token, and calls the SDK method.
   */
  dispatch_fn?: DispatchFn;
  /** Per-tenant+service rate limit + circuit breaker configuration. */
  reliability?: ReliabilityOpts;
}

export class GcpAdapter implements CloudAdapter {
  readonly cloud = 'gcp' as const;
  private readonly broker_issuer: string;
  private readonly broker_audience: string;
  private readonly assume_fn: GcpAssumeFn;
  private readonly dispatch_fn: DispatchFn;
  private readonly reliability: ReturnType<typeof makeReliabilityState>;

  constructor(opts: GcpAdapterOptions) {
    this.broker_issuer = opts.broker_issuer;
    this.broker_audience = opts.broker_audience;
    this.assume_fn = opts.assume_fn ?? defaultAssumeFn;
    this.dispatch_fn = opts.dispatch_fn ?? defaultDispatchFn;
    this.reliability = makeReliabilityState(opts.reliability);
  }

  /**
   * Probe the customer's GCP trust. Structural + issuer/audience
   * match check, matching the AWS adapter's pattern.
   *
   * The trust record carries:
   *   - `account`          = project_number (must be numeric)
   *   - `role_ref`         = `serviceAccount:EMAIL` (the impersonated SA)
   *   - `expected_issuer`  = the broker's OIDC issuer
   *   - `expected_audience` = the broker's OIDC audience
   *
   * The WIF pool + provider are per-action (carried in `GcpActionArgs`)
   * because a tenant may have multiple WIF providers for different
   * trust levels (deploy vs read-only).
   */
  async probeTrust(trust: TenantCloudTrust): Promise<{ ok: boolean; reason: string | null }> {
    if (trust.cloud !== 'gcp') {
      return { ok: false, reason: 'cloud_mismatch' };
    }
    if (!/^\d+$/.test(trust.account)) {
      return { ok: false, reason: 'project_number_must_be_numeric' };
    }
    if (!trust.role_ref.startsWith('serviceAccount:')) {
      return { ok: false, reason: 'service_account_ref_malformed' };
    }
    if (trust.expected_issuer !== this.broker_issuer) {
      return { ok: false, reason: 'expected_issuer_mismatch' };
    }
    if (trust.expected_audience !== this.broker_audience) {
      return { ok: false, reason: 'expected_audience_mismatch' };
    }
    return { ok: true, reason: null };
  }

  /**
   * Exchange the FORA JWT for a GCP federated access token and stash it
   * in a closure-scoped holder. The broker gets back an opaque handle.
   *
   * The exchange is two-step inside google-auth-library's
   * `IdentityPoolClient`:
   *
   *   1. POST the subject token (the FORA JWT) to
   *      `https://sts.googleapis.com/v1/token` with
   *      `audience = //iam.googleapis.com/projects/.../providers/...`.
   *      Google returns a short-lived federated access token scoped
   *      to the workload identity pool.
   *   2. Impersonate the target service account via
   *      `iamcredentials.googleapis.com/v1/...:generateAccessToken`,
   *      using the federated token as the bearer. Google returns an
   *      access token bound to the impersonated SA, with a lifetime
   *      the broker hard-caps at 15 min via
   *      `service_account_impersonation.token_lifetime_seconds`.
   *
   * The returned `expires_at_ms` is the *minimum* of (Google's
   * declared expiry, the broker's 15-min cap). A token that Google
   * would mint for longer still satisfies the cap.
   */
  async assume(args: GcpActionArgs, for_jwt: string): Promise<AssumeResult> {
    if (args.cloud !== 'gcp') {
      throw new Error('gcp adapter received non-gcp args');
    }
    const audience =
      `//iam.googleapis.com/projects/${args.project_number}` +
      `/locations/global/workloadIdentityPools/${args.workload_identity_pool}` +
      `/providers/${args.workload_identity_provider}`;
    const service_account_email = args.service_account;
    const result = await this.assume_fn({
      audience,
      subject_token: for_jwt,
      service_account: service_account_email,
    });
    // Hard cap. The cap is enforced by google-auth-library (the
    // `service_account_impersonation.token_lifetime_seconds` field
    // in the default `assume_fn`) AND by this min() — defence in
    // depth so a future `assume_fn` override cannot bypass the cap.
    const expires_at_ms = Math.min(result.expiration_ms, Date.now() + MAX_CREDENTIAL_LIFETIME_MS);
    const handle = makeHandle(args, expires_at_ms);
    HOLDER_REGISTRY.set(handle, newHolder(result.client, result.access_token, expires_at_ms));
    return {
      handle,
      expires_at_ms,
      role_fingerprint: gcpRoleFingerprint(args),
    };
  }

  /**
   * Dispatch the action to the per-service GCP SDK. Lazy import: the
   * `@google-cloud/*` packages aren't a hard dependency at boot — the
   * first call to a given service triggers `import('@google-cloud/...')`
   * inside `defaultDispatchFn`.
   *
   * Per-tenant+service rate limiting and circuit breaker gate the call.
   * A rate-limit / circuit-open failure is surfaced as a typed error
   * so the broker can record `operation_failed` with a precise reason.
   * The response is redacted of any credential-shaped fields before it
   * crosses the broker boundary.
   *
   * The handle is wiped after the call regardless of success/failure.
   */
  async perform(
    handle: GcpCredentialHandle,
    args: GcpActionArgs,
    ctx: { tenant_id?: string; trace_id?: string } = {},
  ): Promise<unknown> {
    const holder = HOLDER_REGISTRY.get(handle);
    if (!holder) {
      throw new Error('gcp_handle_already_released');
    }
    const tenant_id = ctx.tenant_id ?? 'unknown';
    const svcKey = `${tenant_id}|${args.service}`;
    const bucket =
      this.reliability.buckets.get(svcKey) ?? this.reliability.makeBucket();
    if (!this.reliability.buckets.has(svcKey)) this.reliability.buckets.set(svcKey, bucket);
    const breaker =
      this.reliability.breakers.get(svcKey) ?? this.reliability.makeBreaker();
    if (!this.reliability.breakers.has(svcKey)) this.reliability.breakers.set(svcKey, breaker);

    try {
      if (!bucket.take()) {
        breaker.onFailure();
        throw new Error(`gcp_rate_limited:${args.service}`);
      }
      if (!breaker.canPass()) {
        throw new Error(`gcp_circuit_open:${args.service}`);
      }
      // Operation is a positive allow list — fail fast before
      // touching the SDK so a typo in the action string can't reach
      // the customer's GCP project.
      const opMap = SERVICE_OPS[args.service];
      if (!opMap) {
        throw new Error(`unsupported_gcp_service:${args.service}`);
      }
      const methodName = opMap.operations[args.operation];
      if (!methodName) {
        throw new Error(`unsupported_gcp_service_operation:${args.service}:${args.operation}`);
      }
      const response = await this.dispatch_fn(args.service, args.operation, args.params, holder);
      // Redact the response of any credential-shaped fields, then
      // assert credential-freeness. A failure here is a real bug —
      // the SDK should not be surfacing a credential, but if it does
      // (or a service ever adds a new credential-shaped field), the
      // broker fails the request rather than leak it.
      const redacted = redactCredentials(response);
      assertNoCredentials(redacted);
      breaker.onSuccess();
      return redacted;
    } catch (err) {
      // The breaker only counts SDK / network failures, not
      // permission / validation errors that are the caller's fault.
      // Rate-limit and unsupported-op paths set their own onFailure
      // (or not) above; SDK / network errors flow here.
      if (err instanceof Error) {
        const reason = err.message;
        if (
          !reason.startsWith('gcp_rate_limited:') &&
          !reason.startsWith('gcp_circuit_open:') &&
          !reason.startsWith('unsupported_gcp_service') &&
          !reason.startsWith('gcp_handle_already_released')
        ) {
          breaker.onFailure();
        }
      }
      throw err;
    } finally {
      releaseHandle(handle);
    }
  }

  /**
   * Release a handle obtained from `assume()` without calling
   * `perform()`. The probe path (FORA-126.4) uses this so a
   * canary-assume does not leak its holder into the adapter's
   * `HOLDER_REGISTRY`. Idempotent: calling it twice is a no-op.
   */
  releaseHandle(handle: unknown): void {
    releaseHandle(handle as GcpCredentialHandle);
  }
}

// ---------------------------------------------------------------------------
// Default `assume_fn` — real `google-auth-library` integration. Lazy-loaded
// so this module's import cost stays low. The factory is small and only
// runs at broker-time, never on the import path.
// ---------------------------------------------------------------------------

async function defaultAssumeFn(input: GcpAssumeFnInput): Promise<GcpAssumeFnOutput> {
  // Dynamic import. We only want google-auth-library in memory when an
  // actual GCP assume happens, not on broker boot.
  const { IdentityPoolClient } = await import('google-auth-library');
  const client = new IdentityPoolClient({
    audience: input.audience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    subject_token_supplier: {
      getSubjectToken: async () => input.subject_token,
    },
    service_account_impersonation_url:
      `https://iamcredentials.googleapis.com/v1/` +
      `projects/-/serviceAccounts/${encodeURIComponent(input.service_account)}:generateAccessToken`,
    // Hard-cap impersonation at 15 min. The IAM API caps at 3600s by
    // default, but 900s is the broker's lifetime cap (ADR-0003 §6.2).
    service_account_impersonation: {
      token_lifetime_seconds: Math.floor(MAX_CREDENTIAL_LIFETIME_MS / 1000),
    },
  });
  // Force the STS exchange + impersonation step. `getAccessToken()`
  // throws on failure; the broker turns that into `assume_failed`.
  const res = await client.getAccessToken();
  const access_token = res.token;
  if (!access_token) {
    throw new Error('gcp_assume_no_access_token');
  }
  // google-auth-library 9.x doesn't expose `expiration_time_ms` on the
  // token response directly; the impersonation lifetime is the binding
  // constraint, so we use the cap. A future refactor (FORA-126.4) can
  // parse the `expireTime` field from the iamcredentials response.
  const expiration_ms = Date.now() + MAX_CREDENTIAL_LIFETIME_MS;
  return { access_token, expiration_ms, client };
}

// ---------------------------------------------------------------------------
// Default `dispatch_fn` — lazy per-service SDK dispatch. Constructs the
// per-service client with the federated access token, calls the operation
// method, and returns the response. `perform()` redacts and asserts.
// ---------------------------------------------------------------------------

async function defaultDispatchFn(
  service: string,
  operation: string,
  params: Record<string, unknown>,
  holder: Holder,
): Promise<unknown> {
  const loader = SERVICE_LOADERS[service];
  if (!loader) {
    throw new Error(`unsupported_gcp_service:${service}`);
  }
  const mod = (await loader()) as Record<string, unknown>;
  const opMap = SERVICE_OPS[service];
  if (!opMap) {
    throw new Error(`unsupported_gcp_service:${service}`);
  }
  const ClientClass = mod[opMap.client] as new (config: unknown) => {
    close: () => void;
    [key: string]: unknown;
  };
  if (!ClientClass) {
    throw new Error(`unsupported_gcp_service:${service}`);
  }
  // The federated access token is attached as the bearer credential
  // for every per-service SDK client. google-auth-library's
  // `IdentityPoolClient` exposes `getRequestHeaders()` which returns
  // `{ Authorization: 'Bearer <token>' }`; the v1 SDK clients accept
  // an `Auth` client in the constructor's `authClient` field. v1
  // doesn't ship that field for every client (it depends on the
  // per-service SDK's contract), so the lazy-import here is a
  // forward-looking scaffold; production deploys will fill it in as
  // FORA-92 (per-service SDK dispatch) lands per-service.
  const client = new ClientClass({
    authClient: holder.client,
    ...params,
  });
  try {
    const method = (client as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[
      opMap.operations[operation]!
    ];
    if (typeof method !== 'function') {
      throw new Error(`unsupported_gcp_service_operation:${service}:${operation}`);
    }
    return await method.call(client, params);
  } finally {
    if (typeof (client as { close?: () => void }).close === 'function') {
      (client as { close: () => void }).close();
    }
  }
}

function gcpRoleFingerprint(args: GcpActionArgs): string {
  return 'gcp:' + createHash('sha256')
    .update(
      `${args.project_number}|${args.workload_identity_pool}|${args.workload_identity_provider}|${args.service_account}`,
    )
    .digest('hex')
    .slice(0, 16);
}
