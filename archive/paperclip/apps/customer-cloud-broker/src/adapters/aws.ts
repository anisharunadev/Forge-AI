/**
 * AWS adapter for the customer-cloud-broker (FORA-126 / FORA-126.5).
 *
 * The broker is the *only* path through which a FORA agent can act on a
 * customer's AWS account. The broker exchanges a FORA-issued OIDC token
 * for a short-lived STS credential via `AssumeRoleWithWebIdentity`
 * (ADR-0003 §6.2). The customer's IAM role must:
 *
 *   1. Trust the broker's OIDC issuer (the FORA identity-broker).
 *   2. Have a `MaxSessionDuration` of <= 900 seconds (15 minutes). The
 *      broker refuses a role whose configured duration exceeds the cap
 *      and emits `response_code = credential_too_long`.
 *   3. Carry an inline policy that grants only the actions the tenant
 *      has authorised (ADR-0003 §5.2 narrows beyond the platform
 *      default).
 *
 * Credential lifetime: the FORA-issued token passed in `for_jwt` has
 * its own `exp`. The broker refuses to assume if `exp - now > 900s`,
 * but more importantly, the *returned* `expires_at_ms` is the minimum
 * of (FORA token expiry, AWS credential expiry). The adapter drops the
 * raw credential string immediately after `perform()` returns — the
 * `handle` exposed to the broker is an `AwsCredentialHandle` whose
 * fields are typed so a stray `console.log(handle)` prints an opaque
 * summary, not the secret.
 *
 * FORA-126.5 — per-service AWS SDK dispatch.
 *
 * `perform()` replaces the v1 shim with a real per-service dispatcher:
 *   - The per-service SDK package (`@aws-sdk/client-{service}`) is
 *     lazy-imported on first call for that service.
 *   - The SDK client is constructed with the assumed-role credential
 *     holder from `HOLDER_REGISTRY` and the customer-specified region.
 *   - The SDK call is `client.send(new Command(args.params))`.
 *   - The response is redacted of any credential-shaped fields before
 *     it crosses the broker boundary; the audit factory's
 *     `assertNoCredentials` is the second-line guard.
 *
 * Reliability: per-tenant+service token bucket and circuit breaker so
 * a degraded customer (throttled, 5xx-storming) does not starve other
 * tenants. Both are keyed by `${tenant_id}|${service}`; the state is
 * module-scoped and lazy — the first call to a (tenant, service) pair
 * initialises its own bucket / breaker.
 *
 * Test seam: the `dispatch_fn` option lets tests inject a fake
 * dispatcher that returns a canned response without contacting AWS.
 * Production uses the default, which performs the real SDK call.
 */

import { createHash } from 'node:crypto';
import {
  STSClient,
  AssumeRoleWithWebIdentityCommand,
  type AssumeRoleWithWebIdentityCommandInput,
  type AssumeRoleWithWebIdentityResponse,
} from '@aws-sdk/client-sts';
import type {
  AwsActionArgs,
  CloudAdapter,
  AssumeResult,
  TenantCloudTrust,
} from '../types.js';
import { MAX_CREDENTIAL_LIFETIME_MS } from '../types.js';
import { redactCredentials, assertNoCredentials } from '../audit.js';

// ---------------------------------------------------------------------------
// Opaque handle. The broker sees this; nothing else. It deliberately
// does NOT carry the raw `SessionToken` / `SecretAccessKey` as strings
// — those are wrapped in a module-local `HOLDER_REGISTRY` and wiped
// after `perform()` returns.
// ---------------------------------------------------------------------------

export interface AwsCredentialHandle {
  /** Region the credentials were minted in. */
  readonly region: string;
  /** Role ARN that was assumed. */
  readonly role_arn: string;
  /** Wall-clock expiry (epoch ms). */
  readonly expires_at_ms: number;
  /** Access key id (low-cardinality identifier — safe to log). */
  readonly access_key_id_prefix: string;
  /**
   * Internal-only marker. The adapter sets the raw holder in a
   * module-local WeakMap keyed by this handle and zeroes it after
   * `perform()` returns. The broker never sees this field — the
   * `_internal` symbol is module-private.
   */
  readonly _internal: { readonly [HANDLE_INTERNAL]?: never };
}

const HANDLE_INTERNAL = Symbol('aws.handle.internal');
type Holder = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration_ms: number;
};

