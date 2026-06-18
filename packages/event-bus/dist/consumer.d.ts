/**
 * Event consumer — durable subscribers on the bus.
 *
 * Per ADR-0006 §4.2: Audit, Cost, Memory each register a durable consumer per
 * tenant. The consumer:
 *   1. Subscribes to a per-tenant subject glob; the broker refuses subjects
 *      that cross the consumer's tenant ACL.
 *   2. Parses the envelope against the per-event schema.
 *   3. Enforces the consumer's max-major-version: a v2 event arriving at a
 *      v1 consumer is logged and skipped (the v1 subject continues to be
 *      served per the 30-day deprecation window).
 *   4. Dedupes by event_id via a pluggable store (in-memory by default;
 *      Audit uses Postgres, Cost uses Redis).
 *   5. Rate-limits via a token-bucket (consumer-side backpressure).
 *   6. Acks only after the handler returns; on handler throw, the message is
 *      nacked and JetStream will redeliver (event_id dedupe makes a redelivery
 *      a no-op).
 *
 * The contract — per FORA-50 spec §5.2 — is: consumer-side rate limit +
 * producer at-least-once + consumer-side dedupe.
 */
import type { EventType, TypedEvent } from './events.js';
import { type Stage } from './envelope.js';
/** A handler receives a parsed, validated, deduplicated envelope. */
export type EventHandler<T extends EventType = EventType> = (env: TypedEvent<T>, ctx: {
    subject: string;
    redelivered: boolean;
}) => Promise<void> | void;
/**
 * Dedupe store contract. Implementations:
 *   - `InMemoryDedupeStore` (default; this process only)
 *   - Postgres-backed dedupe for the Audit writer
 *   - Redis-backed dedupe for Cost / Memory
 *
 * The store must be safe under at-least-once redelivery: `tryMark` returns
 * true the first time and false on every subsequent call with the same key.
 */
export interface DedupeStore {
    tryMark(eventId: string): Promise<boolean>;
    /** Test-only: clear all state. */
    reset?(): Promise<void>;
}
/** Default in-memory dedupe store. Sufficient for single-process consumers. */
export declare class InMemoryDedupeStore implements DedupeStore {
    private readonly seen;
    tryMark(eventId: string): Promise<boolean>;
    reset(): Promise<void>;
}
/** Token-bucket rate limiter (consumer-side backpressure). */
export interface RateLimiter {
    /** Returns true if a token is available and consumes one. */
    tryAcquire(): boolean;
    /** Block until a token is available, then consume one. */
    acquire(): Promise<void>;
}
/** Default token-bucket: `capacity` tokens, refilled at `tokensPerSecond`. */
export declare class TokenBucketRateLimiter implements RateLimiter {
    readonly capacity: number;
    readonly tokensPerSecond: number;
    private tokens;
    private lastRefill;
    constructor(capacity: number, tokensPerSecond: number);
    private refill;
    tryAcquire(): boolean;
    acquire(): Promise<void>;
}
/** Handler registry — one handler per event_type a consumer cares about. */
export type HandlerRegistry = {
    readonly [T in EventType]?: EventHandler<T>;
};
/** Result of processing a single message — exposed for tests + metrics. */
export interface ProcessOutcome {
    readonly status: 'processed' | 'deduplicated' | 'unsupported_version' | 'validation_failed' | 'rate_limited';
    readonly subject: string;
    readonly event_id?: string;
    readonly event_type?: EventType;
    readonly error?: Error;
}
/** The consumer interface. */
export interface EventConsumer {
    /** Register a handler for one event_type. Replaces any prior handler. */
    on<T extends EventType>(eventType: T, handler: EventHandler<T>): void;
    /** Start consuming — pulls from JetStream (or core NATS in tests). */
    start(): Promise<void>;
    /** Stop pulling new messages; flush in-flight. */
    stop(): Promise<void>;
    /** Process a single raw message — exposed for tests + the replay bridge. */
    processRaw(raw: Uint8Array | string, meta: {
        subject: string;
        redelivered?: boolean;
    }): Promise<ProcessOutcome>;
}
/** Consumer configuration. */
export interface NatsConsumerConfig {
    readonly tenantId: string;
    readonly durableName: string;
    /** Max major schema version the consumer supports. Defaults to 1. */
    readonly maxMajorVersion?: number;
    /** Per-tenant stream name. Defaults to `fora-<tenant_id>`. */
    readonly streamName?: string;
    /** Reject events outside the consumer's tenant — defaults to true. */
    readonly enforceTenantAcl?: boolean;
    /** The NATS subscription callback. Wired by `NatsEventConsumer.start`. */
    readonly onMessage: (handler: (raw: Uint8Array, subject: string, redelivered: boolean) => Promise<void>) => Promise<void>;
    /** Hook used by `start`/`stop` to manage the underlying subscription lifecycle. */
    readonly onStop?: () => Promise<void>;
    /** Dedupe store; defaults to in-memory. */
    readonly dedupe?: DedupeStore;
    /** Rate limiter; defaults to 100 rps, burst 200. */
    readonly rateLimiter?: RateLimiter;
    /**
     * Optional logger for unsupported versions and validation failures.
     * In production this is stdout-JSON via @fora/observability (not in this package).
     */
    readonly onError?: (outcome: ProcessOutcome) => void;
}
/**
 * Free function version of `processRaw` — used by the SQS+SNS bridge and
 * integration tests that need to drive the consumer pipeline without holding
 * a long-lived subscription.
 */
export declare function processOneEvent(raw: Uint8Array | string, meta: {
    subject: string;
    redelivered?: boolean;
}, cfg: ProcessOneEventConfig): Promise<ProcessOutcome>;
/** Configuration accepted by `processOneEvent`. */
export type ProcessOneEventConfig = Omit<NatsConsumerConfig, 'onMessage' | 'onStop'>;
/**
 * The NATS-backed consumer. Generic enough to be wrapped by either the
 * JetStream pull consumer or the lower-level core NATS subscriber — the
 * consumer logic is the same; the binding is in `onMessage` / `onStop`.
 */
export declare class NatsEventConsumer implements EventConsumer {
    private readonly cfg;
    private readonly handlers;
    private readonly maxMajor;
    private readonly enforceTenantAcl;
    private readonly dedupe;
    private readonly rateLimiter;
    private readonly onError;
    private stopped;
    private started;
    constructor(cfg: NatsConsumerConfig);
    on<T extends EventType>(eventType: T, handler: EventHandler<T>): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    processRaw(raw: Uint8Array | string, meta: {
        subject: string;
        redelivered?: boolean;
    }): Promise<ProcessOutcome>;
}
/**
 * Build the consumer's per-tenant subject glob. Exported for the bridge
 * service + tests.
 */
export declare function consumerSubjectFor(tenantId: string): string;
/** Re-export so the test harness can construct a Stage from a payload. */
export type { Stage };
