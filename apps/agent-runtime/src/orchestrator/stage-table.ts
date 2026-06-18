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
export const STAGE_SPINE: ReadonlyArray<Stage> = [
  'ideation',
  'architect',
  'dev',
  'qa',
  'security',
  'devops',
  'docs',
];

/**
 * Sentinel for the run-state `done`. Not a stage in the spine, but the
 * AdvanceStage response surfaces it as `currentStage` once the last gate
 * passes (docs → done). We keep it as a `Stage | 'done'` so callers can
 * distinguish "last stage approved" from "still in the spine".
 */
export const TERMINAL_STAGE = 'done' as const;
export type TerminalStage = typeof TERMINAL_STAGE;

/** What an AdvanceStage call can target. `done` is the post-docs sentinel. */
export type StageTarget = Stage | TerminalStage;

/** Strict spine index. Throws if a stage is not in the spine. */
export function indexOfStage(stage: Stage): number {
  const i = STAGE_SPINE.indexOf(stage);
  if (i < 0) {
    throw new Error(`stage "${stage}" is not in the seven-stage spine`);
  }
  return i;
}

/**
 * The next stage in the spine, or `done` if `from` is the last stage.
 *
 *   next('docs')  → 'done'
 *   next('dev')   → 'qa'
 */
export function nextStage(from: Stage): StageTarget {
  const i = indexOfStage(from);
  const nxt = STAGE_SPINE[i + 1];
  return nxt ?? TERMINAL_STAGE;
}

/**
 * Whether `to` is a valid `next` target from `from` in the spine.
 *
 *   isValidNext('dev', 'qa')        → true
 *   isValidNext('dev', 'docs')      → false  (skipping QA)
 *   isValidNext('docs', 'done')     → true
 *   isValidNext('docs', 'security') → false  (backwards; use return)
 */
export function isValidNext(from: Stage, to: StageTarget): boolean {
  return nextStage(from) === to;
}

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
export function isValidReturn(from: Stage, to: Stage): boolean {
  // `to` is `Stage` here (caller filtered out 'done'); no need to test.
  const fromIdx = indexOfStage(from);
  const toIdx = indexOfStage(to);
  return toIdx < fromIdx;
}

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
export type Classification =
  | { readonly ok: true; readonly kind: 'next' | 'abort' | 'return' }
  | { readonly ok: false; readonly reason: string };

export function classify(from: Stage, to: StageTarget, decisionKind: 'next' | 'abort' | 'return'): Classification {
  if (decisionKind === 'abort') {
    // ABORT ignores `toStage`. The run transitions to `aborted` (terminal).
    // Per FORA-50 spec §2.3 the abort primitive is its own gate; the engine
    // never blocks an abort based on `toStage`.
    return { ok: true, kind: 'abort' };
  }
  if (decisionKind === 'next') {
    if (to === TERMINAL_STAGE) {
      // 'done' is only valid as a `next` from 'docs'.
      if (from === 'docs') return { ok: true, kind: 'next' };
      return { ok: false, reason: 'spine-skip' };
    }
    return isValidNext(from, to) ? { ok: true, kind: 'next' } : { ok: false, reason: 'spine-skip' };
  }
  // decisionKind === 'return'
  if (to === TERMINAL_STAGE) {
    return { ok: false, reason: 'return-to-terminal' };
  }
  return isValidReturn(from, to) ? { ok: true, kind: 'return' } : { ok: false, reason: 'return-not-prior' };
}

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

export function enumerateTransitionCases(): ReadonlyArray<TransitionCase> {
  const cases: TransitionCase[] = [];
  for (let i = 0; i < STAGE_SPINE.length; i++) {
    const from = STAGE_SPINE[i];
    if (from === undefined) continue;
    // Next: only the immediate successor or 'done' (from docs).
    for (let j = 0; j < STAGE_SPINE.length; j++) {
      const to = STAGE_SPINE[j];
      if (to === undefined) continue;
      const valid = j === i + 1;
      cases.push({
        from,
        to,
        decisionKind: 'next',
        expectedValid: valid,
        reason: valid ? 'spine-forward' : 'spine-skip',
      });
    }
    // 'done' is only valid as next from 'docs'.
    cases.push({
      from,
      to: TERMINAL_STAGE,
      decisionKind: 'next',
      expectedValid: from === 'docs',
      reason: from === 'docs' ? 'spine-final' : 'spine-skip',
    });
    // Return: any prior stage in the spine.
    for (let j = 0; j < STAGE_SPINE.length; j++) {
      const to = STAGE_SPINE[j];
      if (to === undefined) continue;
      const valid = j < i;
      cases.push({
        from,
        to,
        decisionKind: 'return',
        expectedValid: valid,
        reason: valid ? 'spine-return-prior' : 'return-not-prior',
      });
    }
    // Return to 'done' is always invalid.
    cases.push({
      from,
      to: TERMINAL_STAGE,
      decisionKind: 'return',
      expectedValid: false,
      reason: 'return-to-terminal',
    });
  }
  return cases;
}