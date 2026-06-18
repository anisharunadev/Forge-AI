/**
 * Typed orchestrator errors.
 *
 * Per FORA-50 §4.1 the public REST surface returns
 * `{ "error": { "code": "INVALID_TRANSITION", "message": "...", "request_id": "..." } }`.
 * The internal gRPC seam (ADR-0007) maps the same codes to typed
 * `INVALID_ARGUMENT` / `FAILED_PRECONDITION` responses; this module is the
 * shape the gRPC adapter consumes.
 *
 * The error codes are stable; messages are not.
 */
import type { Decision, OrchestratorError, OrchestratorErrorCode, Stage } from './types.js';
import type { StageTarget } from './stage-table.js';
export declare class InvalidTransitionError extends Error {
    readonly code: OrchestratorErrorCode;
    readonly typed: OrchestratorError;
    constructor(args: {
        readonly from: Stage;
        readonly to: StageTarget;
        readonly decisionKind: Decision['kind'];
        readonly reason: string;
        readonly requestId?: string;
    });
}
export declare class StageMismatchError extends Error {
    readonly code: OrchestratorErrorCode;
    readonly typed: OrchestratorError;
    constructor(args: {
        readonly expected: Stage;
        readonly got: Stage;
        readonly requestId?: string;
    });
}
export declare class RunNotFoundError extends Error {
    readonly code: OrchestratorErrorCode;
    readonly typed: OrchestratorError;
    constructor(args: {
        readonly runId: string;
        readonly requestId?: string;
    });
}
export declare class RunNotRunningError extends Error {
    readonly code: OrchestratorErrorCode;
    readonly typed: OrchestratorError;
    constructor(args: {
        readonly runId: string;
        readonly status: string;
        readonly requestId?: string;
    });
}
export declare class InvalidDecisionError extends Error {
    readonly code: OrchestratorErrorCode;
    readonly typed: OrchestratorError;
    constructor(args: {
        readonly reason: string;
        readonly requestId?: string;
    });
}
export declare class ReturnToInvalidStageError extends Error {
    readonly code: OrchestratorErrorCode;
    readonly typed: OrchestratorError;
    constructor(args: {
        readonly from: Stage;
        readonly to: Stage;
        readonly requestId?: string;
    });
}
/** Type-guard helper for the gRPC adapter to map errors → status codes. */
export declare function isOrchestratorError(e: unknown): e is InvalidTransitionError | StageMismatchError | RunNotFoundError | RunNotRunningError | InvalidDecisionError | ReturnToInvalidStageError;
