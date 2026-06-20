#!/usr/bin/env node
/**
 * FORA Agent Runtime v0 — 1-step EchoAgent smoke harness.
 *
 * Per FORA-144 §8 + the acceptance bar:
 *   "A trivial smoke harness invokes a 1-step EchoAgent, calls one
 *    allow-listed handler, produces a finalized RunRecord JSON file."
 *
 * Writes:
 *   - workspace/runs/{runId}.jsonl  — event stream
 *   - workspace/runs/{runId}.json    — finalized RunRecord
 *
 * Run with:
 *   node bin/fora-agent-runtime-smoke.mjs
 */

import { createRuntime, asAgentId, asStepId, asToolName } from '../dist/index.js';

async function main() {
  const runtime = createRuntime();
  const ECHO_TOOL = asToolName('echo');
  const agentId = asAgentId('echo-agent-v0');

  runtime.registerAgent({
    agentId,
    stagePolicy: {
      plan: { allowedTools: new Set() },
      act: { allowedTools: new Set([ECHO_TOOL]) },
      observe: { allowedTools: new Set() },
      reflect: { allowedTools: new Set() },
    },
    handlers: new Map([
      [
        'echo.handler',
        {
          handlerId: 'echo.handler',
          toolName: ECHO_TOOL,
          sideEffect: 'read',
          invoke: async (input) => ({ echoed: input }),
        },
      ],
    ]),
    plan: async (inputs) => ({
      planId: 'plan-smoke',
      intent: inputs.intent,
      steps: [
        {
          stepId: asStepId('smoke-step-1'),
          tool: ECHO_TOOL,
          handlerId: 'echo.handler',
          input: { message: inputs.intent, at: new Date().toISOString() },
        },
      ],
    }),
    reflect: async () => ({ note: 'smoke done', done: true }),
  });

  const res = await runtime.invoke(agentId, {
    intent: 'hello from the FORA v0 smoke harness',
    context: { who: 'paperclip-claude' },
    tenantId: 'paperclip',
    traceId: `smoke-${Date.now().toString(36)}`,
  });

  if (res.status !== 'succeeded') {
    console.error(`[smoke] FAILED status=${res.status}`, res);
    process.exit(1);
  }
  const { runId, record } = res;
  const jsonPath = `workspace/runs/${runId}.json`;
  console.log(`[smoke] runId=${runId} status=${record.status} steps=${record.steps.length}`);
  console.log(`[smoke] run record:  ${jsonPath}`);
  console.log(`[smoke] jsonl stream: workspace/runs/${runId}.jsonl`);
  console.log(`[smoke] output:`, JSON.stringify(record.steps[0]?.output ?? null));
}

main().catch((err) => {
  console.error('[smoke] threw:', err);
  process.exit(1);
});
