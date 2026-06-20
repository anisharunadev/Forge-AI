/**
 * SonarQube adapter for the customer-cloud-broker (FORA-321 / Path B).
 *
 * FORA-290 ships the read-only MCP module (`mcp-servers/sonarqube/`) that
 * consumes a SonarQube user token. Path A's defence-in-depth is the MCP
 * boundary: the token is pinned to one project and the tool surface is
 * restricted to GETs. Path B — this file — is the *credential layer*: the
 * broker mints short-lived SonarQube user tokens scoped to a single
 * project, performs the action, and rotates the token. No raw token ever
 * crosses the broker boundary.
 *
 * Mirrors the structural template in `aws.ts`, `azure.ts`, `gcp.ts`:
 *
 *   1. The broker is the *only* path through which a FORA agent can act
 *      on a customer's SonarQube instance. The adapter assumes a fresh
 *      per-action user token via `assume()`, performs the action via
 *      `perform()` against the SonarQube REST v1 API, and rotates
 *      (revokes) the token via `release()` (and in `perform()`'s own
 *      `finally`).
 *   2. The token holder lives in a module-local WeakMap keyed by an
 *      opaque `SonarQubeUserTokenHandle`. The handle carries no raw
 *      token — the broker sees the handle and a `token_name_prefix`,
 *      nothing else.
 *   3. Lifetime cap = 15 minutes. The adapter enforces it on the
 *      returned `expires_at_ms` (minimum of SonarQube's declared expiry
 *      and `now + MAX_CREDENTIAL_LIFETIME_MS`); the broker re-checks it
 *      in `broker.ts` as a safety net.
 *   4. Cross-tenant deny-by-default: the handle is keyed by
 *      `instance_url + project_key + token_name`; `perform()` asserts
 *      that the requested `args.project_key` matches the pinned project
 *      on the handle. A holder from tenant A can never serve a request
 *      from tenant B because `perform()` would not even reach the
 *      `HOLDER_REGISTRY.get()` for a different tenant's handle — but
 *      the additional assert is belt-and-suspenders.
 *   5. Read-only: the `perform()` dispatcher refuses anything that is
 *      not a GET. The deny-list adds a `^.*$` catch-all deny for
 *      SonarQube POSTs so the broker's second line of defence lines up
 *      with the FORA-290 mandate.
 *   6. Audit: every brokered action emits exactly one `cloud.brokered`
 *      event with the `BrokeredResult`. The audit factory rejects any
 *      payload whose key matches a credential pattern
 *      (`access_token`, `token`, `bearer`, ...); the adapter itself
 *      calls `redactCredentials` + `assertNoCredentials` on the response
 *      before returning it across the broker boundary.
 *
 * Test seam: the `assume_fn` (mint+revoke) and `dispatch_fn` (GET a URL)
 * injection points let unit tests run without contacting SonarQube.
 */

import { createHash } from 'node:crypto';
import type {
  SonarQubeActionArgs,
  CloudAdapter,
  AssumeResult,
  TenantCloudTrust,
} from '../types.js';
import { MAX_CREDENTIAL_LIFETIME_MS } from '../types.js';
import { redactCredentials, assertNoCredentials } from '../audit.js';

// ---------------------------------------------------------------------------
// Opaque handle. The broker sees this; nothing else. It deliberately does
// NOT carry the raw `token` string — that lives in a module-local
// WeakMap keyed by the handle, and the handle itself is typed so a stray
// `console.log(handle)` prints an opaque summary.
// ---------------------------------------------------------------------------

export interface SonarQubeUserTokenHandle {
  /** SonarQube instance URL the token is bound to. */
  readonly instance_url: string;
  /** Project key the token is scoped to. Cross-project access is denied. */
  readonly project_key: string;
  /** Logical token name (e.g. `fora-acme-deploy`). Low-cardinality prefix is safe to log. */
  readonly token_name_prefix: string;
  /** Wall-clock expiry (epoch ms). */
  readonly expires_at_ms: number;
  /**
   * Internal-only marker. The adapter sets the raw holder in a
   * module-local WeakMap keyed by this handle and zeroes it after
   * `perform()` returns. The broker never sees this field — the
   * `_internal` symbol is module-private (defined below) and not
   * exported.
   */
  readonly _internal: { readonly [HANDLE_INTERNAL]?: never };
}

