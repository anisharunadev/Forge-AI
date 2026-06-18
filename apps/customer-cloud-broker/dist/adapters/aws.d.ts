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
import { STSClient, type AssumeRoleWithWebIdentityCommandInput, type AssumeRoleWithWebIdentityResponse } from '@aws-sdk/client-sts';
import type { AwsActionArgs, CloudAdapter, AssumeResult, TenantCloudTrust } from '../types.js';
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
    readonly _internal: {
        readonly [HANDLE_INTERNAL]?: never;
    };
}
declare const HANDLE_INTERNAL: unique symbol;
type Holder = {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration_ms: number;
};
export interface TokenBucketOpts {
    /** Maximum burst size. */
    capacity: number;
    /** Steady-state refill rate (tokens per second). */
    refill_per_sec: number;
    /** `now()` injection for tests. */
    now?: () => number;
}
export declare class TokenBucket {
    private tokens;
    private last_refill_ms;
    private readonly capacity;
    private readonly refill_per_ms;
    private readonly now;
    constructor(opts: TokenBucketOpts);
    /**
     * Try to take one token. Returns `true` on success, `false` if the
     * bucket is empty (caller should fail fast with a rate-limit error).
     */
    take(): boolean;
}
export type BreakerState = 'closed' | 'open' | 'half_open';
export interface CircuitBreakerOpts {
    /** Consecutive failures that trip the breaker from closed → open. */
    failure_threshold: number;
    /** Time (ms) the breaker stays open before allowing a half-open probe. */
    cooldown_ms: number;
    /** `now()` injection for tests. */
    now?: () => number;
}
export declare class CircuitBreaker {
    state: BreakerState;
    private failure_count;
    private opened_at_ms;
    private half_open_in_flight;
    private readonly failure_threshold;
    private readonly cooldown_ms;
    private readonly now;
    constructor(opts: CircuitBreakerOpts);
    /**
     * Returns `true` if the call may proceed. Side effect: when the
     * breaker is in `half_open` and the cooldown has elapsed, the first
     * caller wins the probe slot; subsequent callers are rejected until
     * the probe resolves.
     */
    canPass(): boolean;
    onSuccess(): void;
    onFailure(): void;
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
/**
 * Injectable per-service dispatcher. Production builds a real SDK
 * client and calls `client.send(new Command(params))`. Tests return
 * canned responses without contacting AWS. The `holder` is the raw
 * assumed-role credential; tests MUST NOT log it.
 */
export type DispatchFn = (service: string, operation: string, params: Record<string, unknown>, holder: Holder, region: string) => Promise<unknown>;
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
export declare class AwsAdapter implements CloudAdapter {
    readonly cloud: "aws";
    private readonly broker_issuer;
    private readonly broker_audience;
    private readonly sts_client;
    private readonly assume_fn;
    private readonly dispatch_fn;
    private readonly reliability;
    constructor(opts: AwsAdapterOptions);
    probeTrust(trust: TenantCloudTrust): Promise<{
        ok: boolean;
        reason: string | null;
    }>;
    assume(args: AwsActionArgs, for_jwt: string): Promise<AssumeResult>;
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
    perform(handle: AwsCredentialHandle, args: AwsActionArgs, ctx?: {
        tenant_id?: string;
        trace_id?: string;
    }): Promise<unknown>;
    /**
     * Release a handle obtained from `assume()` without calling
     * `perform()`. The probe path (FORA-126.4) uses this so a
     * canary-assume does not leak its holder into the adapter's
     * `HOLDER_REGISTRY`. Idempotent: calling it twice is a no-op.
     */
    releaseHandle(handle: unknown): void;
}
export {};
