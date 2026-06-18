/**
 * Unit tests for the v0 Agent Runtime.
 *
 * Covers the FORA-144 acceptance bars:
 *   - Stage machine transitions (plan → act → observe → reflect → finish).
 *   - `replan` mid-run when the reflector returns a `nextPlan`.
 *   - `NotAllowed` is raised and recorded when the planner emits a step
 *     calling a tool not in the stage's allow-list.
 *   - `IdempotencyMissing` is raised at `registerAgent` when a `write`
 *     handler lacks `idempotencyKey`.
 *   - `createRuntime` factory wires the public surface.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  createRuntime,
  asAgentId,
  asIdempotencyKey,
  asRunId,
  asStepId,
  asToolName,
  FileSystemRunRecordSink,
  IdempotencyMissingError,
  InMemoryRunRecordSink,
  type AgentId,
  type InvokeResult,
  type Plan,
  type Reflection,
  type RunInputs,
  type SubAgentDefinition,
  type ToolName,
} from '../src/index.js';

const ECHO_AGENT_ID: AgentId = asAgentId('echo-agent');
const ECHO_TOOL: ToolName = asToolName('echo');
const DISALLOWED_TOOL: ToolName = asToolName('forbidden-echo');

function mkEchoAgent(opts: {
  allow?: ReadonlyArray<string>;
  plannerOverride?: (inputs: RunInputs) => Plan | Promise<Plan>;
  reflectorOverride?: (args: { plan: Plan; observations: import('../src/index.js').Observation[] }) => Reflection | Promise<Reflection>;
  handlerSideEffect?: 'none' | 'read' | 'write';
} = {}): SubAgentDefinition {
  const allowed = new Set<ToolName>((opts.allow ?? ['echo']).map(asToolName));
  const handlers = new Map<string, import('../src/index.js').RegisteredHandler>();
  const handlerId = 'echo.handler';
  const registered: import('../src/index.js').RegisteredHandler = {
    handlerId,
    toolName: ECHO_TOOL,
    sideEffect: opts.handlerSideEffect ?? 'read',
    invoke: async (input: unknown) => ({ echoed: input }),
  };
  if (opts.handlerSideEffect === 'write') {
    registered.idempotencyKey = asIdempotencyKey('idem-1');
  }
  handlers.set(handlerId, registered);
  return {
    agentId: ECHO_AGENT_ID,
    stagePolicy: {
      plan: { allowedTools: new Set() },
      act: { allowedTools: allowed },
      observe: { allowedTools: new Set() },
      reflect: { allowedTools: new Set() },
    },
    handlers,
    plan: opts.plannerOverride ?? (async (inputs: RunInputs): Promise<Plan> => ({
      planId: 'plan-1',
      intent: inputs.intent,
      steps: [
        {
          stepId: asStepId('step-1'),
          tool: ECHO_TOOL,
          handlerId,
          input: { message: inputs.intent },
        },
      ],
    })),
    reflect: opts.reflectorOverride ?? (async (): Promise<Reflection> => ({
      note: 'echo done',
      done: true,
    })),
  };
}

describe('agent-runtime: stage machine', () => {
  it('walks plan → act → observe → reflect → finished for a 1-step EchoAgent', async () => {
    const runtime = createRuntime();
    runtime.registerAgent(mkEchoAgent());

    const sink = new InMemoryRunRecordSink(asRunId('run-1'));
    // We can't inject the sink into a default runtime; instead we use
    // the filesystem sink by writing into a tmp dir. We assert on the
    // return value (the `InvokeResult`) for now.
    const res = await runtime.invoke(ECHO_AGENT_ID, {
      intent: 'hello',
      context: {},
      tenantId: 't1',
      traceId: 'tr-1',
    });
    expect(res.status).toBe('succeeded');
    if (res.status === 'succeeded') {
      expect(res.record.steps.length).toBe(1);
      expect(res.record.steps[0]?.tool).toBe(ECHO_TOOL);
      expect(res.record.status).toBe('succeeded');
      expect(res.record.replanCycles).toBe(0);
      expect(res.record.errors).toEqual([]);
    }
    // Suppress the unused-var warning on `sink`; the type-level test
    // above is what matters for v0.
    void sink;
  });

  it('records replan cycles when the reflector returns a nextPlan', async () => {
    const agent = mkEchoAgent({
      reflectorOverride: (() => {
        let calls = 0;
        return async (args: { plan: Plan }): Promise<Reflection> => {
          calls += 1;
          if (calls < 3) {
            return {
              note: `replan ${calls}`,
              done: false,
              nextPlan: { planId: `plan-${calls + 1}`, intent: args.plan.intent, steps: args.plan.steps },
            };
          }
          return { note: 'done', done: true };
        };
      })(),
    });
    const runtime = createRuntime();
    runtime.registerAgent(agent);
    const res = await runtime.invoke(ECHO_AGENT_ID, {
      intent: 'replan-me',
      context: {},
      tenantId: 't1',
      traceId: 'tr-replan',
    });
    expect(res.status).toBe('succeeded');
    if (res.status === 'succeeded') {
      expect(res.record.replanCycles).toBe(2);
      // 1 step per plan × 3 plan iterations = 3 steps total.
      expect(res.record.steps.length).toBe(3);
    }
  });

  it('aborts with ReplanBudgetExhausted when replan cycles exceed maxReplans', async () => {
    const agent = mkEchoAgent({
      reflectorOverride: (async (args: { plan: Plan }): Promise<Reflection> => ({
        note: 'replan forever',
        done: false,
        nextPlan: { planId: 'plan-next', intent: args.plan.intent, steps: args.plan.steps },
      })),
    });
    const runtime = createRuntime();
    runtime.registerAgent(agent);
    const res = await runtime.invoke(ECHO_AGENT_ID, {
      intent: 'infinite',
      context: {},
      tenantId: 't1',
      traceId: 'tr-budget',
      maxReplans: 2,
    });
    expect(res.status).toBe('failed');
    if (res.status === 'failed') {
      expect(res.error.code).toBe('ReplanBudgetExhausted');
      expect(res.record.replanCycles).toBe(2);
      expect(res.record.errors.some((e) => e.code === 'ReplanBudgetExhausted')).toBe(true);
    }
  });

  it('raises and records NotAllowed when the planner emits a step calling a non-allow-listed tool', async () => {
    const agent = mkEchoAgent({
      plannerOverride: async (inputs: RunInputs): Promise<Plan> => ({
        planId: 'plan-bad',
        intent: inputs.intent,
        steps: [
          {
            stepId: asStepId('step-bad'),
            tool: DISALLOWED_TOOL,
            handlerId: 'doesnt-matter',
            input: { message: inputs.intent },
          },
        ],
      }),
    });
    const runtime = createRuntime();
    runtime.registerAgent(agent);
    const res = await runtime.invoke(ECHO_AGENT_ID, {
      intent: 'should-fail',
      context: {},
      tenantId: 't1',
      traceId: 'tr-not-allowed',
    });
    expect(res.status).toBe('failed');
    if (res.status === 'failed') {
      expect(res.error.code).toBe('NotAllowed');
      expect(res.record.errors.some((e) => e.code === 'NotAllowed')).toBe(true);
    }
  });
});

describe('agent-runtime: boot-time validator', () => {
  it('rejects registerAgent when a write handler lacks idempotencyKey', () => {
    const agent = mkEchoAgent({ handlerSideEffect: 'write' });
    // Strip the idempotencyKey so the contract is violated.
    const handlers = new Map(agent.handlers);
    const first = handlers.values().next().value;
    if (first) {
      handlers.set(first.handlerId, { ...first, idempotencyKey: undefined });
    }
    const violated: SubAgentDefinition = { ...agent, handlers };
    const runtime = createRuntime();
    expect(() => runtime.registerAgent(violated)).toThrow(IdempotencyMissingError);
  });

  it('accepts a write handler that has idempotencyKey', () => {
    const agent = mkEchoAgent({ handlerSideEffect: 'write' });
    const runtime = createRuntime();
    expect(() => runtime.registerAgent(agent)).not.toThrow();
    expect(runtime.listAgents()).toContain(ECHO_AGENT_ID);
  });

  it('rejects a duplicate agent id', () => {
    const runtime = createRuntime();
    runtime.registerAgent(mkEchoAgent());
    expect(() => runtime.registerAgent(mkEchoAgent())).toThrow(/already registered/i);
  });
});

describe('agent-runtime: factory + sink', () => {
  it('exposes registerAgent / invoke / cancel / listAgents', () => {
    const runtime = createRuntime();
    expect(typeof runtime.registerAgent).toBe('function');
    expect(typeof runtime.invoke).toBe('function');
    expect(typeof runtime.cancel).toBe('function');
    expect(Array.from(runtime.listAgents())).toEqual([]);
    runtime.registerAgent(mkEchoAgent());
    expect(Array.from(runtime.listAgents())).toEqual([ECHO_AGENT_ID]);
  });

  it('throws UnknownAgentError when invoke is called on an unknown agent', async () => {
    const runtime = createRuntime();
    await expect(
      runtime.invoke(asAgentId('does-not-exist'), {
        intent: 'x',
        context: {},
        tenantId: 't1',
        traceId: 'tr-x',
      }),
    ).rejects.toThrow(/not registered/i);
  });

  it('filesystem sink writes a finalized RunRecord JSON file', async () => {
    const { mkdtempSync, readFileSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(`${tmpdir()}/fora-runtime-`);
    const runtime = createRuntime({ workspace: dir });
    runtime.registerAgent(mkEchoAgent());
    const res = await runtime.invoke(ECHO_AGENT_ID, {
      intent: 'persist-me',
      context: {},
      tenantId: 't1',
      traceId: 'tr-fs',
    });
    expect(res.status).toBe('succeeded');
    if (res.status === 'succeeded') {
      const runId = res.runId;
      const jsonPath = `${dir}/runs/${runId}.json`;
      const jsonlPath = `${dir}/runs/${runId}.jsonl`;
      expect(existsSync(jsonPath)).toBe(true);
      expect(existsSync(jsonlPath)).toBe(true);
      const parsed = JSON.parse(readFileSync(jsonPath, 'utf-8')) as { runId: string; status: string };
      expect(parsed.runId).toBe(runId);
      expect(parsed.status).toBe('succeeded');
    }
  });
});
