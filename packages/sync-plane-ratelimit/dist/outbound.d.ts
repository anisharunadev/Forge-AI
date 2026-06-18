/**
 * Outbound — orchestrates the per-tenant bucket, per-(tenant,platform)
 * bucket, per-platform circuit breaker, and composite-edit coalescer
 * into a single `enqueue` API. Implements FORA-256 §"Scope" and the
 * 5 acceptance criteria end-to-end.
 *
 * The actual platform call (Jira / GitHub / ClickUp) is the injected
 * `platformCall`. This package does not depend on the MCP servers;
 * the sync-plane service (FORA-252 / 11.1) wires the platform adapter
 * at construction time. The smoke test injects a mock.
 *
 * Order of checks (each layer must pass before the next):
 *   1. Per-tenant bucket        → R-SYNC-08 (one tenant's burst)
 *   2. Per-(tenant,platform)    → platform-specific quotas
 *   3. Per-platform breaker     → ADR-0010 §7.1 (5xx storm isolation)
 *   4. Coalescer                → R-SYNC-03 (comment storm DoS)
 *   5. X-RateLimit-Remaining    → pause the platform on low water
 *   6. platformCall (injected)
 */
import { type OutboundEdit, type PlatformId } from './coalescer.js';
import { InMemoryAuditSink, type AuditSink } from './audit.js';
export interface OutboundConfig {
    /** Per-tenant bucket defaults. 60 events/min = 1/s; burst 10. */
    readonly tenant_bucket?: {
        capacity: number;
        refill_per_sec: number;
    };
    /** Per-(tenant,platform) bucket defaults. */
    readonly platform_bucket?: {
        capacity: number;
        refill_per_sec: number;
    };
    /** Per-platform circuit breaker defaults. 5 failures in 60s; 5-min cooldown. */
    readonly breaker?: {
        failure_threshold: number;
        failure_window_ms: number;
        cooldown_ms: number;
    };
    /** Composite-edit coalesce window. Default 30s. */
    readonly coalesce_window_ms?: number;
    /** Audit sink. Defaults to a noop. The smoke test uses InMemoryAuditSink. */
    readonly audit?: AuditSink;
    /** `now()` injection for tests. */
    readonly now?: () => number;
}
export interface OutboundPlatformCallContext {
    readonly tenant_id: string;
    readonly platform: PlatformId;
    readonly edit: OutboundEdit | CompositeBody;
    /** True if this call is a coalesced composite of N source events. */
    readonly composite: boolean;
}
export interface CompositeBody {
    readonly source_event_ids: readonly string[];
    readonly source_count: number;
    readonly body: string;
}
export interface PlatformCallResult {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: unknown;
}
export type PlatformCall = (ctx: OutboundPlatformCallContext) => Promise<PlatformCallResult>;
export type EnqueueDisposition = {
    kind: 'sent';
    result: PlatformCallResult;
    composite: false;
} | {
    kind: 'coalesced';
    key: string;
    composite_event_ids: readonly string[];
} | {
    kind: 'rejected_rate_limited';
    layer: 'tenant' | 'platform';
} | {
    kind: 'rejected_circuit_open';
} | {
    kind: 'rejected_platform_paused';
    until_ms: number;
};
export declare class OutboundReliability {
    private readonly platformCall;
    private readonly tenantBuckets;
    private readonly platformBuckets;
    private readonly breakers;
    private readonly pausedUntil;
    private readonly coalescer;
    private readonly audit;
    private readonly now;
    private readonly cfg;
    constructor(opts: OutboundConfig, platformCall: PlatformCall);
    /**
     * Enqueue an outbound edit. Returns a synchronous disposition
     * describing what happened. For coalesced edits, the actual platform
     * call is fired by the coalescer's flush handler (W seconds after
     * the first edit), not by `enqueue()`.
     */
    enqueue(edit: OutboundEdit): EnqueueDisposition;
    /** Force-flush all pending coalesce buffers. Test / shutdown seam. */
    drain(): Promise<number>;
    /** Test seam: read the audit sink (works only if it was an InMemoryAuditSink). */
    inspectAudit(): InMemoryAuditSink | null;
    private flushComposite;
    private handleResult;
    private handleError;
    private emitBreakerStateIfChanged;
    private tenantBucketFor;
    private platformBucketFor;
    private breakerFor;
    private get nowDate();
}
