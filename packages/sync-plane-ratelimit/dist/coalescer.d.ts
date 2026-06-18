/**
 * Composite-edit coalescer — N consecutive outbound edits within a
 * W-second window collapse to a single composite edit.
 *
 * Implements FORA-256 §"Scope" / AC #3 and ADR-0010 §8.2 R-SYNC-03
 * (comment storm DoS). When two human commenters, three CI bots, and
 * a sync reconciliation all try to update the same Jira issue in
 * quick succession, the downstream platform should see ONE composite
 * edit, not six.
 *
 * The coalescer is keyed by
 *   `${tenant_id}|${platform}|${remote_issue_id}|${edit_kind}`
 * so different edit kinds (comment vs. status change) are NOT merged —
 * the audit trail must distinguish them.
 *
 * `W` is configurable per the platform adapter; the default is 30s.
 * `now()` is injectable so the smoke test can compress seconds to ms.
 *
 * The coalescer is pure data + timer logic. No network. The actual
 * `platformCall` is injected by the caller (see `outbound.ts`).
 */
export type PlatformId = 'jira' | 'github' | 'clickup';
export type EditKind = 'comment' | 'status' | 'assignee' | 'field';
export interface OutboundEdit {
    readonly event_id: string;
    readonly tenant_id: string;
    readonly platform: PlatformId;
    readonly remote_issue_id: string;
    readonly edit_kind: EditKind;
    readonly body: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly enqueued_at_ms: number;
}
export interface CoalesceConfig {
    /** Coalesce window in ms. Edits within W of the first collapse. */
    readonly window_ms: number;
    /** `now()` injection for tests. */
    readonly now?: () => number;
    /** Caller-supplied flush function. */
    readonly flush: (merged: CompositeEdit) => Promise<CoalesceFlushResult>;
}
export interface CompositeEdit {
    readonly key: string;
    readonly tenant_id: string;
    readonly platform: PlatformId;
    readonly remote_issue_id: string;
    readonly edit_kind: EditKind;
    /** Number of source edits that were merged into this composite. */
    readonly source_count: number;
    /** Original event ids in arrival order. */
    readonly source_event_ids: readonly string[];
    /** Merged body. */
    readonly body: string;
    /** Window the first and last edits fell in (ms). */
    readonly window_first_ms: number;
    readonly window_last_ms: number;
}
export interface CoalesceFlushResult {
    /** True if the platform accepted the composite edit. */
    readonly ok: boolean;
    /** HTTP-style status, or 'coalesced_queued' if the adapter buffered. */
    readonly status: number | string;
    /** Per-source event results, in the same order as `source_event_ids`. */
    readonly per_event?: ReadonlyArray<{
        event_id: string;
        ok: boolean;
    }>;
}
export declare class Coalescer {
    private readonly buffers;
    private readonly window_ms;
    private readonly now;
    private readonly flush;
    /** Stats for the audit / smoke. */
    private stats;
    constructor(cfg: CoalesceConfig);
    /**
     * Enqueue an outbound edit. Returns immediately with
     * `coalesced: true` if the edit was appended to a pending composite,
     * or `coalesced: false` if it is the first of a new composite
     * (which will be flushed after W).
     */
    enqueue(edit: OutboundEdit): {
        coalesced: boolean;
        key: string;
    };
    /**
     * Flush a specific key immediately. Returns the composite (whether
     * or not the platform call succeeded). Test / shutdown seam.
     */
    flushKey(key: string): Promise<CompositeEdit | null>;
    /**
     * Force-flush all pending buffers. Returns the number of composites
     * that were emitted. Test / shutdown seam.
     */
    drain(): Promise<number>;
    /** Read-only stats (for audit / smoke). */
    getStats(): {
        enqueued: number;
        coalesced_into: number;
        flushed: number;
    };
    /** Number of pending buffers (test seam). */
    pendingCount(): number;
    private scheduleFlush;
    private doFlush;
    private keyOf;
}
