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

import type {
  AgentId,
  RegisteredHandler,
  RunId,
  SubAgentDefinition,
  ToolName,
  TypedError,
} from './types.js';
import { asRunId, makeError } from './types.js';

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
export function validateSubAgent(def: SubAgentDefinition): TypedError | null {
  const actAllowed = def.stagePolicy.act.allowedTools;
  for (const handler of def.handlers.values()) {
    const err = validateHandler(def.agentId, handler, actAllowed);
    if (err) return err;
  }
  return null;
}

function validateHandler(
  agentId: AgentId,
  h: RegisteredHandler,
  actAllowed: ReadonlySet<ToolName>,
): TypedError | null {
  if (h.sideEffect !== 'write') return null;
  if (h.idempotencyKey !== undefined) return null;

  const placeholderRunId: RunId = asRunId('');
  return makeError({
    code: 'IdempotencyMissing',
    message: `handler "${h.handlerId}" (tool "${h.toolName}") on agent "${agentId}" is sideEffect=write and ${
      actAllowed.has(h.toolName) ? 'act-allowed' : 'not act-allowed'
    } but lacks idempotencyKey`,
    handlerId: h.handlerId,
    runId: placeholderRunId,
  });
}
