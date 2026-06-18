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
export class InvalidTransitionError extends Error {
    code = 'INVALID_TRANSITION';
    typed;
    constructor(args) {
        super(`${args.from} → ${args.to} is not a valid "${args.decisionKind}" transition (${args.reason})`);
        this.name = 'InvalidTransitionError';
        this.typed = {
            code: 'INVALID_TRANSITION',
            message: this.message,
            ...(args.requestId !== undefined ? { requestId: args.requestId } : {}),
        };
    }
}
export class StageMismatchError extends Error {
    code = 'STAGE_MISMATCH';
    typed;
    constructor(args) {
        super(`fromStage=${args.expected} does not match run.currentStage=${args.got}`);
        this.name = 'StageMismatchError';
        this.typed = {
            code: 'STAGE_MISMATCH',
            message: this.message,
            ...(args.requestId !== undefined ? { requestId: args.requestId } : {}),
        };
    }
}
export class RunNotFoundError extends Error {
    code = 'RUN_NOT_FOUND';
    typed;
    constructor(args) {
        super(`run ${args.runId} not found (or soft-deleted)`);
        this.name = 'RunNotFoundError';
        this.typed = {
            code: 'RUN_NOT_FOUND',
            message: this.message,
            ...(args.requestId !== undefined ? { requestId: args.requestId } : {}),
        };
    }
}
export class RunNotRunningError extends Error {
    code = 'RUN_NOT_RUNNING';
    typed;
    constructor(args) {
        super(`run ${args.runId} is in status "${args.status}"; AdvanceStage requires running/waiting_approval`);
        this.name = 'RunNotRunningError';
        this.typed = {
            code: 'RUN_NOT_RUNNING',
            message: this.message,
            ...(args.requestId !== undefined ? { requestId: args.requestId } : {}),
        };
    }
}
export class InvalidDecisionError extends Error {
    code = 'INVALID_DECISION';
    typed;
    constructor(args) {
        super(`decision is invalid: ${args.reason}`);
        this.name = 'InvalidDecisionError';
        this.typed = {
            code: 'INVALID_DECISION',
            message: this.message,
            ...(args.requestId !== undefined ? { requestId: args.requestId } : {}),
        };
    }
}
export class ReturnToInvalidStageError extends Error {
    code = 'RETURN_TO_INVALID_STAGE';
    typed;
    constructor(args) {
        super(`return target "${args.to}" is not a prior stage of "${args.from}"`);
        this.name = 'ReturnToInvalidStageError';
        this.typed = {
            code: 'RETURN_TO_INVALID_STAGE',
            message: this.message,
            ...(args.requestId !== undefined ? { requestId: args.requestId } : {}),
        };
    }
}
/** Type-guard helper for the gRPC adapter to map errors → status codes. */
export function isOrchestratorError(e) {
    return (e instanceof InvalidTransitionError ||
        e instanceof StageMismatchError ||
        e instanceof RunNotFoundError ||
        e instanceof RunNotRunningError ||
        e instanceof InvalidDecisionError ||
        e instanceof ReturnToInvalidStageError);
}
//# sourceMappingURL=errors.js.map