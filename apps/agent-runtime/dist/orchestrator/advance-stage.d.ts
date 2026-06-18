/**
 * AdvanceStage — the typed gRPC seam between the Agent Runtime and the
 * Master Orchestrator.
 *
 * Per ADR-0007 §3 the contract is:
 *
 *   rpc AdvanceStage(AdvanceStageRequest) returns (StageDecision);
 *
 * This module is the **typed handler** the gRPC server invokes. It does not
 * speak protobuf itself — the gRPC server adapter (a future sub-task that
 * lands `orchestrator.proto` codegen) converts the wire message to the
 * `AdvanceStageRequest` shape defined in `./types.ts` and back.
 *
 * Algorithm (ADR-0007 §6 worked example + FORA-50 §2.3 + §4.1):
 *
 *   1. Validate the decision envelope (kind-specific required fields).
 *   2. Look up the run header. Refuse RUN_NOT_FOUND if missing.
 *   3. Refuse RUN_NOT_RUNNING if the run is in a terminal/non-live state.
 *   4. Refuse STAGE_MISMATCH if run.currentStage ≠ request.fromStage.
 *   5. Idempotency cache: replay the stored response on a retry.
 *   6. Classify (from, to, kind) via stage-table.classify:
 *        - invalid → emit `invalid_transition` + `error`; return
 *          InvalidTransitionError. The run is NOT advanced.
 *        - valid → emit the success event(s), persist the new stage state,
 *          and return StageDecisionResponse.
 *
 * Acceptance criteria (FORA-135):
 *   - ✓ Valid transitions persist the new stage state and emit gate_passed.
 *   - ✓ Invalid transitions emit invalid_transition and do not advance.
 *   - ✓ Return from dev → architect uses the same primitive as rejection.
 *   - ✓ AdvanceStage works for all 7 stages (matrix-tested in
 *       ./test/orchestrator.test.ts).
 *   - ✓ Unit tests cover every (from, to) pair.
 */
import { nextStage, TERMINAL_STAGE } from './stage-table.js';
import type { AdvanceStageRequest, StageDecisionResponse } from './types.js';
import type { OrchestratorDeps } from './ports.js';
export declare function advanceStage(request: AdvanceStageRequest, deps: OrchestratorDeps): Promise<StageDecisionResponse>;
/** Re-export for the test suite. */
export { nextStage, TERMINAL_STAGE };
