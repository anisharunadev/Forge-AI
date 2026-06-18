/**
 * ProbeScheduler — periodic re-probe of every active trust record.
 *
 * FORA-126.4. Runs `probeTenant` over every (tenant_id, cloud) pair
 * in the `TrustStore` on a fixed interval (default 5 min). For each
 * probe:
 *
 *   1. `probeTenant` runs phase 1 (config check) + phase 2 (canary
 *      assume with a probe JWT).
 *   2. The returned `ProbeResult.state` is written back to the trust
 *      record via `TrustStore.setState`.
 *   3. A `cloud.probe.{ok,fail}` audit event is emitted with
 *      `actor = system:probe`.
 *   4. If the state changed (active → cloud_disabled or vice versa),
 *      the optional `on_state_change` callback fires so the broker
 *      can e.g. evict a cached entry.
 *
 * The scheduler is intentionally minimal: a single `setInterval` per
 * process. Concurrent processes would re-probe in parallel — for
 * v1, we assume a single broker replica; the postgres-backed store
 * (a follow-up epic) will add a per-record lease so two replicas
 * don't stampede the customer IAM endpoint.
 *
 * On boot, the broker calls `probeAll()` once before `start()` so
 * every tenant has a known state before the first request lands.
 */
import type { AuditSink } from './audit.js';
import type { AdapterRegistry } from './adapters/index.js';
import type { ProbeProbeSigner } from './probe-signer.js';
import { probeTenant, type ProbeResult } from './trust.js';
import type { TrustStore } from './trust.js';
/** Default re-probe interval. 5 minutes per FORA-126.4 acceptance. */
export declare const PROBE_INTERVAL_MS_DEFAULT: number;
export interface ProbeSchedulerOptions {
    trust_store: TrustStore;
    adapters: AdapterRegistry;
    signer: ProbeProbeSigner;
    audit: AuditSink;
    /** Re-probe interval in ms. Default 5 min. */
    interval_ms?: number;
    /** AWS probe region. */
    probe_region?: string;
    /**
     * Called when a probe flips a trust record's state. Used by the
     * broker to evict any per-tenant cache (e.g. rate-limit buckets).
     */
    on_state_change?: (input: {
        tenant_id: string;
        cloud: 'aws' | 'azure' | 'gcp';
        from: ProbeResult['state'];
        to: ProbeResult['state'];
        reason: string | null;
    }) => void;
    /** `setTimeout` override for tests. */
    set_timer?: (cb: () => void, ms: number) => NodeJS.Timeout;
    /** `clearTimeout` override for tests. */
    clear_timer?: (handle: NodeJS.Timeout) => void;
}
export declare class ProbeScheduler {
    private readonly trust_store;
    private readonly adapters;
    private readonly signer;
    private readonly audit;
    private readonly interval_ms;
    private readonly probe_region;
    private readonly on_state_change;
    private readonly set_timer;
    private readonly clear_timer;
    private timer;
    private running;
    /** Re-entrancy guard for the periodic tick. */
    private ticking;
    constructor(opts: ProbeSchedulerOptions);
    /** Run one sweep over every (tenant, cloud) pair. Returns the per-record results. */
    probeAll(): Promise<ProbeResult[]>;
    /** Probe a single (tenant_id, cloud) trust record. */
    probeOne(tenant_id: string, trust: Parameters<typeof probeTenant>[0]): Promise<ProbeResult>;
    /** Start the periodic re-probe loop. Idempotent. */
    start(): void;
    /** Stop the periodic re-probe loop. Idempotent. Safe to call before start. */
    stop(): void;
    private scheduleNext;
    private tick;
}
