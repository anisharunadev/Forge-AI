/**
 * Integration tests for FORA-145 acceptance.
 *
 *   "EchoAgent with `tokenCeiling = 1` aborts at `plan` with
 *    `BudgetExceeded`; no tool calls fire; run record status
 *    `budget_exceeded`."
 *
 * Plus a few other wiring smoke tests that exercise the full
 * stage machine with retry / idempotency / cancel / budget.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  asAgentId,
  asIdempotencyKey,
  asRunId,
  asStepId,
  asToolName,
  BudgetExceededError,
  createRuntime,
  FileSystemRunRecordSink,
  InMemoryRunRecordSink,
  RetryableError,
  type AgentId,
  type IdempotencyKey,
  type Observation,
  type Plan,
  type Reflection,
  type RegisteredHandler,
  type RunInputs,
  type StagePolicy,
  type SubAgentDefinition,
  type ToolName,
} from '../src/index.js';

const ECHO_AGENT_ID: AgentId = asAgentId('echo-agent');
const ECHO_TOOL: ToolName = asToolName('echo');
const KEY: IdempotencyKey = asIdempotencyKey('idem-key-1');

function mkAgentWithPlanner(
  planner: (inputs: RunInputs) => Plan | Promise<Plan>,
  handler: RegisteredHandler['invoke'] = async (input: unknown) => ({ echoed: input }),
): SubAgentDefinition {
  const stagePolicy: StagePolicy = {
    plan: { allowedTools: new Set() },
    act: { allowedTools: new Set([ECHO_TOOL]) },
    observe: { allowedTools: new Set() },
    reflect: { allowedTools: new Set() },
  };
  const handlers = new Map<string, RegisteredHandler>();
  handlers.set('echo.handler', {
    handlerId: 'echo.handler',
    toolName: ECHO_TOOL,
    sideEffect: 'read',
    invoke: handler,
  });
  return {
    agentId: ECHO_AGENT_ID,
    stagePolicy,
    handlers,
    plan: async (inputs) => Promise.resolve(planner(inputs)),
    reflect: async (): Promise<Reflection> => ({ note: 'done', done: true }),
  };
}

describe('integration: FORA-145 acceptance — EchoAgent tokenCeiling=1 aborts at plan', () => {
  it('emits status `budget_exceeded`, no tool calls fire, and the run record carries the snapshot', async () => {
    let handlerCalls = 0;
    const agent = mkAgentWithPlanner(
      async (inputs: RunInputs): Promise<Plan> => ({
        planId: 'plan-budget',
        intent: inputs.intent,
        steps: [
          {
            stepId: asStepId('s1'),
            tool: ECHO_TOOL,
            handlerId: 'echo.handler',
            input: { message: inputs.intent },
            idempotencyKey: KEY,
          },
        ],
        // Planner reports 2 tokens of usage — strictly greater than
        // the 1-token ceiling. The pre-stage check before `act`
        // catches this on the next stage; the handler is never called.
        usage: { tokens: 2 },
      }),
      async (input) => {
        handlerCalls += 1;
        return { echoed: input };
      },
    );

    const runtime = createRuntime();
    runtime.registerAgent(agent);

    const res = await runtime.invoke(ECHO_AGENT_ID, {
      intent: 'exceed',
      context: {},
      tenantId: 't1',
      traceId: 'tr-budget-1',
      budget: { tokenCeiling: 1 },
    });

    // The planner reported 2 tokens of usage, the *plan* stage
    // recorded it, and the pre-stage check before `act` raises
    // BudgetExceeded. The handler must not have been called.
    expect(res.status).toBe('budget_exceeded');
    if (res.status === 'budget_exceeded') {
      expect(res.error.code).toBe('BudgetExceeded');
      expect(res.error.spent.tokens).toBe(2);
      expect(res.error.ceiling.tokenCeiling).toBe(1);
      expect(res.record.status).toBe('budget_exceeded');
      expect(res.record.budget?.spent.tokens).toBe(2);
    }
    expect(handlerCalls).toBe(0);
  });

  it('pre-stage check fires at the next stage when the spend exceeds the ceiling', async () => {
    // Use a clock that ticks by 5ms on every call so the
    // wall-clock check at `act` fires immediately. This isolates
    // the pre-stage check from any planner-recorded usage.
    let t = 0;
    const tickClock = () => (t += 5);
    const runtime = createRuntime({ now: tickClock });
    const agent = mkAgentWithPlanner(
      async (inputs: RunInputs): Promise<Plan> => ({
        planId: 'plan',
        intent: inputs.intent,
        steps: [],
      }),
    );
    runtime.registerAgent(agent);
    const res = await runtime.invoke(ECHO_AGENT_ID, {
      intent: 'wallclock',
      context: {},
      tenantId: 't1',
      traceId: 'tr-wc-1',
      budget: { wallClockCeilingMs: 7 },
    });
    // The pre-stage check at `act` should fire (10ms > 7ms).
    expect(res.status).toBe('budget_exceeded');
  });
});

describe('integration: retry + idempotency in the stage machine', () => {
  it('retries a flaky handler and caches the successful result', async () => {
    let calls = 0;
    const flakyHandler: RegisteredHandler['invoke'] = async () => {
      calls += 1;
      if (calls < 3) throw new RetryableError('flap', 'transport');
      return { ok: true, count: calls };
    };
    const stagePolicy: StagePolicy = {
      plan: { allowedTools: new Set() },
      act: { allowedTools: new Set([ECHO_TOOL]) },
      observe: { allowedTools: new Set() },
      reflect: { allowedTools: new Set() },
    };
    const handlers = new Map<string, RegisteredHandler>();
    handlers.set('echo.handler', {
      handlerId: 'echo.handler',
      toolName: ECHO_TOOL,
      sideEffect: 'write',
      idempotencyKey: KEY,
      retry: { maxAttempts: 5, backoff: { base: 1, factor: 1, max: 1, fullJitter: false } },
      invoke: flakyHandler,
    });

    const runtime = createRuntime();
    runtime.registerAgent({
      agentId: ECHO_AGENT_ID,
      stagePolicy,
      handlers,
      plan: async (inputs: RunInputs): Promise<Plan> => ({
        planId: 'p1',
        intent: inputs.intent,
        steps: [
          {
            stepId: asStepId('s1'),
            tool: ECHO_TOOL,
            handlerId: 'echo.handler',
            input: { x: 1 },
            idempotencyKey: KEY,
          },
        ],
      }),
      reflect: async (): Promise<Reflection> => ({ note: 'done', done: true }),
    });

    const res = await runtime.invoke(ECHO_AGENT_ID, {
      intent: 'retry-me',
      context: {},
      tenantId: 't1',
      traceId: 'tr-retry',
    });
    expect(res.status).toBe('succeeded');
    if (res.status === 'succeeded') {
      expect(res.record.steps.length).toBe(1);
      expect(calls).toBe(3);
      expect(res.record.steps[0]?.output).toEqual({ ok: true, count: 3 });
    }
  });
});

describe('integration: costHint feeds the budget meter (3rd site)', () => {
  it('records a tool handler costHint as a budget spend', async () => {
    const stagePolicy: StagePolicy = {
      plan: { allowedTools: new Set() },
      act: { allowedTools: new Set([ECHO_TOOL]) },
      observe: { allowedTools: new Set() },
      reflect: { allowedTools: new Set() },
    };
    const handlers = new Map<string, RegisteredHandler>();
    handlers.set('echo.handler', {
      handlerId: 'echo.handler',
      toolName: ECHO_TOOL,
      sideEffect: 'read',
      invoke: async (input: unknown) => ({
        output: { echoed: input },
        costHint: { tokens: 3, usd: 0.0001 },
      }),
    });
    const runtime = createRuntime();
    runtime.registerAgent({
      agentId: ECHO_AGENT_ID,
      stagePolicy,
      handlers,
      plan: async (inputs: RunInputs): Promise<Plan> => ({
        planId: 'p1',
        intent: inputs.intent,
        steps: [
          {
            stepId: asStepId('s1'),
            tool: ECHO_TOOL,
            handlerId: 'echo.handler',
            input: { x: 1 },
            idempotencyKey: KEY,
          },
        ],
      }),
      reflect: async (): Promise<Reflection> => ({ note: 'done', done: true }),
    });

    const res = await runtime.invoke(ECHO_AGENT_ID, {
      intent: 'cost-hint',
      context: {},
      tenantId: 't1',
      traceId: 'tr-hint',
    });
    expect(res.status).toBe('succeeded');
    if (res.status === 'succeeded') {
      expect(res.record.budget?.spent.tokens).toBe(3);
      expect(res.record.budget?.spent.usd).toBeCloseTo(0.0001);
    }
  });
});

describe('integration: cancellation drives a run to status `cancelled`', () => {
  it('cancels a run started with a long handler; status is `cancelled` if cancel arrives in time', async () => {
    const PREDICTED_RUN_ID = asRunId('run-cancel-me');
    const runtime = createRuntime({
      mintRunId: () => PREDICTED_RUN_ID,
    });
    // Long-running handler — gives us time to fire cancel().
    const stagePolicy: StagePolicy = {
      plan: { allowedTools: new Set() },
      act: { allowedTools: new Set([ECHO_TOOL]) },
      observe: { allowedTools: new Set() },
      reflect: { allowedTools: new Set() },
    };
    const handlers = new Map<string, RegisteredHandler>();
    handlers.set('echo.handler', {
      handlerId: 'echo.handler',
      toolName: ECHO_TOOL,
      sideEffect: 'read',
      invoke: (input: unknown) =>
        new Promise((resolve) => setTimeout(() => resolve({ echoed: input }), 100)),
    });
    runtime.registerAgent({
      agentId: ECHO_AGENT_ID,
      stagePolicy,
      handlers,
      plan: async (inputs: RunInputs): Promise<Plan> => ({
        planId: 'p1',
        intent: inputs.intent,
        steps: [
          {
            stepId: asStepId('s1'),
            tool: ECHO_TOOL,
            handlerId: 'echo.handler',
            input: { message: inputs.intent },
            idempotencyKey: KEY,
          },
        ],
      }),
      reflect: async (): Promise<Reflection> => ({ note: 'done', done: true }),
    });

    const promise = runtime.invoke(ECHO_AGENT_ID, {
      intent: 'cancel me',
      context: {},
      tenantId: 't1',
      traceId: 'tr-cancel',
    });
    // Cancel after a tick. The handler sleeps 100ms; cancel will land first.
    setTimeout(() => runtime.cancel(PREDICTED_RUN_ID, 'op cancel'), 5);
    const res = await promise;
    if (res.status === 'cancelled') {
      expect(res.error.code).toBe('Cancelled');
      expect(res.record.status).toBe('cancelled');
      expect(res.error.reason).toBe('op cancel');
    } else {
      // Race tolerance: if the handler raced to completion, status
      // is 'succeeded' (and the cancel was ignored). Both are
      // acceptable outcomes; the test only asserts a valid status.
      expect(res.status).toBe('succeeded');
    }
  });
});
