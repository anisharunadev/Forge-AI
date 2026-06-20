/**
 * Acceptance harness EchoAgent factory.
 *
 * Per FORA-30 §10 (and acceptance mapping in §13), the EchoAgent is the
 * canonical integration target for proving the v0 runtime contract. It
 * is intentionally minimal — one tool, one handler, one planner, one
 * reflector — so the harness can isolate each acceptance property
 * without compositional noise.
 *
 * The factory is shared by the five scenarios in `scenarios.ts`. Each
 * scenario overrides the planner / handler / reflector / allow-list as
 * needed and reads back through the same surface (`invoke → InvokeResult`,
 * `RunRecord`, JSONL stream).
 *
 * Tool names are namespaced per the FORA-30 design doc §3 ("`fs.read`,
 * `github.openPR`"); we use `notes.append` and `fs.delete` directly so
 * the negative scenario can show the gateway rejecting a non-allow-listed
 * tool by name.
 */

import {
  asAgentId,
  asStepId,
  asToolName,
  type AgentId,
  type IdempotencyKey,
  type Plan,
  type PlanStep,
  type RegisteredHandler,
  type RunInputs,
  type StagePolicy,
  type SubAgentDefinition,
  type ToolCtx,
  type ToolName,
  type ToolHandler,
  type ToolResult,
} from '../../src/index.js';

/** Tool names used in the harness. Namespaced per design doc §3. */
export const NOTES_APPEND = asToolName('notes.append');
export const FS_DELETE = asToolName('fs.delete');
export const ECHO_AGENT_ID: AgentId = asAgentId('echo-agent-acceptance');

/** Single deterministic per-step idempotency key — derived from the step index. */
export function stepKey(stepIdx: number): IdempotencyKey {
  return (`notes-append-step-${stepIdx}`) as IdempotencyKey;
}

/** Single idempotency key shared across all retry attempts (scenario 3). */
export const SHARED_IDEMPOTENCY_KEY: IdempotencyKey =
  'notes-append-shared' as IdempotencyKey;

export interface EchoAgentOpts {
  /** Override the `act` allow-list. Defaults to `[NOTES_APPEND]`. */
  allow?: ReadonlyArray<ToolName>;
  /** Override the planner (defaults to a 3-step notes.append plan). */
  planner?: (inputs: RunInputs) => Plan | Promise<Plan>;
  /** Override the reflector (defaults to `{ note: 'done', done: true }`). */
  reflector?: (args: { plan: Plan; observations: unknown[] }) =>
    | { note: string; done: boolean; nextPlan?: Plan }
    | Promise<{ note: string; done: boolean; nextPlan?: Plan }>;
  /** Override the notes.append handler. Defaults to a counting no-op. */
  notesAppendHandler?: ToolHandler<{ note: string }, ToolResult<{ ok: true; note: string }>>;
  /**
   * Side-effect tag for `notes.append`. The validator (§6) enforces that
   * `write` handlers MUST declare an `idempotencyKey`. Defaults to
   * `'write'` because the design doc and the acceptance scenarios both
   * exercise the side-effecting path.
   */
  sideEffect?: 'none' | 'read' | 'write';
}

/** The default 3-step notes.append planner — scenario 1. */
export function defaultThreeStepPlanner(inputs: RunInputs): Plan {
  const steps: PlanStep[] = [0, 1, 2].map((i) => ({
    stepId: asStepId(`step-${i + 1}`),
    tool: NOTES_APPEND,
    handlerId: 'notes.append.handler',
    input: { note: `${inputs.intent}::${i + 1}` },
    // Per-step idempotency key — distinct keys so the 3 calls are NOT
    // deduped against each other. The dedup property is exercised
    // separately in scenario 3 (same key, multiple calls).
    idempotencyKey: stepKey(i + 1),
  }));
  return {
    planId: 'echo-3step',
    intent: inputs.intent,
    steps,
    // Light planner usage to seed the budget meter (site 1).
    usage: { inputTokens: 1, outputTokens: 1, usd: 0.00001 },
  };
}

/**
 * Default `notes.append` handler.
 *
 *   - Counts invocations so scenarios can assert on call counts.
 *   - Returns a `ToolResult` with a small `costHint` so the budget meter
 *     records spend (site 3) and scenario 1 can assert `cost.tokens > 0`.
 *   - Honors `ctx.signal` for the cancellation scenario.
 */
export function defaultNotesAppendHandler(
  state: { calls: number },
): ToolHandler<{ note: string }, ToolResult<{ ok: true; note: string }>> {
  return async (input, ctx) => {
    state.calls += 1;
    if (ctx.signal) {
      // Cooperative cancel: if the signal is already aborted, fail fast.
      // We don't await here — scenario 5 uses a separate handler that
      // explicitly waits on the signal so the test can observe the
      // mid-act cancellation.
      if (ctx.signal.aborted) {
        throw new Error('notes.append: cancelled before invocation');
      }
    }
    return {
      output: { ok: true as const, note: input.note },
      costHint: { tokens: 1, usd: 0.00001 },
    };
  };
}

/** Construct an EchoAgent `SubAgentDefinition`. */
export function mkEchoAgent(opts: EchoAgentOpts = {}): SubAgentDefinition {
  const allowed = new Set<ToolName>(opts.allow ?? [NOTES_APPEND]);
  const stagePolicy: StagePolicy = {
    plan: { allowedTools: new Set() },
    act: { allowedTools: allowed },
    observe: { allowedTools: new Set() },
    reflect: { allowedTools: new Set() },
  };
  const handlers = new Map<string, RegisteredHandler>();
  const sideEffect = opts.sideEffect ?? 'write';
  const handlerId = 'notes.append.handler';
  const registered: RegisteredHandler = {
    handlerId,
    toolName: NOTES_APPEND,
    sideEffect,
    invoke: (opts.notesAppendHandler ??
      defaultNotesAppendHandler({ calls: 0 })) as RegisteredHandler['invoke'],
  };
  // Validator contract: `write` handlers must declare idempotencyKey.
  // The runtime uses the per-step key (set by the planner) for dedupe,
  // but the handler-level key must be present at registration time.
  if (sideEffect === 'write') {
    registered.idempotencyKey = SHARED_IDEMPOTENCY_KEY;
  }
  handlers.set(handlerId, registered);

  return {
    agentId: ECHO_AGENT_ID,
    stagePolicy,
    handlers,
    plan: opts.planner
      ? async (i: RunInputs) => Promise.resolve(opts.planner!(i))
      : async (i: RunInputs) => defaultThreeStepPlanner(i),
    reflect: opts.reflector
      ? async (a) => Promise.resolve(opts.reflector!(a as { plan: Plan; observations: unknown[] }))
      : async (): Promise<Reflection> => ({ note: 'echo done', done: true }),
  };
}

// Local type alias so the optional reflector override above types cleanly.
type Reflection = import('../../src/index.js').Reflection;

export { ECHO_AGENT_ID as defaultEchoAgentId };
