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
import { type ApprovalsRepo, type Clock, type EventBus, type Pager, type PaperclipClient } from './ports.js';
import type { ApprovalEvent } from './ports.js';
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
    events: ApprovalEvent[];
    emit(event: ApprovalEvent): Promise<void>;
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
