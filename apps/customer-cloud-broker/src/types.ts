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

// ---------------------------------------------------------------------------
// Cloud identifiers. Closed enum; adding a new cloud is a code change on
// purpose (each adapter needs hand-written trust onboarding).
// ---------------------------------------------------------------------------

export const CLOUDS = ['aws', 'azure', 'gcp', 'sonarqube'] as const;
export type Cloud = (typeof CLOUDS)[number];

// ---------------------------------------------------------------------------
// Tenant IAM trust onboarding record. Loaded from
// `tenants/{tenant_id}/cloud_trust.yaml` per tenant. The `trust_state`
// is computed by `src/trust.ts` and gated on a live probe; a tenant
// whose trust is missing or wrong is in `cloud_disabled` state and the
// broker refuses every action for it.
// ---------------------------------------------------------------------------

export const TRUST_STATES = [
  'active',         // trust verified, broker accepts actions
  'cloud_disabled', // trust missing or wrong; broker rejects every action
  'pending_probe',  // initial probe in flight
] as const;
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

// ---------------------------------------------------------------------------
// Brokered request shape. Extends the ToolCall envelope from
// `apps/identity-broker/src/iam.ts` with the cloud-specific action. The
// envelope is verified by the identity-broker first; the customer-cloud-
// broker trusts only verified envelopes signed by the identity-broker.
// ---------------------------------------------------------------------------

export interface BrokeredRequest {
  /** ToolCall trace_id (ADR-0003 §3.2). */
  trace_id: string;
  tenant_id: string;
  principal: 'agent';
  agent_type: string;
  /** Always `customer-cloud-broker` for requests that reach this service. */
  mcp: 'customer-cloud-broker';
  /** Cloud-specific action (e.g. `aws.sts.assume`, `azure.compute.list`, `gcp.storage.get`, `sonarqube.projects.search`). */
  action: string;
  /** The cloud-native target descriptor (e.g. for AWS: role ARN + region). */
  args: AwsActionArgs | AzureActionArgs | GcpActionArgs | SonarQubeActionArgs;
  scopes_used: string[];
  /** Wall-clock deadline the broker must finish under. Past this, refuse. */
  deadline_ms?: number;
}

// Cloud-specific argument shapes. The action string names the operation;
// the args carry the per-call target. The deny-list match is over
// `(cloud, action)` so the *operation* is what's gated, not the *target* —
// this is intentional and matches ADR-0003 §6.3 ("centralised deny-list of
// dangerous actions").

export const AwsActionArgsSchema = z.object({
  cloud: z.literal('aws'),
  role_arn: z.string().min(20).describe('Customer IAM role ARN to assume (trusts the broker IdP).'),
  region: z.string().min(1).describe('AWS region for the subsequent SDK call.'),
  service: z.string().min(1).describe('AWS service namespace (e.g. "s3", "ec2", "iam").'),
  operation: z.string().min(1).describe('AWS SDK operation name (e.g. "GetObject", "RunInstances").'),
  params: z.record(z.string(), z.unknown()).default({}).describe('Operation parameters. Must NOT contain credentials.'),
});
export type AwsActionArgs = z.infer<typeof AwsActionArgsSchema>;

