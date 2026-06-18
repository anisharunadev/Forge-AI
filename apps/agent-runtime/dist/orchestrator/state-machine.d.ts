/**
 * Run-lifecycle state machine.
 *
 * Per FORA-50 spec §2.2 the run has exactly one of these states at any time:
 *
 *   created ──▶ running ──▶ waiting_approval ──▶ finished ──▶ done (terminal)
 *      ▲           ▲                  │
 *      └───────────┴──── approve ─────┘
 *      from any state: paused / aborted (terminal)
 *
 * This module is the pure transition function. It does not touch the DB or
 * the bus; the `AdvanceStage` handler (./advance-stage.ts) wraps it with
 * persistence + event publishing.
 *
 * The state machine is intentionally a small, hand-rolled table — the engine
 * is the only writer per ADR-0001, so exhaustive (state, event) coverage is
 * what gates "every (state, event) pair" in code review.
 */
import type { RunState, Stage } from './types.js';
export type RunEvent = {
    readonly kind: 'start';
    readonly initialStage: Stage;
} | {
    readonly kind: 'request_approval';
} | {
    readonly kind: 'approve';
} | {
    readonly kind: 'stage_complete';
} | {
    readonly kind: 'finish';
} | {
    readonly kind: 'pause';
} | {
    readonly kind: 'resume';
} | {
    readonly kind: 'abort';
};
export type TransitionVerdict = {
    readonly ok: true;
    readonly next: RunState;
} | {
    readonly ok: false;
    readonly reason: string;
};
/** Terminal states cannot be left; the engine refuses any transition out. */
export declare const TERMINAL_RUN_STATES: ReadonlySet<RunState>;
/**
 * Classify a (state, event) pair. Pure function; no side effects.
 *
 * The transitions follow FORA-50 §2.2 exactly. `paused` is resumable;
 * `done` / `aborted` are terminal.
 */
export declare function step(state: RunState, event: RunEvent): TransitionVerdict;
/**
 * Map an AdvanceStage decision to the run-level transition the engine
 * performs on success. Used by `advance-stage.ts` to pick the new RunState
 * without reaching back into the state-machine table.
 *
 *   decision 'next' + newStage === 'done' → run becomes `done` (terminal)
 *   decision 'next'                       → run stays `running`
 *   decision 'return'                     → run stays `running`
 *   decision 'abort'                      → run becomes `aborted` (terminal)
 *
 * A `paused` run stays paused across any decision that doesn't terminate;
 * the operator must `resume` before the next stage starts.
 */
export declare function runStateAfterDecision(current: RunState, decision: 'next' | 'return' | 'abort', newStage: Stage | 'done'): RunState;
