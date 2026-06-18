/**
 * NATS adapter for the orchestrator's `EventBus` port (FORA-170).
 *
 * Implements the four-event slice the gate router owns:
 *   - approval_requested
 *   - approval_decided
 *   - approval_expired
 *   - stage_returned
 *
 * Per ADR-0006 §3.1 every publish goes to the per-tenant subject
 *
 *     fora.events.<tenant_id>.<event_type>.v1
 *
 * The orchestrator serves many tenants from one process, so this
 * adapter owns a NATS connection shared across tenants and lazily mints
 * one `NatsEventProducer` per tenant it sees. The producer is the
 * substrate-level writer from `@fora/event-bus` (FORA-136); this module
 * is the thin glue that maps the orchestrator's `ApprovalEvent` union
 * onto the substrate's typed-event payloads.
 *
 * The adapter is the *only* writer of approval events. Per architecture.md §2.1
 * the Orchestrator is the only writer of run state; the bus mirrors those
 * writes for downstream consumers (audit, cost, memory, Forge console,
 * customer webhooks).
 *
 * Failure modes are the substrate's:
 *   - NATS down       → publish throws `TransportError`; the router's
 *                       call site surfaces it to the HTTP edge (the run
 *                       row is already persisted, so a retry replays the
 *                       event with the same `event_id` and the consumer
 *                       dedupes — ADR-0006 §5.2 + FORA-50 spec §5.2).
 *   - Cross-tenant    → refused in-process by `assertSubjectTenant`
 *                       before the broker sees it.
 *   - Schema drift    → refused by the per-event Zod schema at publish.
 */
import { NatsEventProducer, } from '@fora/event-bus';
export async function openNatsConnection(url) {
    // Lazy-import so unit tests that substitute the producer factory
    // never touch the `nats` package's connect path.
    const { connect, StringCodec } = await import('nats');
    void StringCodec;
    const nc = await connect({ servers: url });
    // The JetStream handle is optional; when the cluster has JetStream
    // enabled, we publish through it for durability (msgID-based dedupe
    // per ADR-0006 §4.1). When JS is absent the producer falls back to
    // core NATS publish — fire-and-forget, useful for dev.
    let js;
    try {
        js = nc.jetstream();
    }
    catch {
        js = undefined;
    }
    return {
        nc,
        js,
        close: async () => {
            await nc.drain();
        },
    };
}
/**
 * Build a producer factory bound to a shared NATS connection bundle.
 * Use this in production via `connectNatsApprovalEventBus`.
 */
export function natsProducerFactoryFor(bundle) {
    return (tenantId) => {
        const cfg = {
            nc: bundle.nc,
            ...(bundle.js ? { js: bundle.js } : {}),
            tenantId,
        };
        return new NatsEventProducer(cfg);
    };
}
/**
 * Connect the adapter against a live NATS cluster. Returns the adapter
 * and the connection bundle so the caller owns the shutdown path.
 *
 *   const { bus, bundle } = await connectNatsApprovalEventBus({
 *     url: process.env.FORA_NATS_URL!,
 *   });
 *   // ... wire into the router ...
 *   await bundle.close();  // graceful drain on shutdown
 */
export async function connectNatsApprovalEventBus(args) {
    const bundle = await openNatsConnection(args.url);
    const bus = new NatsApprovalEventBus({
        producerFactory: natsProducerFactoryFor(bundle),
        ...(args.log ? { log: args.log } : {}),
    });
    return { bus, bundle };
}
/**
 * The adapter. Implements the orchestrator's `EventBus` port by
 * mapping the four-event `ApprovalEvent` union onto the substrate's
 * typed-event payloads.
 *
 * Tenant isolation: every `emit` resolves the producer for the event's
 * `tenantId`. The substrate enforces the in-process tenant guard
 * (`assertSubjectTenant`) before each publish, and the broker enforces
 * the per-tenant subject ACL — see ADR-0006 §3.1 + §4.3.
 */
