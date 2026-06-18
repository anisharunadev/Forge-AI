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
import { cloudProbeEvent } from './audit.js';
import { probeTenant } from './trust.js';
/** Default re-probe interval. 5 minutes per FORA-126.4 acceptance. */
export const PROBE_INTERVAL_MS_DEFAULT = 5 * 60 * 1000;
export class ProbeScheduler {
    trust_store;
    adapters;
    signer;
    audit;
    interval_ms;
    probe_region;
    on_state_change;
    set_timer;
    clear_timer;
    timer = null;
    running = false;
    /** Re-entrancy guard for the periodic tick. */
    ticking = false;
    constructor(opts) {
        this.trust_store = opts.trust_store;
        this.adapters = opts.adapters;
        this.signer = opts.signer;
        this.audit = opts.audit;
        this.interval_ms = opts.interval_ms ?? PROBE_INTERVAL_MS_DEFAULT;
        this.probe_region = opts.probe_region;
        this.on_state_change = opts.on_state_change;
        // Default timer functions. Tests can pass a fake.
        this.set_timer =
            opts.set_timer ?? ((cb, ms) => setTimeout(cb, ms));
        this.clear_timer = opts.clear_timer ?? ((h) => clearTimeout(h));
    }
    /** Run one sweep over every (tenant, cloud) pair. Returns the per-record results. */
    async probeAll() {
        if (this.ticking)
            return [];
        this.ticking = true;
        try {
            const results = [];
            for (const { tenant_id, trust } of this.trust_store.entries()) {
                const result = await this.probeOne(tenant_id, trust);
                results.push(result);
            }
            return results;
        }
        finally {
            this.ticking = false;
        }
    }
    /** Probe a single (tenant_id, cloud) trust record. */
    async probeOne(tenant_id, trust) {
        const probeOpts = {
            signer: this.signer,
            ...(this.probe_region ? { probe_region: this.probe_region } : {}),
        };
        const result = await probeTenant(trust, this.adapters, probeOpts);
        const previous = trust.trust_state;
        this.trust_store.setState(tenant_id, trust.cloud, result.state, result.reason);
        if (previous !== result.state && this.on_state_change) {
            try {
                this.on_state_change({
                    tenant_id,
                    cloud: trust.cloud,
                    from: previous,
                    to: result.state,
                    reason: result.reason,
                });
            }
            catch {
                // State-change callbacks are best-effort. We never want a
                // consumer bug to mask the probe outcome or the audit write.
            }
        }
        // Emit exactly one cloud.probe event per probe, regardless of
        // whether the state changed. The audit row is the canonical
        // record of what the probe saw.
        const event = cloudProbeEvent({
            tenant_id,
            cloud: trust.cloud,
            result: result.phase2 === 'ok' ? 'ok' : 'fail',
            reason: result.reason,
            probe_jti: result.probe_jti ?? null,
            duration_ms: result.duration_ms,
        });
        await this.audit.write(event);
        return result;
    }
    /** Start the periodic re-probe loop. Idempotent. */
    start() {
        if (this.running)
            return;
        this.running = true;
        this.scheduleNext();
    }
    /** Stop the periodic re-probe loop. Idempotent. Safe to call before start. */
    stop() {
        this.running = false;
        if (this.timer != null) {
            this.clear_timer(this.timer);
            this.timer = null;
        }
    }
    scheduleNext() {
        if (!this.running)
            return;
        this.timer = this.set_timer(() => {
            void this.tick();
        }, this.interval_ms);
    }
    async tick() {
        if (!this.running)
            return;
        try {
            await this.probeAll();
        }
        catch (err) {
            // A probe sweep error must not crash the loop. Log to stderr
            // (the broker process owns structured logging) and continue.
            // eslint-disable-next-line no-console
            console.error('[probe-scheduler] sweep failed', err);
        }
        finally {
            this.scheduleNext();
        }
    }
}
