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
export const CLOUDS = ['aws', 'azure', 'gcp'];
// ---------------------------------------------------------------------------
// Tenant IAM trust onboarding record. Loaded from
// `tenants/{tenant_id}/cloud_trust.yaml` per tenant. The `trust_state`
// is computed by `src/trust.ts` and gated on a live probe; a tenant
// whose trust is missing or wrong is in `cloud_disabled` state and the
// broker refuses every action for it.
// ---------------------------------------------------------------------------
export const TRUST_STATES = [
    'active', // trust verified, broker accepts actions
    'cloud_disabled', // trust missing or wrong; broker rejects every action
    'pending_probe', // initial probe in flight
];
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
// ---------------------------------------------------------------------------
// The 15-minute ceiling. ADR-0003 §6.2 mandates this; AWS IAM role
// `MaxSessionDuration` can be set up to 12 hours, so the broker must
// reject a role whose configured duration exceeds the cap and refuse
// to assume it.
// ---------------------------------------------------------------------------
export const MAX_CREDENTIAL_LIFETIME_MS = 15 * 60 * 1000;