function makeHandle(
  response: AssumeRoleWithWebIdentityResponse,
  args: AwsActionArgs,
  expires_at_ms: number,
): AwsCredentialHandle {
  const akid = response.Credentials?.AccessKeyId ?? '';
  return {
    region: args.region,
    role_arn: args.role_arn,
    expires_at_ms,
    access_key_id_prefix: akid.slice(0, 8),
    _internal: Object.freeze({ [HANDLE_INTERNAL]: undefined as never }),
  } as AwsCredentialHandle;
}

function newHolder(
  response: AssumeRoleWithWebIdentityResponse,
): Holder | null {
  const creds = response.Credentials;
  if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken || !creds.Expiration) {
    return null;
  }
  return {
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretAccessKey,
    sessionToken: creds.SessionToken,
    expiration_ms: creds.Expiration.getTime(),
  };
}

// Module-level WeakMap from handle to holder. Lives only for the
// lifetime of the brokered action; the broker is responsible for
// calling `releaseHandle(handle)` after `perform()` returns. The
// adapter ALSO releases in its own `finally` so a forgotten caller
// cannot leak a holder indefinitely.
const HOLDER_REGISTRY = new WeakMap<AwsCredentialHandle, Holder>();

function releaseHandle(handle: AwsCredentialHandle): void {
  HOLDER_REGISTRY.delete(handle);
}

// ---------------------------------------------------------------------------
// Per-service dispatch registry. v1 supports the five service
// namespaces called out in the FORA-126.5 acceptance bar: s3, ec2,
// iam, cloudformation, cloudcontrol. Adding a new service is a
// one-line addition here AND a one-line `dynamicImport` entry below.
// ---------------------------------------------------------------------------

/**
 * Map from `args.service` to the SDK client class name and the set of
 * allowed operations. The allowed-operation list is a *positive* allow
 * list — anything not in the map is rejected with
 * `unsupported_aws_service_operation` before the SDK is even touched.
 *
 * The operation names match the AWS SDK v3 `Command` class names
 * (e.g. `GetObject` → `GetObjectCommand`). The IAM action namespace
 * (e.g. `s3:GetObject`) is what the broker's deny-list matches on
 * (see `deny_list.yaml`); the SDK command name is what we dispatch.
 */
const SERVICE_OPS: Record<string, { client: string; operations: Record<string, string> }> = {
  s3: {
    client: 'S3Client',
    operations: {
      GetObject: 'GetObjectCommand',
      PutObject: 'PutObjectCommand',
      ListBuckets: 'ListBucketsCommand',
    },
  },
  ec2: {
    client: 'EC2Client',
    operations: {
      DescribeInstances: 'DescribeInstancesCommand',
    },
  },
  iam: {
    client: 'IAMClient',
    operations: {
      GetUser: 'GetUserCommand',
      ListUsers: 'ListUsersCommand',
    },
  },
  cloudformation: {
    client: 'CloudFormationClient',
    operations: {
      DescribeStacks: 'DescribeStacksCommand',
    },
  },
  cloudcontrol: {
    client: 'CloudControlClient',
    operations: {
      GetResource: 'GetResourceCommand',
      ListResources: 'ListResourcesCommand',
    },
  },
};

/** Lazy module loaders, keyed by service name. */
const SERVICE_LOADERS: Record<string, () => Promise<unknown>> = {
  s3: () => import('@aws-sdk/client-s3'),
  ec2: () => import('@aws-sdk/client-ec2'),
  iam: () => import('@aws-sdk/client-iam'),
  cloudformation: () => import('@aws-sdk/client-cloudformation'),
  cloudcontrol: () => import('@aws-sdk/client-cloudcontrol'),
};

// ---------------------------------------------------------------------------
// Token bucket. Per (tenant_id, service) — caps the steady-state call
// rate so a misbehaving agent cannot exhaust a customer's account
// quotas. Capacity is small; the default (10/s, burst 10) is well
// under any AWS service quota but high enough that real agent
// traffic is not throttled.
// ---------------------------------------------------------------------------

export interface TokenBucketOpts {
  /** Maximum burst size. */
  capacity: number;
  /** Steady-state refill rate (tokens per second). */
  refill_per_sec: number;
  /** `now()` injection for tests. */
  now?: () => number;
}