export class NatsApprovalEventBus {
    opts;
    producers = new Map();
    closed = false;
    log;
    constructor(opts) {
        this.opts = opts;
        this.log = opts.log ?? (() => { });
    }
    async emit(event) {
        if (this.closed) {
            throw new Error('NatsApprovalEventBus: emit after close');
        }
        const tenantId = eventTenantId(event);
        const producer = this.producerFor(tenantId);
        const { eventType, payload } = project(event);
        await producer.publish(eventType, payload);
    }
    /**
     * Drain the per-tenant producers and close the adapter. Does NOT
     * close the underlying NATS connection — the caller owns that via
     * the `bundle` returned from `connectNatsApprovalEventBus`.
     */
    async disconnect() {
        if (this.closed)
            return;
        this.closed = true;
        const errors = [];
        for (const [tenant, producer] of this.producers) {
            try {
                await producer.flush();
                await producer.close();
            }
            catch (e) {
                errors.push(e);
                this.log('error', `NatsApprovalEventBus: failed to close producer for ${tenant}: ${String(e)}`);
            }
        }
        if (errors.length > 0) {
            throw new Error(`NatsApprovalEventBus: ${errors.length} producer(s) failed to close`);
        }
    }
    /**
     * Test seam — number of producers currently held. Useful to assert
     * that the adapter mints a producer per tenant on first publish and
     * reuses it on subsequent publishes.
     */
    get producerCount() {
        return this.producers.size;
    }
    producerFor(tenantId) {
        let p = this.producers.get(tenantId);
        if (!p) {
            p = this.opts.producerFactory(tenantId);
            this.producers.set(tenantId, p);
        }
        return p;
    }
}
/**
 * Extract the tenant id from any ApprovalEvent variant. The discriminated
 * union guarantees `tenantId` is present on every variant — keeping it
 * there (added in FORA-170) means the adapter never has to reach back
 * into the repo to discover the tenant.
 */
function eventTenantId(event) {
    // ApprovalEvent is a discriminated union; every variant carries tenantId.
    return event.tenantId;
}
/**
 * Project an `ApprovalEvent` onto the substrate's `(eventType, payload)`
 * pair. The substrate validates the payload against the per-event Zod
 * schema (`EVENT_SCHEMAS[eventType]`), so the projection is the
 * single source of truth for what lands on the wire.
 *
 * Mappings:
 *
 *   approval_requested → @fora/event-bus.ApprovalRequestedPayload
 *     orchestrator ApprovalEvent.approval_requested carries:
 *       stage, gateKind, requiredRole, approvalId, interactionId,
 *       expiresAt, artefactRefs
 *     bus payload is the canonical ApprovalRequestedPayload
 *     (stage nullable for the launch gate, approval_id / gate_kind /
 *      interaction_id added in FORA-170).
 *
 *   approval_decided → @fora/event-bus.ApprovalDecidedPayload
 *     orchestrator decision ∈ {accept, reject, request_changes};
 *     the bus decision ∈ {approved, rejected} (accept→approved,
 *     reject→rejected; request_changes is not a decision on this
 *     event — the router emits `stage_returned` instead).
 *
 *   approval_expired → @fora/event-bus.ApprovalExpiredPayload
 *     orchestrator carries runId + approvalId + expiredAt.
 *
 *   stage_returned → @fora/event-bus.StageReturnedPayload
 *     orchestrator carries approvalId (added in FORA-170 so consumers
 *     can correlate with the approval row).
 */
function project(event) {
    switch (event.type) {
        case 'approval_requested': {
            return {
                eventType: 'approval_requested',
                payload: {
                    run_id: event.runId,
                    stage: event.stage,
                    required_role: event.requiredRole,
                    expires_at: event.expiresAt,
                    artefact_refs: event.artefactRefs.map((r) => ({
                        kind: r.kind,
                        url: r.url,
                        sha256: r.sha256 ?? null,
                    })),
                    approval_id: event.approvalId,
                    gate_kind: event.gateKind,
                    interaction_id: event.interactionId,
                },
            };
        }
        case 'approval_decided': {
            const decision = event.decision === 'accept' ? 'approved' : 'rejected';
            return {
                eventType: 'approval_decided',
                payload: {
                    run_id: event.runId,
                    approval_id: event.approvalId,
                    decision,
                    decided_by: event.decidedBy,
                    decided_at: event.decidedAt,
                },
            };
        }
        case 'approval_expired': {
            return {
                eventType: 'approval_expired',
                payload: {
                    run_id: event.runId,
                    approval_id: event.approvalId,
                    expired_at: event.expiredAt,
                },
            };
        }
        case 'stage_returned': {
            return {
                eventType: 'stage_returned',
                payload: {
                    run_id: event.runId,
                    from_stage: event.fromStage,
                    to_stage: event.toStage,
                    reason: event.reason,
                    returned_by: event.returnedBy,
                    approval_id: event.approvalId,
                },
            };
        }
    }
}
//# sourceMappingURL=event-bus-nats.js.map