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

import { randomUUID } from 'node:crypto';
import type { NatsConnection, JetStreamClient, JsMsg } from 'nats';
import { StringCodec } from 'nats';
import type { EventType, TypedEvent } from './events.js';
import { buildEnvelope, EVENT_SCHEMAS } from './events.js';
import { ClosedError, InvalidInputError, SchemaValidationError, TransportError } from './errors.js';
import { assertSubjectTenant, buildSubject } from './subject.js';
import { parseSemver } from './envelope.js';

const sc = StringCodec();

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
  publish<T extends EventType>(
    eventType: T,
    payload: unknown,
    opts?: PublishOptions,
  ): Promise<TypedEvent<T>>;

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
export class NatsEventProducer implements EventProducer {
  private closed = false;

  constructor(private readonly cfg: NatsProducerConfig) {
    if (!cfg.nc) throw new InvalidInputError('nc (NatsConnection) is required');
    if (!cfg.tenantId) throw new InvalidInputError('tenantId is required');
  }

  async publish<T extends EventType>(
    eventType: T,
    payload: unknown,
    opts: PublishOptions = {},
  ): Promise<TypedEvent<T>> {
    if (this.closed) throw new ClosedError('producer');
    if (!eventType) throw new InvalidInputError('eventType is required');

    // 1. Validate payload against the per-event schema.
    const entry = EVENT_SCHEMAS[eventType];
    if (!entry) throw new InvalidInputError(`unknown event_type "${eventType}"`);
    let parsed: unknown;
    try {
      parsed = entry.payload.parse(payload);
    } catch (e) {
      if (e && typeof e === 'object' && 'issues' in e) {
        const issues = (e as { issues: ReadonlyArray<{ path: (string | number)[]; message: string }> }).issues;
        throw new SchemaValidationError(
          eventType,
          issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      throw e;
    }

    // 2. Build the per-tenant subject and enforce the in-process tenant guard.
    const subject = buildSubject({
      tenantId: this.cfg.tenantId,
      eventType,
      major: entry.major,
    });
    assertSubjectTenant(subject, this.cfg.tenantId);

    // 3. Build the typed envelope.
    const envelope = buildEnvelope<T>({
      eventType,
      runId: ((parsed as { run_id?: unknown }).run_id as string | undefined) ?? '',
      tenantId: this.cfg.tenantId,
      stage: ((parsed as { stage?: unknown }).stage as TypedEvent<T>['stage']) ?? null,
      actor: { type: 'agent', id: 'orchestrator' },
      eventId: opts.eventId ?? `evt-${randomUUID()}`,
      ...(opts.occurredAt !== undefined ? { occurredAt: opts.occurredAt } : {}),
      payload: parsed,
    });

    // 4. Publish — durability when JetStream is configured, fire-and-forget otherwise.
    //    Headers carry trace + dedupe hints; not part of the wire-format invariant.
    try {
      if (this.cfg.js) {
        await this.cfg.js.publish(subject, sc.encode(JSON.stringify(envelope)), {
          msgID: envelope.event_id,
        });
      } else {
        this.cfg.nc.publish(subject, sc.encode(JSON.stringify(envelope)));
      }
    } catch (e) {
      throw new TransportError(
        `failed to publish ${eventType} to ${subject}: ${(e as Error).message}`,
        e,
      );
    }

    return envelope;
  }

  async flush(): Promise<void> {
    if (this.closed) return;
    // JetStream publishes are durable by ack; we still flush the underlying
    // NATS connection so buffered core messages are not lost on shutdown.
    await this.cfg.nc.flush();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // The connection is owned by the caller; we do not close it here.
  }
}

/**
 * In-memory producer for tests. Captures every published envelope; `published`
 * returns them in order. Honors tenant isolation and validation; does not
 * require NATS.
 */
export class InMemoryEventProducer implements EventProducer {
  private closed = false;
  public readonly published: Array<{ subject: string; envelope: TypedEvent<EventType> }> = [];

  constructor(public readonly tenantId: string) {
    if (!tenantId) throw new InvalidInputError('tenantId is required');
  }

  async publish<T extends EventType>(
    eventType: T,
    payload: unknown,
    opts: PublishOptions = {},
  ): Promise<TypedEvent<T>> {
    if (this.closed) throw new ClosedError('producer');
    const entry = EVENT_SCHEMAS[eventType];
    if (!entry) throw new InvalidInputError(`unknown event_type "${eventType}"`);
    let parsed: unknown;
    try {
      parsed = entry.payload.parse(payload);
    } catch (e) {
      if (e && typeof e === 'object' && 'issues' in e) {
        const issues = (e as { issues: ReadonlyArray<{ path: (string | number)[]; message: string }> }).issues;
        throw new SchemaValidationError(
          eventType,
          issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      throw e;
    }

    const subject = buildSubject({
      tenantId: this.tenantId,
      eventType,
      major: entry.major,
    });
    assertSubjectTenant(subject, this.tenantId);

    const envelope = buildEnvelope<T>({
      eventType,
      runId: ((parsed as { run_id?: unknown }).run_id as string | undefined) ?? '',
      tenantId: this.tenantId,
      stage: ((parsed as { stage?: unknown }).stage as TypedEvent<T>['stage']) ?? null,
      actor: { type: 'agent', id: 'orchestrator' },
      eventId: opts.eventId ?? `evt-${randomUUID()}`,
      ...(opts.occurredAt !== undefined ? { occurredAt: opts.occurredAt } : {}),
      payload: parsed,
    });
    this.published.push({ subject, envelope: envelope as TypedEvent<EventType> });
    return envelope;
  }

  async flush(): Promise<void> {
    /* no-op */
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

/** Helper used by tests: parse a published subject into parts. */
export function subjectMajorFromEnvelope(env: TypedEvent<EventType>): number {
  return parseSemver(env.v).major;
}

/** Re-export for tests + downstream consumers. */
export type { JsMsg };
