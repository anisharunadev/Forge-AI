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
import type { GcpActionArgs, CloudAdapter, AssumeResult, TenantCloudTrust } from '../types.js';
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
declare const HANDLE_INTERNAL: unique symbol;
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
    readonly _internal: {
        readonly [HANDLE_INTERNAL]?: never;
    };
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
export type DispatchFn = (service: string, operation: string, params: Record<string, unknown>, holder: Holder) => Promise<unknown>;
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
export declare class GcpAdapter implements CloudAdapter {
    readonly cloud: "gcp";
    private readonly broker_issuer;
    private readonly broker_audience;
    private readonly assume_fn;
    private readonly dispatch_fn;
    private readonly reliability;
    constructor(opts: GcpAdapterOptions);
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
    probeTrust(trust: TenantCloudTrust): Promise<{
        ok: boolean;
        reason: string | null;
    }>;
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
    assume(args: GcpActionArgs, for_jwt: string): Promise<AssumeResult>;
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
    perform(handle: GcpCredentialHandle, args: GcpActionArgs, ctx?: {
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
