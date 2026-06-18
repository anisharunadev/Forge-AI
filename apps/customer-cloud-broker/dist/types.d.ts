/**
 * Core types for the customer-cloud-broker (FORA-126 / 0.7.4).
 *
 * The broker is the *only* path through which a FORA agent can act on a
 * customer's AWS / Azure / GCP account. The agent never sees the
 * customer's cloud credentials; the broker assumes the customer's
 * pre-provisioned IAM role via OIDC federation (ADR-0003 §6), performs
 * the action, and discards the credential before responding.
 *
 * Three non-negotiable invariants:
 *   1. No credential material in any return value, audit detail, or log.
 *   2. Credential lifetime cap = 15 minutes. The broker refreshes per
 *      action; it never caches a credential across actions.
 *   3. Every action is denied if it appears in `config/customer-cloud-broker/deny_list.yaml`.
 *
 * The `BrokeredRequest` carries the ToolCall envelope's claim set plus
 * the cloud-specific action descriptor (`AwsAction | AzureAction | GcpAction`).
 * The broker verifies the claim (delegated to the identity-broker over
 * the signed ToolCall envelope), checks the deny-list, assumes the role,
 * executes, audits, and returns a `BrokeredResult`.
 */
import { z } from 'zod';
export declare const CLOUDS: readonly ["aws", "azure", "gcp"];
export type Cloud = (typeof CLOUDS)[number];
export declare const TRUST_STATES: readonly ["active", "cloud_disabled", "pending_probe"];
export type TrustState = (typeof TRUST_STATES)[number];
export interface TenantCloudTrust {
    tenant_id: string;
    cloud: Cloud;
    /** Cloud-specific account/subscription/project identifier the customer provisioned. */
    account: string;
    /** Cloud-specific role / app registration / workload identity pool to assume. */
    role_ref: string;
    /** OIDC issuer URL the customer's trust policy must pin to. */
    expected_issuer: string;
    /** OIDC audience (the broker's client_id at the IdP). */
    expected_audience: string;
    /** Computed at probe time. `active` only when the live probe succeeded. */
    trust_state: TrustState;
    /** Last probe timestamp (ISO-8601). */
    last_probed_at: string | null;
    /** Human-readable reason when `trust_state != active`. */
    disabled_reason: string | null;
}
export interface BrokeredRequest {
    /** ToolCall trace_id (ADR-0003 §3.2). */
    trace_id: string;
    tenant_id: string;
    principal: 'agent';
    agent_type: string;
    /** Always `customer-cloud-broker` for requests that reach this service. */
    mcp: 'customer-cloud-broker';
    /** Cloud-specific action (e.g. `aws.sts.assume`, `azure.compute.list`, `gcp.storage.get`). */
    action: string;
    /** The cloud-native target descriptor (e.g. for AWS: role ARN + region). */
    args: AwsActionArgs | AzureActionArgs | GcpActionArgs;
    scopes_used: string[];
    /** Wall-clock deadline the broker must finish under. Past this, refuse. */
    deadline_ms?: number;
}
export declare const AwsActionArgsSchema: z.ZodObject<{
    cloud: z.ZodLiteral<"aws">;
    role_arn: z.ZodString;
    region: z.ZodString;
    service: z.ZodString;
    operation: z.ZodString;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    cloud: "aws";
    params: Record<string, unknown>;
    role_arn: string;
    region: string;
    service: string;
    operation: string;
}, {
    cloud: "aws";
    role_arn: string;
    region: string;
    service: string;
    operation: string;
    params?: Record<string, unknown> | undefined;
}>;
export type AwsActionArgs = z.infer<typeof AwsActionArgsSchema>;
export declare const AzureActionArgsSchema: z.ZodObject<{
    cloud: z.ZodLiteral<"azure">;
    subscription_id: z.ZodString;
    resource_group: z.ZodOptional<z.ZodString>;
    /** Entra ID tenant id (GUID) hosting the customer's app registration. Required for the federated token exchange. */
    aad_tenant_id: z.ZodString;
    app_registration_client_id: z.ZodString;
    service: z.ZodString;
    operation: z.ZodString;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    cloud: "azure";
    params: Record<string, unknown>;
    service: string;
    operation: string;
    subscription_id: string;
    aad_tenant_id: string;
    app_registration_client_id: string;
    resource_group?: string | undefined;
}, {
    cloud: "azure";
    service: string;
    operation: string;
    subscription_id: string;
    aad_tenant_id: string;
    app_registration_client_id: string;
    params?: Record<string, unknown> | undefined;
    resource_group?: string | undefined;
}>;
export type AzureActionArgs = z.infer<typeof AzureActionArgsSchema>;
export declare const GcpActionArgsSchema: z.ZodObject<{
    cloud: z.ZodLiteral<"gcp">;
    project_number: z.ZodString;
    /** Workload Identity Pool id (e.g. `fora-prod-pool`). */
    workload_identity_pool: z.ZodString;
    /** Workload Identity Provider id inside the pool. The provider is what
     *  trusts the FORA identity-broker OIDC issuer and audience. */
    workload_identity_provider: z.ZodString;
    /** Service account email to impersonate, e.g. `deploy@acme.iam.gserviceaccount.com`. */
    service_account: z.ZodString;
    service: z.ZodString;
    operation: z.ZodString;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    cloud: "gcp";
    params: Record<string, unknown>;
    service: string;
    operation: string;
    project_number: string;
    workload_identity_pool: string;
    workload_identity_provider: string;
    service_account: string;
}, {
    cloud: "gcp";
    service: string;
    operation: string;
    project_number: string;
    workload_identity_pool: string;
    workload_identity_provider: string;
    service_account: string;
    params?: Record<string, unknown> | undefined;
}>;
export type GcpActionArgs = z.infer<typeof GcpActionArgsSchema>;
export type BrokerResponseCode = 'ok' | 'deny_listed_action' | 'cloud_disabled' | 'assume_failed' | 'operation_failed' | 'deadline_exceeded' | 'credential_too_long' | 'unsupported_cloud' | 'malformed_args' | 'internal_error';
export interface BrokeredResult {
    trace_id: string;
    tenant_id: string;
    cloud: Cloud;
    account: string;
    action: string;
    response_code: BrokerResponseCode;
    /** Cloud-native operation result. Redacted by the adapter — no credential material. */
    response: unknown;
    /** Wall-clock duration of the brokered action in milliseconds. */
    duration_ms: number;
    /** Fingerprint of the role/sa that was assumed (NOT the credential). */
    role_fingerprint: string;
}
export interface AssumeResult {
    /** Opaque, in-memory handle the adapter uses to call the cloud. */
    handle: unknown;
    /** Wall-clock expiry (epoch ms). The broker enforces Duration <= MAX_CREDENTIAL_LIFETIME_MS. */
    expires_at_ms: number;
    /** Fingerprint of the assumed role, suitable for the audit detail. */
    role_fingerprint: string;
}
export interface CloudAdapter {
    readonly cloud: Cloud;
    /**
     * Verify the tenant's IAM trust for this cloud. Called by the broker
     * at onboarding probe time and on a periodic re-probe. Should NOT
     * actually exchange a credential — the goal is to confirm the trust
     * policy is wired correctly so a real assume would succeed.
     */
    probeTrust(trust: TenantCloudTrust): Promise<{
        ok: boolean;
        reason: string | null;
    }>;
    /**
     * Assume the customer's IAM role via OIDC federation. The FORA-issued
     * token is exchanged for a cloud-native short-lived credential. The
     * credential MUST be discarded by the adapter after the call returns
     * — the returned `handle` must not contain raw credential strings.
     */
    assume(args: AwsActionArgs | AzureActionArgs | GcpActionArgs, for_jwt: string): Promise<AssumeResult>;
    /**
     * Perform the action against the cloud. The adapter is the only
     * place that holds the credential. The returned value is the
     * operation's response, with any credential material stripped.
     *
     * The `ctx` is the broker context for the request (tenant, trace).
     * Adapters that scope per-tenant rate limiting or per-tenant circuit
     * breakers (AWS, future Azure / GCP adapters) read `ctx.tenant_id`
     * to key their state.
     */
    perform(handle: unknown, args: AwsActionArgs | AzureActionArgs | GcpActionArgs, ctx?: {
        tenant_id?: string;
        trace_id?: string;
    }): Promise<unknown>;
    /**
     * Release a handle obtained from `assume()` without calling
     * `perform()`. The probe path uses this so a canary-assume does not
     * leak its holder into the adapter's registry. Adapters that don't
     * cache credential material in a registry may leave this undefined.
     */
    releaseHandle?(handle: unknown): void;
}
export declare const MAX_CREDENTIAL_LIFETIME_MS: number;
