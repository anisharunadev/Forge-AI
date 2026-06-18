/**
 * v0 FORA Agent Runtime — type contracts.
 *
 * Mirrors design doc §3. Every type in this file is the public surface that
 * sub-agents, planners, reflectors, and the run record writer agree on.
 * The CTO signs the design doc; this file is the validator.
 *
 * Invariants:
 *   - No `any`. All shapes are structural.
 *   - IDs are branded strings so a ToolName cannot be assigned to a RunId
 *     by accident.
 *   - TypedError is a discriminated union; the stage machine and run
 *     record writer both pattern-match on `code` to decide recovery.
 */
/** Cast helpers for boundaries that mint IDs (e.g., test fixtures, sink). */
export const asRunId = (s) => s;
export const asAgentId = (s) => s;
export const asToolName = (s) => s;
export const asStepId = (s) => s;
export const asIdempotencyKey = (s) => s;
/** Type guard for the optional `ToolResult` shape. */
export function asToolResult(v) {
    if (v && typeof v === 'object' && 'output' in v) {
        return v;
    }
    return null;
}
/** Helper: build a typed error. */
export function makeError(e) {
    return e;
}
//# sourceMappingURL=types.js.map