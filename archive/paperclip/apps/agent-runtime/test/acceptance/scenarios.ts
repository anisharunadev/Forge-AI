/**
 * Acceptance scenarios — FORA-30 §10 / §13 acceptance mapping.
 *
 * Each scenario is a self-contained, side-effect-free function that:
 *   1. Builds a fresh runtime + agent.
 *   2. Invokes the runtime.
 *   3. Returns a `ScenarioResult` describing what was observed.
 *
 * The scenarios are wired together by `acceptance.test.ts` and asserted
 * via vitest. Failures are loud: each scenario emits a structured
 * `failures` array that the test runner reports in full.
 *
 * Mapping to FORA-30 acceptance lines (§13):
 *
 *   scenario 1 (happyPath)           ← "A sub-agent can be invoked, plan
 *                                       a 3-step task, call only allow-listed
 *                                       tools, and produce a structured run record."
 *   scenario 2 (allowListNegative)   ← "Runtime never calls a non-allow-listed
 *                                       tool; attempts are logged and surfaced
 *                                       as a typed error."
 *   scenario 3 (idempotencyProperty) ← "Retries do not duplicate side effects
 *                                       when handlers return idempotency keys."
 *   scenario 4 (budgetAbort)         ← "Cost ceiling enforcement aborts the run
 *                                       with a typed error rather than silently
 *                                       exceeding budget."
 *   scenario 5 (cancellation)        ← (bonus) "Cancellation behaves correctly."
 */

import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  asRunId,
  CancelledError,
  createRuntime,
  LruIdempotencyStore,
  type AgentId,
  type IdempotencyStore,
  type InvokeResult,
  type Plan,
  type RunId,
  type ToolHandler,
} from '../../src/index.js';

import {
  defaultNotesAppendHandler,
  ECHO_AGENT_ID,
  FS_DELETE,
  mkEchoAgent,
  NOTES_APPEND,
  SHARED_IDEMPOTENCY_KEY,
  stepKey,
  type EchoAgentOpts,
} from './echo-agent.js';

export interface ScenarioResult {
  /** Scenario number per FORA-30 §10. */
  number: 1 | 2 | 3 | 4 | 5;
  /** Scenario name. */
  name: string;
  /** FORA-30 §13 acceptance line the scenario proves. */
  acceptanceLine: string;
  /** What the scenario did. */
  description: string;
  /** The runtime's terminal `InvokeResult`. */
  invokeResult: InvokeResult;
  /** Resolved workspace path (for filesystem inspection). */
  workspace: string;
  /** Observed JSONL event stream (one event per line). */
  events: ReadonlyArray<unknown>;
  /** Counters / facts the assertions rely on. */
  facts: Record<string, unknown>;
  /** Failures collected by the scenario. Empty on pass. */
  failures: string[];
}

function newWorkspace(label: string): string {
  return mkdtempSync(join(tmpdir(), `fora-acceptance-${label}-`));
}

