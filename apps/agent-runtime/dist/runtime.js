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
import { validateSubAgent } from './validator.js';
import { defaultRunId, runStages, } from './stages.js';
import { FileSystemRunRecordSink } from './run-record.js';
import { LruIdempotencyStore, } from './idempotency.js';
import { InMemoryCancelTokenRegistry } from './cancel.js';
export class AgentAlreadyRegisteredError extends Error {
    typed;
    constructor(typed) {
        super(typed.message);
        this.typed = typed;
        this.name = 'AgentAlreadyRegisteredError';
    }
}
export class UnknownAgentError extends Error {
    typed;
    constructor(typed) {
        super(typed.message);
        this.typed = typed;
        this.name = 'UnknownAgentError';
    }
}
export class IdempotencyMissingError extends Error {
    typed;
    constructor(typed) {
        super(typed.message);
        this.typed = typed;
        this.name = 'IdempotencyMissingError';
    }
}
export function createRuntime(opts = {}) {
    const workspace = opts.workspace ?? `${process.cwd()}/workspace`;
    const agents = new Map();
    // 0.2.3: own a process-local cancel-token registry and idempotency
    // store. Tests inject custom implementations via opts; the default
    // in-memory implementations are good enough for the v0 smoke harness
    // and the unit suite.
    const cancelTokens = opts.cancelTokens ?? new InMemoryCancelTokenRegistry();
    const idempotency = opts.idempotency ?? new LruIdempotencyStore();
    const registry = {
        registerAgent(definition) {
            if (agents.has(definition.agentId)) {
                const err = {
                    code: 'AgentAlreadyRegistered',
                    message: `agent "${definition.agentId}" is already registered`,
                    agentId: definition.agentId,
                };
                throw new AgentAlreadyRegisteredError(err);
            }
            const validation = validateSubAgent(definition);
            if (validation) {
                if (validation.code === 'IdempotencyMissing') {
                    throw new IdempotencyMissingError(validation);
                }
                // The validator only returns IdempotencyMissing in v0; future
                // codes land here as we add rules.
                throw new Error(`registerAgent rejected: ${validation.code}: ${validation.message}`);
            }
            agents.set(definition.agentId, definition);
        },
        async invoke(agentId, inputs) {
            const def = agents.get(agentId);
            if (!def) {
                const err = {
                    code: 'UnknownAgent',
                    message: `agent "${agentId}" is not registered`,
                    agentId,
                };
                throw new UnknownAgentError(err);
            }
            const runId = opts.mintRunId ? opts.mintRunId() : defaultRunId();
            const sink = new FileSystemRunRecordSink(runId, workspace);
            const deps = {
                sink,
                ...(opts.now ? { now: opts.now } : {}),
                ...(opts.cancelRegistry ? { cancelRegistry: opts.cancelRegistry } : {}),
                cancelTokens,
                idempotency,
            };
            return runStages({
                agent: def,
                runId,
                tenantId: inputs.tenantId,
                traceId: inputs.traceId,
                inputs,
                deps,
            });
        },
        cancel(runId, reason = 'cancelled') {
            cancelTokens.request(runId, reason);
        },
        listAgents() {
            return Array.from(agents.keys());
        },
    };
    return registry;
}
//# sourceMappingURL=runtime.js.map