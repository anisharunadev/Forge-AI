/**
 * Unit tests for the NATS adapter (FORA-170).
 *
 * Covers the acceptance bar:
 *   - All four approval events are published on the corresponding state
 *     changes; a unit test asserts every (state-change → event) pair.
 *   - Per-tenant subject isolation: a publish for tenant A is not
 *     visible to a consumer subscribed to tenant B (verified via the
 *     subject scheme the adapter emits).
 *
 * Uses a multi-tenant in-memory fake producer (`MultiTenantFakeProducer`)
 * so the test exercises the adapter's tenant-routing logic without
 * touching a live broker. The integration test in
 * `event-bus-nats.live.test.ts` covers the broker-backed path.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEventProducer, buildSubject, } from '@fora/event-bus';
import { NatsApprovalEventBus, natsProducerFactoryFor, } from './event-bus-nats.js';
import { asRunId, asTenantId } from '../types.js';
const TENANT_A = 'tnt_acme';
const TENANT_B = 'tnt_globex';
const RUN = 'run-1234';
const A = asTenantId(TENANT_A);
const B = asTenantId(TENANT_B);
const R = asRunId(RUN);
/**
 * A multi-tenant fake producer. `InMemoryEventProducer` is single-tenant
 * by construction; this wrapper holds one producer per tenant and routes
 * the publish. It records the (tenant, subject, envelope) tuple so tests
 * can assert per-tenant isolation end-to-end.
 */
