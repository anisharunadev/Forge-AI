/**
 * Event producer — the Orchestrator's only writer to the bus.
 *
 * Per ADR-0006 §4.3 the producer is single-tenant and has publish-only NATS
 * credentials. Every publish:
 *   1. Validates the payload against the per-event schema (events.ts).
 *   2. Builds the per-tenant subject (subject.ts) and refuses cross-tenant writes.
 *   3. Publishes with a message header carrying the event_id for trace + dedupe.
 *
 * `publish` is the only public method. `flush` ensures the JetStream ack has
 * been received before returning — at-least-once delivery with synchronous
 * flush is the durability contract that lets the Orchestrator persist the row
 * to `agent_run_events` immediately after.
 */
import type { NatsConnection, JetStreamClient, JsMsg } from 'nats';
import type { EventType, TypedEvent } from './events.js';
/** Header carried on every message — broker-agnostic trace + dedupe hints. */
export interface ProducerMessageHeaders {
    readonly 'fora-tenant-id': string;
    readonly 'fora-run-id': string;
    readonly 'fora-event-type': EventType;
    readonly 'fora-event-id': string;
    readonly 'fora-event-version': string;
}
/** Options accepted by `publish`. */
export interface PublishOptions {
    /** Override the auto-generated event_id (only for replay / determinism). */
    readonly eventId?: string;
    /** Override `occurred_at` (only for replay / determinism). */
    readonly occurredAt?: string;
}
/**
 * The producer interface. Implemented by `NatsEventProducer`; tests substitute
 * an in-memory fake via `InMemoryEventProducer` (test only, not exported in
 * production index).
 */
export interface EventProducer {
    publish<T extends EventType>(eventType: T, payload: unknown, opts?: PublishOptions): Promise<TypedEvent<T>>;
    /** Block until all in-flight publishes have been acked. */
    flush(): Promise<void>;
    /** Idempotent close — releases NATS connection. */
    close(): Promise<void>;
}
/** Producer configuration. */
export interface NatsProducerConfig {
    /** Pre-opened NATS connection; the producer is single-tenant and shares the connection. */
    readonly nc: NatsConnection;
    /** Optional JetStream handle — when absent, publishes are fire-and-forget on the core NATS layer. */
    readonly js?: JetStreamClient;
    /** The single tenant_id this producer publishes for. Set once at construction. */
    readonly tenantId: string;
    /**
     * Stream name pattern. Defaults to `fora-<tenant_id>` per ADR-0006 §4.1.
     * Set explicitly only for tests.
     */
    readonly streamName?: string;
}
/**
 * The NATS-backed producer. Single-tenant by construction.
 *
 * Important: the bus is durable (NATS JetStream). When `js` is provided, the
 * producer uses `JetStream.publish` with an ack timeout; when it is absent,
 * the publish goes on core NATS and is not durable (useful for tests).
 */
export declare class NatsEventProducer implements EventProducer {
    private readonly cfg;
    private closed;
    constructor(cfg: NatsProducerConfig);
    publish<T extends EventType>(eventType: T, payload: unknown, opts?: PublishOptions): Promise<TypedEvent<T>>;
    flush(): Promise<void>;
    close(): Promise<void>;
}
/**
 * In-memory producer for tests. Captures every published envelope; `published`
 * returns them in order. Honors tenant isolation and validation; does not
 * require NATS.
 */
export declare class InMemoryEventProducer implements EventProducer {
    readonly tenantId: string;
    private closed;
    readonly published: Array<{
        subject: string;
        envelope: TypedEvent<EventType>;
    }>;
    constructor(tenantId: string);
    publish<T extends EventType>(eventType: T, payload: unknown, opts?: PublishOptions): Promise<TypedEvent<T>>;
    flush(): Promise<void>;
    close(): Promise<void>;
}
/** Helper used by tests: parse a published subject into parts. */
export declare function subjectMajorFromEnvelope(env: TypedEvent<EventType>): number;
/** Re-export for tests + downstream consumers. */
export type { JsMsg };