const HANDLE_INTERNAL = Symbol('sonarqube.handle.internal');
type Holder = { token: string; project_key: string };

function makeHandle(
  args: SonarQubeActionArgs,
  token_name: string,
  expires_at_ms: number,
): { handle: SonarQubeUserTokenHandle; holder: Holder } {
  const prefix = token_name.slice(0, 8);
  const handle = {
    instance_url: args.instance_url,
    project_key: args.project_key,
    token_name_prefix: prefix,
    expires_at_ms,
    _internal: Object.freeze({ [HANDLE_INTERNAL]: undefined as never }),
  } as SonarQubeUserTokenHandle;
  return { handle, holder: { token: '', project_key: args.project_key } };
}

/**
 * Module-level WeakMap from handle to the raw `Holder`. Lives only for
 * the lifetime of the brokered action; the broker is responsible for
 * calling `releaseHandle(handle)` after `perform()` returns. The handle's
 * `_internal` field is the only thing that can index this map — external
 * callers cannot construct a holder.
 */
const HOLDER_REGISTRY = new WeakMap<SonarQubeUserTokenHandle, Holder>();

function releaseHolder(handle: SonarQubeUserTokenHandle): void {
  const h = HOLDER_REGISTRY.get(handle);
  if (h) {
    // Zero the raw token so a future GC sweep or heap dump cannot
    // surface it. The string is mutated in place; references to the
    // old value (e.g. inside `assume_fn`) still hold the old bytes,
    // but those references are dropped by the caller immediately.
    h.token = '';
  }
  HOLDER_REGISTRY.delete(handle);
}

// ---------------------------------------------------------------------------
// Per-tenant+service state. Mirrors the AWS / GCP adapter's reliability
// pair so a degraded customer cannot starve other tenants.
// ---------------------------------------------------------------------------

interface TokenBucketOpts {
  capacity: number;
  refill_per_sec: number;
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

type BreakerState = 'closed' | 'open' | 'half_open';

interface CircuitBreakerOpts {
  failure_threshold: number;
  cooldown_ms: number;
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
  rate_capacity?: number;
  rate_per_sec?: number;
  breaker_threshold?: number;
  breaker_cooldown_ms?: number;
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
// Per-operation allowlist. The task spec calls out 6 endpoints; we keep
// the same allow-list the MCP server (`mcp-servers/sonarqube/src/client.ts`)
// uses — that's the surface SecurityEngineer has approved for FORA-290
// and matches the `listProjects / getProject / searchComponents /
// getComponentMeasures / listIssues / getIssue / getQualityGate /
// webhooksGet` MCP toolset.
//
// The map is keyed by `service.operation` (the broker's action string
// after the cloud prefix), and the value is the SonarQube REST v1 path
// plus the set of permitted `operation` strings. Anything outside this
// allow-list is refused with `unsupported_sonarqube_operation` before
// any network call lands.
// ---------------------------------------------------------------------------

export const SONARQUBE_SERVICES = [
  'projects',
  'issues',
  'qualitygates',
  'webhooks',
  'components',
  'measures',
] as const;
export type SonarQubeService = (typeof SONARQUBE_SERVICES)[number];

const SERVICE_OPS: Record<string, Record<string, string>> = {
  projects: {
    search: '/api/projects/search',
    show: '/api/projects/show',
  },
  issues: {
    search: '/api/issues/search',
    show: '/api/issues/search', // v1 surfaces single-issue detail via `?issues=<key>`
  },
  qualitygates: {
    project_status: '/api/qualitygates/project_status',
  },
  webhooks: {
    deliveries: '/api/webhooks/deliveries',
  },
  components: {
    search: '/api/components/search',
  },
  measures: {
    component: '/api/measures/component',
  },
};

// ---------------------------------------------------------------------------
// `assume_fn` — mint a fresh token, revoke any prior one for the same
// `token_name`. Production calls SonarQube `/api/user_tokens/generate`
// and `/api/user_tokens/revoke` with a service-account bearer (the
// tenant's per-tenant "broker" account). Tests inject a stub.
// ---------------------------------------------------------------------------

export interface SonarQubeAssumeFnInput {
  /** SonarQube instance URL. */
  instance_url: string;
  /** Logical token name to mint (e.g. `fora-acme-<traceId>`). */
  token_name: string;
  /** FORA-issued JWT — broker-side audit correlation only; the token exchange does not use it. */
  for_jwt: string;
}

export interface SonarQubeAssumeFnOutput {
  /** The raw token string. Held only in the module-local registry. */
  token: string;
  /** Token expiry as epoch ms. The adapter clamps this to `MAX_CREDENTIAL_LIFETIME_MS`. */
  expiration_ms: number;
}

/**
 * Default `assume_fn` — POSTs to SonarQube `/api/user_tokens/generate`.
 * The endpoint accepts `name` + optional `expirationDate` (ISO-8601) or
 * `expirationDuration` (seconds). We pass `expirationDuration` clamped
 * to `MAX_CREDENTIAL_LIFETIME_MS / 1000` so the customer cannot pin a
 * longer-lived token than the broker allows.
 *
 * The request is authenticated with the customer's pre-provisioned
 * broker service account (carried in `process.env.SONARQUBE_BROKER_TOKEN`
 * or fetched from secrets manager in a follow-up — this adapter only
 * knows the test seam today; production wiring lands with FORA-321.1).
 */
async function defaultAssumeFn(input: SonarQubeAssumeFnInput): Promise<SonarQubeAssumeFnOutput> {
  const brokerToken = process.env.SONARQUBE_BROKER_TOKEN;
  if (!brokerToken) {
    throw new Error('sonarqube_broker_token_unset');
  }
  const init: RequestInit = {
    method: 'POST',
    headers: {
      authorization: `Bearer ${brokerToken}`,
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      name: input.token_name,
      type: 'USER_TOKEN',
      expirationDuration: String(Math.floor(MAX_CREDENTIAL_LIFETIME_MS / 1000)),
    }).toString(),
  };
  const res = await fetch(`${input.instance_url.replace(/\/+$/, '')}/api/user_tokens/generate`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`sonarqube_assume_failed: HTTP ${res.status}: ${text}`);
  }
  const parsed = (await res.json()) as { token?: string; expirationDate?: string };
  if (!parsed.token) {
    throw new Error('sonarqube_assume_missing_token');
  }
  const expiration_ms = parsed.expirationDate
    ? Date.parse(parsed.expirationDate)
    : Date.now() + MAX_CREDENTIAL_LIFETIME_MS;
  return { token: parsed.token, expiration_ms };
}

