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
import { TokenBucket } from './token_bucket.js';
import { CircuitBreaker } from './circuit_breaker.js';
import { Coalescer } from './coalescer.js';
import { InMemoryAuditSink, NoopAuditSink, makeEvent } from './audit.js';
export class OutboundReliability {
    platformCall;
    tenantBuckets = new Map();
    platformBuckets = new Map();
    breakers = new Map();
    pausedUntil = new Map();
    coalescer;
    audit;
    now;
    cfg;
    constructor(opts, platformCall) {
        this.platformCall = platformCall;
        this.audit = opts.audit ?? new NoopAuditSink();
        this.now = opts.now ?? Date.now;
        this.cfg = {
            tenant_bucket: opts.tenant_bucket ?? { capacity: 10, refill_per_sec: 1 }, // 60/min ≈ 1/s, burst 10
            platform_bucket: opts.platform_bucket ?? { capacity: 10, refill_per_sec: 1 },
            breaker: opts.breaker ?? { failure_threshold: 5, failure_window_ms: 60_000, cooldown_ms: 5 * 60_000 },
            coalesce_window_ms: opts.coalesce_window_ms ?? 30_000,
        };
        this.coalescer = new Coalescer({
            window_ms: this.cfg.coalesce_window_ms,
            now: this.now,
            flush: (merged) => this.flushComposite(merged),
        });
    }
    /**
     * Enqueue an outbound edit. Returns a synchronous disposition
     * describing what happened. For coalesced edits, the actual platform
     * call is fired by the coalescer's flush handler (W seconds after
     * the first edit), not by `enqueue()`.
     */
    enqueue(edit) {
        // 1. Platform pause check (X-RateLimit-Remaining < 10% previously
        //    tripped a pause; inbound keeps flowing).
        const pausedUntil = this.pausedUntil.get(edit.platform);
        if (pausedUntil !== undefined && this.now() < pausedUntil) {
            return { kind: 'rejected_platform_paused', until_ms: pausedUntil };
        }
        // 2. Per-tenant bucket.
        const tenantBucket = this.tenantBucketFor(edit.tenant_id);
        if (!tenantBucket.take()) {
            this.audit.emit(makeEvent('connector.rate_limit.throttled', edit.tenant_id, edit.platform, { layer: 'tenant' }, this.nowDate));
            return { kind: 'rejected_rate_limited', layer: 'tenant' };
        }
        // 3. Per-(tenant, platform) bucket.
        const platformBucket = this.platformBucketFor(edit.tenant_id, edit.platform);
        if (!platformBucket.take()) {
            this.audit.emit(makeEvent('connector.rate_limit.throttled', edit.tenant_id, edit.platform, { layer: 'platform' }, this.nowDate));
            return { kind: 'rejected_rate_limited', layer: 'platform' };
        }
        // 4. Per-platform circuit breaker.
        const breaker = this.breakerFor(edit.platform);
        if (!breaker.canPass()) {
            this.audit.emit(makeEvent('connector.circuit.opened', edit.tenant_id, edit.platform, {}, this.nowDate));
            return { kind: 'rejected_circuit_open' };
        }
        // 5. Coalescer — append and return disposition.
        const { coalesced, key } = this.coalescer.enqueue(edit);
        if (coalesced) {
            this.audit.emit(makeEvent('connector.coalesce.applied', edit.tenant_id, edit.platform, { key, event_id: edit.event_id }, this.nowDate));
            // Reflect the event in the composite result once it flushes;
            // we don't know the final source_event_ids yet, so we record
            // just the new event id here and the audit row at flush time
            // is the canonical N→1 record.
            const bufferKey = key;
            return { kind: 'coalesced', key: bufferKey, composite_event_ids: [edit.event_id] };
        }
        return { kind: 'coalesced', key, composite_event_ids: [edit.event_id] };
    }
    /** Force-flush all pending coalesce buffers. Test / shutdown seam. */
    async drain() {
        return this.coalescer.drain();
    }
    /** Test seam: read the audit sink (works only if it was an InMemoryAuditSink). */
    inspectAudit() {
        return this.audit instanceof InMemoryAuditSink ? this.audit : null;
    }
    async flushComposite(merged) {
        try {
            const result = await this.platformCall({
                tenant_id: merged.tenant_id,
                platform: merged.platform,
                edit: {
                    source_event_ids: merged.source_event_ids,
                    source_count: merged.source_count,
                    body: merged.body,
                },
                composite: true,
            });
            this.handleResult(merged.tenant_id, merged.platform, result);
            return {
                ok: result.status >= 200 && result.status < 300,
                status: result.status,
                per_event: merged.source_event_ids.map((event_id) => ({ event_id, ok: result.status >= 200 && result.status < 300 })),
            };
        }
        catch (err) {
            this.handleError(merged.tenant_id, merged.platform, err);
            return { ok: false, status: 'platform_error', per_event: merged.source_event_ids.map((event_id) => ({ event_id, ok: false })) };
        }
    }
    handleResult(tenant_id, platform, result) {
        const breaker = this.breakerFor(platform);
        if (result.status >= 500 && result.status < 600) {
            breaker.onFailure();
            this.emitBreakerStateIfChanged(platform, breaker);
        }
        else {
            breaker.onSuccess();
        }
        // X-RateLimit-Remaining < 10% → pause outbound for the cooldown.
        const remaining = parseRateLimitRemaining(result.headers);
        const limit = parseRateLimitLimit(result.headers);
        if (remaining !== null && limit !== null && limit > 0) {
            const ratio = remaining / limit;
            if (ratio < 0.1) {
                const retryAfter = parseRetryAfterMs(result.headers) ?? this.cfg.breaker.cooldown_ms;
                const until = this.now() + retryAfter;
                const existing = this.pausedUntil.get(platform) ?? 0;
                if (until > existing)
                    this.pausedUntil.set(platform, until);
                this.audit.emit(makeEvent('connector.rate_limit.throttled', tenant_id, platform, { layer: 'provider', remaining, limit, paused_until_ms: until }, this.nowDate));
            }
        }
    }
    handleError(_tenant_id, platform, _err) {
        const breaker = this.breakerFor(platform);
        breaker.onFailure();
        this.emitBreakerStateIfChanged(platform, breaker);
    }
    emitBreakerStateIfChanged(platform, breaker) {
        const transitions = breaker.recentTransitions();
        if (transitions.length === 0)
            return;
        const last = transitions[transitions.length - 1];
        if (last.to === 'open' && last.from !== 'open') {
            this.audit.emit(makeEvent('connector.circuit.opened', null, platform, { state: 'open', at_ms: last.at_ms }, this.nowDate));
        }
        else if (last.to === 'closed' && last.from !== 'closed') {
            this.audit.emit(makeEvent('connector.circuit.closed', null, platform, { state: 'closed', at_ms: last.at_ms }, this.nowDate));
        }
    }
    tenantBucketFor(tenant_id) {
        let b = this.tenantBuckets.get(tenant_id);
        if (!b) {
            b = new TokenBucket({ ...this.cfg.tenant_bucket, now: this.now });
            this.tenantBuckets.set(tenant_id, b);
        }
        return b;
    }
    platformBucketFor(tenant_id, platform) {
        const key = `${tenant_id}|${platform}`;
        let b = this.platformBuckets.get(key);
        if (!b) {
            b = new TokenBucket({ ...this.cfg.platform_bucket, now: this.now });
            this.platformBuckets.set(key, b);
        }
        return b;
    }
    breakerFor(platform) {
        let b = this.breakers.get(platform);
        if (!b) {
            b = new CircuitBreaker({ ...this.cfg.breaker, now: this.now });
            this.breakers.set(platform, b);
        }
        return b;
    }
    get nowDate() {
        const nowFn = this.now;
        return () => new Date(nowFn());
    }
}
function parseRateLimitRemaining(headers) {
    const v = headers['x-ratelimit-remaining'] ?? headers['X-RateLimit-Remaining'];
    if (v === undefined)
        return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function parseRateLimitLimit(headers) {
    const v = headers['x-ratelimit-limit'] ?? headers['X-RateLimit-Limit'];
    if (v === undefined)
        return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function parseRetryAfterMs(headers) {
    const v = headers['retry-after'] ?? headers['Retry-After'];
    if (v === undefined)
        return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 1000) : null;
}
//# sourceMappingURL=outbound.js.map