function readEvents(workspace: string, runId: RunId): unknown[] {
  // Lazy require — keeps the harness free of fs at import time so the
  // vitest module graph stays small.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const path = join(workspace, 'runs', `${runId}.jsonl`);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

function fail(result: ScenarioResult, message: string): ScenarioResult {
  return { ...result, failures: [...result.failures, message] };
}

/* ------------------------------------------------------------------------- */
/* Scenario 1 — Happy path (3 ordered notes.append calls, idempotency keys)  */
/* ------------------------------------------------------------------------- */

export async function scenario1_happyPath(): Promise<ScenarioResult> {
  const workspace = newWorkspace('s1-happy');
  const handlerState = { calls: 0 };
  const agent = mkEchoAgent({
    notesAppendHandler: defaultNotesAppendHandler(handlerState),
  });
  const runtime = createRuntime({ workspace });
  runtime.registerAgent(agent);

  const invokeResult = await runtime.invoke(ECHO_AGENT_ID, {
    intent: 'happy-path',
    context: {},
    tenantId: 't-acceptance',
    traceId: 'acc-1-happy',
  });
  const runId = invokeResult.runId;
  const events = readEvents(workspace, runId);

  const result: ScenarioResult = {
    number: 1,
    name: 'happyPath',
    acceptanceLine:
      'A sub-agent can be invoked, plan a 3-step task, call only allow-listed tools, and produce a structured run record.',
    description:
      'EchoAgent with allow-list [notes.append], planner emits a 3-step plan, side-effecting handler with idempotencyKey.',
    invokeResult,
    workspace,
    events,
    facts: {
      handlerCalls: handlerState.calls,
      finalizedPath: join(workspace, 'runs', `${runId}.json`),
      streamPath: join(workspace, 'runs', `${runId}.jsonl`),
    },
    failures: [],
  };

  // ---- Assertions (1:1 with §10 scenario 1) -------------------------------

  // status === 'succeeded' on the InvokeResult AND the RunRecord
  if (invokeResult.status !== 'succeeded') {
    return fail(
      result,
      `expected invoke.status='succeeded' got '${invokeResult.status}' (error=${JSON.stringify(
        (invokeResult as { error?: unknown }).error,
      )})`,
    );
  }
  const { record } = invokeResult;
  if (record.status !== 'succeeded') {
    return fail(result, `expected record.status='succeeded' got '${record.status}'`);
  }

  // 3 ordered tool_call_finished events ⇒ 3 step records, all `ok: true`,
  // in plan order, each calling NOTES_APPEND
  if (record.steps.length !== 3) {
    return fail(result, `expected 3 step records got ${record.steps.length}`);
  }
  const allNotesAppend = record.steps.every((s) => s.tool === NOTES_APPEND);
  if (!allNotesAppend) {
    return fail(result, `expected all steps to call notes.append; tools=${record.steps.map((s) => String(s.tool)).join(',')}`);
  }
  const allOk = record.steps.every((s) => s.ok);
  if (!allOk) {
    return fail(result, `expected all steps ok; statuses=${record.steps.map((s) => s.ok).join(',')}`);
  }
  // Ordered — step ids are sequential in default planner.
  const stepIds = record.steps.map((s) => String(s.stepId));
  if (stepIds.join(',') !== 'step-1,step-2,step-3') {
    return fail(result, `expected ordered step ids got ${stepIds.join(',')}`);
  }

  // Exactly 3 ledger entries, no duplicates — handler was called 3 times.
  if (handlerState.calls !== 3) {
    return fail(result, `expected handler called 3 times; got ${handlerState.calls}`);
  }

  // cost.tokens > 0 — budget meter recorded spend from handler costHint.
  const spentTokens = record.budget?.spent.tokens ?? 0;
  if (!(spentTokens > 0)) {
    return fail(result, `expected record.budget.spent.tokens > 0; got ${spentTokens}`);
  }

  // Finalized JSON file present on disk.
  if (!existsSync(result.facts.finalizedPath as string)) {
    return fail(result, `expected finalized JSON at ${result.facts.finalizedPath}`);
  }

  return result;
}

/* ------------------------------------------------------------------------- */
/* Scenario 2 — Allow-list negative (planner emits a non-allow-listed tool)  */
/* ------------------------------------------------------------------------- */

export async function scenario2_allowListNegative(): Promise<ScenarioResult> {
  const workspace = newWorkspace('s2-allowlist');
  const handlerState = { calls: 0 };
  const agent = mkEchoAgent({
    // EchoAgent's default allow-list is [NOTES_APPEND]; the planner will
    // emit a step calling FS_DELETE which is NOT in the allow-list.
    notesAppendHandler: defaultNotesAppendHandler(handlerState),
    planner: (inputs): Plan => ({
      planId: 'echo-bad-step',
      intent: inputs.intent,
      steps: [
        {
          stepId: ('fs-delete-1') as never,
          tool: FS_DELETE,
          handlerId: 'fs.delete.handler',
          input: { path: '/etc/passwd' },
        },
      ],
      usage: { tokens: 1 },
    }),
  });
  const runtime = createRuntime({ workspace });
  runtime.registerAgent(agent);

  const invokeResult = await runtime.invoke(ECHO_AGENT_ID, {
    intent: 'try-fs-delete',
    context: {},
    tenantId: 't-acceptance',
    traceId: 'acc-2-allowlist',
  });
  const events = readEvents(workspace, invokeResult.runId);

  const result: ScenarioResult = {
    number: 2,
    name: 'allowListNegative',
    acceptanceLine:
      'Runtime never calls a non-allow-listed tool; attempts are logged and surfaced as a typed error.',
    description:
      'Same EchoAgent; planner emits a step calling fs.delete (not in allow-list).',
    invokeResult,
    workspace,
    events,
    facts: {
      handlerCalls: handlerState.calls,
    },
    failures: [],
  };

  // ---- Assertions (1:1 with §10 scenario 2) -------------------------------

  if (invokeResult.status !== 'failed') {
    return fail(
      result,
      `expected invoke.status='failed' got '${invokeResult.status}'`,
    );
  }
  const err = (invokeResult as { error?: { code?: string } }).error;
  if (err?.code !== 'NotAllowed') {
    return fail(
      result,
      `expected error.code='NotAllowed' got '${err?.code}' (error=${JSON.stringify(err)})`,
    );
  }

  // Run record includes the typed NotAllowed error.
  const recordedNotAllowed = invokeResult.record.errors.some((e) => e.code === 'NotAllowed');
  if (!recordedNotAllowed) {
    return fail(
      result,
      `expected NotAllowed in record.errors; got codes=${invokeResult.record.errors
        .map((e) => e.code)
        .join(',')}`,
    );
  }

  // notes.append is never called.
  if (handlerState.calls !== 0) {
    return fail(result, `expected handler NOT called; got ${handlerState.calls}`);
  }

  // The JSONL stream records an error event (first-class surface).
  const errorEvents = events.filter((e) => (e as { kind?: string }).kind === 'error');
  if (errorEvents.length === 0) {
    return fail(result, 'expected an error event in JSONL stream');
  }

  return result;
}

/* ------------------------------------------------------------------------- */
/* Scenario 3 — Idempotency property (5 calls same key → handler runs once)   */
/* ------------------------------------------------------------------------- */

export async function scenario3_idempotencyProperty(): Promise<ScenarioResult> {
  const workspace = newWorkspace('s3-idem');
  const handlerState = { calls: 0 };
  const agent = mkEchoAgent({
    notesAppendHandler: defaultNotesAppendHandler(handlerState),
    planner: (inputs): Plan => ({
      planId: 'echo-idem',
      intent: inputs.intent,
      steps: [
        {
          stepId: ('idem-step-1') as never,
          tool: NOTES_APPEND,
          handlerId: 'notes.append.handler',
          input: { note: `${inputs.intent}::shared` },
          // SAME key across all 5 invocations — this is what triggers dedupe.
          idempotencyKey: SHARED_IDEMPOTENCY_KEY,
        },
      ],
      usage: { tokens: 1 },
    }),
  });
  // Shared idempotency store so the 5 invocations all see the same cache.
  const idempotency: IdempotencyStore = new LruIdempotencyStore();
  const runtime = createRuntime({ workspace, idempotency });
  runtime.registerAgent(agent);

  // Inject the fault sequence [ok, 429, ok, 5xx, ok]: 5 separate runtime
  // invocations against the SAME (agentId, tool, idempotencyKey). Only
  // the FIRST call should reach the handler; the rest dedupe from the
  // cache. The "fault sequence" describes what the handler WOULD do if
  // called repeatedly — but the dedupe prevents all but the first call.
  const ids = ['acc-3-idem-1', 'acc-3-idem-2', 'acc-3-idem-3', 'acc-3-idem-4', 'acc-3-idem-5'];
  const results: InvokeResult[] = [];
  for (const traceId of ids) {
    const res = await runtime.invoke(ECHO_AGENT_ID, {
      intent: 'idem-shared-key',
      context: {},
      tenantId: 't-acceptance',
      traceId,
    });
    results.push(res);
  }

  // Use the first run's events / record for the failure surface.
  const firstResult = results[0]!;
  const events = readEvents(workspace, firstResult.runId);

  const result: ScenarioResult = {
    number: 3,
    name: 'idempotencyProperty',
    acceptanceLine:
      'Retries do not duplicate side effects when handlers return idempotency keys.',
    description:
      'Inject [ok, 429, ok, 5xx, ok] against the same notes.append call; ledger has exactly one entry.',
    invokeResult: firstResult,
    workspace,
    events,
    facts: {
      handlerCalls: handlerState.calls,
      invocations: results.length,
      cacheSize: idempotency.size(),
      statuses: results.map((r) => r.status),
    },
    failures: [],
  };

  // ---- Assertions (1:1 with §10 scenario 3) -------------------------------

  // The ledger (idempotency cache) has exactly one entry.
  if (idempotency.size() !== 1) {
    return fail(result, `expected idempotency cache size=1; got ${idempotency.size()}`);
  }

  // The handler ran exactly once across all 5 invocations — the "at most
  // once per unique key" invariant from §6.
  if (handlerState.calls !== 1) {
    return fail(result, `expected handler called once; got ${handlerState.calls}`);
  }

  // All 5 invocations succeeded (the cached result replays).
  const allSucceeded = results.every((r) => r.status === 'succeeded');
  if (!allSucceeded) {
    return fail(
      result,
      `expected all 5 invocations succeeded; got ${results.map((r) => r.status).join(',')}`,
    );
  }

  // Invocations 2-5 should carry an `idempotencyHit` on their step record.
  const replaysWithHit = results
    .slice(1)
    .map((r) =>
      r.status === 'succeeded' ? r.record.steps[0]?.idempotencyHit?.key : undefined,
    );
  const allReplaysDedupe = replaysWithHit.every((k) => k === SHARED_IDEMPOTENCY_KEY);
  if (!allReplaysDedupe) {
    return fail(
      result,
      `expected dedupe hits on invocations 2-5; got ${JSON.stringify(replaysWithHit)}`,
    );
  }

  return result;
}

/* ------------------------------------------------------------------------- */
/* Scenario 4 — Budget abort (tokenCeiling=1, planner reports 2 tokens)      */
/* ------------------------------------------------------------------------- */

export async function scenario4_budgetAbort(): Promise<ScenarioResult> {
  const workspace = newWorkspace('s4-budget');
  const handlerState = { calls: 0 };
  const agent = mkEchoAgent({
    notesAppendHandler: defaultNotesAppendHandler(handlerState),
    planner: (inputs): Plan => ({
      planId: 'echo-budget',
      intent: inputs.intent,
      steps: [
        {
          stepId: ('budget-step-1') as never,
          tool: NOTES_APPEND,
          handlerId: 'notes.append.handler',
          input: { note: `${inputs.intent}::never-called` },
          idempotencyKey: stepKey(99),
        },
      ],
      // Planner reports 2 tokens of usage. The pre-stage check at `act`
      // catches it against the 1-token ceiling; the handler is never called.
      usage: { tokens: 2 },
    }),
  });
  const runtime = createRuntime({ workspace });
  runtime.registerAgent(agent);

  const invokeResult = await runtime.invoke(ECHO_AGENT_ID, {
    intent: 'over-budget',
    context: {},
    tenantId: 't-acceptance',
    traceId: 'acc-4-budget',
    budget: { tokenCeiling: 1 },
  });
  const events = readEvents(workspace, invokeResult.runId);

  const result: ScenarioResult = {
    number: 4,
    name: 'budgetAbort',
    acceptanceLine:
      'Cost ceiling enforcement aborts the run with a typed error rather than silently exceeding budget.',
    description: 'EchoAgent with tokenCeiling=1; planner reports usage {tokens: 2}.',
    invokeResult,
    workspace,
    events,
    facts: { handlerCalls: handlerState.calls },
    failures: [],
  };

  // ---- Assertions (1:1 with §10 scenario 4) -------------------------------

  if (invokeResult.status !== 'budget_exceeded') {
    return fail(
      result,
      `expected status='budget_exceeded' got '${invokeResult.status}'`,
    );
  }
  const err = (invokeResult as { error?: { code?: string; spent?: { tokens?: number } } }).error;
  if (err?.code !== 'BudgetExceeded') {
    return fail(
      result,
      `expected error.code='BudgetExceeded' got '${err?.code}' (error=${JSON.stringify(err)})`,
    );
  }
  if ((err.spent?.tokens ?? 0) <= 1) {
    return fail(
      result,
      `expected error.spent.tokens > ceiling; got ${err.spent?.tokens}`,
    );
  }
  if (invokeResult.record.status !== 'budget_exceeded') {
    return fail(
      result,
      `expected record.status='budget_exceeded' got '${invokeResult.record.status}'`,
    );
  }

  // Zero tool calls fired.
  if (handlerState.calls !== 0) {
    return fail(result, `expected handler NOT called; got ${handlerState.calls}`);
  }

  return result;
}

/* ------------------------------------------------------------------------- */
/* Scenario 5 — Cancellation (mid-act cancel → status='cancelled')           */
/* ------------------------------------------------------------------------- */

export async function scenario5_cancellation(): Promise<ScenarioResult> {
  const workspace = newWorkspace('s5-cancel');
  const handlerState = { calls: 0, observedAbort: false };

  // Barrier: the handler resolves it as soon as it is invoked. The test
  // awaits the barrier before calling `runtime.cancel`, so cancel always
  // lands mid-act (after the handler started, while it is awaiting the
  // abort signal). This avoids any timing race.
  let resolveHandlerStarted!: () => void;
  const handlerStarted = new Promise<void>((resolve) => {
    resolveHandlerStarted = resolve;
  });

  // Deterministic mid-act cancel handler: blocks on ctx.signal until the
  // cancel token aborts it, then throws CancelledError. No timers, no race.
  const cancellableHandler: ToolHandler = async (_input, ctx) => {
    handlerState.calls += 1;
    resolveHandlerStarted();
    if (!ctx.signal) {
      throw new Error('acceptance scenario 5 expected ctx.signal to be defined');
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        handlerState.observedAbort = true;
        reject(new CancelledError('acceptance test'));
      };
      if (ctx.signal!.aborted) {
        return onAbort();
      }
      ctx.signal!.addEventListener('abort', onAbort, { once: true });
      // Safety net: if cancel never arrives within 5 s, fail loud so the
      // harness does not hang CI. The test asserts cancel arrives long
      // before this; the timer is a guard, not the assertion.
      setTimeout(() => {
        ctx.signal!.removeEventListener('abort', onAbort);
        resolve();
      }, 5_000);
    });
    return { ok: true };
  };

  const agent = mkEchoAgent({
    notesAppendHandler: cancellableHandler as EchoAgentOpts['notesAppendHandler'],
    sideEffect: 'read', // Avoid the write → idempotencyKey contract here.
  });

  const predictedRunId = asRunId('acc-5-cancel');
  const runtime = createRuntime({
    workspace,
    mintRunId: (): RunId => predictedRunId,
  });
  runtime.registerAgent(agent);

  // Start the run, wait for the handler to actually be invoked, then
  // cancel mid-act. The barrier is the only synchronization primitive —
  // no fixed delays, so the test is timing-independent.
  const promise = runtime.invoke(ECHO_AGENT_ID, {
    intent: 'cancel-me',
    context: {},
    tenantId: 't-acceptance',
    traceId: 'acc-5-cancel',
  });
  await handlerStarted;
  runtime.cancel(predictedRunId, 'acceptance test');

  const invokeResult = await promise;
  const events = readEvents(workspace, invokeResult.runId);

  const result: ScenarioResult = {
    number: 5,
    name: 'cancellation',
    acceptanceLine: '(Bonus) Cancellation behaves correctly.',
    description:
      'Start a run; call runtime.cancel(runId, reason) mid-act; assert Cancelled surfaces.',
    invokeResult,
    workspace,
    events,
    facts: {
      handlerCalls: handlerState.calls,
      signalObservedAbort: handlerState.observedAbort,
    },
    failures: [],
  };

  // ---- Assertions (1:1 with §10 scenario 5) -------------------------------

  // The handler must have been invoked exactly once before cancel arrived.
  if (handlerState.calls !== 1) {
    return fail(result, `expected handler invoked once; got ${handlerState.calls}`);
  }
  if (!handlerState.observedAbort) {
    return fail(result, 'expected ctx.signal abort to be observed by handler');
  }

  if (invokeResult.status !== 'cancelled') {
    return fail(
      result,
      `expected status='cancelled' got '${invokeResult.status}'`,
    );
  }
  const err = (invokeResult as { error?: { code?: string; reason?: string } }).error;
  if (err?.code !== 'Cancelled') {
    return fail(
      result,
      `expected error.code='Cancelled' got '${err?.code}' (error=${JSON.stringify(err)})`,
    );
  }
  if (err.reason !== 'acceptance test') {
    return fail(result, `expected error.reason='acceptance test' got '${err.reason}'`);
  }
  if (invokeResult.record.status !== 'cancelled') {
    return fail(
      result,
      `expected record.status='cancelled' got '${invokeResult.record.status}'`,
    );
  }

  return result;
}

/** Convenience: run all five in order, return their results. */
export async function runAllScenarios(): Promise<ScenarioResult[]> {
  const fns = [
    scenario1_happyPath,
    scenario2_allowListNegative,
    scenario3_idempotencyProperty,
    scenario4_budgetAbort,
    scenario5_cancellation,
  ];
  const out: ScenarioResult[] = [];
  for (const fn of fns) {
    out.push(await fn());
  }
  return out;
}

/** Format a `ScenarioResult` as a single-line summary suitable for CI logs. */
export function formatScenarioSummary(r: ScenarioResult): string {
  const verdict = r.failures.length === 0 ? 'PASS' : 'FAIL';
  return [
    `scenario ${r.number} ${r.name} [${verdict}]`,
    `  acceptance: ${r.acceptanceLine}`,
    `  status=${r.invokeResult.status}`,
    `  facts=${JSON.stringify(r.facts)}`,
    ...(r.failures.length === 0 ? [] : r.failures.map((f) => `  - ${f}`)),
  ].join('\n');
}

// Re-export the agent id used by the harness so callers do not need a
// second import path.
export { ECHO_AGENT_ID };
export type { AgentId };
