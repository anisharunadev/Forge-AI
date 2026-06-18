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
/** Terminal states cannot be left; the engine refuses any transition out. */
export const TERMINAL_RUN_STATES = new Set(['done', 'aborted']);
/**
 * Classify a (state, event) pair. Pure function; no side effects.
 *
 * The transitions follow FORA-50 §2.2 exactly. `paused` is resumable;
 * `done` / `aborted` are terminal.
 */
export function step(state, event) {
    // Terminal states refuse everything except no-op checks.
    if (TERMINAL_RUN_STATES.has(state)) {
        return { ok: false, reason: `state "${state}" is terminal` };
    }
    switch (event.kind) {
        case 'start':
            if (state !== 'created')
                return { ok: false, reason: `cannot start from "${state}"` };
            return { ok: true, next: 'running' };
        case 'request_approval':
            if (state !== 'running')
                return { ok: false, reason: `cannot request approval from "${state}"` };
            return { ok: true, next: 'waiting_approval' };
        case 'approve':
            if (state !== 'waiting_approval')
                return { ok: false, reason: `cannot approve from "${state}"` };
            return { ok: true, next: 'running' };
        case 'stage_complete':
            if (state !== 'running')
                return { ok: false, reason: `cannot complete stage from "${state}"` };
            return { ok: true, next: 'finished' };
        case 'finish':
            if (state !== 'finished')
                return { ok: false, reason: `cannot finish from "${state}"` };
            return { ok: true, next: 'done' };
        case 'pause':
            // Per FORA-50 §2.2: "from any state" can pause. `paused` itself
            // re-pauses (idempotent for operator safety).
            if (state === 'paused')
                return { ok: true, next: 'paused' };
            return { ok: true, next: 'paused' };
        case 'resume':
            if (state !== 'paused')
                return { ok: false, reason: `cannot resume from "${state}"` };
            return { ok: true, next: 'running' };
        case 'abort':
            // Abort from any non-terminal state is allowed; terminal is blocked above.
            return { ok: true, next: 'aborted' };
        default: {
            // Exhaustiveness guard — the discriminated union is the contract.
            const _exhaustive = event;
            void _exhaustive;
            return { ok: false, reason: 'unknown event kind' };
        }
    }
}
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
export function runStateAfterDecision(current, decision, newStage) {
    if (decision === 'abort')
        return 'aborted';
    if (decision === 'next' && newStage === 'done')
        return 'done';
    if (current === 'paused')
        return 'paused';
    return 'running';
}
//# sourceMappingURL=state-machine.js.map