class MultiTenantFakeProducer {
    perTenant = new Map();
    publishes = [];
    factory = (tenantId) => {
        let p = this.perTenant.get(tenantId);
        if (!p) {
            p = new InMemoryEventProducer(tenantId);
            this.perTenant.set(tenantId, p);
        }
        const wrap = {
            publish: async (eventType, payload, opts) => {
                const env = await p.publish(eventType, payload, opts);
                this.publishes.push({ tenantId, subject: env && '' /* unused */, envelope: env });
                // Read the subject off the in-memory producer's tail entry —
                // `published` is the canonical record.
                const last = p.published[p.published.length - 1];
                if (last) {
                    this.publishes[this.publishes.length - 1].subject = last.subject;
                }
                return env;
            },
            flush: () => p.flush(),
            close: () => p.close(),
        };
        return wrap;
    };
    /** All envelopes ever published, flattened across tenants. */
    all() {
        return this.publishes;
    }
    /** Envelopes for a single tenant, in publish order. */
    forTenant(tenantId) {
        return this.publishes
            .filter((p) => p.tenantId === tenantId)
            .map((p) => ({ subject: p.subject, envelope: p.envelope }));
    }
}
function buildBus(opts = {}) {
    const fake = new MultiTenantFakeProducer();
    const bus = new NatsApprovalEventBus({
        producerFactory: opts.producerFactory ?? fake.factory,
        ...(opts.log ? { log: opts.log } : {}),
    });
    return { bus, fake };
}
// ---- Fixtures ------------------------------------------------------------
const baseCtx = {
    runId: R,
    approvalId: 'apr-1',
    interactionId: 'pc-1',
    expiresAt: '2026-06-17T01:00:00.000Z',
    artefactRefs: [{ kind: 'pr', url: 'https://github.com/fora/repo/pull/42' }],
};
const samples = {
    approvalRequested: {
        type: 'approval_requested',
        tenantId: A,
        runId: baseCtx.runId,
        stage: 'dev',
        gateKind: 'dev->qa',
        requiredRole: 'qa',
        approvalId: baseCtx.approvalId,
        interactionId: baseCtx.interactionId,
        expiresAt: baseCtx.expiresAt,
        artefactRefs: baseCtx.artefactRefs,
    },
    approvalDecidedAccept: {
        type: 'approval_decided',
        tenantId: A,
        runId: baseCtx.runId,
        approvalId: baseCtx.approvalId,
        decision: 'accept',
        decidedBy: 'user:qa-lead',
        decidedAt: '2026-06-17T00:30:00.000Z',
    },
    approvalDecidedReject: {
        type: 'approval_decided',
        tenantId: A,
        runId: baseCtx.runId,
        approvalId: baseCtx.approvalId,
        decision: 'reject',
        decidedBy: 'user:cto',
        decidedAt: '2026-06-17T00:30:00.000Z',
    },
    approvalExpired: {
        type: 'approval_expired',
        tenantId: A,
        runId: baseCtx.runId,
        approvalId: baseCtx.approvalId,
        expiredAt: '2026-06-17T01:00:01.000Z',
    },
    stageReturned: {
        type: 'stage_returned',
        tenantId: A,
        runId: baseCtx.runId,
        approvalId: baseCtx.approvalId,
        fromStage: 'dev',
        toStage: 'architect',
        reason: 'ADR missing',
        returnedBy: 'user:cto',
    },
};
// ---- Tests ---------------------------------------------------------------
describe('NatsApprovalEventBus — projection + subject scheme (FORA-170 acceptance #1)', () => {
    let bus;
    let fake;
    beforeEach(() => {
        ({ bus, fake } = buildBus());
    });
    it('approval_requested → subject fora.events.<tenant>.<event>.v1 + payload shape', async () => {
        await bus.emit(samples.approvalRequested);
        const all = fake.all();
        expect(all).toHaveLength(1);
        const { subject, envelope } = all[0];
        expect(subject).toBe(`fora.events.${TENANT_A}.approval_requested.v1`);
        expect(envelope.event_type).toBe('approval_requested');
        expect(envelope.tenant_id).toBe(TENANT_A);
        expect(envelope.run_id).toBe(RUN);
        expect(envelope.payload).toMatchObject({
            run_id: RUN,
            stage: 'dev',
            required_role: 'qa',
            expires_at: baseCtx.expiresAt,
            artefact_refs: [
                { kind: 'pr', url: 'https://github.com/fora/repo/pull/42', sha256: null },
            ],
            approval_id: baseCtx.approvalId,
            gate_kind: 'dev->qa',
            interaction_id: baseCtx.interactionId,
        });
    });
    it('approval_decided with orchestrator `accept` maps to bus `approved`', async () => {
        await bus.emit(samples.approvalDecidedAccept);
        const all = fake.all();
        expect(all).toHaveLength(1);
        const { envelope } = all[0];
        expect(envelope.event_type).toBe('approval_decided');
        expect(envelope.payload).toMatchObject({
            decision: 'approved',
            approval_id: baseCtx.approvalId,
            decided_by: 'user:qa-lead',
            decided_at: '2026-06-17T00:30:00.000Z',
        });
    });
    it('approval_decided with orchestrator `reject` maps to bus `rejected`', async () => {
        await bus.emit(samples.approvalDecidedReject);
        const { envelope } = fake.all()[0];
        expect(envelope.payload).toMatchObject({ decision: 'rejected' });
    });
    it('approval_expired → subject + payload', async () => {
        await bus.emit(samples.approvalExpired);
        const { subject, envelope } = fake.all()[0];
        expect(subject).toBe(`fora.events.${TENANT_A}.approval_expired.v1`);
        expect(envelope.event_type).toBe('approval_expired');
        expect(envelope.payload).toMatchObject({
            approval_id: baseCtx.approvalId,
            expired_at: '2026-06-17T01:00:01.000Z',
        });
    });
    it('stage_returned → subject + payload (with approval_id)', async () => {
        await bus.emit(samples.stageReturned);
        const { subject, envelope } = fake.all()[0];
        expect(subject).toBe(`fora.events.${TENANT_A}.stage_returned.v1`);
        expect(envelope.event_type).toBe('stage_returned');
        expect(envelope.payload).toMatchObject({
            from_stage: 'dev',
            to_stage: 'architect',
            reason: 'ADR missing',
            returned_by: 'user:cto',
            approval_id: baseCtx.approvalId,
        });
    });
    it('every (state-change → event) pair in the FORA-170 acceptance bar is covered', async () => {
        // Drives each of the four adapter inputs in sequence and asserts
        // that the published envelope + subject + payload are well-formed.
        // This is the unit-test counterpart of FORA-170 acceptance #1.
        const cases = [
            {
                event: samples.approvalRequested,
                expectType: 'approval_requested',
                expectSubject: buildSubject({
                    tenantId: TENANT_A,
                    eventType: 'approval_requested',
                    major: 1,
                }),
            },
            {
                event: samples.approvalDecidedAccept,
                expectType: 'approval_decided',
                expectSubject: buildSubject({ tenantId: TENANT_A, eventType: 'approval_decided', major: 1 }),
            },
            {
                event: samples.approvalExpired,
                expectType: 'approval_expired',
                expectSubject: buildSubject({ tenantId: TENANT_A, eventType: 'approval_expired', major: 1 }),
            },
            {
                event: samples.stageReturned,
                expectType: 'stage_returned',
                expectSubject: buildSubject({ tenantId: TENANT_A, eventType: 'stage_returned', major: 1 }),
            },
        ];
        for (const c of cases) {
            await bus.emit(c.event);
            const last = fake.all().at(-1);
            expect(last.subject, `${c.event.type} subject`).toBe(c.expectSubject);
            expect(last.envelope.event_type, `${c.event.type} event_type`).toBe(c.expectType);
            expect(last.envelope.tenant_id, `${c.event.type} tenant_id`).toBe(TENANT_A);
            expect(last.envelope.run_id, `${c.event.type} run_id`).toBe(RUN);
        }
        expect(fake.all()).toHaveLength(4);
    });
});
describe('NatsApprovalEventBus — per-tenant subject isolation (FORA-170 acceptance #3)', () => {
    let bus;
    let fake;
    beforeEach(() => {
        ({ bus, fake } = buildBus());
    });
    it('publishes for tenant A land on fora.events.<A>.> only', async () => {
        await bus.emit({ ...samples.approvalRequested, tenantId: A });
        const all = fake.all();
        expect(all).toHaveLength(1);
        expect(all[0].subject).toMatch(/^fora\.events\.tnt_acme\./);
        expect(all[0].subject).not.toMatch(/tnt_globex/);
        expect(all[0].envelope.tenant_id).toBe(TENANT_A);
    });
    it('a tenant-A publish is not visible to a tenant-B subscriber (subject scheme separation)', async () => {
        // Adapter publishes for tenant A and tenant B.
        await bus.emit({ ...samples.approvalRequested, tenantId: A });
        await bus.emit({ ...samples.approvalRequested, tenantId: B });
        const aOnly = fake.forTenant(TENANT_A);
        const bOnly = fake.forTenant(TENANT_B);
        expect(aOnly).toHaveLength(1);
        expect(bOnly).toHaveLength(1);
        // The subjects are disjoint: tenant-A consumer (subscribed to
        // fora.events.tnt_acme.>) does not see tenant-B publishes, and
        // vice versa. This is the in-process dual of the broker ACL.
        expect(aOnly[0].subject).toBe(`fora.events.${TENANT_A}.approval_requested.v1`);
        expect(bOnly[0].subject).toBe(`fora.events.${TENANT_B}.approval_requested.v1`);
        expect(aOnly[0].envelope.tenant_id).toBe(TENANT_A);
        expect(bOnly[0].envelope.tenant_id).toBe(TENANT_B);
    });
    it('reuses a single producer per tenant across multiple publishes', async () => {
        await bus.emit({ ...samples.approvalRequested, tenantId: A });
        await bus.emit({ ...samples.approvalDecidedAccept, tenantId: A });
        expect(bus.producerCount).toBe(1);
        await bus.emit({ ...samples.approvalRequested, tenantId: B });
        expect(bus.producerCount).toBe(2);
        await bus.emit({ ...samples.approvalDecidedReject, tenantId: B });
        expect(bus.producerCount).toBe(2);
        // The fake's per-tenant producers carry the envelope history.
        const aProducer = fake.perTenant.get(TENANT_A);
        const bProducer = fake.perTenant.get(TENANT_B);
        expect(aProducer.published).toHaveLength(2);
        expect(bProducer.published).toHaveLength(2);
    });
    it('a launch-gate approval_requested publishes with stage=null (per FORA-50 §6.1)', async () => {
        await bus.emit({
            ...samples.approvalRequested,
            stage: null,
            gateKind: 'launch',
            requiredRole: 'board',
        });
        const { subject, envelope } = fake.all()[0];
        expect(subject).toBe(`fora.events.${TENANT_A}.approval_requested.v1`);
        expect(envelope.payload).toMatchObject({ stage: null, gate_kind: 'launch' });
    });
});
describe('NatsApprovalEventBus — at-least-once + idempotency (FORA-170 acceptance #2)', () => {
    let bus;
    let fake;
    beforeEach(() => {
        ({ bus, fake } = buildBus());
    });
    it('each publish produces a unique event_id (broker dedupe boundary)', async () => {
        await bus.emit({ ...samples.approvalRequested, tenantId: A });
        await bus.emit({ ...samples.approvalRequested, tenantId: A });
        const all = fake.all();
        expect(all).toHaveLength(2);
        expect(all[0].envelope.event_id).not.toBe(all[1].envelope.event_id);
    });
    it('the event envelope carries ADR-0006 §3.2 fields (v, event_id, tenant_id, run_id, stage, occurred_at, actor)', async () => {
        await bus.emit({ ...samples.approvalRequested, tenantId: A });
        const { envelope } = fake.all()[0];
        expect(envelope.v).toBe('1.0.0');
        expect(envelope.event_id).toMatch(/^evt-/);
        expect(envelope.tenant_id).toBe(TENANT_A);
        expect(envelope.run_id).toBe(RUN);
        expect(envelope.stage).toBe('dev');
        expect(typeof envelope.occurred_at).toBe('string');
        expect(envelope.actor).toEqual({ type: 'agent', id: 'orchestrator' });
    });
});
describe('NatsApprovalEventBus — lifecycle', () => {
    let bus;
    let fake;
    beforeEach(() => {
        ({ bus, fake } = buildBus());
    });
    it('disconnect flushes every per-tenant producer and is idempotent', async () => {
        await bus.emit({ ...samples.approvalRequested, tenantId: A });
        await bus.emit({ ...samples.approvalRequested, tenantId: B });
        expect(bus.producerCount).toBe(2);
        await bus.disconnect();
        // A second disconnect is a no-op.
        await bus.disconnect();
        // The in-memory producers are closed; further publishes throw.
        await expect(bus.emit({ ...samples.approvalRequested, tenantId: A })).rejects.toThrow(/after close/i);
    });
    it('forwards factory errors so the router sees the substrate failure', async () => {
        const boom = new NatsApprovalEventBus({
            producerFactory: () => {
                throw new Error('factory exploded');
            },
        });
        await expect(boom.emit(samples.approvalRequested)).rejects.toThrow(/factory exploded/);
    });
});
// Sanity check: the production factory helper builds a producer-bound
// adapter against the substrate. This is a thin glue test — the
// integration test (`.live.test.ts`) covers the live broker path.
describe('natsProducerFactoryFor — substrate wiring', () => {
    it('returns a function that mints a producer scoped to a tenant', () => {
        const fakeNc = {
            // Minimal stub — `NatsEventProducer` does not call any of these
            // methods synchronously, so a no-op stub suffices for the type
            // check. The live integration test exercises the real client.
            publish: () => undefined,
            jetstream: () => undefined,
            flush: () => Promise.resolve(),
            drain: () => Promise.resolve(),
        };
        const factory = natsProducerFactoryFor({
            nc: fakeNc,
            close: async () => { },
        });
        const a = factory(TENANT_A);
        const b = factory(TENANT_A); // same tenant → independent instance
        expect(a).not.toBe(b);
        expect(typeof a.publish).toBe('function');
        expect(typeof b.publish).toBe('function');
    });
});
//# sourceMappingURL=event-bus-nats.test.js.map