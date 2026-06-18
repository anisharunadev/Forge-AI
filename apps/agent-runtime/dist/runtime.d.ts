/**
 * `createRuntime` factory + `Runtime` interface.
 *
 * Per §9 of the design doc:
 *   - `Runtime.registerAgent(definition)` — boot-time validated
 *   - `Runtime.invoke(agentId, inputs)` — runs the stage machine
 *   - `Runtime.cancel(runId, reason?)` — external cancel entry (0.2.3)
 *   - `Runtime.listAgents()` — diagnostic / test seam
 *
 * 0.2.3 wiring: the runtime owns a `CancelTokenRegistry` and an
 * `IdempotencyStore` for the lifetime of the process. Tests can inject
 * custom implementations via `RuntimeOpts`.
 */
import { type Clock, type InvokeResult } from './stages.js';
import { type IdempotencyStore } from './idempotency.js';
import { type CancelTokenRegistry } from './cancel.js';
import type { AgentId, RunId, RunInputs, SubAgentDefinition, TypedError } from './types.js';
export interface RuntimeOpts {
    /**
     * Filesystem path the run record writer writes into.
     * Defaults to `<process.cwd()>/workspace`.
     */
    workspace?: string;
    /** Override the clock (test seam). */
    now?: Clock;
    /** Override the cancel-token registry (test seam). */
    cancelTokens?: CancelTokenRegistry;
    /**
     * @deprecated v0 cancel-registry seam. Wrapped into a
     * `CancelTokenRegistry` if `cancelTokens` is not supplied.
     */
    cancelRegistry?: import('./stages.js').CancelRegistry;
    /** Override the idempotency store (test seam). */
    idempotency?: IdempotencyStore;
    /** Optional id mint; tests inject deterministic ids. */
    mintRunId?: () => RunId;
}
export interface Runtime {
    registerAgent(definition: SubAgentDefinition): void;
    invoke(agentId: AgentId, inputs: RunInputs): Promise<InvokeResult>;
    /** 0.2.3: external cancel entry. The `reason` is propagated into the
     *  run record error and the cancel token's `whenCancelled` promise. */
    cancel(runId: RunId, reason?: string): void;
    /** Read-only view of registered agent ids — useful for tests/diagnostics. */
    listAgents(): readonly AgentId[];
}
export declare class AgentAlreadyRegisteredError extends Error {
    readonly typed: TypedError;
    constructor(typed: TypedError);
}
export declare class UnknownAgentError extends Error {
    readonly typed: TypedError;
    constructor(typed: TypedError);
}
export declare class IdempotencyMissingError extends Error {
    readonly typed: TypedError;
    constructor(typed: TypedError);
}
export declare function createRuntime(opts?: RuntimeOpts): Runtime;
