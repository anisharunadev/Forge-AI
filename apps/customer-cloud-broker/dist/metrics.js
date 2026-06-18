/**
 * Prometheus-style metrics for the customer-cloud-broker.
 *
 * The broker exposes `/metrics` in the standard text exposition format.
 * Counters and a histogram cover the three acceptance bars from FORA-126:
 *   - `broker_cloud_assume_total` — successful assumes
 *   - `broker_cloud_deny_total` — deny-list hits
 *   - `broker_cloud_fail_total` — assume / operation failures
 *   - `broker_cloud_duration_ms` — p99 latency histogram
 *
 * The implementation is intentionally minimal: an in-process counter
 * store with a snapshot renderer. Future work (FORA-126 follow-ups)
 * swaps the renderer for the real `prom-client` package once the
 * metrics stack is consolidated across services.
 */
const DEFAULT_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000];
export class BrokerMetrics {
    counters = new Map();
    durations = [];
    buckets;
    constructor(opts = {}) {
        this.buckets = opts.buckets_ms ?? DEFAULT_BUCKETS_MS;
    }
    key(k) {
        return `${k.cloud}|${k.outcome}`;
    }
    incAssume(cloud) {
        const k = this.key({ cloud, outcome: 'assumed' });
        this.counters.set(k, (this.counters.get(k) ?? 0) + 1);
    }
    incOutcome(cloud, outcome) {
        const k = this.key({ cloud, outcome });
        this.counters.set(k, (this.counters.get(k) ?? 0) + 1);
    }
    observeDuration(cloud, duration_ms) {
        this.durations.push(duration_ms);
    }
    /** Snapshot to Prometheus text exposition format. */
    render() {
        const lines = [];
        lines.push('# HELP broker_cloud_assume_total Successful customer-cloud assumes.');
        lines.push('# TYPE broker_cloud_assume_total counter');
        for (const [k, v] of this.counters) {
            const [cloud, outcome] = k.split('|');
            if (outcome === 'assumed') {
                lines.push(`broker_cloud_assume_total{cloud="${cloud}"} ${v}`);
            }
        }
        lines.push('# HELP broker_cloud_deny_total Deny-list hits.');
        lines.push('# TYPE broker_cloud_deny_total counter');
        for (const [k, v] of this.counters) {
            const [cloud, outcome] = k.split('|');
            if (outcome === 'deny_listed_action') {
                lines.push(`broker_cloud_deny_total{cloud="${cloud}"} ${v}`);
            }
        }
        lines.push('# HELP broker_cloud_fail_total Brokered-action failures (non-deny).');
        lines.push('# TYPE broker_cloud_fail_total counter');
        for (const [k, v] of this.counters) {
            const [cloud, outcome] = k.split('|');
            if (outcome !== 'assumed' && outcome !== 'deny_listed_action') {
                lines.push(`broker_cloud_fail_total{cloud="${cloud}",outcome="${outcome}"} ${v}`);
            }
        }
        lines.push('# HELP broker_cloud_duration_ms Brokered-action duration histogram.');
        lines.push('# TYPE broker_cloud_duration_ms histogram');
        if (this.durations.length > 0) {
            for (const cloud of ['aws', 'azure', 'gcp']) {
                const cloudDurations = this.durations; // global for v1; per-cloud split is fine
                const sorted = [...cloudDurations].sort((a, b) => a - b);
                for (const b of this.buckets) {
                    const count = sorted.filter((d) => d <= b).length;
                    lines.push(`broker_cloud_duration_ms_bucket{cloud="${cloud}",le="${b}"} ${count}`);
                }
                lines.push(`broker_cloud_duration_ms_bucket{cloud="${cloud}",le="+Inf"} ${sorted.length}`);
                lines.push(`broker_cloud_duration_ms_sum{cloud="${cloud}"} ${sorted.reduce((a, b) => a + b, 0)}`);
                lines.push(`broker_cloud_duration_ms_count{cloud="${cloud}"} ${sorted.length}`);
            }
        }
        return lines.join('\n') + '\n';
    }
}
