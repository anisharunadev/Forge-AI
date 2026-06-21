/**
 * Type contracts for the Master Orchestrator (FORA-50 §2 / §3 / §4).
 *
 * Invariants:
 *   - IDs are branded so a TenantId cannot be assigned to a RunId by
 *     accident — same convention as `@fora/agent-runtime/src/types.ts`.
 *   - TypedError is a discriminated union; the HTTP layer maps the
 *     `code` field onto the JSON error envelope in FORA-50 §4.1.
 *   - All states/stages are string-literal unions matching the CHECK
 *     constraints installed by migrations/0002_*.
 */
declare const brand: unique symbol;
type Brand<T, B extends string> = T & {
    readonly [brand]: B;
};
export type RunId = Brand<string, 'RunId'>;
export type TenantId = Brand<string, 'TenantId'>;
export type GoalId = Brand<string, 'GoalId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;
/** Opaque cast helpers for boundaries that mint IDs (handlers, tests). */
export declare const asRunId: (s: string) => RunId;
export declare const asTenantId: (s: string) => TenantId;
export declare const asGoalId: (s: string) => GoalId;
export declare const asProjectId: (s: string) => ProjectId;
export declare const asIdempotencyKey: (s: string) => IdempotencyKey;
/**
 * The seven canonical stages from FORA-50 §3.2. `done` is not a stage
 * column value on agent_run_stages (it lives only on agent_runs as the
 * `current_stage` terminal state per the §2.2 state machine).
 */
export type Stage = 'ideation' | 'architect' | 'dev' | 'qa' | 'security' | 'devops' | 'docs';
/** The seven stages in order. */
export declare const STAGES_IN_ORDER: ReadonlyArray<Stage>;
/** Run status (FORA-50 §2.2). `done` is the terminal happy-path state. */
export type RunStatus = 'created' | 'running' | 'waiting_approval' | 'paused' | 'aborted' | 'finished' | 'done';
/** Stage status (FORA-50 §3.2). */
export type StageStatus = 'pending' | 'running' | 'waiting_approval' | 'approved' | 'rejected' | 'returned' | 'skipped';
/**
 * The lifecycle verbs the Orchestrator exposes. `cancel` is idempotent
 * on retry; the state machine rejects verbs that are not valid for the
 * current status (see state-machine.ts).
 */
export type LifecycleVerb = 'pause' | 'resume' | 'cancel';
/**
 * Typed error codes for the JSON error envelope. Stable; clients
 * pattern-match on `code`. The HTTP status is mapped in server.ts.
 *
 * Note: a cross-tenant read or write (caller's tenant claim does not
 * match the row's tenant_id) is intentionally mapped to 404 NOT_FOUND,
 * not to a dedicated `TENANT_MISMATCH` code. Returning a different
 * status code for a foreign-tenant row would leak the existence of
 * the row to a caller who should not know it exists (ADR-0003 §4.2).
 */
export type OrchestratorErrorCode = 'NOT_FOUND' | 'INVALID_TRANSITION' | 'IDEMPOTENCY_CONFLICT' | 'VALIDATION' | 'INTERNAL';
export interface OrchestratorError {
    code: OrchestratorErrorCode;
    message: string;
    request_id: string;
}
/** Run header — the persisted shape of an `agent_runs` row. */
export interface RunRecord {
    id: RunId;
    tenant_id: TenantId;
    goal_id: GoalId;
    project_id: ProjectId;
    status: RunStatus;
    current_stage: Stage | 'done';
    triggered_by: TriggerPayload;
    cost_ceiling_usd: string;
    cost_spent_usd: string;
    started_at: string | null;
    finished_at: string | null;
    deleted_at: string | null;
    archived_at: string | null;
}
/** Stage row — the persisted shape of an `agent_run_stages` row. */
export interface StageRecord {
    id: string;
    run_id: RunId;
    stage: Stage;
    status: StageStatus;
    decision: StageDecision | null;
    started_at: string | null;
    finished_at: string | null;
}
/** `triggered_by` shape — `{type, actor, payload_ref}` per FORA-50 §3.1. */
export interface TriggerPayload {
    type: 'manual' | 'slack' | 'email' | 'schedule' | 'api';
    actor: string;
    payload_ref?: string;
}
/** `decision` shape — `{by, at, reason, artefact_refs[]}` per FORA-50 §3.2. */
export interface StageDecision {
    by: string;
    at: string;
    reason?: string;
    artefact_refs?: ReadonlyArray<{
        kind: string;
        url: string;
        sha256?: string;
    }>;
}
/**
 * `createRun` request body. Tenant id is taken from the verified JWT
 * (broker claim) per ADR-0003 §4.2, not from the body; the body
 * declares only goal + project + trigger metadata.
 */
export interface CreateRunRequest {
    goal_id: GoalId;
    project_id: ProjectId;
    triggered_by: TriggerPayload;
    /** Optional ceiling override. Falls back to $100/run default. */
    cost_ceiling_usd?: string;
}
/**
 * Idempotency record stored on `agent_run_idempotency_keys`. The
 * `request_fingerprint` is a SHA-256 of the canonical request body; a
 * replay with the same key but different fingerprint returns
 * `IDEMPOTENCY_CONFLICT` per architecture.md §7.
 */
export interface IdempotencyRecord {
    key: IdempotencyKey;
    tenant_id: TenantId;
    run_id: RunId | null;
    request_fingerprint: string;
    response_status: number;
    response_body: unknown;
    created_at: string;
}
/**
 * Helper for the small subset of errors we throw internally. The HTTP
 * layer maps each code to the right RFC 7807-style envelope and HTTP
 * status.
 */
export declare function makeOrchestratorError(code: OrchestratorErrorCode, message: string, request_id: string): OrchestratorError;
export {};
