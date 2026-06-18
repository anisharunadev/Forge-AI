/**
 * Run + stage state machine — the lifecycle guards.
 *
 * Per FORA-50 §2.2 the seven-stage spine has these states:
 *
 *     trigger → created → running → ... → finished → done
 *                              ↑↓            ↑
 *                          waiting_approval  ↑
 *                              ↑↓            ↑
 *                            paused ─────────┘ (operator can resume)
 *
 * From any state, an operator may pause/resume/cancel. The Orchestrator
 * refuses invalid transitions and emits a typed error; the run is
 * NOT advanced. This is the FORA-50 §2.2 + §10 acceptance bar #4.
 *
 * The state machine is a pure module: no I/O, no side effects. The
 * server.ts handler maps the verb onto `canTransition` / `nextStatus`
 * and persists the new state.
 */
/**
 * The verb → next-status map. Each verb has at most one valid next
 * status from a given current status; an unmapped (verb, status) pair
 * is rejected as `INVALID_TRANSITION`.
 */
const VERB_NEXT_STATUS = {
    // pause is allowed from any active state; pause from a terminal
    // state is invalid (the run is already finished/aborted/done).
    pause: {
        created: 'paused',
        running: 'paused',
        waiting_approval: 'paused',
    },
    // resume is the inverse of pause; resume from a non-paused state is
    // invalid (we don't "resume" a created run; the engine starts it).
    resume: {
        paused: 'running',
    },
    // cancel is always valid (operator override). The terminal verb that
    // halts the run. From a paused run, cancel moves the run to aborted.
    cancel: {
        created: 'aborted',
        running: 'aborted',
        waiting_approval: 'aborted',
        paused: 'aborted',
    },
};
/** Terminal statuses — no verb transitions out of these. */
const TERMINAL_STATUSES = new Set([
    'aborted',
    'done',
]);
/**
 * True iff the verb may be applied from the current status. Pure
 * function. The HTTP layer surfaces the false branch as a 409 with
 * code `INVALID_TRANSITION` per FORA-50 §4.1.
 */
export function canTransition(verb, current) {
    const next = VERB_NEXT_STATUS[verb][current];
    return next !== undefined;
}
/**
 * The next status for a (verb, current) pair. Throws via the
 * server.ts caller — never throws here. Pure.
 */
export function nextStatus(verb, current) {
    const next = VERB_NEXT_STATUS[verb][current];
    if (next === undefined) {
        // Unreachable at runtime — server.ts guards every call with
        // canTransition. We throw a sentinel so a future refactor that
        // drops the guard fails loud rather than writing a wrong status.
        throw new Error(`nextStatus: invalid transition verb=${verb} from current=${current}`);
    }
    return next;
}
/** True iff the status is terminal (no further transitions allowed). */
export function isTerminal(status) {
    return TERMINAL_STATUSES.has(status);
}
/**
 * The "intended next current_stage" after the run header's status
 * advances. Today, the lifecycle verbs do not change `current_stage`
 * (only the stage engine in FORA-135 does); the helper exists so
 * the persistence layer can short-circuit on `pause` without
 * re-deriving the stage logic.
 *
 * Kept as a no-op identity so it stays a typed function — a future
 * FORA-135 patch that needs to track pause-by-stage can replace the
 * body without changing the call sites.
 */
export function currentStageOnVerb(_verb, currentStage) {
    return currentStage;
}
//# sourceMappingURL=state-machine.js.map