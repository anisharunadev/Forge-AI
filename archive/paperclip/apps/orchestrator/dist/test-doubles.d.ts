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
import { type ApprovalsRepo, type Clock, type CostBudget, type EventBus, type Pager, type PaperclipClient, type StageEngine } from './ports.js';
import type { ApprovalEvent, RunLifecycleEvent } from './ports.js';
import type { ApprovalRecord, ApprovalStatus, PaperclipInteraction } from './router-types.js';
import type { IdempotencyKey, RunId, TenantId } from './types.js';
/** Mutable wall-clock for tests. */
export declare class TestClock implements Clock {
    private current;
    constructor(start?: Date);
    now(): Date;
    set(d: Date): void;
    advance(ms: number): void;
}
/** Public read-only view of the row's seq (for test ordering). */
export interface StoredApprovalView extends ApprovalRecord {
    __seq: number;
}
export declare class InMemoryApprovalsRepo implements ApprovalsRepo {
    private rows;
    private byId;
    private nextSeq;
    /**
     * Clock used to stamp `requested_at` on inserted rows. The router
     * passes `expiresAt = clock.now() + TTL`, so the difference between
     * the two stamps must equal the TTL tier exactly; using a real
     * `Date.now()` here would drift the difference by the time it
     * takes to insert. Tests inject `TestClock` so the math is exact.
     */
    private readonly clock;
    constructor(clock?: Clock);
    /** Test helper: pre-load a row (used to seed the sweeper). */
    seed(row: ApprovalRecord): void;
    /** Test helper: read every row (filtered or not). */
    all(): ReadonlyArray<ApprovalRecord>;
    /** Test helper: read every row including the monotonic `__seq`
     *  counter so tests can pick the latest row deterministically. */
    allWithSeq(): ReadonlyArray<StoredApprovalView>;
    insertPending(args: {
        runId: RunId;
        tenantId: TenantId;
        stage: import('./types.js').Stage | null;
        gateKind: import('./gates.js').GateKind;
        requiredRole: import('./gates.js').RoleOfRecord;
        expiresAt: Date;
        artefactRefs: ReadonlyArray<{
            kind: string;
            url: string;
            sha256?: string;
        }>;
        reason?: string;
    }): Promise<ApprovalRecord>;
    markStageWaitingApproval(_args: {
        runId: RunId;
        stage: import('./types.js').Stage;
    }): Promise<void>;
    findById(args: {
        approvalId: string;
        tenantId: TenantId;
    }): Promise<ApprovalRecord | null>;
    findPendingByStage(args: {
        runId: RunId;
        stage: import('./types.js').Stage;
        tenantId: TenantId;
    }): Promise<ApprovalRecord | null>;
    applyDecision(args: {
        approvalId: string;
        tenantId: TenantId;
        decision: 'accept' | 'reject' | 'request_changes';
        decidedBy: {
            actor: string;
            role: import('./gates.js').RoleOfRecord | 'board';
        };
        reason: string;
    }): Promise<ApprovalRecord>;
    expire(args: {
        approvalId: string;
        tenantId: TenantId;
        expiredAt: Date;
    }): Promise<ApprovalRecord>;
    extend(args: {
        approvalId: string;
        tenantId: TenantId;
        newExpiresAt: Date;
        extendedBy: string;
    }): Promise<ApprovalRecord>;
    setInteractionId(args: {
        approvalId: string;
        tenantId: TenantId;
        interactionId: string;
    }): Promise<ApprovalRecord>;
    markPagedAt50Percent(args: {
        approvalId: string;
        tenantId: TenantId;
    }): Promise<void>;
    listPendingForSweep(args: {
        tenantId?: TenantId;
        asOf: Date;
        limit: number;
    }): Promise<ReadonlyArray<ApprovalRecord>>;
}
export declare class RecordingPaperclipClient implements PaperclipClient {
    /** Every interaction issued, in order. */
    issued: Array<{
        issueId: string;
        interaction: PaperclipInteraction;
        interactionId: string;
    }>;
    /** Every re-issue, in order. */
    reissued: Array<{
        issueId: string;
        interaction: PaperclipInteraction;
        interactionId: string;
        supersededInteractionId: string;
    }>;
    issue(args: {
        issueId: string;
        interaction: PaperclipInteraction;
    }): Promise<{
        interactionId: string;
    }>;
    reissue(args: {
        issueId: string;
        interaction: PaperclipInteraction;
        supersededInteractionId: string;
    }): Promise<{
        interactionId: string;
    }>;
}
export declare class RecordingEventBus implements EventBus {
    /**
     * Every emitted event — both router-owned `ApprovalEvent`s and
     * stage-engine-owned `RunLifecycleEvent`s. The orchestrator is
     * the only writer (architecture.md §2.1), so the bus is the audit
     * boundary; tests assert on the union to catch vocabulary drift
     * (e.g. the FORA-528 `gate_failed_cost_ceiling` variant).
     */
    events: Array<ApprovalEvent | RunLifecycleEvent>;
    emit(event: ApprovalEvent | RunLifecycleEvent): Promise<void>;
}
/**
 * Configurable in-memory `CostBudget` adapter for tests. The default
 * is `{ spentUsd: 0, ceilingUsd: 100 }` (under-budget, the v0.1
 * EnvCostBudget behaviour). Tests override `spentUsd` per tenant to
 * exercise the over-budget refusal path.
 *
 * The double records every query so a test can assert the wiring
 * called the port (vs. skipped the check).
 */
