/**
 * Azure adapter for the customer-cloud-broker (FORA-126.2 / 0.7.4).
 *
 * Mirrors the structural template in `aws.ts`. The broker is the *only*
 * path through which a FORA agent can act on a customer's Azure
 * subscription. The broker exchanges a FORA-issued OIDC token for a
 * short-lived Azure access token via
 * `@azure/identity` ≥ 4.x's `ClientAssertionCredential` (the federated
 * assertion primitive behind the
 * `DefaultAzureCredential` / `WorkloadIdentityCredential` chain) — the
 * customer's app registration carries a federated credential that
 * trusts the FORA identity-broker's issuer, so MSAL accepts the
 * FORA-signed JWT as a client assertion and mints an Azure access token
 * scoped to ARM (≤ 15 min lifetime).
 *
 * Non-negotiable invariants (matching `aws.ts`):
 *   1. No raw credential material in any return value, audit detail,
 *      or log. The adapter exposes an opaque `AzureCredentialHandle`;
 *      the actual `AccessToken` lives in a module-local `HOLDER_REGISTRY`
 *      keyed by the handle and is dropped after `perform()` returns.
 *   2. Credential lifetime cap = 15 minutes. The adapter enforces it
 *      on the returned `expires_at_ms` (minimum of MSAL's
 *      `expiresOnTimestamp` and `now + MAX_CREDENTIAL_LIFETIME_MS`).
 *      The broker also re-checks this in `broker.ts`.
 *   3. The deny-list check lives upstream in the broker. By the time
 *      `perform()` is called, the action has already been validated
 *      against `config/customer-cloud-broker/deny_list.yaml`.
 *
 * `perform()` dispatches by `args.service` to the appropriate ARM SDK
 * package (`@azure/arm-compute`, `@azure/arm-storage`,
 * `@azure/arm-network`, `@azure/arm-authorization`). The dispatch is
 * lazy-imported so this module loads cheaply and the per-service SDK
 * versions can be pinned independently. v1 returns the *intent*
 * envelope (the same shape as the AWS adapter) — the actual ARM
 * client call is the responsibility of the `azure-deploy` MCP server,
 * which consumes the brokered token in a follow-up epic. The lazy
 * import structure is in place so the dispatch path is one line per
 * service when that lands.
 *
 * Test seams: the adapter accepts an optional `token_credential_factory`
 * that lets tests inject a fake `TokenCredential` returning a fake
 * `AccessToken` without contacting MSAL or Entra ID. The default
 * factory constructs a real `ClientAssertionCredential` from
 * `@azure/identity` ≥ 4.x.
 */
import type { TokenCredential } from '@azure/core-auth';
import type { AzureActionArgs, CloudAdapter, AssumeResult, TenantCloudTrust } from '../types.js';
export interface AzureCredentialHandle {
    /** Subscription id the credential was minted against. */
    readonly subscription_id: string;
    /** Entra ID tenant id hosting the customer's app registration. */
    readonly aad_tenant_id: string;
    /** Customer app registration client id (the federated credential principal). */
    readonly app_registration_client_id: string;
    /** Wall-clock expiry (epoch ms). */
    readonly expires_at_ms: number;
    /** Short, low-cardinality identifier — safe to log. */
    readonly app_registration_client_id_prefix: string;
    /**
     * Internal-only marker. The adapter sets the raw `AccessToken` in a
     * module-local registry keyed by this handle and zeroes it after
     * `perform()` returns. The broker never sees this field — the
     * `_internal` symbol is module-private (defined below) and not
     * exported.
     */
    readonly _internal: {
        readonly [HANDLE_INTERNAL]?: never;
    };
}
declare const HANDLE_INTERNAL: unique symbol;
export type AzureTokenCredentialFactory = (args: AzureActionArgs, for_jwt: string) => TokenCredential;
export declare const AZURE_ARM_SERVICES: readonly ["compute", "storage", "network", "authorization"];
export type AzureArmService = (typeof AZURE_ARM_SERVICES)[number];
export interface AzureAdapterOptions {
    /** Default scope for ARM control-plane access tokens. */
    arm_scope?: string;
    /** Inject the `TokenCredential` factory. Test seam. */
    token_credential_factory?: AzureTokenCredentialFactory;
}
export declare class AzureAdapter implements CloudAdapter {
    readonly cloud: "azure";
    private readonly arm_scope;
    private readonly token_credential_factory;
    constructor(opts?: AzureAdapterOptions);
    /**
     * Probe the customer's trust. We do NOT call MSAL here — the probe
     * is a configuration check, not a federation attempt. The customer's
     * subscription id must parse, the `mi://` role ref must be well-
     * formed, and the trust record's `cloud` must be `azure`. The
     * `expected_issuer` / `expected_audience` are not checked here —
     * those are validated by the trust store's phase-1 probe (which
     * calls `adapter.probeTrust`) at boot, and re-validated on every
     * PATCH to `cloud_trust.yaml`.
     *
     * A separate "canary assume" task (run from `src/trust.ts::probeTenant`,
     * not in the request hot path) is what actually proves the customer's
     * federated credential accepts the broker's issuer. That probe uses
     * this adapter's `assume()` path with a synthetic FORA token.
     */
    probeTrust(trust: TenantCloudTrust): Promise<{
        ok: boolean;
        reason: string | null;
    }>;
    /**
     * Exchange the FORA-issued JWT for an Azure access token via
     * `ClientAssertionCredential`. The customer's app registration must
     * have a federated credential configured to trust FORA's OIDC
     * issuer; MSAL validates the assertion and mints a short-lived
     * ARM-scoped access token (≤ 15 min by Entra's own policy).
     *
     * The returned `expires_at_ms` is the minimum of (MSAL
     * `expiresOnTimestamp`, `now + MAX_CREDENTIAL_LIFETIME_MS`). The
     * broker re-checks this in `broker.ts` as a safety net.
     */
    assume(args: AzureActionArgs, for_jwt: string): Promise<AssumeResult>;
    /**
     * Perform the requested action. The adapter resolves the ARM SDK
     * client for the requested `args.service` lazily so this module loads
     * cheaply. The credential holder is wiped after the call.
     *
     * v1 of this adapter returns the *intent* envelope (the same shape
     * the AWS adapter returns) — the actual ARM client call is the
     * responsibility of the `azure-deploy` MCP server, which consumes
     * the brokered token in a follow-up epic. The lazy-import switch
     * below is in place so the dispatch path is one line per service
     * when that lands.
     */
    perform(handle: AzureCredentialHandle, args: AzureActionArgs, _ctx?: {
        tenant_id?: string;
        trace_id?: string;
    }): Promise<unknown>;
}
/**
 * @deprecated Kept for backward-compat with the v1 stub's export
 * surface. The full Azure adapter is now implemented; new callers
 * should treat `AzureAdapter` as the supported entrypoint and ignore
 * this error type.
 */
export declare class AdapterNotImplementedError extends Error {
    readonly cloud: string;
    readonly code = "adapter_not_implemented";
    constructor(cloud: string, message: string);
}
/**
 * @deprecated Replaced by `AzureAdapter.assume()`'s built-in
 * fingerprint. Kept for backward-compat with the v1 stub.
 */
export declare function azureRoleFingerprint(args: AzureActionArgs): string;
export {};
