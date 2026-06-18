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
import { StringCodec } from 'nats';
import { buildEnvelope, EVENT_SCHEMAS } from './events.js';
import { ClosedError, InvalidInputError, SchemaValidationError, TransportError } from './errors.js';
import { assertSubjectTenant, buildSubject } from './subject.js';
import { parseSemver } from './envelope.js';
const sc = StringCodec();
/**
 * The NATS-backed producer. Single-tenant by construction.
 *
 * Important: the bus is durable (NATS JetStream). When `js` is provided, the
 * producer uses `JetStream.publish` with an ack timeout; when it is absent,
 * the publish goes on core NATS and is not durable (useful for tests).
 */
export class NatsEventProducer {
    cfg;
    closed = false;
    constructor(cfg) {
        this.cfg = cfg;
        if (!cfg.nc)
            throw new InvalidInputError('nc (NatsConnection) is required');
        if (!cfg.tenantId)
            throw new InvalidInputError('tenantId is required');
    }
    async publish(eventType, payload, opts = {}) {
        if (this.closed)
            throw new ClosedError('producer');
        if (!eventType)
            throw new InvalidInputError('eventType is required');
        // 1. Validate payload against the per-event schema.
        const entry = EVENT_SCHEMAS[eventType];
        if (!entry)
            throw new InvalidInputError(`unknown event_type "${eventType}"`);
        let parsed;
        try {
            parsed = entry.payload.parse(payload);
        }
        catch (e) {
            if (e && typeof e === 'object' && 'issues' in e) {
                const issues = e.issues;
                throw new SchemaValidationError(eventType, issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
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
        const envelope = buildEnvelope({
            eventType,
            runId: parsed.run_id ?? '',
            tenantId: this.cfg.tenantId,
            stage: parsed.stage ?? null,
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
            }
            else {
                this.cfg.nc.publish(subject, sc.encode(JSON.stringify(envelope)));
            }
        }
        catch (e) {
            throw new TransportError(`failed to publish ${eventType} to ${subject}: ${e.message}`, e);
        }
        return envelope;
    }
    async flush() {
        if (this.closed)
            return;
        // JetStream publishes are durable by ack; we still flush the underlying
        // NATS connection so buffered core messages are not lost on shutdown.
        await this.cfg.nc.flush();
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        // The connection is owned by the caller; we do not close it here.
    }
}
/**
 * In-memory producer for tests. Captures every published envelope; `published`
 * returns them in order. Honors tenant isolation and validation; does not
 * require NATS.
 */
export class InMemoryEventProducer {
    tenantId;
    closed = false;
    published = [];
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId)
            throw new InvalidInputError('tenantId is required');
    }
    async publish(eventType, payload, opts = {}) {
        if (this.closed)
            throw new ClosedError('producer');
        const entry = EVENT_SCHEMAS[eventType];
        if (!entry)
            throw new InvalidInputError(`unknown event_type "${eventType}"`);
        let parsed;
        try {
            parsed = entry.payload.parse(payload);
        }
        catch (e) {
            if (e && typeof e === 'object' && 'issues' in e) {
                const issues = e.issues;
                throw new SchemaValidationError(eventType, issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
            }
            throw e;
        }
        const subject = buildSubject({
            tenantId: this.tenantId,
            eventType,
            major: entry.major,
        });
        assertSubjectTenant(subject, this.tenantId);
        const envelope = buildEnvelope({
            eventType,
            runId: parsed.run_id ?? '',
            tenantId: this.tenantId,
            stage: parsed.stage ?? null,
            actor: { type: 'agent', id: 'orchestrator' },
            eventId: opts.eventId ?? `evt-${randomUUID()}`,
            ...(opts.occurredAt !== undefined ? { occurredAt: opts.occurredAt } : {}),
            payload: parsed,
        });
        this.published.push({ subject, envelope: envelope });
        return envelope;
    }
    async flush() {
        /* no-op */
    }
    async close() {
        this.closed = true;
    }
}
/** Helper used by tests: parse a published subject into parts. */
export function subjectMajorFromEnvelope(env) {
    return parseSemver(env.v).major;
}
//# sourceMappingURL=producer.js.map