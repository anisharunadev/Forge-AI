/**
 * In-memory test doubles for the router ports.
 *
 * These are the only adapter the unit tests need. The production
 * adapters (Postgres, NATS, Paperclip HTTP, PagerDuty) are follow-up
 * sub-tasks; the algorithm under test is platform-independent.
 *
 * Conventions:
 *   - `InMemoryApprovalsRepo` enforces the same status transition
 *     guards as the Postgres adapter (monotonic status; soft-delete
 *     filter on every read).
 *   - `RecordingPaperclipClient` records every issued interaction so
 *     tests can assert on idempotencyKey, primitive, target, etc.
 *   - `RecordingEventBus` captures emitted events so tests can assert
 *     on the typed event vocabulary.
 *   - `RecordingPager` records paged approvals so tests can assert
 *     that the sweeper pages each pending approval exactly once.
 */
import { ApprovalAlreadyDecidedError, } from './ports.js';
/** Mutable wall-clock for tests. */
export class TestClock {
    current;
    constructor(start = new Date('2026-06-17T00:00:00.000Z')) {
        this.current = start;
    }
    now() {
        return new Date(this.current);
    }
    set(d) {
        this.current = d;
    }
    advance(ms) {
        this.current = new Date(this.current.getTime() + ms);
    }
}
export class InMemoryApprovalsRepo {
    rows = [];
    byId = new Map();
    nextSeq = 0;
    /**
     * Clock used to stamp `requested_at` on inserted rows. The router
     * passes `expiresAt = clock.now() + TTL`, so the difference between
     * the two stamps must equal the TTL tier exactly; using a real
     * `Date.now()` here would drift the difference by the time it
     * takes to insert. Tests inject `TestClock` so the math is exact.
     */
    clock;
    constructor(clock = { now: () => new Date() }) {
        this.clock = clock;
    }
    /** Test helper: pre-load a row (used to seed the sweeper). */
    seed(row) {
        const stored = { ...row, __seq: this.nextSeq++ };
        this.rows.push(stored);
        this.byId.set(stored.id, stored);
    }
    /** Test helper: read every row (filtered or not). */
    all() {
        return this.rows.filter((r) => r.deleted_at === null);
    }
    async insertPending(args) {
        const id = `appr-${++this.nextSeq}`;
        // Stamp requested_at from the clock (NOT `Date.now()`) so the
        // difference between `expires_at` and `requested_at` equals the
        // router's TTL tier exactly. A real `Date.now()` here drifts the
        // difference by the time it takes to insert.
        const row = {
            __seq: this.nextSeq,
            id,
            run_id: args.runId,
            tenant_id: args.tenantId,
            stage: args.stage,
            gate_kind: args.gateKind,
            required_role: args.requiredRole,
            status: 'pending',
            paperclip_interaction_id: null,
            artefact_refs: args.artefactRefs,
            reason: args.reason ?? null,
            requested_at: this.clock.now().toISOString(),
            decided_at: null,
            decided_by: null,
            decision: null,
            expires_at: args.expiresAt.toISOString(),
            paged_at_50_percent: false,
            superseded_interaction_id: null,
            deleted_at: null,
        };
        this.rows.push(row);
        this.byId.set(id, row);
        return row;
    }
    async markStageWaitingApproval(_args) {
        // No-op for the in-memory adapter; the stage status is owned by
        // `agent_run_stages` and the algorithm under test is the gate
        // router. A future sub-task that covers the stage engine will
        // wire the real adapter.
    }
    async findById(args) {
        const row = this.byId.get(args.approvalId);
        if (!row)
            return null;
        if (row.deleted_at !== null)
            return null;
        if (row.tenant_id !== args.tenantId)
            return null;
        return row;
    }
    async findPendingByStage(args) {
        const pending = this.rows.filter((r) => {
            return (r.run_id === args.runId &&
                r.stage === args.stage &&
                r.tenant_id === args.tenantId &&
                r.status === 'pending' &&
                r.deleted_at === null);
        });
        if (pending.length === 0)
            return null;
        // Return newest by seq
        return pending.sort((a, b) => b.__seq - a.__seq)[0] ?? null;
    }
    async applyDecision(args) {
        const row = this.byId.get(args.approvalId);
        if (!row || row.deleted_at !== null || row.tenant_id !== args.tenantId) {
            throw new Error(`applyDecision: approval ${args.approvalId} not found`);
        }
        if (row.status !== 'pending') {
            throw new ApprovalAlreadyDecidedError({
                code: 'APPROVAL_ALREADY_DECIDED',
                message: `approval ${args.approvalId} is already ${row.status}`,
                currentStatus: row.status,
            });
        }
        row.status = args.decision === 'accept' ? 'approved' : 'rejected';
        row.decided_at = new Date().toISOString();
        row.decided_by = args.decidedBy;
        row.decision = args.decision;
        row.reason = args.reason;
        return row;
    }
    async expire(args) {
        const row = this.byId.get(args.approvalId);
        if (!row || row.deleted_at !== null || row.tenant_id !== args.tenantId) {
            throw new Error(`expire: approval ${args.approvalId} not found`);
        }
        if (row.status !== 'pending') {
            // Monotonic: a row that was already decided (e.g. accept raced
            // with the sweeper) stays at its decided status. The expire
            // call is a no-op; the sweeper logs the race.
            return row;
        }
        row.status = 'expired';
        row.decided_at = args.expiredAt.toISOString();
        return row;
    }
    async extend(args) {
        const row = this.byId.get(args.approvalId);
        if (!row || row.deleted_at !== null || row.tenant_id !== args.tenantId) {
            throw new Error(`extend: approval ${args.approvalId} not found`);
        }
        if (row.status !== 'pending') {
            throw new Error(`extend: approval ${args.approvalId} is ${row.status}`);
        }
        row.expires_at = args.newExpiresAt.toISOString();
        row.paged_at_50_percent = false;
        return row;
    }
    async setInteractionId(args) {
        const row = this.byId.get(args.approvalId);
        if (!row || row.deleted_at !== null || row.tenant_id !== args.tenantId) {
            throw new Error(`setInteractionId: approval ${args.approvalId} not found`);
        }
        row.superseded_interaction_id = row.paperclip_interaction_id;
        row.paperclip_interaction_id = args.interactionId;
        return row;
    }
    async markPagedAt50Percent(args) {
        const row = this.byId.get(args.approvalId);
        if (!row || row.deleted_at !== null || row.tenant_id !== args.tenantId) {
            return;
        }
        row.paged_at_50_percent = true;
    }
    async listPendingForSweep(args) {
        const filtered = this.rows.filter((r) => {
            if (r.deleted_at !== null)
                return false;
            if (r.status !== 'pending')
                return false;
            if (args.tenantId && r.tenant_id !== args.tenantId)
                return false;
            return true;
        });
        return filtered.slice(0, args.limit);
    }
}
export class RecordingPaperclipClient {
    /** Every interaction issued, in order. */
    issued = [];
    /** Every re-issue, in order. */
    reissued = [];
    async issue(args) {
        // Same idempotency key → same interaction id (Paperclip behaviour).
        const existing = this.issued.find((i) => i.interaction.idempotencyKey === args.interaction.idempotencyKey);
        if (existing) {
            return { interactionId: existing.interactionId };
        }
        const interactionId = `pc-${this.issued.length + 1}-${args.interaction.idempotencyKey}`;
        this.issued.push({ ...args, interactionId });
        return { interactionId };
    }
    async reissue(args) {
        const interactionId = `pc-rev-${this.reissued.length + 1}-${args.interaction.idempotencyKey}`;
        this.reissued.push({ ...args, interactionId });
        return { interactionId };
    }
}
export class RecordingEventBus {
    events = [];
    async emit(event) {
        this.events.push(event);
    }
}
export class RecordingPager {
    paged = [];
    async pageApprover(args) {
        // Idempotent: same idempotencyKey returns the original page id.
        const existing = this.paged.find((p) => p.idempotencyKey === args.idempotencyKey);
        if (existing)
            return { pageId: existing.pageId };
        const pageId = `page-${this.paged.length + 1}`;
        this.paged.push({ ...args, pageId });
        return { pageId };
    }
}
//# sourceMappingURL=test-doubles.js.map