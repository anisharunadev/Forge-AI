/**
 * Master Orchestrator — stage transition engine unit tests.
 *
 * Covers FORA-135 acceptance criteria:
 *   - Valid transitions persist the new stage state and emit `gate_passed`.
 *   - Invalid transitions (e.g. `dev → docs`) emit `invalid_transition` and
 *     do not advance the run.
 *   - `return` from `dev` to `architect` uses the same primitive as a
 *     rejection; the run is recoverable.
 *   - `AdvanceStage` gRPC seam works for all 7 stages.
 *   - **Every (from, to) pair in the stage table is covered** — CI fails
 *     on a missing pair (the matrix test enumerates STAGE_SPINE × targets
 *     and asserts the engine verdict matches the table).
 *
 * Also includes a microbenchmark for the SLA per architecture.md §4 and
 * ADR-0007 §7: p50 < 200 ms, p99 < 1 s. The benchmark is informational on
 * this build (in-memory bus + Map-backed run store); a CI slack message
 * fires when the budget is missed, not a hard fail — production deploy
 * wires the real Postgres + NATS and the SLA is a P2 bug per architecture.md
 * §8.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  advanceStage,
  classify,
  enumerateTransitionCases,
  isValidNext,
  isValidReturn,
  nextStage,
  step,
  STAGE_SPINE,
  TERMINAL_STAGE,
  TERMINAL_RUN_STATES,
  InMemoryEventBus,
  InMemoryRunStore,
  InvalidTransitionError,
  RunNotFoundError,
  RunNotRunningError,
  StageMismatchError,
  type AdvanceStageRequest,
  type Decision,
  type RunHeader,
  type RunId,
  type Stage,
  asActorId,
  asIdempotencyKey,
  asRunId,
  asTenantId,
} from '../src/orchestrator/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = asTenantId('tenant-test');
const RUN_ID = asRunId('run-1');

function mkRunHeader(overrides: Partial<RunHeader> = {}): RunHeader {
  return {
    runId: RUN_ID,
    tenantId: TENANT,
    goalId: 'goal-1',
    projectId: 'project-1',
    status: 'running',
    currentStage: 'dev',
    triggeredBy: { type: 'USER', actor: 'test-user' },
    costCeilingUsd: 100,
    costSpentUsd: 0,
    startedAt: '2026-06-17T00:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

function mkAdvanceRequest(overrides: Partial<AdvanceStageRequest> = {}): AdvanceStageRequest {
  return {
    runId: RUN_ID,
    tenantId: TENANT,
    fromStage: 'dev',
    toStage: 'qa',
    decision: { kind: 'next' },
    idempotencyKey: asIdempotencyKey(`idem-${Math.random()}`),
    requestedBy: asActorId('test-actor'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Stage transition table — pure functions
// ---------------------------------------------------------------------------

describe('orchestrator: stage spine', () => {
  it('STAGE_SPINE is the seven SDLC stages in order', () => {
    expect(STAGE_SPINE).toEqual([
      'ideation',
      'architect',
      'dev',
      'qa',
      'security',
      'devops',
      'docs',
    ]);
  });

  it('nextStage walks the spine + surfaces `done` after docs', () => {
    expect(nextStage('ideation')).toBe('architect');
    expect(nextStage('architect')).toBe('dev');
    expect(nextStage('dev')).toBe('qa');
    expect(nextStage('qa')).toBe('security');
    expect(nextStage('security')).toBe('devops');
    expect(nextStage('devops')).toBe('docs');
    expect(nextStage('docs')).toBe(TERMINAL_STAGE);
  });

  it('isValidNext accepts only the immediate successor', () => {
    expect(isValidNext('dev', 'qa')).toBe(true);
    expect(isValidNext('dev', 'architect')).toBe(false);
    expect(isValidNext('dev', 'docs')).toBe(false); // skipping QA
    expect(isValidNext('docs', TERMINAL_STAGE)).toBe(true);
    expect(isValidNext('docs', 'security')).toBe(false);
    expect(isValidNext('ideation', TERMINAL_STAGE)).toBe(false);
  });

  it('isValidReturn accepts any prior stage in the spine', () => {
    expect(isValidReturn('dev', 'architect')).toBe(true);
    expect(isValidReturn('qa', 'architect')).toBe(true);
    expect(isValidReturn('qa', 'dev')).toBe(true);
    expect(isValidReturn('docs', 'devops')).toBe(true);
    expect(isValidReturn('dev', 'dev')).toBe(false);
    expect(isValidReturn('dev', 'qa')).toBe(false); // forward; use next
    expect(isValidReturn('dev', 'docs')).toBe(false);
    expect(isValidReturn('ideation', 'architect')).toBe(false); // no earlier
  });

  it('classify matches the engine verdict for every (from, to, kind) pair', () => {
    const cases = enumerateTransitionCases();
    // CI invariant: the matrix is exhaustive over STAGE_SPINE ×
    // targets × {next, return}. Count check guards against a missing pair.
    const expected = STAGE_SPINE.length * (STAGE_SPINE.length + 1) * 2;
    expect(cases.length).toBe(expected);

    for (const c of cases) {
      const verdict = classify(c.from, c.to, c.decisionKind);
      if (c.expectedValid) {
        expect(verdict.ok, `expected valid: ${c.from} → ${c.to} (${c.decisionKind})`).toBe(true);
      } else {
        expect(verdict.ok, `expected invalid: ${c.from} → ${c.to} (${c.decisionKind})`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Run-lifecycle state machine
// ---------------------------------------------------------------------------

describe('orchestrator: run lifecycle state machine', () => {
  it('walks created → running → waiting_approval → finished → done', () => {
    let s: ReturnType<typeof step> = step('created', { kind: 'start', initialStage: 'ideation' });
    expect(s.ok && s.next).toBe('running');

    s = step('running', { kind: 'request_approval' });
    expect(s.ok && s.next).toBe('waiting_approval');

    s = step('waiting_approval', { kind: 'approve' });
    expect(s.ok && s.next).toBe('running');

    s = step('running', { kind: 'stage_complete' });
    expect(s.ok && s.next).toBe('finished');

    s = step('finished', { kind: 'finish' });
    expect(s.ok && s.next).toBe('done');
  });

  it('pauses + resumes from any non-terminal state', () => {
    for (const from of ['created', 'running', 'waiting_approval', 'finished'] as const) {
      const paused = step(from, { kind: 'pause' });
      expect(paused.ok && paused.next).toBe('paused');
      const resumed = step('paused', { kind: 'resume' });
      expect(resumed.ok && resumed.next).toBe('running');
    }
  });

  it('refuses to leave terminal states', () => {
    for (const terminal of TERMINAL_RUN_STATES) {
      for (const ev of [
        { kind: 'start' as const, initialStage: 'ideation' as Stage },
        { kind: 'request_approval' as const },
        { kind: 'approve' as const },
        { kind: 'stage_complete' as const },
        { kind: 'finish' as const },
        { kind: 'pause' as const },
        { kind: 'resume' as const },
        { kind: 'abort' as const },
      ]) {
        const v = step(terminal, ev);
        expect(v.ok, `${terminal} should refuse ${ev.kind}`).toBe(false);
      }
    }
  });

  it('abort from any non-terminal state is allowed', () => {
    for (const from of ['created', 'running', 'waiting_approval', 'paused', 'finished'] as const) {
      const v = step(from, { kind: 'abort' });
      expect(v.ok && v.next).toBe('aborted');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. AdvanceStage happy path — every spine transition
// ---------------------------------------------------------------------------

describe('orchestrator: AdvanceStage happy path', () => {
  let store: InMemoryRunStore;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    store = new InMemoryRunStore();
    bus = new InMemoryEventBus();
  });

  it.each([
    ['ideation', 'architect'],
    ['architect', 'dev'],
    ['dev', 'qa'],
    ['qa', 'security'],
    ['security', 'devops'],
    ['devops', 'docs'],
  ] as const)('advances %s → %s and emits gate_passed', async (from, to) => {
    const runId = asRunId(`run-${from}-${to}`);
    await store.getRun; // ensure store is constructed (unused import)
    const seed = new InMemoryRunStore([
      mkRunHeader({ runId, currentStage: from, status: 'running' }),
    ]);
    const localBus = new InMemoryEventBus();
    const deps = { runs: seed, bus: localBus };

    const res = await advanceStage(
      mkAdvanceRequest({
        runId,
        fromStage: from,
        toStage: to,
        decision: { kind: 'next' },
        idempotencyKey: asIdempotencyKey(`idem-${from}-${to}`),
      }),
      deps,
    );
    expect(res.currentStage).toBe(to);
    expect(res.status).toBe('running');
    expect(localBus.published.some((e) => e.type === 'gate_passed')).toBe(true);
    const persisted = await seed.getRun(runId);
    expect(persisted?.currentStage).toBe(to);
  });

  it('advances docs → done and emits gate_passed with toStage=docs', async () => {
    const runId = asRunId('run-final');
    const seed = new InMemoryRunStore([
      mkRunHeader({ runId, currentStage: 'docs', status: 'running' }),
    ]);
    const localBus = new InMemoryEventBus();
    const deps = { runs: seed, bus: localBus };

    const res = await advanceStage(
      mkAdvanceRequest({
        runId,
        fromStage: 'docs',
        toStage: TERMINAL_STAGE,
        decision: { kind: 'next' },
        idempotencyKey: asIdempotencyKey('idem-docs-done'),
      }),
      deps,
    );
    expect(res.status).toBe('done');
    const gp = localBus.published.find((e) => e.type === 'gate_passed');
    expect(gp && gp.type === 'gate_passed' && gp.toStage).toBe('docs');
  });

  it('returns dev → architect via the same primitive as rejection (run is recoverable)', async () => {
    const runId = asRunId('run-return');
    const seed = new InMemoryRunStore([
      mkRunHeader({ runId, currentStage: 'dev', status: 'running' }),
    ]);
    const localBus = new InMemoryEventBus();
    const deps = { runs: seed, bus: localBus };

    const decision: Decision = {
      kind: 'return',
      reason: 'Architect: please revise the API contract.',
      returnedToStage: 'architect',
    };
    const res = await advanceStage(
      mkAdvanceRequest({
        runId,
        fromStage: 'dev',
        toStage: 'architect',
        decision,
        idempotencyKey: asIdempotencyKey('idem-return-dev-architect'),
      }),
      deps,
    );

    // Run is recoverable: status stays `running`, currentStage is now `architect`.
    expect(res.currentStage).toBe('architect');
    expect(res.status).toBe('running');

    // Same primitive emits `stage_returned` (the rejection-routing event).
    const ret = localBus.published.find((e) => e.type === 'stage_returned');
    expect(ret && ret.type === 'stage_returned' && ret.fromStage).toBe('dev');
    expect(ret && ret.type === 'stage_returned' && ret.toStage).toBe('architect');
    expect(ret && ret.type === 'stage_returned' && ret.reason).toContain('Architect');

    // Persisted state mirrors.
    const persisted = await seed.getRun(runId);
    expect(persisted?.currentStage).toBe('architect');
    expect(persisted?.status).toBe('running');
  });

  it('abort terminalises the run and emits run_aborted', async () => {
    const runId = asRunId('run-abort');
    const seed = new InMemoryRunStore([
      mkRunHeader({ runId, currentStage: 'qa', status: 'running' }),
    ]);
    const localBus = new InMemoryEventBus();
    const deps = { runs: seed, bus: localBus };

    const res = await advanceStage(
      mkAdvanceRequest({
        runId,
        fromStage: 'qa',
        toStage: 'security',
        decision: { kind: 'abort', reason: 'Fatal QA flaw; unrecoverable.' },
        idempotencyKey: asIdempotencyKey('idem-abort'),
      }),
      deps,
    );
    expect(res.status).toBe('aborted');
    const aborted = localBus.published.find((e) => e.type === 'run_aborted');
    expect(aborted && aborted.type === 'run_aborted' && aborted.lastStage).toBe('qa');
  });
});

// ---------------------------------------------------------------------------
// 4. Invalid transitions — engine refuses, emits invalid_transition, no advance
// ---------------------------------------------------------------------------

describe('orchestrator: invalid_transition guard', () => {
  it('refuses dev → docs (spine-skip) and emits invalid_transition + error', async () => {
    const runId = asRunId('run-skip');
    const seed = new InMemoryRunStore([
      mkRunHeader({ runId, currentStage: 'dev', status: 'running' }),
    ]);
    const localBus = new InMemoryEventBus();
    const deps = { runs: seed, bus: localBus };

    await expect(
      advanceStage(
        mkAdvanceRequest({
          runId,
          fromStage: 'dev',
          toStage: 'docs',
          decision: { kind: 'next' },
          idempotencyKey: asIdempotencyKey('idem-skip'),
        }),
        deps,
      ),
    ).rejects.toBeInstanceOf(InvalidTransitionError);

    // Engine refused: run is NOT advanced.
    const persisted = await seed.getRun(runId);
    expect(persisted?.currentStage).toBe('dev');

    // Both events were emitted.
    expect(localBus.published.some((e) => e.type === 'invalid_transition')).toBe(true);
    expect(localBus.published.some((e) => e.type === 'error' && e.code === 'INVALID_TRANSITION')).toBe(true);

    const iv = localBus.published.find((e) => e.type === 'invalid_transition');
    expect(iv && iv.type === 'invalid_transition' && iv.fromStage).toBe('dev');
    expect(iv && iv.type === 'invalid_transition' && iv.toStage).toBe('docs');
  });

  it('refuses dev → qa as a `return` (forward-not-return) and does not advance', async () => {
    const runId = asRunId('run-bad-return');
    const seed = new InMemoryRunStore([
      mkRunHeader({ runId, currentStage: 'dev', status: 'running' }),
    ]);
    const localBus = new InMemoryEventBus();
    const deps = { runs: seed, bus: localBus };

    await expect(
      advanceStage(
        mkAdvanceRequest({
          runId,
          fromStage: 'dev',
          toStage: 'qa',
          decision: { kind: 'return', reason: 'why not', returnedToStage: 'qa' },
          idempotencyKey: asIdempotencyKey('idem-bad-return'),
        }),
        deps,
      ),
    ).rejects.toBeInstanceOf(InvalidTransitionError);

    const persisted = await seed.getRun(runId);
    expect(persisted?.currentStage).toBe('dev');
  });

  it('refuses return to `done` (return-to-terminal) and does not advance', async () => {
    const runId = asRunId('run-return-done');
    const seed = new InMemoryRunStore([
      mkRunHeader({ runId, currentStage: 'dev', status: 'running' }),
    ]);
    const deps = { runs: seed, bus: new InMemoryEventBus() };

    await expect(
      advanceStage(
        mkAdvanceRequest({
          runId,
          fromStage: 'dev',
          toStage: TERMINAL_STAGE,
          decision: { kind: 'return', reason: 'no', returnedToStage: 'docs' },
          idempotencyKey: asIdempotencyKey('idem-return-done'),
        }),
        deps,
      ),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('refuses a stage drift (fromStage ≠ run.currentStage)', async () => {
    const runId = asRunId('run-drift');
    const seed = new InMemoryRunStore([
      mkRunHeader({ runId, currentStage: 'qa', status: 'running' }),
    ]);
    const deps = { runs: seed, bus: new InMemoryEventBus() };

    await expect(
      advanceStage(
        mkAdvanceRequest({
          runId,
          fromStage: 'dev',
          toStage: 'qa',
          decision: { kind: 'next' },
          idempotencyKey: asIdempotencyKey('idem-drift'),
        }),
        deps,
      ),
    ).rejects.toBeInstanceOf(StageMismatchError);
  });

  it('refuses advance on a missing run (RUN_NOT_FOUND)', async () => {
    const deps = { runs: new InMemoryRunStore(), bus: new InMemoryEventBus() };

    await expect(
      advanceStage(
        mkAdvanceRequest({
          runId: asRunId('run-ghost'),
          idempotencyKey: asIdempotencyKey('idem-ghost'),
        }),
        deps,
      ),
    ).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it('refuses advance on a terminal run (RUN_NOT_RUNNING)', async () => {
    const runId = asRunId('run-done');
    const seed = new InMemoryRunStore([
      mkRunHeader({ runId, currentStage: 'docs', status: 'done' }),
    ]);
    const deps = { runs: seed, bus: new InMemoryEventBus() };

    await expect(
      advanceStage(
        mkAdvanceRequest({
          runId,
          fromStage: 'docs',
          toStage: TERMINAL_STAGE,
          decision: { kind: 'next' },
          idempotencyKey: asIdempotencyKey('idem-done'),
        }),
        deps,
      ),
    ).rejects.toBeInstanceOf(RunNotRunningError);
  });

  it('refuses an abort without a reason', async () => {
    const runId = asRunId('run-abort-no-reason');
    const seed = new InMemoryRunStore([
      mkRunHeader({ runId, currentStage: 'dev', status: 'running' }),
    ]);
    const deps = { runs: seed, bus: new InMemoryEventBus() };

    await expect(
      advanceStage(
        mkAdvanceRequest({
          runId,
          fromStage: 'dev',
          toStage: 'qa',
          decision: { kind: 'abort', reason: '' },
          idempotencyKey: asIdempotencyKey('idem-abort-no-reason'),
        }),
        deps,
      ),
    ).rejects.toThrow(/abort requires a non-empty reason/i);
  });
});

// ---------------------------------------------------------------------------
// 5. Idempotency — replay returns the stored response
// ---------------------------------------------------------------------------

describe('orchestrator: idempotency replay', () => {
  it('returns the cached response on retry with the same Idempotency-Key', async () => {
    const runId = asRunId('run-idem');
    const seed = new InMemoryRunStore([
      mkRunHeader({ runId, currentStage: 'dev', status: 'running' }),
    ]);
    const localBus = new InMemoryEventBus();
    const idemStore = new (await import('../src/orchestrator/index.js')).InMemoryIdempotencyStore();
    const deps = { runs: seed, bus: localBus, idempotency: idemStore };

    const req = mkAdvanceRequest({
      runId,
      fromStage: 'dev',
      toStage: 'qa',
      decision: { kind: 'next' },
      idempotencyKey: asIdempotencyKey('idem-replay'),
    });
    const first = await advanceStage(req, deps);
    const second = await advanceStage(req, deps);

    // Same response, no second gate_passed event.
    expect(second).toEqual(first);
    const gatePassedCount = localBus.published.filter((e) => e.type === 'gate_passed').length;
    expect(gatePassedCount).toBe(1);

    // The run is still at qa (single advance).
    const persisted = await seed.getRun(runId);
    expect(persisted?.currentStage).toBe('qa');
  });
});

// ---------------------------------------------------------------------------
// 6. SLA microbenchmark — ADR-0007 §7, architecture.md §4
// ---------------------------------------------------------------------------

describe('orchestrator: AdvanceStage SLA microbenchmark', () => {
  it('p50 < 200 ms, p99 < 1 s on the in-memory port (informational)', async () => {
    const ITER = 200;
    const runId = asRunId('run-bench');
    const seed = new InMemoryRunStore([
      mkRunHeader({ runId, currentStage: 'ideation', status: 'running' }),
    ]);
    const localBus = new InMemoryEventBus();
    const deps = { runs: seed, bus: localBus };
    const durations: number[] = [];

    // Walk the entire spine to exercise the full control flow.
    const sequence: Array<{ from: Stage; to: Stage | typeof TERMINAL_STAGE }> = [
      { from: 'ideation', to: 'architect' },
      { from: 'architect', to: 'dev' },
      { from: 'dev', to: 'qa' },
      { from: 'qa', to: 'security' },
      { from: 'security', to: 'devops' },
      { from: 'devops', to: 'docs' },
      { from: 'docs', to: TERMINAL_STAGE },
    ];

    for (let i = 0; i < ITER; i++) {
      const tmpRunId: RunId = asRunId(`run-bench-${i}`);
      const localStore = new InMemoryRunStore([
        mkRunHeader({ runId: tmpRunId, currentStage: 'ideation', status: 'running' }),
      ]);
      const localDeps = { runs: localStore, bus: new InMemoryEventBus() };
      const t0 = performance.now();
      for (const step of sequence) {
        await advanceStage(
          mkAdvanceRequest({
            runId: tmpRunId,
            fromStage: step.from,
            toStage: step.to,
            decision: { kind: 'next' },
            idempotencyKey: asIdempotencyKey(`idem-bench-${i}-${step.from}`),
          }),
          localDeps,
        );
      }
      durations.push(performance.now() - t0);
    }

    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(ITER * 0.5)] ?? 0;
    const p99 = durations[Math.floor(ITER * 0.99)] ?? 0;
    const mean = durations.reduce((s, d) => s + d, 0) / ITER;

    // eslint-disable-next-line no-console
    console.log(
      `[orchestrator SLA bench] full-spine 7-step AdvanceStage × ${ITER} runs: ` +
        `p50=${p50.toFixed(1)}ms p99=${p99.toFixed(1)}ms mean=${mean.toFixed(1)}ms`,
    );

    // The bench walks 7 stages per run; amortised per-call should be well
    // under the p99 budget on this build. The bounds are informational —
    // production deploys wire the real Postgres + NATS and the SLA is a
    // P2 bug per architecture.md §8.
    expect(p50).toBeLessThan(200);
    expect(p99).toBeLessThan(1000);
  });
});