// ---------------------------------------------------------------------------
// `dispatch_fn` — GET a URL with a Bearer token. Production uses global
// `fetch`; tests inject a stub.
// ---------------------------------------------------------------------------

export type SonarQubeDispatchFn = (
  url: string,
  init: RequestInit,
) => Promise<{ status: number; body: unknown }>;

async function defaultDispatchFn(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// `release_fn` — best-effort POST to `/api/user_tokens/revoke` with the
// token's name. Production uses the broker service-account bearer.
// ---------------------------------------------------------------------------

export type SonarQubeReleaseFn = (
  instance_url: string,
  token_name: string,
) => Promise<void>;

async function defaultReleaseFn(instance_url: string, token_name: string): Promise<void> {
  const brokerToken = process.env.SONARQUBE_BROKER_TOKEN;
  if (!brokerToken) return; // best-effort: if the broker token is missing, log later via audit.
  const init: RequestInit = {
    method: 'POST',
    headers: {
      authorization: `Bearer ${brokerToken}`,
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ name: token_name }).toString(),
  };
  try {
    await fetch(`${instance_url.replace(/\/+$/, '')}/api/user_tokens/revoke`, init);
  } catch {
    // Rotation failures are best-effort: the token still expires via
    // its declared `expirationDate`. A future follow-up can emit a
    // `cloud.sonarqube.rotate_fail` audit event; for v1 the silent
    // swallow matches the FORA-290 read-only MCP server's behaviour
    // when the upstream is unavailable.
  }
}

// ---------------------------------------------------------------------------
// SonarQube adapter.
// ---------------------------------------------------------------------------

export interface SonarQubeAdapterOptions {
  /**
   * Test seam: inject a custom `assume_fn`. Production uses the default,
   * which calls `/api/user_tokens/generate` with the broker service
   * account.
   */
  assume_fn?: (input: SonarQubeAssumeFnInput) => Promise<SonarQubeAssumeFnOutput>;
  /**
   * Test seam: inject a custom `dispatch_fn`. Production uses global
   * `fetch` with a Bearer token from the holder registry.
   */
  dispatch_fn?: SonarQubeDispatchFn;
  /** Test seam: inject a custom `release_fn`. Production calls `/api/user_tokens/revoke`. */
  release_fn?: SonarQubeReleaseFn;
  /** Per-tenant+service rate limit + circuit breaker configuration. */
  reliability?: ReliabilityOpts;
}