export declare class InMemoryCostBudget implements CostBudget {
    /** Per-tenant spend + ceiling. Tests mutate this directly. */
    budgets: Map<string, {
        spentUsd: number;
        ceilingUsd: number;
    }>;
    /** Every `currentSpendUsd` query, in order. */
    queries: Array<{
        tenantId: string;
        at: string;
    }>;
    constructor(defaultBudget?: {
        spentUsd: number;
        ceilingUsd: number;
    });
    /** Test helper: set the per-tenant budget. */
    set(tenantId: string, budget: {
        spentUsd: number;
        ceilingUsd: number;
    }): void;
    currentSpendUsd(args: {
        tenantId: import('./types.js').TenantId;
    }): Promise<{
        spentUsd: number;
        ceilingUsd: number;
    }>;
}
export declare class RecordingPager implements Pager {
    paged: Array<{
        approvalId: string;
        runId: RunId;
        role: import('./gates.js').RoleOfRecord;
        reason: 'ttl_50_percent' | 'ttl_100_percent_expired';
        idempotencyKey: IdempotencyKey;
        pageId: string;
    }>;
    pageApprover(args: {
        approvalId: string;
        runId: RunId;
        role: import('./gates.js').RoleOfRecord;
        reason: 'ttl_50_percent' | 'ttl_100_percent_expired';
        idempotencyKey: IdempotencyKey;
    }): Promise<{
        pageId: string;
    }>;
}
export type { ApprovalStatus };
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
export declare class InMemoryStageEngine implements StageEngine {
    /** Per-run state, keyed by runId. */
    private runs;
    /** Every advance call (for test assertions). */
    advances: Array<{
        runId: string;
        fromStage: import('./types.js').Stage;
        toStage: import('./types.js').Stage | 'done';
        idempotencyKey: string;
        at: string;
    }>;
    /** Every reEnter call (for test assertions). */
    reEnters: Array<{
        runId: string;
        fromStage: import('./types.js').Stage;
        toStage: import('./types.js').Stage;
        reason: string;
        idempotencyKey: string;
        at: string;
    }>;
    /** Every pauseRun call (for test assertions). Mirrors the
     *  per-run `pauseHistory` map; flat for easy inspection. */
    pauseHistory: Array<{
        runId: string;
        approvalId: string;
        at: string;
    }>;
    /** Test helper: seed a fresh run at a stage. */
    seed(args: {
        tenantId: import('./types.js').TenantId;
        runId: import('./types.js').RunId;
        currentStage: import('./types.js').Stage;
    }): void;
    /** Test helper: read the run header state. */
    state(runId: import('./types.js').RunId): {
        currentStage: import('./types.js').Stage | 'done';
        status: 'running' | 'paused' | 'done';
    } | null;
    private getOrThrow;
    advance(args: {
        tenantId: import('./types.js').TenantId;
        runId: import('./types.js').RunId;
        fromStage: import('./types.js').Stage;
        toStage: import('./types.js').Stage | 'done';
        idempotencyKey: string;
    }): Promise<{
        currentStage: import('./types.js').Stage | 'done';
    }>;
    reEnter(args: {
        tenantId: import('./types.js').TenantId;
        runId: import('./types.js').RunId;
        fromStage: import('./types.js').Stage;
        toStage: import('./types.js').Stage;
        reason: string;
        idempotencyKey: string;
    }): Promise<{
        currentStage: import('./types.js').Stage;
    }>;
    pauseRun(args: {
        tenantId: import('./types.js').TenantId;
        runId: import('./types.js').RunId;
        approvalId: string;
    }): Promise<void>;
    private isValidNextStage;
}
