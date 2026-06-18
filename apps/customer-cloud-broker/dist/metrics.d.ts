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
import type { Cloud } from './types.js';
import type { BrokerResponseCode } from './types.js';
export declare class BrokerMetrics {
    private readonly counters;
    private readonly durations;
    private readonly buckets;
    constructor(opts?: {
        buckets_ms?: number[];
    });
    private key;
    incAssume(cloud: Cloud): void;
    incOutcome(cloud: Cloud, outcome: BrokerResponseCode): void;
    observeDuration(cloud: Cloud, duration_ms: number): void;
    /** Snapshot to Prometheus text exposition format. */
    render(): string;
}