export class TokenBucket {
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
// Open = fail fast (caller gets a circuit-open error). After the
// cooldown the breaker enters half-open: a single probe is allowed
// through. Success closes the breaker; failure re-opens it for
// another cooldown. This isolates a single degraded customer from
// every other tenant+service.
// ---------------------------------------------------------------------------

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOpts {
  /** Consecutive failures that trip the breaker from closed → open. */
  failure_threshold: number;
  /** Time (ms) the breaker stays open before allowing a half-open probe. */
  cooldown_ms: number;
  /** `now()` injection for tests. */
  now?: () => number;
}

export class CircuitBreaker {
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

// ---------------------------------------------------------------------------
// Per-tenant+service state. Lazy `Map` so a customer who never calls
// `s3:GetObject` does not occupy a bucket slot.
// ---------------------------------------------------------------------------

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
// AWS adapter. The `stsClient` is injected so tests can use a mock;
// the `dispatch_fn` is the per-service injection point.
// ---------------------------------------------------------------------------

/**
 * Injectable per-service dispatcher. Production builds a real SDK
 * client and calls `client.send(new Command(params))`. Tests return
 * canned responses without contacting AWS. The `holder` is the raw
 * assumed-role credential; tests MUST NOT log it.
 */
export type DispatchFn = (
  service: string,
  operation: string,
  params: Record<string, unknown>,
  holder: Holder,
  region: string,
) => Promise<unknown>;

export interface AwsAdapterOptions {
  /** The broker's OIDC issuer URL (the identity-broker). The customer's role trusts this. */
  broker_issuer: string;
  /** The audience (broker's client_id at the FORA IdP). */
  broker_audience: string;
  /** Inject the STS client (test seam). */
  sts_client?: (region: string) => STSClient;
  /**
   * Inject the assume-with-web-identity call directly. Useful for tests
   * that don't want to construct a full STSClient. Production code uses
   * the default, which calls `sts_client(region).send(new ...Command(input))`.
   */
  assume_fn?: (input: AssumeRoleWithWebIdentityCommandInput) => Promise<AssumeRoleWithWebIdentityResponse>;
  /**
   * Inject the per-service dispatcher (test seam). Production builds
   * a real AWS SDK v3 client and calls `client.send(new Command(params))`.
   */
  dispatch_fn?: DispatchFn;
  /** Per-tenant+service rate limit + circuit breaker configuration. */
  reliability?: ReliabilityOpts;
}

export class AwsAdapter implements CloudAdapter {
  readonly cloud = 'aws' as const;
  private readonly broker_issuer: string;
  private readonly broker_audience: string;
  private readonly sts_client: (region: string) => STSClient;
  private readonly assume_fn: (input: AssumeRoleWithWebIdentityCommandInput) => Promise<AssumeRoleWithWebIdentityResponse>;
  private readonly dispatch_fn: DispatchFn;
  private readonly reliability: ReturnType<typeof makeReliabilityState>;

  constructor(opts: AwsAdapterOptions) {
    this.broker_issuer = opts.broker_issuer;
    this.broker_audience = opts.broker_audience;
    this.sts_client = opts.sts_client ?? ((region) => new STSClient({ region }));
    this.assume_fn =
      opts.assume_fn ??
      (async (input) => {
        const region = input.RoleSessionName?.split('-')[1] ?? 'us-east-1';
        const client = this.sts_client(region);
        return client.send(new AssumeRoleWithWebIdentityCommand(input));
      });
    this.dispatch_fn = opts.dispatch_fn ?? defaultDispatchFn;
    this.reliability = makeReliabilityState(opts.reliability);
  }

  async probeTrust(trust: TenantCloudTrust): Promise<{ ok: boolean; reason: string | null }> {
    if (!trust.role_ref.startsWith('arn:aws:iam::')) {
      return { ok: false, reason: 'role_arn_malformed' };
    }
    if (trust.expected_issuer !== this.broker_issuer) {
      return { ok: false, reason: 'expected_issuer_mismatch' };
    }
    if (trust.expected_audience !== this.broker_audience) {
      return { ok: false, reason: 'expected_audience_mismatch' };
    }
    return { ok: true, reason: null };
  }

  async assume(args: AwsActionArgs, for_jwt: string): Promise<AssumeResult> {
    if (args.cloud !== 'aws') {
      throw new Error('aws adapter received non-aws args');
    }
    const input: AssumeRoleWithWebIdentityCommandInput = {
      RoleArn: args.role_arn,
      RoleSessionName: `fora-${args.region}-${shortHash(for_jwt)}`,
      WebIdentityToken: for_jwt,
      DurationSeconds: Math.floor(MAX_CREDENTIAL_LIFETIME_MS / 1000),
    };
    const response = await this.assume_fn(input);
    const holder = newHolder(response);
    if (!holder) {
      throw new Error('assume_role_response_missing_credentials');
    }
    const expires_at_ms = Math.min(holder.expiration_ms, Date.now() + MAX_CREDENTIAL_LIFETIME_MS);
    const handle = makeHandle(response, args, expires_at_ms);
    HOLDER_REGISTRY.set(handle, holder);
    return {
      handle,
      expires_at_ms,
      role_fingerprint: fingerprintRole(args.role_arn, args.region),
    };
  }

