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
import type { LifecycleVerb, RunStatus } from './types.js';
/**
 * True iff the verb may be applied from the current status. Pure
 * function. The HTTP layer surfaces the false branch as a 409 with
 * code `INVALID_TRANSITION` per FORA-50 §4.1.
 */
export declare function canTransition(verb: LifecycleVerb, current: RunStatus): boolean;
/**
 * The next status for a (verb, current) pair. Throws via the
 * server.ts caller — never throws here. Pure.
 */
export declare function nextStatus(verb: LifecycleVerb, current: RunStatus): RunStatus;
/** True iff the status is terminal (no further transitions allowed). */
export declare function isTerminal(status: RunStatus): boolean;
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
export declare function currentStageOnVerb(_verb: LifecycleVerb, currentStage: string): string;
