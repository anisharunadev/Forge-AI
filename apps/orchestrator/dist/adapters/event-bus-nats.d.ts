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
import { EventProducer } from '@fora/event-bus';
import type { EventBus, ApprovalEvent } from '../ports.js';
import type { TenantId } from '../types.js';
/** Configuration for the adapter factory. */
export interface NatsApprovalEventBusOptions {
    /**
     * The per-tenant producer factory. The default uses `NatsEventProducer`
     * from `@fora/event-bus`; tests substitute an in-memory fake so the
     * adapter can be exercised without a live broker.
     *
     * The factory receives the tenant id and returns an `EventProducer`
     * scoped to that tenant. The adapter calls `producer.publish` with the
     * matching event_type — the subject scheme `fora.events.<tenant_id>.>`
     * is the per-tenant isolation boundary.
     */
    readonly producerFactory: (tenantId: string) => EventProducer;
    /**
     * Optional logger. Defaults to a no-op so the adapter is silent in
     * production; tests use a recording logger to assert error paths.
     */
    readonly log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}
/**
 * Production factory: opens a NATS connection once, mints a producer per
 * tenant from the shared connection. The connection is owned by the
 * caller — the adapter does not close it on `disconnect`.
 *
 * `FORA_NATS_URL` is the connection string (e.g. `nats://nats:4222`).
 * The JetStream manager is shared across tenants.
 */
export interface NatsConnectionBundle {
    readonly nc: import('nats').NatsConnection;
    readonly js?: import('nats').JetStreamClient | undefined;
    readonly close: () => Promise<void>;
}
export declare function openNatsConnection(url: string): Promise<NatsConnectionBundle>;
/**
 * Build a producer factory bound to a shared NATS connection bundle.
 * Use this in production via `connectNatsApprovalEventBus`.
 */
export declare function natsProducerFactoryFor(bundle: NatsConnectionBundle): (tenantId: string) => EventProducer;
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
export declare function connectNatsApprovalEventBus(args: {
    url: string;
    log?: NatsApprovalEventBusOptions['log'];
}): Promise<{
    bus: NatsApprovalEventBus;
    bundle: NatsConnectionBundle;
}>;
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
export declare class NatsApprovalEventBus implements EventBus {
    private readonly opts;
    private readonly producers;
    private closed;
    private readonly log;
    constructor(opts: NatsApprovalEventBusOptions);
    emit(event: ApprovalEvent): Promise<void>;
    /**
     * Drain the per-tenant producers and close the adapter. Does NOT
     * close the underlying NATS connection — the caller owns that via
     * the `bundle` returned from `connectNatsApprovalEventBus`.
     */
    disconnect(): Promise<void>;
    /**
     * Test seam — number of producers currently held. Useful to assert
     * that the adapter mints a producer per tenant on first publish and
     * reuses it on subsequent publishes.
     */
    get producerCount(): number;
    private producerFor;
}
/**
 * Re-export the typed TenantId as a cast target so callers do not
 * need to import `types.js` separately when wiring this adapter.
 */
export type { TenantId };