  /**
   * Perform the requested action. v2 (FORA-126.5) replaces the shim
   * with a real per-service dispatcher: lazy-import the SDK package,
   * build a client with the assumed credential, call
   * `client.send(new Command(params))`, redact the response.
   *
   * Per-tenant+service rate limiting and circuit breaker gate the
   * call. A rate-limit / circuit-open failure is surfaced as a typed
   * error so the broker can record `operation_failed` with a precise
   * reason; the audit factory never sees a credential.
   */
  async perform(
    handle: AwsCredentialHandle,
    args: AwsActionArgs,
    ctx: { tenant_id?: string; trace_id?: string } = {},
  ): Promise<unknown> {
    const holder = HOLDER_REGISTRY.get(handle);
    if (!holder) {
      throw new Error('aws_handle_already_released');
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
        throw new Error(`aws_rate_limited:${args.service}`);
      }
      if (!breaker.canPass()) {
        throw new Error(`aws_circuit_open:${args.service}`);
      }
      // Operation is a positive allow list — fail fast before
      // touching the SDK so a typo in the action string can't reach
      // the customer's AWS account.
      const opMap = SERVICE_OPS[args.service];
      if (!opMap) {
        throw new Error(`unsupported_aws_service:${args.service}`);
      }
      const commandName = opMap.operations[args.operation];
      if (!commandName) {
        throw new Error(`unsupported_aws_service_operation:${args.service}:${args.operation}`);
      }
      const response = await this.dispatch_fn(args.service, args.operation, args.params, holder, args.region);
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
      // We did NOT call breaker.onFailure() in the inner try/catch on
      // every error — the breaker only counts SDK / network failures,
      // not permission / validation errors that are the caller's
      // fault. The rate-limit and unsupported-op paths set their own
      // onFailure (or not) above; SDK / network errors flow here.
      if (err instanceof Error) {
        const reason = err.message;
        if (
          !reason.startsWith('aws_rate_limited:') &&
          !reason.startsWith('aws_circuit_open:') &&
          !reason.startsWith('unsupported_aws_service') &&
          !reason.startsWith('aws_handle_already_released')
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
    releaseHandle(handle as AwsCredentialHandle);
  }
}

// ---------------------------------------------------------------------------
// Default dispatch function. Lazy-imports the per-service SDK package,
// constructs a client with the assumed-role credential, and calls
// `client.send(new Command(params))`. The returned response is whatever
// the SDK produced; `perform()` redacts and asserts.
// ---------------------------------------------------------------------------

async function defaultDispatchFn(
  service: string,
  operation: string,
  params: Record<string, unknown>,
  holder: Holder,
  region: string,
): Promise<unknown> {
  const loader = SERVICE_LOADERS[service];
  if (!loader) {
    throw new Error(`unsupported_aws_service:${service}`);
  }
  const mod = (await loader()) as Record<string, unknown>;
  const opMap = SERVICE_OPS[service];
  if (!opMap) {
    throw new Error(`unsupported_aws_service:${service}`);
  }
  const ClientClass = mod[opMap.client] as new (config: unknown) => {
    send: (command: unknown) => Promise<unknown>;
    destroy: () => void;
  };
  const CommandClass = mod[opMap.operations[operation]!] as new (input: unknown) => unknown;
  if (!ClientClass || !CommandClass) {
    throw new Error(`unsupported_aws_service_operation:${service}:${operation}`);
  }
  const client = new ClientClass({
    region,
    credentials: {
      accessKeyId: holder.accessKeyId,
      secretAccessKey: holder.secretAccessKey,
      sessionToken: holder.sessionToken,
    },
  });
  try {
    return await client.send(new CommandClass(params));
  } finally {
    // The client holds a reference to the credentials via the
    // credential provider; destroying releases sockets and any
    // cached metadata. The credential holder itself was already
    // wiped by `releaseHandle` in the calling `perform()`'s finally.
    client.destroy();
  }
}

function shortHash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 12);
}

function fingerprintRole(role_arn: string, region: string): string {
  return 'aws:' + createHash('sha256').update(`${region}|${role_arn}`).digest('hex').slice(0, 16);
}
