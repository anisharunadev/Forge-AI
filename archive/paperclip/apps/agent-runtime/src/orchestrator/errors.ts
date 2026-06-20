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

import type {
  Decision,
  OrchestratorError,
  OrchestratorErrorCode,
  Stage,
} from './types.js';
import type { StageTarget } from './stage-table.js';

export class InvalidTransitionError extends Error {
  public readonly code: OrchestratorErrorCode = 'INVALID_TRANSITION';
  public readonly typed: OrchestratorError;
  constructor(args: {
    readonly from: Stage;
    readonly to: StageTarget;
    readonly decisionKind: Decision['kind'];
    readonly reason: string;
    readonly requestId?: string;
  }) {
    super(
      `${args.from} → ${args.to} is not a valid "${args.decisionKind}" transition (${args.reason})`,
    );
    this.name = 'InvalidTransitionError';
    this.typed = {
      code: 'INVALID_TRANSITION',
      message: this.message,
      ...(args.requestId !== undefined ? { requestId: args.requestId } : {}),
    };
  }
}

export class StageMismatchError extends Error {
  public readonly code: OrchestratorErrorCode = 'STAGE_MISMATCH';
  public readonly typed: OrchestratorError;
  constructor(args: {
    readonly expected: Stage;
    readonly got: Stage;
    readonly requestId?: string;
  }) {
    super(
      `fromStage=${args.expected} does not match run.currentStage=${args.got}`,
    );
    this.name = 'StageMismatchError';
    this.typed = {
      code: 'STAGE_MISMATCH',
      message: this.message,
      ...(args.requestId !== undefined ? { requestId: args.requestId } : {}),
    };
  }
}

export class RunNotFoundError extends Error {
  public readonly code: OrchestratorErrorCode = 'RUN_NOT_FOUND';
  public readonly typed: OrchestratorError;
  constructor(args: { readonly runId: string; readonly requestId?: string }) {
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
  public readonly code: OrchestratorErrorCode = 'RUN_NOT_RUNNING';
  public readonly typed: OrchestratorError;
  constructor(args: {
    readonly runId: string;
    readonly status: string;
    readonly requestId?: string;
  }) {
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
  public readonly code: OrchestratorErrorCode = 'INVALID_DECISION';
  public readonly typed: OrchestratorError;
  constructor(args: { readonly reason: string; readonly requestId?: string }) {
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
  public readonly code: OrchestratorErrorCode = 'RETURN_TO_INVALID_STAGE';
  public readonly typed: OrchestratorError;
  constructor(args: {
    readonly from: Stage;
    readonly to: Stage;
    readonly requestId?: string;
  }) {
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
export function isOrchestratorError(e: unknown): e is
  | InvalidTransitionError
  | StageMismatchError
  | RunNotFoundError
  | RunNotRunningError
  | InvalidDecisionError
  | ReturnToInvalidStageError {
  return (
    e instanceof InvalidTransitionError ||
    e instanceof StageMismatchError ||
    e instanceof RunNotFoundError ||
    e instanceof RunNotRunningError ||
    e instanceof InvalidDecisionError ||
    e instanceof ReturnToInvalidStageError
  );
}