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
import {
  defaultRunId,
  runStages,
  type Clock,
  type InvokeResult,
  type RuntimeDeps,
} from './stages.js';
import { FileSystemRunRecordSink } from './run-record.js';
import {
  type IdempotencyStore,
  LruIdempotencyStore,
} from './idempotency.js';
import { type CancelTokenRegistry, InMemoryCancelTokenRegistry } from './cancel.js';
import type {
  AgentId,
  RunId,
  RunInputs,
  SubAgentDefinition,
  TypedError,
} from './types.js';

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

export class AgentAlreadyRegisteredError extends Error {
  constructor(public readonly typed: TypedError) {
    super(typed.message);
    this.name = 'AgentAlreadyRegisteredError';
  }
}

export class UnknownAgentError extends Error {
  constructor(public readonly typed: TypedError) {
    super(typed.message);
    this.name = 'UnknownAgentError';
  }
}

export class IdempotencyMissingError extends Error {
  constructor(public readonly typed: TypedError) {
    super(typed.message);
    this.name = 'IdempotencyMissingError';
  }
}

export function createRuntime(opts: RuntimeOpts = {}): Runtime {
  const workspace = opts.workspace ?? `${process.cwd()}/workspace`;
  const agents = new Map<AgentId, SubAgentDefinition>();

  // 0.2.3: own a process-local cancel-token registry and idempotency
  // store. Tests inject custom implementations via opts; the default
  // in-memory implementations are good enough for the v0 smoke harness
  // and the unit suite.
  const cancelTokens: CancelTokenRegistry = opts.cancelTokens ?? new InMemoryCancelTokenRegistry();
  const idempotency: IdempotencyStore = opts.idempotency ?? new LruIdempotencyStore();

  const registry: Runtime = {
    registerAgent(definition) {
      if (agents.has(definition.agentId)) {
        const err: TypedError = {
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
        const err: TypedError = {
          code: 'UnknownAgent',
          message: `agent "${agentId}" is not registered`,
          agentId,
        };
        throw new UnknownAgentError(err);
      }
      const runId = opts.mintRunId ? opts.mintRunId() : defaultRunId();
      const sink = new FileSystemRunRecordSink(runId, workspace);
      const deps: RuntimeDeps = {
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
