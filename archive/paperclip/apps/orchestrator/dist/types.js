/**
 * Type contracts for the Master Orchestrator (FORA-50 §2 / §3 / §4).
 *
 * Invariants:
 *   - IDs are branded so a TenantId cannot be assigned to a RunId by
 *     accident — same convention as `@fora/agent-runtime/src/types.ts`.
 *   - TypedError is a discriminated union; the HTTP layer maps the
 *     `code` field onto the JSON error envelope in FORA-50 §4.1.
 *   - All states/stages are string-literal unions matching the CHECK
 *     constraints installed by migrations/0002_*.
 */
/** Opaque cast helpers for boundaries that mint IDs (handlers, tests). */
export const asRunId = (s) => s;
export const asTenantId = (s) => s;
export const asGoalId = (s) => s;
export const asProjectId = (s) => s;
export const asIdempotencyKey = (s) => s;
/** The seven stages in order. */
export const STAGES_IN_ORDER = [
    'ideation',
    'architect',
    'dev',
    'qa',
    'security',
    'devops',
    'docs',
];
/**
 * Helper for the small subset of errors we throw internally. The HTTP
 * layer maps each code to the right RFC 7807-style envelope and HTTP
 * status.
 */
export function makeOrchestratorError(code, message, request_id) {
    return { code, message, request_id };
}
//# sourceMappingURL=types.js.map