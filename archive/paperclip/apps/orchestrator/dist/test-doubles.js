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
import { ApprovalAlreadyDecidedError, InvalidStageTransitionError, } from './ports.js';
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
    /** Test helper: read every row including the monotonic `__seq`
     *  counter so tests can pick the latest row deterministically. */
    allWithSeq() {
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
    /**
     * Every emitted event — both router-owned `ApprovalEvent`s and
     * stage-engine-owned `RunLifecycleEvent`s. The orchestrator is
     * the only writer (architecture.md §2.1), so the bus is the audit
     * boundary; tests assert on the union to catch vocabulary drift
     * (e.g. the FORA-528 `gate_failed_cost_ceiling` variant).
     */
    events = [];
    async emit(event) {
        this.events.push(event);
    }
}
// ---------------------------------------------------------------------------
// InMemoryCostBudget — the CostBudget port test double for FORA-528
// ---------------------------------------------------------------------------
/**
 * Configurable in-memory `CostBudget` adapter for tests. The default
 * is `{ spentUsd: 0, ceilingUsd: 100 }` (under-budget, the v0.1
 * EnvCostBudget behaviour). Tests override `spentUsd` per tenant to
 * exercise the over-budget refusal path.
 *
 * The double records every query so a test can assert the wiring
 * called the port (vs. skipped the check).
 */
export class InMemoryCostBudget {
    /** Per-tenant spend + ceiling. Tests mutate this directly. */
    budgets = new Map();
    /** Every `currentSpendUsd` query, in order. */
    queries = [];
    constructor(defaultBudget = {
        spentUsd: 0,
        ceilingUsd: 100,
    }) {
        this.budgets.set('*', defaultBudget);
    }
    /** Test helper: set the per-tenant budget. */
    set(tenantId, budget) {
        this.budgets.set(tenantId, budget);
    }
    async currentSpendUsd(args) {
        this.queries.push({ tenantId: args.tenantId, at: new Date().toISOString() });
        return this.budgets.get(args.tenantId) ?? this.budgets.get('*') ?? { spentUsd: 0, ceilingUsd: 100 };
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
// ---------------------------------------------------------------------------
// InMemoryStageEngine — the StageEngine port test double for FORA-173
// ---------------------------------------------------------------------------
/**
 * Minimal in-memory implementation of `StageEngine`. The production
 * adapter is the gRPC client from ADR-0007 (FORA-135); this adapter
 * exists so the gate-wiring integration test can exercise the full
 * round-trip without a live engine.
 *
 * Invariants enforced:
 *   - Every (runId, toStage) advance is recorded once. A replay
 *     with the same `idempotencyKey` is a no-op (returns the
 *     previous current stage). A replay with a different `toStage`
 *     raises `InvalidStageTransitionError`.
 *   - reEnter is keyed by (runId, toStage) per ADR-0001 §2.3.
 *   - pauseRun is monotonic: a paused run stays paused until a new
 *     advance resumes it.
 *   - `fromStage` must match the run's current stage; a drift
 *     raises `InvalidStageTransitionError` (a stale event).
 */
export class InMemoryStageEngine {
    /** Per-run state, keyed by runId. */
    runs = new Map();
    /** Every advance call (for test assertions). */
    advances = [];
    /** Every reEnter call (for test assertions). */
    reEnters = [];
    /** Every pauseRun call (for test assertions). Mirrors the
     *  per-run `pauseHistory` map; flat for easy inspection. */
    pauseHistory = [];
    /** Test helper: seed a fresh run at a stage. */
    seed(args) {
        this.runs.set(args.runId, {
            tenantId: args.tenantId,
            currentStage: args.currentStage,
            status: 'running',
            lastAdvanceKey: null,
            reEntries: new Set(),
        });
    }
    /** Test helper: read the run header state. */
    state(runId) {
        const r = this.runs.get(runId);
        if (!r)
            return null;
        return { currentStage: r.currentStage, status: r.status };
    }
    getOrThrow(runId) {
        const r = this.runs.get(runId);
        if (!r) {
            throw new Error(`InMemoryStageEngine: unknown runId ${runId}`);
        }
        return r;
    }
    async advance(args) {
        const r = this.getOrThrow(args.runId);
        // Idempotent replay: same key + same target is a no-op.
        if (r.lastAdvanceKey === args.idempotencyKey) {
            return { currentStage: r.currentStage };
        }
        if (r.currentStage !== args.fromStage) {
            throw new InvalidStageTransitionError({
                code: 'INVALID_STAGE_TRANSITION',
                message: `advance: run ${args.runId} is at ${r.currentStage}, not ${args.fromStage}`,
                fromStage: args.fromStage,
                toStage: args.toStage,
            });
        }
        // Spine validation: `toStage` is either the next stage in order
        // or 'done' (the docs->done terminal advance).
        if (!this.isValidNextStage(r.currentStage, args.toStage)) {
            throw new InvalidStageTransitionError({
                code: 'INVALID_STAGE_TRANSITION',
                message: `advance: invalid transition ${r.currentStage} → ${args.toStage}`,
                fromStage: r.currentStage,
                toStage: args.toStage,
            });
        }
        r.currentStage = args.toStage;
        r.status = args.toStage === 'done' ? 'done' : 'running';
        r.lastAdvanceKey = args.idempotencyKey;
        this.advances.push({
            runId: args.runId,
            fromStage: args.fromStage,
            toStage: args.toStage,
            idempotencyKey: args.idempotencyKey,
            at: new Date().toISOString(),
        });
        return { currentStage: r.currentStage };
    }
    async reEnter(args) {
        const r = this.getOrThrow(args.runId);
        const key = `${args.runId}->${args.toStage}`;
        // Idempotent on (runId, toStage) per ADR-0001 §2.3.
        if (r.reEntries.has(key)) {
            return { currentStage: args.toStage };
        }
        if (r.currentStage !== args.fromStage) {
            throw new InvalidStageTransitionError({
                code: 'INVALID_STAGE_TRANSITION',
                message: `reEnter: run ${args.runId} is at ${r.currentStage}, not ${args.fromStage}`,
                fromStage: args.fromStage,
                toStage: args.toStage,
            });
        }
        r.currentStage = args.toStage;
        r.status = 'running';
        r.reEntries.add(key);
        this.reEnters.push({
            runId: args.runId,
            fromStage: args.fromStage,
            toStage: args.toStage,
            reason: args.reason,
            idempotencyKey: args.idempotencyKey,
            at: new Date().toISOString(),
        });
        return { currentStage: r.currentStage };
    }
    async pauseRun(args) {
        const r = this.getOrThrow(args.runId);
        if (r.status === 'done') {
            // A terminal run cannot be paused. The router should never
            // emit an approval_expired for a done run, but if it does
            // the engine silently no-ops.
            return;
        }
        r.status = 'paused';
        this.pauseHistory.push({
            runId: args.runId,
            approvalId: args.approvalId,
            at: new Date().toISOString(),
        });
    }
    isValidNextStage(from, to) {
        if (from === 'done')
            return false;
        const next = {
            ideation: 'architect',
            architect: 'dev',
            dev: 'qa',
            qa: 'security',
            security: 'devops',
            devops: 'docs',
            docs: 'done',
        };
        return next[from] === to;
    }
}
//# sourceMappingURL=test-doubles.js.map