export const AzureActionArgsSchema = z.object({
  cloud: z.literal('azure'),
  subscription_id: z.string().min(1),
  resource_group: z.string().min(1).optional(),
  /** Entra ID tenant id (GUID) hosting the customer's app registration. Required for the federated token exchange. */
  aad_tenant_id: z.string().min(1),
  app_registration_client_id: z.string().min(1),
  service: z.string().min(1),
  operation: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type AzureActionArgs = z.infer<typeof AzureActionArgsSchema>;

export const GcpActionArgsSchema = z.object({
  cloud: z.literal('gcp'),
  project_number: z.string().regex(/^\d+$/, 'project_number must be numeric'),
  /** Workload Identity Pool id (e.g. `fora-prod-pool`). */
  workload_identity_pool: z.string().min(1),
  /** Workload Identity Provider id inside the pool. The provider is what
   *  trusts the FORA identity-broker OIDC issuer and audience. */
  workload_identity_provider: z.string().min(1),
  /** Service account email to impersonate, e.g. `deploy@acme.iam.gserviceaccount.com`. */
  service_account: z.string().min(1),
  service: z.string().min(1),
  operation: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type GcpActionArgs = z.infer<typeof GcpActionArgsSchema>;

/**
 * SonarQube brokered action args (FORA-321 / Path B).
 *
 * The broker mints a per-action, per-project SonarQube user token
 * (FORA-290 Path A ships the read-only MCP module that consumes such
 * tokens; FORA-321 Path B is the credential layer that mints and rotates
 * them through the broker). The customer's SonarQube instance is
 * identified by `instance_url` (e.g. `https://sonarcloud.io` or a
 * self-hosted `https://sonar.acme.example`); the broker pins every
 * action to the project key on the trust record AND on the handle, so a
 * token scoped to one project can never act on another.
 */
export const SonarQubeActionArgsSchema = z.object({
  cloud: z.literal('sonarqube'),
  /** Base URL of the customer's SonarQube/SonarCloud instance (no trailing slash). */
  instance_url: z.string().url(),
  /** SonarQube project key. Pinned against the trust record + handle. */
  project_key: z.string().min(1),
  /** Logical name for the user token (used for rotation/audit correlation). */
  token_name: z.string().min(1).max(255),
  /** Logical service namespace; one of the v1 allow-list (see adapter). */
  service: z.string().min(1),
  /** Operation within the service (e.g. `search`, `show`, `project_status`). */
  operation: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type SonarQubeActionArgs = z.infer<typeof SonarQubeActionArgsSchema>;

// ---------------------------------------------------------------------------
// Brokered result. By contract, this is the *only* shape the agent ever
// sees. The credential is gone before this object is constructed — see
// the adapters in `src/adapters/*`.
// ---------------------------------------------------------------------------

export type BrokerResponseCode =
  | 'ok'
  | 'deny_listed_action'   // action on the global deny-list
  | 'cloud_disabled'        // tenant trust is in `cloud_disabled` state
  | 'assume_failed'         // STS / federated token exchange failed
  | 'operation_failed'      // the cloud API call itself failed
  | 'deadline_exceeded'
  | 'credential_too_long'   // customer role's MaxSessionDuration exceeds cap
  | 'unsupported_cloud'     // the cloud identifier is not wired
  | 'malformed_args'
  | 'internal_error';

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

// ---------------------------------------------------------------------------
// Adapter contract. Each cloud implements this. The broker never speaks
// AWS / Azure / GCP APIs directly — always through an adapter.
// ---------------------------------------------------------------------------

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
  probeTrust(trust: TenantCloudTrust): Promise<{ ok: boolean; reason: string | null }>;
  /**
   * Assume the customer's IAM role via OIDC federation. The FORA-issued
   * token is exchanged for a cloud-native short-lived credential. The
   * credential MUST be discarded by the adapter after the call returns
   * — the returned `handle` must not contain raw credential strings.
   */
  assume(args: AwsActionArgs | AzureActionArgs | GcpActionArgs | SonarQubeActionArgs, for_jwt: string): Promise<AssumeResult>;
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
  perform(
    handle: unknown,
    args: AwsActionArgs | AzureActionArgs | GcpActionArgs | SonarQubeActionArgs,
    ctx?: { tenant_id?: string; trace_id?: string },
  ): Promise<unknown>;
  /**
   * Release a handle obtained from `assume()` without calling
   * `perform()`. The probe path uses this so a canary-assume does not
   * leak its holder into the adapter's registry. Adapters that don't
   * cache credential material in a registry may leave this undefined.
   */
  releaseHandle?(handle: unknown): void;
}

// ---------------------------------------------------------------------------
// The 15-minute ceiling. ADR-0003 §6.2 mandates this; AWS IAM role
// `MaxSessionDuration` can be set up to 12 hours, so the broker must
// reject a role whose configured duration exceeds the cap and refuse
// to assume it.
// ---------------------------------------------------------------------------

export const MAX_CREDENTIAL_LIFETIME_MS = 15 * 60 * 1000;
