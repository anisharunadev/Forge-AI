/**
 * Types shared between the router, ports, sweeper, and tests.
 *
 * Lives in its own module so `ports.ts` (which `router.ts` imports)
 * and `router.ts` (which `sweeper.ts` imports) do not form a cycle.
 */
import type { Stage } from './types.js';
import type { GateKind, PaperclipPrimitive, RoleOfRecord } from './gates.js';
export type { GateKind, PaperclipPrimitive, RoleOfRecord };
/** Approval lifecycle status. Matches the `agent_run_approvals.status`
 *  CHECK constraint in migration 0002 (FORA-50 §3.4). */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
/**
 * The decision recorded by the human. Per ADR-0008 §4 step 8 the
 * router handles three outcomes:
 *
 *   - `accept`: advance the run per the gate rule.
 *   - `reject`: pause the run, emit `stage_rejected`.
 *   - `request_changes`: the "return" primitive — send the stage back
 *     to a prior owner. Reuses the same routing as a rejection.
 *
 * The `return` primitive is encoded as a decision with a non-null
 * `returnTo` field; the router maps `decision === 'request_changes'`
 * + `returnTo != null` onto the `stage_returned` event.
 */
export type Decision = 'accept' | 'reject' | 'request_changes';
/** Where the "send it back" primitive should land. */
export interface ReturnTarget {
    toStage: Stage;
    /** The role that owns the receiving gate. */
    requiredRole: RoleOfRecord;
}
/**
 * The Paperclip interaction shape the router issues. Mirrors the
 * wire-format in `POST /api/issues/{id}/interactions` (per
 * Paperclip's interaction API). The router passes this to the
 * `PaperclipClient.issue` port; the implementation marshals to
 * JSON.
 */
export interface PaperclipInteraction {
    kind: 'request_confirmation' | 'request_board_approval';
    /**
     * Idempotency key per ADR-0008 §4 step 3:
     *   `approval:{run_id}:{stage}` — the per-stage primitive.
     * The stale-target recovery (§5) appends `:rev{N}` where N is the
     * new plan revision number.
     */
    idempotencyKey: string;
    /** The Paperclip issue id that owns the gate's run. */
    targetIssueId: string;
    /** Target document binding (per ADR-0008 §5). */
    target: {
        type: 'issue_document';
        issueId: string;
        key: 'plan';
        revisionId: string;
    };
    /** Wake semantics. `wake_assignee` for per-stage, `wake_assignee_on_accept` for board. */
    continuationPolicy: 'wake_assignee' | 'wake_assignee_on_accept';
    /** Human-readable question + artefact refs. */
    payload: {
        title: string;
        prompt: string;
        role: RoleOfRecord;
        artefactRefs: ReadonlyArray<{
            kind: string;
            url: string;
            sha256?: string;
        }>;
        ttlSeconds: number;
    };
}
/**
 * The persisted approval row. Mirrors the FORA-50 §3.4 table; the
 * Postgres adapter (`apps/orchestrator/migrations/0002_*`) maps to
 * the row directly.
 */
export interface ApprovalRecord {
    id: string;
    run_id: string;
    tenant_id: string;
    stage: Stage | null;
    gate_kind: GateKind;
    required_role: RoleOfRecord;
    status: ApprovalStatus;
    paperclip_interaction_id: string | null;
    artefact_refs: ReadonlyArray<{
        kind: string;
        url: string;
        sha256?: string;
    }>;
    reason: string | null;
    requested_at: string;
    decided_at: string | null;
    decided_by: {
        actor: string;
        role: RoleOfRecord | 'board';
    } | null;
    decision: Decision | null;
    expires_at: string;
    paged_at_50_percent: boolean;
    /** Set when a stale-target recovery re-issued the interaction. */
    superseded_interaction_id: string | null;
    deleted_at: string | null;
}
/**
 * Helper: derive the gate from the persisted record. Pure; used by
 * the sweeper and tests to look up TTL + continuation policy without
 * a second query.
 */
export declare function gateOf(record: ApprovalRecord): GateKind;
/** Helper: true iff the interaction primitive for `kind` matches `p`. */
export declare function primitiveMatches(kind: GateKind, p: PaperclipPrimitive): boolean;
