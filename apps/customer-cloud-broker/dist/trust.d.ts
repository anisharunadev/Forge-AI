/**
 * Tenant IAM trust onboarding + re-probe.
 *
 * Per FORA-126 acceptance bar #4: the customer's IAM trust policy is
 * verified during tenant onboarding; a tenant whose trust is missing
 * or wrong is in `cloud_disabled` state until repaired.
 *
 * This module owns the trust store (`TenantCloudTrust`) and the probe
 * pipeline. The probe pipeline is two-phase:
 *
 *   Phase 1 — `adapter.probeTrust`. Synchronous, no network.
 *   Validates the tenant's `cloud_trust.yaml` shape: role ARN parses,
 *   issuer/audience match what the broker mints, role is in the
 *   expected region/account. This is fast and runs on every broker
 *   boot.
 *
 *   Phase 2 — canary assume via the adapter's `assume()` path. A
 *   `ProbeProbeSigner` mints a probe-specific FORA JWT (with the
 *   `scope: 'probe'` sentinel claim so customers can allow probes
 *   only); the broker hands it to the adapter to exchange for a
 *   cloud-native credential. A success proves the customer's trust
 *   policy actually accepts the broker's issuer. A failure flips
 *   the tenant to `cloud_disabled` with a typed reason.
 *
 *   The probe never calls `adapter.perform()` — only `assume()`.
 *   The handle is released via `adapter.releaseHandle?()` in a
 *   `finally` so a canary-assume never leaks its holder into the
 *   adapter's registry. The probe JWT itself is short-lived (60s)
 *   and never persisted.
 *
 * The trust store is read at boot and re-probed on a cron schedule
 * (`PROBE_INTERVAL_MS`, default 5 min). A tenant that was active and
 * goes `cloud_disabled` mid-flight has its in-flight requests
 * completed by the broker; subsequent requests are refused.
 *
 * FORA-126.4: this module owns phase 2 (the canary). Phase 1 is in
 * each adapter's `probeTrust()`. The audit event for probe outcomes
 * lives in `audit.ts::CloudProbeAuditEvent`.
 */
import { z } from 'zod';
import type { AdapterRegistry } from './adapters/index.js';
import type { Cloud, TenantCloudTrust, TrustState } from './types.js';
import type { ProbeProbeSigner } from './probe-signer.js';
declare const TenantTrustFileSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    description: z.ZodOptional<z.ZodString>;
    clouds: z.ZodArray<z.ZodObject<{
        cloud: z.ZodEnum<["aws", "azure", "gcp"]>;
        account: z.ZodString;
        role_ref: z.ZodString;
        expected_issuer: z.ZodString;
        expected_audience: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        cloud: "aws" | "azure" | "gcp";
        account: string;
        role_ref: string;
        expected_issuer: string;
        expected_audience: string;
    }, {
        cloud: "aws" | "azure" | "gcp";
        account: string;
        role_ref: string;
        expected_issuer: string;
        expected_audience: string;
    }>, "many">;
}, "strict", z.ZodTypeAny, {
    version: 1;
    clouds: {
        cloud: "aws" | "azure" | "gcp";
        account: string;
        role_ref: string;
        expected_issuer: string;
        expected_audience: string;
    }[];
    description?: string | undefined;
}, {
    version: 1;
    clouds: {
        cloud: "aws" | "azure" | "gcp";
        account: string;
        role_ref: string;
        expected_issuer: string;
        expected_audience: string;
    }[];
    description?: string | undefined;
}>;
export type TenantTrustFile = z.infer<typeof TenantTrustFileSchema>;
interface LoadOptions {
    baseDir?: string;
}
export declare function loadTenantTrustFile(source: string, opts?: LoadOptions): TenantTrustFile;
export declare class TrustStore {
    private readonly trusts;
    /** Load a tenant's trust from disk, replacing any prior state. */
    loadTenant(tenant_id: string, source: string, opts?: LoadOptions): TenantCloudTrust[];
    /** Returns the trust entry for a tenant+cloud, or null. */
    get(tenant_id: string, cloud: Cloud): TenantCloudTrust | null;
    /** Returns the trust entry by account reference (used during brokered requests). */
    getByAccount(tenant_id: string, cloud: Cloud, account: string): TenantCloudTrust | null;
    setState(tenant_id: string, cloud: Cloud, state: TrustState, reason: string | null): void;
    list(tenant_id: string): TenantCloudTrust[];
    /** Iterate every (tenant_id, cloud) pair across every tenant. */
    entries(): IterableIterator<{
        tenant_id: string;
        trust: TenantCloudTrust;
    }>;
}
/**
 * The canary probe's typed reasons. Surfaced as `disabled_reason` on
 * the trust record AND as `cloud.probe.fail.reason` in the audit
 * event. Customers and operators can grep on these codes.
 */
export type ProbeFailureReason = 'no_adapter' | 'phase1_failed' | 'probe_mint_failed' | 'assume_failed' | 'adapter_not_implemented' | 'unhandled_probe_error';
export interface ProbeResult {
    tenant_id: string;
    cloud: Cloud;
    state: TrustState;
    reason: string | null;
    /** Token-only result of phase 2 — the probe JWT, for audit correlation. */
    probe_jti?: string;
    /** Wall-clock duration of the probe (ms). */
    duration_ms: number;
    /** Phase 2 outcome, distinct from `state` so the audit log can mark it. */
    phase2: 'ok' | 'fail' | 'skipped';
}
export interface ProbeOptions {
    /** Probe JWT minter. Required for phase 2. */
    signer: ProbeProbeSigner;
    /** Region to mint the probe AWS args in. Defaults to `us-east-1`. */
    probe_region?: string;
    /** `now()` override for tests. */
    now?: () => number;
    /** Skip phase 2 — runs only the cheap config check. Test seam. */
    skip_canary?: boolean;
}
/**
 * Probe a single tenant+cloud trust record. Phase 1 is the cheap
 * config check; phase 2 is the canary assume.
 *
 * The returned `ProbeResult.state` is the new trust state — callers
 * (`TrustStore.setState` or the periodic re-probe loop) should write
 * it back. The audit event for the probe outcome is emitted by the
 * caller (the broker boot / the periodic loop) so a single probe
 * produces exactly one `cloud.probe.{ok,fail}` event regardless of
 * who scheduled it.
 */
export declare function probeTenant(trust: TenantCloudTrust, adapters: AdapterRegistry, opts: ProbeOptions): Promise<ProbeResult>;
export interface DiscoveredTenantTrust {
    tenant_id: string;
    source: string;
}
export declare function discoverTenantTrusts(rootDir: string): DiscoveredTenantTrust[];
export {};
