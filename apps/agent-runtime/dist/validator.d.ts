/**
 * Boot-time validator.
 *
 * Per §6 of the design doc, `registerAgent` rejects a side-effecting
 * (`sideEffect: 'write'`) `act`-allowed handler that lacks
 * `idempotencyKey` with the typed `IdempotencyMissing` error.
 *
 * The check runs at registration time, not at invocation time. This
 * keeps the hot path cheap and ensures the agent cannot start running
 * with a misconfigured handler.
 */
import type { SubAgentDefinition, TypedError } from './types.js';
/**
 * Validate a sub-agent definition. Returns a typed error on the first
 * violation, or `null` if the definition is well-formed.
 *
 * Rule: for every handler whose `sideEffect` is `'write'`, the handler
 * must be present in the `act` allow-list and must declare an
 * `idempotencyKey`.
 *
 * The returned error's `runId` is a placeholder; the runtime attaches
 * the real runId when the error is recorded.
 */
export declare function validateSubAgent(def: SubAgentDefinition): TypedError | null;