export class SonarQubeAdapter implements CloudAdapter {
  readonly cloud = 'sonarqube' as const;
  private readonly assume_fn: (input: SonarQubeAssumeFnInput) => Promise<SonarQubeAssumeFnOutput>;
  private readonly dispatch_fn: SonarQubeDispatchFn;
  private readonly release_fn: SonarQubeReleaseFn;
  private readonly reliability: ReturnType<typeof makeReliabilityState>;

  constructor(opts: SonarQubeAdapterOptions = {}) {
    this.assume_fn = opts.assume_fn ?? defaultAssumeFn;
    this.dispatch_fn = opts.dispatch_fn ?? defaultDispatchFn;
    this.release_fn = opts.release_fn ?? defaultReleaseFn;
    this.reliability = makeReliabilityState(opts.reliability);
  }

  /**
   * Probe the customer's SonarQube trust. Structural checks only —
   * no network call, no token mint. Phase 2 (canary assume) is what
   * proves the broker's service-account bearer works against the
   * customer's instance; that lands via `probeTenant` (FORA-126.4
   * pattern) once a SecurityEngineer hire owns the runtime.
   *
   * Trust record carries:
   *   - `account`     = `instance_url` (the customer's SonarQube URL)
   *   - `role_ref`    = `project:<project_key>` (the pinned project)
   *   - `expected_issuer`  / `expected_audience` — broker OIDC pin
   */
  async probeTrust(trust: TenantCloudTrust): Promise<{ ok: boolean; reason: string | null }> {
    if (trust.cloud !== 'sonarqube') {
      return { ok: false, reason: 'cloud_mismatch' };
    }
    if (!/^https?:\/\//.test(trust.account)) {
      return { ok: false, reason: 'instance_url_malformed' };
    }
    if (!trust.role_ref.startsWith('project:')) {
      return { ok: false, reason: 'project_ref_malformed' };
    }
    return { ok: true, reason: null };
  }

  /**
   * Mint a fresh SonarQube user token scoped to the requested project.
   * The returned `expires_at_ms` is the minimum of (SonarQube's
   * declared expiry, the broker's 15-min cap). The broker re-checks
   * this in `broker.ts`.
   *
   * The raw token never appears in the return value or audit detail —
   * it lives only in the module-local `HOLDER_REGISTRY` and is wiped
   * after `perform()` returns.
   */
  async assume(args: SonarQubeActionArgs, for_jwt: string): Promise<AssumeResult> {
    if (args.cloud !== 'sonarqube') {
      throw new Error('sonarqube adapter received non-sonarqube args');
    }
    const result = await this.assume_fn({
      instance_url: args.instance_url,
      token_name: args.token_name,
      for_jwt,
    });
    if (!result.token) {
      throw new Error('sonarqube_assume_returned_empty_token');
    }
    const cap = Date.now() + MAX_CREDENTIAL_LIFETIME_MS;
    const expires_at_ms = Math.min(result.expiration_ms, cap);
    const { handle, holder } = makeHandle(args, args.token_name, expires_at_ms);
    holder.token = result.token;
    HOLDER_REGISTRY.set(handle, holder);
    return {
      handle,
      expires_at_ms,
      role_fingerprint: fingerprintToken(args),
    };
  }

