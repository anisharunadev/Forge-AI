/**
 * The seven-stage spine — the only place the (from, to) transition table is
 * defined.
 *
 * Per FORA-50 spec §2.3 and architecture.md §3:
 *
 *   ideation → architect → dev → qa → security → devops → docs → done
 *
 * The Master Orchestrator refuses to skip a stage. `next` advances exactly
 * one position. `return` can target any **prior** stage in the spine. `abort`
 * is terminal and ignores `toStage`. Anything else is an `invalid_transition`
 * (typed `INVALID_TRANSITION` error per FORA-50 §4.1).
 *
 * The table is intentionally hand-written and exhaustive: every (from, to)
 * pair is covered by exactly one rule. CI fails on a missing pair (see
 * `apps/agent-runtime/test/orchestrator.test.ts` — the full-matrix test).
 */
import type { Stage } from './types.js';
/** Strict spine order. The orchestrator refuses to reorder this. */
export declare const STAGE_SPINE: ReadonlyArray<Stage>;
/**
 * Sentinel for the run-state `done`. Not a stage in the spine, but the
 * AdvanceStage response surfaces it as `currentStage` once the last gate
 * passes (docs → done). We keep it as a `Stage | 'done'` so callers can
 * distinguish "last stage approved" from "still in the spine".
 */
export declare const TERMINAL_STAGE: "done";
export type TerminalStage = typeof TERMINAL_STAGE;
/** What an AdvanceStage call can target. `done` is the post-docs sentinel. */
export type StageTarget = Stage | TerminalStage;
/** Strict spine index. Throws if a stage is not in the spine. */
export declare function indexOfStage(stage: Stage): number;
/**
 * The next stage in the spine, or `done` if `from` is the last stage.
 *
 *   next('docs')  → 'done'
 *   next('dev')   → 'qa'
 */
export declare function nextStage(from: Stage): StageTarget;
/**
 * Whether `to` is a valid `next` target from `from` in the spine.
 *
 *   isValidNext('dev', 'qa')        → true
 *   isValidNext('dev', 'docs')      → false  (skipping QA)
 *   isValidNext('docs', 'done')     → true
 *   isValidNext('docs', 'security') → false  (backwards; use return)
 */
export declare function isValidNext(from: Stage, to: StageTarget): boolean;
/**
 * Whether `to` is a valid `return` target from `from` in the spine.
 *
 * Per FORA-50 spec §2.3: "Returning a stage to a prior owner uses the same
 * `return` primitive." A return may target **any** earlier spine stage; it
 * may not target the same stage, a forward stage, or `done`.
 *
 *   isValidReturn('dev', 'architect') → true   (CTO sends Dev back)
 *   isValidReturn('qa',  'architect') → true   (skips dev on return)
 *   isValidReturn('dev', 'dev')       → false
 *   isValidReturn('dev', 'qa')        → false  (forward; use next)
 *   isValidReturn('dev', 'done')      → false
 *   isValidReturn('ideation', …)     → false  (no earlier stage)
 */
export declare function isValidReturn(from: Stage, to: Stage): boolean;
/**
 * Classify a (from, to) pair against the decision kind. Returns the verdict
 * the engine should apply, or `invalid` if the pair doesn't fit the kind.
 *
 *   classify('dev', 'qa',         'next')    → { ok: true,  kind: 'next'    }
 *   classify('dev', 'docs',       'next')    → { ok: false, reason: 'spine-skip' }
 *   classify('dev', 'architect',  'return')  → { ok: true,  kind: 'return'  }
 *   classify('dev', 'qa',         'return')  → { ok: false, reason: 'forward-not-return' }
 *   classify('ideation', 'architect', 'abort') → { ok: true, kind: 'abort' }  // abort ignores to
 */
export type Classification = {
    readonly ok: true;
    readonly kind: 'next' | 'abort' | 'return';
} | {
    readonly ok: false;
    readonly reason: string;
};
export declare function classify(from: Stage, to: StageTarget, decisionKind: 'next' | 'abort' | 'return'): Classification;
/**
 * Enumerate every (from, to) pair across `decisionKind ∈ {next, return}`
 * for matrix-test coverage. ABORT is excluded because it ignores `toStage`;
 * it has its own dedicated test path.
 *
 * The matrix is the source of truth for "every (from, to) pair in the stage
 * table" (FORA-135 acceptance). CI fails if this matrix disagrees with
 * `STAGE_SPINE` length × targets.
 */
export interface TransitionCase {
    readonly from: Stage;
    readonly to: StageTarget;
    readonly decisionKind: 'next' | 'return';
    readonly expectedValid: boolean;
    readonly reason: string;
}
export declare function enumerateTransitionCases(): ReadonlyArray<TransitionCase>;
