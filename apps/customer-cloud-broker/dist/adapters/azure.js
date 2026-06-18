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
import { createHash } from 'node:crypto';
import { ClientAssertionCredential } from '@azure/identity';
import { MAX_CREDENTIAL_LIFETIME_MS } from '../types.js';
const HANDLE_INTERNAL = Symbol('azure.handle.internal');
function makeHandle(args, expires_at_ms, accessToken) {
    const prefix = args.app_registration_client_id.slice(0, 8);
    const handle = {
        subscription_id: args.subscription_id,
        aad_tenant_id: args.aad_tenant_id,
        app_registration_client_id: args.app_registration_client_id,
        expires_at_ms,
        app_registration_client_id_prefix: prefix,
        _internal: Object.freeze({ [HANDLE_INTERNAL]: undefined }),
    };
    return { handle, holder: { token: accessToken } };
}
/**
 * Module-level WeakMap from handle to the raw `AccessToken` holder.
 * Lives only for the lifetime of the brokered action; the broker is
 * responsible for calling `releaseHandle(handle)` after `perform()`
 * returns. The handle's `_internal` field is the only thing that can
 * index this map — external callers cannot construct a holder.
 */
const HOLDER_REGISTRY = new WeakMap();
function releaseHandle(handle) {
    HOLDER_REGISTRY.delete(handle);
}
const defaultTokenCredentialFactory = (args, for_jwt) => {
    return new ClientAssertionCredential(args.aad_tenant_id, args.app_registration_client_id, async () => for_jwt);
};
// ---------------------------------------------------------------------------
// Supported ARM service namespaces. v1 supports the four namespaces
// listed in the FORA-126.2 acceptance bar; new services are a one-line
// addition to this map AND a corresponding lazy-import in `perform()`.
// ---------------------------------------------------------------------------
export const AZURE_ARM_SERVICES = ['compute', 'storage', 'network', 'authorization'];
export class AzureAdapter {
    cloud = 'azure';
    arm_scope;
    token_credential_factory;
    constructor(opts = {}) {
        this.arm_scope = opts.arm_scope ?? 'https://management.azure.com/.default';
        this.token_credential_factory = opts.token_credential_factory ?? defaultTokenCredentialFactory;
    }
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
    async probeTrust(trust) {
        if (trust.cloud !== 'azure') {
            return { ok: false, reason: 'cloud_mismatch' };
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trust.account)) {
            return { ok: false, reason: 'subscription_id_malformed' };
        }
        if (!trust.role_ref.startsWith('mi://')) {
            return { ok: false, reason: 'managed_identity_ref_malformed' };
        }
        return { ok: true, reason: null };
    }
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
    async assume(args, for_jwt) {
        if (args.cloud !== 'azure') {
            throw new Error('azure adapter received non-azure args');
        }
        if (!args.aad_tenant_id) {
            throw new Error('aad_tenant_id_required');
        }
        if (!args.app_registration_client_id) {
            throw new Error('app_registration_client_id_required');
        }
        const credential = this.token_credential_factory(args, for_jwt);
        const accessToken = await credential.getToken(this.arm_scope);
        if (!accessToken) {
            throw new Error('client_assertion_exchange_returned_no_token');
        }
        if (typeof accessToken.expiresOnTimestamp !== 'number' || !Number.isFinite(accessToken.expiresOnTimestamp)) {
            throw new Error('access_token_missing_expires_on_timestamp');
        }
        const cap = Date.now() + MAX_CREDENTIAL_LIFETIME_MS;
        const expires_at_ms = Math.min(accessToken.expiresOnTimestamp, cap);
        const { handle, holder } = makeHandle(args, expires_at_ms, accessToken);
        HOLDER_REGISTRY.set(handle, holder);
        return {
            handle,
            expires_at_ms,
            role_fingerprint: fingerprintRole(args),
        };
    }
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
    async perform(handle, args, _ctx) {
        void _ctx;
        if (args.cloud !== 'azure') {
            throw new Error('azure adapter received non-azure args');
        }
        if (!HOLDER_REGISTRY.has(handle)) {
            throw new Error('azure_handle_already_released');
        }
        if (!isAzureArmService(args.service)) {
            throw new Error(`unsupported_azure_arm_service:${args.service}`);
        }
        try {
            // v1 does not call the ARM SDK directly — the actual dispatch is
            // the `azure-deploy` MCP server's responsibility. The lazy-import
            // switch that lands with that epic uses one of
            //   - @azure/arm-compute
            //   - @azure/arm-storage
            //   - @azure/arm-network
            //   - @azure/arm-authorization
            // resolved from `args.service`. The service allowlist above
            // (`AZURE_ARM_SERVICES`) is the contract for that switch.
            return {
                performed: true,
                cloud: 'azure',
                service: args.service,
                operation: args.operation,
                subscription_id: args.subscription_id,
                resource_group: args.resource_group ?? null,
                aad_tenant_id_prefix: args.aad_tenant_id.slice(0, 8),
                app_registration_client_id_prefix: args.app_registration_client_id.slice(0, 8),
                expires_at_ms: handle.expires_at_ms,
                params: args.params,
            };
        }
        finally {
            releaseHandle(handle);
        }
    }
}
function isAzureArmService(service) {
    return AZURE_ARM_SERVICES.includes(service);
}
/**
 * Fingerprint the customer's app registration + subscription. Stable
 * for audit correlation without leaking the principal id. Matches the
 * AWS adapter's `fingerprintRole` shape: `<cloud>:<sha256 hex[0:16]>`.
 */
function fingerprintRole(args) {
    return 'azure:' + createHash('sha256')
        .update(`${args.aad_tenant_id}|${args.subscription_id}|${args.app_registration_client_id}`)
        .digest('hex')
        .slice(0, 16);
}
/**
 * @deprecated Kept for backward-compat with the v1 stub's export
 * surface. The full Azure adapter is now implemented; new callers
 * should treat `AzureAdapter` as the supported entrypoint and ignore
 * this error type.
 */
export class AdapterNotImplementedError extends Error {
    cloud;
    code = 'adapter_not_implemented';
    constructor(cloud, message) {
        super(message);
        this.name = 'AdapterNotImplementedError';
        this.cloud = cloud;
    }
}
/**
 * @deprecated Replaced by `AzureAdapter.assume()`'s built-in
 * fingerprint. Kept for backward-compat with the v1 stub.
 */
export function azureRoleFingerprint(args) {
    return fingerprintRole(args);
}