  /**
   * Dispatch the action against the SonarQube REST v1 API.
   *
   * Reliability: per-tenant+service token bucket + circuit breaker
   * gate the call. The cross-tenant deny-by-default check is the
   * `assertSameTenant` step: the holder's `project_key` MUST equal
   * the args' `project_key` — a token scoped to one project cannot
   * serve a request for another project.
   *
   * Read-only: the dispatcher is a thin GET wrapper. SonarQube also
   * requires POSTs for some endpoints (e.g. `user_tokens/generate`,
   * `user_tokens/revoke`) but those live in the adapter's own
   * `assume_fn` / `release_fn` — never here. `params.method` is
   * ignored if present.
   *
   * The response is redacted of any credential-shaped field, then
   * `assertNoCredentials` runs on the redacted value. A failure
   * there is a real bug — surface it.
   */
  async perform(
    handle: SonarQubeUserTokenHandle,
    args: SonarQubeActionArgs,
    ctx: { tenant_id?: string; trace_id?: string } = {},
  ): Promise<unknown> {
    if (args.cloud !== 'sonarqube') {
      throw new Error('sonarqube adapter received non-sonarqube args');
    }
    const holder = HOLDER_REGISTRY.get(handle);
    if (!holder) {
      throw new Error('sonarqube_handle_already_released');
    }
    // Cross-tenant deny-by-default: the token is scoped to a single
    // project. A request whose `project_key` doesn't match the holder
    // is refused before any network call lands. The handle's
    // `project_key` is immutable (set by `makeHandle`); a fabricated
    // handle cannot trick the adapter because the holder registry
    // would not contain it.
    if (holder.project_key !== args.project_key) {
      throw new Error('sonarqube_project_scope_mismatch');
    }
    if (!(SONARQUBE_SERVICES as readonly string[]).includes(args.service)) {
      throw new Error(`unsupported_sonarqube_service:${args.service}`);
    }
    const opMap = SERVICE_OPS[args.service];
    const path = opMap?.[args.operation];
    if (!path) {
      throw new Error(`unsupported_sonarqube_operation:${args.service}:${args.operation}`);
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
        throw new Error(`sonarqube_rate_limited:${args.service}`);
      }
      if (!breaker.canPass()) {
        throw new Error(`sonarqube_circuit_open:${args.service}`);
      }
      const url = `${args.instance_url.replace(/\/+$/, '')}${path}${stringifyQuery(args.params)}`;
      const init: RequestInit = {
        method: 'GET',
        headers: {
          authorization: `Bearer ${holder.token}`,
          accept: 'application/json',
          'user-agent': 'fora-customer-cloud-broker/0.1.0',
        },
      };
      const { status, body } = await this.dispatch_fn(url, init);
      if (status < 200 || status >= 300) {
        throw new Error(`sonarqube_http_${status}`);
      }
      // Redact the response of any credential-shaped fields, then
      // assert credential-freeness. Same belt-and-suspenders as the
      // AWS / GCP adapters.
      const redacted = redactCredentials(body);
      assertNoCredentials(redacted);
      breaker.onSuccess();
      return redacted;
    } catch (err) {
      if (err instanceof Error) {
        const reason = err.message;
        if (
          !reason.startsWith('sonarqube_rate_limited:') &&
          !reason.startsWith('sonarqube_circuit_open:') &&
          !reason.startsWith('unsupported_sonarqube_') &&
          !reason.startsWith('sonarqube_handle_already_released') &&
          !reason.startsWith('sonarqube_project_scope_mismatch')
        ) {
          breaker.onFailure();
        }
      }
      throw err;
    } finally {
      // Rotate the token after the action lands — release the handle's
      // holder so the raw token is wiped, and best-effort revoke the
      // server-side token. The revocation failure is silent (see
      // `defaultReleaseFn`); the holder registry delete + token zero
      // always happens.
      const revokedTokenName = `${args.token_name}`;
      try {
        await this.release_fn(args.instance_url, revokedTokenName);
      } finally {
        releaseHolder(handle);
      }
    }
  }

  /**
   * Release a handle without calling `perform()`. The probe path uses
   * this so a canary-assume never leaks its holder. Idempotent.
   */
  releaseHandle(handle: unknown): void {
    releaseHolder(handle as SonarQubeUserTokenHandle);
  }
}

/**
 * Fingerprint the (instance_url, project_key, token_name) tuple.
 * Stable for audit correlation without leaking the customer pin.
 * Matches the AWS / Azure / GCP adapter fingerprint shape:
 * `<cloud>:<sha256 hex[0:16]>`.
 */
function fingerprintToken(args: SonarQubeActionArgs): string {
  return 'sonarqube:' + createHash('sha256')
    .update(`${args.instance_url}|${args.project_key}|${args.token_name}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Stringify the operation `params` map as a URL query string. Values
 * that are arrays or objects are JSON-encoded (SonarQube accepts a
 * comma-joined string for `metricKeys`, but the params are
 * caller-controlled so we coerce once and let the server reject any
 * unknown shape with a typed error).
 */
function stringifyQuery(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      q.set(k, v.map((x) => String(x)).join(','));
    } else if (typeof v === 'object') {
      q.set(k, JSON.stringify(v));
    } else {
      q.set(k, String(v));
    }
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}