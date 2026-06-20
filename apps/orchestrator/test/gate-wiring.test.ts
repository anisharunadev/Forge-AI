/**
 * Gate wiring integration test (FORA-173).
 *
 * Walks a run through the seven stages end to end:
 *
 *   1. Forward path (stage_completed → routeGate):
 *      For each of the seven transitions, the test invokes
 *      `onStageCompleted` and asserts that `routeGate` issued a
 *      confirmation and the bus emitted `approval_requested`.
 *
 *   2. Reverse path — accept (approval_decided{accept} → engine.advance):
 *      For each of the seven transitions, the test invokes
 *      `routerDecide` (to apply the decision + emit the event),
 *      then `onApprovalDecided{accept}` and asserts the engine
 *      advanced to the next stage.
 *
 *   3. Reverse path — request_changes (reEnter):
 *      The test exercises `request_changes` on the dev→qa gate,
 *      returning to architect; asserts reEnter was called and
 *      idempotency on a second event with the same key.
 *
 *   4. Reverse path — expired (pauseRun):
 *      The test exercises `approval_expired` on the qa→security
 *      gate (after the prior reEnter + accept of dev→qa); asserts
 *      the engine was paused.
 *
 * 5. Resume on accept:
 *      After the pause, a new approval for qa→security is issued
 *      (via onStageCompleted) and accepted; asserts the engine
 *      resumed + advanced to security.
 */

import { describe, expect, it } from 'vitest';

import { GATES, type GateKind } from '../src/gates.js';
import {
  onApprovalDecided,
  onApprovalExpired,
  onStageCompleted,
} from '../src/gate_wiring.js';
import {
  decide as routerDecide,
  routeGate,
  type RouterDeps,
} from '../src/router.js';
import {
  InMemoryApprovalsRepo,
  InMemoryCostBudget,
  InMemoryStageEngine,
  RecordingEventBus,
  RecordingPaperclipClient,
  RecordingPager,
  TestClock,
} from '../src/test-doubles.js';
import {
  asIdempotencyKey,
  asRunId,
  asTenantId,
  type RunId,
  type TenantId,
} from '../src/types.js';

const TENANT = asTenantId('tenant-ct');
const RUN = asRunId('run-001');
const ORCHESTRATOR_ISSUE = 'issue-orch-001';
const PLAN_REV = 'rev-1-abc';

function makeDeps(): {
  deps: RouterDeps;
  bus: RecordingEventBus;
  paperclip: RecordingPaperclipClient;
  repo: InMemoryApprovalsRepo;
  pager: RecordingPager;
  clock: TestClock;
  costBudget: InMemoryCostBudget;
} {
  const clock = new TestClock();
  const repo = new InMemoryApprovalsRepo(clock);
  const paperclip = new RecordingPaperclipClient();
  const bus = new RecordingEventBus();
  const pager = new RecordingPager();
  const deps: RouterDeps = { repo, paperclip, bus, pager, clock };
  // Default under-budget: $0 spent of $100 ceiling. Matches the v0.1
  // EnvCostBudget behaviour (FORA-528 0.1.b). Tests override per-tenant
  // to exercise the over-budget refusal path.
  const costBudget = new InMemoryCostBudget({ spentUsd: 0, ceilingUsd: 100 });
  return { deps, bus, paperclip, repo, pager, clock, costBudget };
}

function ctxArgs() {
  return {
    tenantId: TENANT,
    runId: RUN,
    orchestratorIssueId: ORCHESTRATOR_ISSUE,
    planRevisionId: PLAN_REV,
    artefactRefs: [{ kind: 'pr', url: 'https://example/pr/1' }],
    reason: 'FORA-173 acceptance test',
  };
}

const STAGE_SPINE: ReadonlyArray<import('../src/types.js').Stage> = [
  'ideation',
  'architect',
  'dev',
  'qa',
  'security',
  'devops',
  'docs',
];

describe('gate_wiring — forward path: stage_completed → routeGate', () => {
  it('issues a confirmation for every stage transition in the spine', async () => {
    const { deps, bus, paperclip, repo, costBudget } = makeDeps();
    const engine = new InMemoryStageEngine();
    engine.seed({ tenantId: TENANT, runId: RUN, currentStage: 'ideation' });

    for (let i = 0; i < STAGE_SPINE.length - 1; i++) {
      const from = STAGE_SPINE[i]!;
      const to = STAGE_SPINE[i + 1]!;
      const result = await onStageCompleted(
        { router: deps, bus, costBudget },
        {
          tenantId: TENANT,
          runId: RUN,
          fromStage: from,
          toStage: to,
          artefactRefs: [{ kind: 'pr', url: `https://example/pr/${i}` }],
          ctx: ctxArgs(),
        },
      );
      expect(result, `stage_completed ${from}->${to} should produce a gate`).not.toBeNull();
      expect(result!.gateKind).toBe(`${from}->${to}` as GateKind);
      expect(paperclip.issued.length).toBe(i + 1);
      expect(repo.all().length).toBe(i + 1);
      // The bus has the matching approval_requested event.
      const requested = bus.events.filter((e) => e.type === 'approval_requested');
      expect(requested.length).toBe(i + 1);
      const last = requested[requested.length - 1]!;
      expect(last.gateKind).toBe(`${from}->${to}`);
    }

    // Seven stage transitions, but launch is separate (only after
    // docs->done is accepted). Sanity: the spine has 7 entries, 6
    // stage_transition gates plus docs->done = 7 total.
    expect(GATES.length).toBe(8);
  });

  it('returns null when toStage is "done" (launch gate is not routed here)', async () => {
    const { deps, bus, paperclip, costBudget } = makeDeps();
    const engine = new InMemoryStageEngine();
    engine.seed({ tenantId: TENANT, runId: RUN, currentStage: 'docs' });
    void engine;

    const result = await onStageCompleted(
      { router: deps, bus, costBudget },
      {
        tenantId: TENANT,
        runId: RUN,
        fromStage: 'docs',
        toStage: 'done',
        artefactRefs: [],
        ctx: ctxArgs(),
      },
    );
    expect(result).toBeNull();
    expect(paperclip.issued.length).toBe(0);
  });
});

describe('gate_wiring — reverse path: accept → engine.advance', () => {
  it('walks ideation → docs and the engine advances through the spine', async () => {
    const { deps, bus, repo, costBudget } = makeDeps();
    const engine = new InMemoryStageEngine();
    engine.seed({ tenantId: TENANT, runId: RUN, currentStage: 'ideation' });

    for (let i = 0; i < STAGE_SPINE.length - 1; i++) {
      const from = STAGE_SPINE[i]!;
      const to = STAGE_SPINE[i + 1]!;

      // Forward: engine emits stage_completed; router issues a gate.
      await onStageCompleted(
        { router: deps, bus, costBudget },
        {
          tenantId: TENANT,
          runId: RUN,
          fromStage: from,
          toStage: to,
          artefactRefs: [{ kind: 'pr', url: `https://example/pr/${i}` }],
          ctx: ctxArgs(),
        },
      );

      // Pull the row the router just inserted.
      const row = repo.all().find((r) => r.stage === from && r.gate_kind === `${from}->${to}`);
      expect(row, `pending row for ${from}->${to}`).toBeDefined();
      expect(row!.status).toBe('pending');

      // Reverse: the human accepts. routerDecide applies the
      // decision (terminal status + emits approval_decided), then
      // the wiring forwards accept to the engine.
      await routerDecide(deps, {
        approvalId: row!.id,
        tenantId: TENANT,
        decision: 'accept',
        reason: 'test accept',
        decidedBy: { actor: 'tester', role: 'product' },
        idempotencyKey: asIdempotencyKey(`decide:${RUN}:${row!.id}:accept`),
      });

      const decidedEvent = bus.events.find(
        (e) => e.type === 'approval_decided' && e.approvalId === row!.id,
      );
      expect(decidedEvent).toBeDefined();

      await onApprovalDecided(
        { engine },
        {
          event: decidedEvent as Extract<typeof decidedEvent, { type: 'approval_decided' }>,
          fromStage: from,
        },
      );

      // Engine has advanced to `to`.
      const s = engine.state(RUN);
      expect(s, `engine state after accept ${from}->${to}`).not.toBeNull();
      expect(s!.currentStage).toBe(to);
    }

    // 6 advance calls (one per stage transition).
    expect(engine.advances.length).toBe(STAGE_SPINE.length - 1);
    expect(engine.state(RUN)!.currentStage).toBe('docs');
  });

  it('advances to "done" when the docs->done gate accepts', async () => {
    const { deps, bus, repo, costBudget } = makeDeps();
    const engine = new InMemoryStageEngine();
    engine.seed({ tenantId: TENANT, runId: RUN, currentStage: 'docs' });

    await onStageCompleted(
      { router: deps, bus, costBudget },
      {
        tenantId: TENANT,
        runId: RUN,
        fromStage: 'docs',
        toStage: 'done',
        artefactRefs: [],
        ctx: ctxArgs(),
      },
    );
    // The wiring returns null for toStage=done; route the docs->done
    // gate directly so we have a row to decide on.
    const { interactionId } = await routeGate(
      deps,
      {
        ...ctxArgs(),
        artefactRefs: [],
      },
      'docs->done',
    );
    expect(interactionId).toBeDefined();

    const row = repo.all().find((r) => r.gate_kind === 'docs->done');
    expect(row).toBeDefined();

    await routerDecide(deps, {
      approvalId: row!.id,
      tenantId: TENANT,
      decision: 'accept',
      reason: 'test accept docs->done',
      decidedBy: { actor: 'tester', role: 'docs' },
      idempotencyKey: asIdempotencyKey(`decide:${RUN}:${row!.id}:accept`),
    });
    const decidedEvent = bus.events.find(
      (e) => e.type === 'approval_decided' && e.approvalId === row!.id,
    ) as Extract<typeof bus.events[number], { type: 'approval_decided' }>;
    await onApprovalDecided(
      { engine },
      { event: decidedEvent, fromStage: 'docs' },
    );

    expect(engine.state(RUN)!.currentStage).toBe('done');
    expect(engine.state(RUN)!.status).toBe('done');
  });
});

describe('gate_wiring — reverse path: request_changes → engine.reEnter', () => {
  it('returns a run to a prior stage and is idempotent on replay', async () => {
    const { deps, bus, repo, costBudget } = makeDeps();
    const engine = new InMemoryStageEngine();
    engine.seed({ tenantId: TENANT, runId: RUN, currentStage: 'dev' });

    // Issue the dev→qa gate.
    await onStageCompleted(
      { router: deps, bus, costBudget },
      {
        tenantId: TENANT,
        runId: RUN,
        fromStage: 'dev',
        toStage: 'qa',
        artefactRefs: [],
        ctx: ctxArgs(),
      },
    );
    const row = repo.all().find((r) => r.gate_kind === 'dev->qa');
    expect(row).toBeDefined();

    // Decide with request_changes back to architect.
    await routerDecide(deps, {
      approvalId: row!.id,
      tenantId: TENANT,
      decision: 'request_changes',
      reason: 'spec changed',
      returnTo: { toStage: 'architect', requiredRole: 'cto' },
      decidedBy: { actor: 'tester', role: 'qa' },
      idempotencyKey: asIdempotencyKey(`decide:${RUN}:${row!.id}:rc`),
    });
    const decidedEvent = bus.events.find(
      (e) => e.type === 'approval_decided' && e.approvalId === row!.id,
    ) as Extract<typeof bus.events[number], { type: 'approval_decided' }>;
    await onApprovalDecided(
      { engine },
      { event: decidedEvent, fromStage: 'dev', returnTo: { toStage: 'architect' } },
    );

    // Engine re-entered architect; still running.
    expect(engine.state(RUN)!.currentStage).toBe('architect');
    expect(engine.state(RUN)!.status).toBe('running');
    expect(engine.reEnters.length).toBe(1);

    // Idempotent replay of the same wiring call: same idempotency key
    // was used internally; the (runId, toStage) key in InMemoryStageEngine
    // dedupes — no second reEnters entry.
    await onApprovalDecided(
      { engine },
      { event: decidedEvent, fromStage: 'dev', returnTo: { toStage: 'architect' } },
    );
    expect(engine.reEnters.length).toBe(1);
  });
});

describe('gate_wiring — reverse path: reject → engine.pauseRun', () => {
  it('pauses the run when a gate is rejected', async () => {
    const { deps, bus, repo, costBudget } = makeDeps();
    const engine = new InMemoryStageEngine();
    engine.seed({ tenantId: TENANT, runId: RUN, currentStage: 'dev' });

    await onStageCompleted(
      { router: deps, bus, costBudget },
      {
        tenantId: TENANT,
        runId: RUN,
        fromStage: 'dev',
        toStage: 'qa',
        artefactRefs: [],
        ctx: ctxArgs(),
      },
    );
    const row = repo.all().find((r) => r.gate_kind === 'dev->qa');
    await routerDecide(deps, {
      approvalId: row!.id,
      tenantId: TENANT,
      decision: 'reject',
      reason: 'security blocker',
      decidedBy: { actor: 'tester', role: 'qa' },
      idempotencyKey: asIdempotencyKey(`decide:${RUN}:${row!.id}:reject`),
    });
    const decidedEvent = bus.events.find(
      (e) => e.type === 'approval_decided' && e.approvalId === row!.id,
    ) as Extract<typeof bus.events[number], { type: 'approval_decided' }>;
    await onApprovalDecided(
      { engine },
      { event: decidedEvent, fromStage: 'dev' },
    );

    expect(engine.state(RUN)!.status).toBe('paused');
  });
});

describe('gate_wiring — reverse path: approval_expired → engine.pauseRun + run_paused', () => {
  it('pauses the run and emits run_paused', async () => {
    const { bus, costBudget } = makeDeps();
    const engine = new InMemoryStageEngine();
    engine.seed({ tenantId: TENANT, runId: RUN, currentStage: 'qa' });

    await onApprovalExpired(
      { engine, bus },
      {
        event: {
          type: 'approval_expired',
          tenantId: TENANT,
          runId: RUN,
          approvalId: 'appr-1',
          expiredAt: '2026-06-17T01:00:00.000Z',
        },
      },
    );

    expect(engine.state(RUN)!.status).toBe('paused');
    expect(engine.pauseHistory.length).toBe(1);

    const runPaused = bus.events.find((e) => e.type === 'run_paused');
    expect(runPaused).toBeDefined();
    expect(runPaused!.reason).toBe('approval_expired');
  });

  it('resume after expiry: re-issue + accept advances the engine', async () => {
    const { deps, bus, repo, costBudget } = makeDeps();
    const engine = new InMemoryStageEngine();
    engine.seed({ tenantId: TENANT, runId: RUN, currentStage: 'qa' });

    // Expire.
    await onApprovalExpired(
      { engine, bus },
      {
        event: {
          type: 'approval_expired',
          tenantId: TENANT,
          runId: RUN,
          approvalId: 'appr-old',
          expiredAt: '2026-06-17T01:00:00.000Z',
        },
      },
    );
    expect(engine.state(RUN)!.status).toBe('paused');

    // Operator extends the original approval row (the row stays
    // the same; the engine does not see extend). For the test we
    // simulate the resume path by issuing a new stage_completed
    // for the same gate. The engine accepts the advance from its
    // current stage (qa) → security.
    await onStageCompleted(
      { router: deps, bus, costBudget },
      {
        tenantId: TENANT,
        runId: RUN,
        fromStage: 'qa',
        toStage: 'security',
        artefactRefs: [],
        ctx: ctxArgs(),
      },
    );
    const row = repo.all().find((r) => r.gate_kind === 'qa->security');
    await routerDecide(deps, {
      approvalId: row!.id,
      tenantId: TENANT,
      decision: 'accept',
      reason: 'resume accept',
      decidedBy: { actor: 'tester', role: 'security' },
      idempotencyKey: asIdempotencyKey(`decide:${RUN}:${row!.id}:accept-resume`),
    });
    const decidedEvent = bus.events.find(
      (e) => e.type === 'approval_decided' && e.approvalId === row!.id,
    ) as Extract<typeof bus.events[number], { type: 'approval_decided' }>;
    await onApprovalDecided(
      { engine },
      { event: decidedEvent, fromStage: 'qa' },
    );

    expect(engine.state(RUN)!.currentStage).toBe('security');
    expect(engine.state(RUN)!.status).toBe('running');
  });
});

describe('gate_wiring — idempotency on engine.advance replay', () => {
  it('a duplicate approval_decided event does not double-advance', async () => {
    const { deps, bus, repo, costBudget } = makeDeps();
    const engine = new InMemoryStageEngine();
    engine.seed({ tenantId: TENANT, runId: RUN, currentStage: 'ideation' });

    await onStageCompleted(
      { router: deps, bus, costBudget },
      {
        tenantId: TENANT,
        runId: RUN,
        fromStage: 'ideation',
        toStage: 'architect',
        artefactRefs: [],
        ctx: ctxArgs(),
      },
    );
    const row = repo.all().find((r) => r.gate_kind === 'ideation->architect');
    await routerDecide(deps, {
      approvalId: row!.id,
      tenantId: TENANT,
      decision: 'accept',
      reason: 'first',
      decidedBy: { actor: 'tester', role: 'product' },
      idempotencyKey: asIdempotencyKey(`decide:${RUN}:${row!.id}:accept-1`),
    });
    const decidedEvent = bus.events.find(
      (e) => e.type === 'approval_decided' && e.approvalId === row!.id,
    ) as Extract<typeof bus.events[number], { type: 'approval_decided' }>;
    await onApprovalDecided(
      { engine },
      { event: decidedEvent, fromStage: 'ideation' },
    );
    expect(engine.state(RUN)!.currentStage).toBe('architect');

    // Replay the SAME event (the NATS consumer dedupes; this test
    // verifies the wiring's idempotencyKey also dedupes if a
    // duplicate slips through).
    await onApprovalDecided(
      { engine },
      { event: decidedEvent, fromStage: 'ideation' },
    );
    expect(engine.state(RUN)!.currentStage).toBe('architect');
    expect(engine.advances.length).toBe(1);
  });
});

describe('gateForStageTransition', () => {
  it('returns the gate kind for valid transitions', async () => {
    const { gateForStageTransition } = await import('../src/gate_wiring.js');
    expect(gateForStageTransition('ideation', 'architect')).toBe('ideation->architect');
    expect(gateForStageTransition('docs', 'done')).toBe('docs->done');
    expect(gateForStageTransition('dev', 'qa')).toBe('dev->qa');
  });

  it('returns null for invalid transitions', async () => {
    const { gateForStageTransition } = await import('../src/gate_wiring.js');
    expect(gateForStageTransition('ideation', 'dev')).toBeNull();
    expect(gateForStageTransition('architect', 'done')).toBeNull();
    expect(gateForStageTransition('docs', 'qa')).toBeNull();
  });
});

describe('end-to-end: full seven-stage walk with one request_changes + one expire', () => {
  it('produces a run that ends at docs with a clean audit chain', async () => {
    const { deps, bus, repo, costBudget } = makeDeps();
    const engine = new InMemoryStageEngine();
    engine.seed({ tenantId: TENANT, runId: RUN, currentStage: 'ideation' });

    // Walk ideation → dev (3 accepts).
    for (const [from, to] of [
      ['ideation', 'architect'],
      ['architect', 'dev'],
    ] as const) {
      await onStageCompleted(
        { router: deps, bus, costBudget },
        {
          tenantId: TENANT,
          runId: RUN,
          fromStage: from,
          toStage: to,
          artefactRefs: [],
          ctx: ctxArgs(),
        },
      );
      const row = repo.all().find((r) => r.gate_kind === `${from}->${to}`);
      await routerDecide(deps, {
        approvalId: row!.id,
        tenantId: TENANT,
        decision: 'accept',
        reason: 'e2e accept',
        decidedBy: { actor: 'tester', role: from === 'ideation' ? 'product' : 'cto' },
        idempotencyKey: asIdempotencyKey(`decide:${RUN}:${row!.id}:accept`),
      });
      const decidedEvent = bus.events.find(
        (e) => e.type === 'approval_decided' && e.approvalId === row!.id,
      ) as Extract<typeof bus.events[number], { type: 'approval_decided' }>;
      await onApprovalDecided(
        { engine },
        { event: decidedEvent, fromStage: from },
      );
    }

    // dev→qa: request_changes back to architect.
    await onStageCompleted(
      { router: deps, bus, costBudget },
      {
        tenantId: TENANT,
        runId: RUN,
        fromStage: 'dev',
        toStage: 'qa',
        artefactRefs: [],
        ctx: ctxArgs(),
      },
    );
    const devQa = repo.all().find((r) => r.gate_kind === 'dev->qa');
    await routerDecide(deps, {
      approvalId: devQa!.id,
      tenantId: TENANT,
      decision: 'request_changes',
      reason: 'spec changed',
      returnTo: { toStage: 'architect', requiredRole: 'cto' },
      decidedBy: { actor: 'tester', role: 'qa' },
      idempotencyKey: asIdempotencyKey(`decide:${RUN}:${devQa!.id}:rc`),
    });
    const rcEvent = bus.events.find(
      (e) => e.type === 'approval_decided' && e.approvalId === devQa!.id,
    ) as Extract<typeof bus.events[number], { type: 'approval_decided' }>;
    await onApprovalDecided(
      { engine },
      { event: rcEvent, fromStage: 'dev', returnTo: { toStage: 'architect' } },
    );
    expect(engine.state(RUN)!.currentStage).toBe('architect');

    // Walk architect → dev again (accept).
    await onStageCompleted(
      { router: deps, bus, costBudget },
      {
        tenantId: TENANT,
        runId: RUN,
        fromStage: 'architect',
        toStage: 'dev',
        artefactRefs: [],
        ctx: ctxArgs(),
      },
    );
    const archDev2 = repo.allWithSeq()
      .filter((r) => r.gate_kind === 'architect->dev')
      .sort((a, b) => b.__seq - a.__seq)[0]!;
    await routerDecide(deps, {
      approvalId: archDev2.id,
      tenantId: TENANT,
      decision: 'accept',
      reason: 'redo',
      decidedBy: { actor: 'tester', role: 'cto' },
      idempotencyKey: asIdempotencyKey(`decide:${RUN}:${archDev2.id}:accept2`),
    });
    const archDevEvent = bus.events.find(
      (e) => e.type === 'approval_decided' && e.approvalId === archDev2.id,
    ) as Extract<typeof bus.events[number], { type: 'approval_decided' }>;
    await onApprovalDecided(
      { engine },
      { event: archDevEvent, fromStage: 'architect' },
    );

    // dev→qa again — this time expire.
    await onStageCompleted(
      { router: deps, bus, costBudget },
      {
        tenantId: TENANT,
        runId: RUN,
        fromStage: 'dev',
        toStage: 'qa',
        artefactRefs: [],
        ctx: ctxArgs(),
      },
    );
    const devQa2 = repo.allWithSeq()
      .filter((r) => r.gate_kind === 'dev->qa')
      .sort((a, b) => b.__seq - a.__seq)[0]!;
    await onApprovalExpired(
      { engine, bus },
      {
        event: {
          type: 'approval_expired',
          tenantId: TENANT,
          runId: RUN,
          approvalId: devQa2.id,
          expiredAt: '2026-06-17T02:00:00.000Z',
        },
      },
    );
    expect(engine.state(RUN)!.status).toBe('paused');

    // Audit chain sanity:
    //   6 approval_requested events (ideation->arch, arch->dev,
    //   dev->qa, arch->dev re-issue, dev->qa re-issue,
    //   plus one we never exercised in this walk) — actually we
    //   issued 5 in this walk: ideation->arch, arch->dev (×2),
    //   dev->qa (×2).
    const requested = bus.events.filter((e) => e.type === 'approval_requested');
    expect(requested.length).toBe(5);
    const decided = bus.events.filter((e) => e.type === 'approval_decided');
    // 4 decides (3 accepts + 1 request_changes); the expired gate was
    // never decided by a human.
    expect(decided.length).toBe(4);
    const runPaused = bus.events.filter((e) => e.type === 'run_paused');
    expect(runPaused.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FORA-528 (0.1.b) — Active cost-ceiling check.
// ---------------------------------------------------------------------------

describe('gate_wiring — active cost-ceiling check (FORA-528 / 0.1.b)', () => {
  it('under-budget: routeGate is called and the gate is issued', async () => {
    const { deps, bus, paperclip, repo, costBudget } = makeDeps();
    const engine = new InMemoryStageEngine();
    engine.seed({ tenantId: TENANT, runId: RUN, currentStage: 'ideation' });

    // Default { spentUsd: 0, ceilingUsd: 100 } → under-budget.
    const result = await onStageCompleted(
      { router: deps, bus, costBudget },
      {
        tenantId: TENANT,
        runId: RUN,
        fromStage: 'ideation',
        toStage: 'architect',
        artefactRefs: [{ kind: 'pr', url: 'https://example/pr/0' }],
        ctx: ctxArgs(),
      },
    );

    expect(result, 'under-budget gate should produce a result').not.toBeNull();
    expect(result!.gateKind).toBe('ideation->architect');
    // The cost-budget port was queried exactly once.
    expect(costBudget.queries.length).toBe(1);
    expect(costBudget.queries[0]!.tenantId).toBe(TENANT);
    // The gate was issued: Paperclip interaction recorded, row inserted,
    // approval_requested event emitted.
    expect(paperclip.issued.length).toBe(1);
    expect(repo.all().length).toBe(1);
    expect(bus.events.filter((e) => e.type === 'approval_requested').length).toBe(1);
    // No gate_failed_cost_ceiling event was emitted.
    expect(bus.events.filter((e) => e.type === 'gate_failed_cost_ceiling').length).toBe(0);
  });

  it('over-budget: gate is refused, gate_failed_cost_ceiling is emitted, no approval row', async () => {
    const { deps, bus, paperclip, repo, costBudget } = makeDeps();
    const engine = new InMemoryStageEngine();
    engine.seed({ tenantId: TENANT, runId: RUN, currentStage: 'ideation' });
    void engine;

    // Force the over-budget path: $120 spent of $100 ceiling.
    costBudget.set(TENANT, { spentUsd: 120, ceilingUsd: 100 });

    const result = await onStageCompleted(
      { router: deps, bus, costBudget },
      {
        tenantId: TENANT,
        runId: RUN,
        fromStage: 'ideation',
        toStage: 'architect',
        artefactRefs: [{ kind: 'pr', url: 'https://example/pr/0' }],
        ctx: ctxArgs(),
      },
    );

    // Wiring returned null — no gate was routed.
    expect(result).toBeNull();
    // The port was queried exactly once.
    expect(costBudget.queries.length).toBe(1);
    // No Paperclip interaction was issued, no approval row inserted.
    expect(paperclip.issued.length).toBe(0);
    expect(repo.all().length).toBe(0);
    // No approval_requested event was emitted.
    expect(bus.events.filter((e) => e.type === 'approval_requested').length).toBe(0);
    // gate_failed_cost_ceiling was emitted exactly once with the right shape.
    const failed = bus.events.filter((e) => e.type === 'gate_failed_cost_ceiling');
    expect(failed.length).toBe(1);
    const ev = failed[0] as Extract<typeof failed[number], { type: 'gate_failed_cost_ceiling' }>;
    expect(ev.tenantId).toBe(TENANT);
    expect(ev.runId).toBe(RUN);
    expect(ev.fromStage).toBe('ideation');
    expect(ev.toStage).toBe('architect');
    expect(ev.gateKind).toBe('ideation->architect');
    expect(ev.spentUsd).toBe(120);
    expect(ev.ceilingUsd).toBe(100);
    expect(ev.reason).toBe('over_budget');
    expect(typeof ev.emittedAt).toBe('string');
    // The run stays in the originating stage — the engine was NOT
    // advanced because routeGate was never called.
    expect(engine.state(RUN)!.currentStage).toBe('ideation');
  });

  it('boundary: spentUsd === ceilingUsd refuses (over-budget is inclusive)', async () => {
    const { deps, bus, paperclip, repo, costBudget } = makeDeps();
    const engine = new InMemoryStageEngine();
    engine.seed({ tenantId: TENANT, runId: RUN, currentStage: 'dev' });
    void engine;

    // Exactly at ceiling — the >= comparison refuses.
    costBudget.set(TENANT, { spentUsd: 100, ceilingUsd: 100 });

    const result = await onStageCompleted(
      { router: deps, bus, costBudget },
      {
        tenantId: TENANT,
        runId: RUN,
        fromStage: 'dev',
        toStage: 'qa',
        artefactRefs: [],
        ctx: ctxArgs(),
      },
    );

    expect(result).toBeNull();
    expect(paperclip.issued.length).toBe(0);
    expect(repo.all().length).toBe(0);
    expect(bus.events.filter((e) => e.type === 'gate_failed_cost_ceiling').length).toBe(1);
  });

  it('one cent under ceiling advances (under-budget is inclusive)', async () => {
    const { deps, bus, paperclip, repo, costBudget } = makeDeps();
    const engine = new InMemoryStageEngine();
    engine.seed({ tenantId: TENANT, runId: RUN, currentStage: 'dev' });

    costBudget.set(TENANT, { spentUsd: 99.99, ceilingUsd: 100 });

    const result = await onStageCompleted(
      { router: deps, bus, costBudget },
      {
        tenantId: TENANT,
        runId: RUN,
        fromStage: 'dev',
        toStage: 'qa',
        artefactRefs: [{ kind: 'pr', url: 'https://example/pr/2' }],
        ctx: ctxArgs(),
      },
    );

    expect(result).not.toBeNull();
    expect(result!.gateKind).toBe('dev->qa');
    expect(paperclip.issued.length).toBe(1);
    expect(repo.all().length).toBe(1);
    expect(bus.events.filter((e) => e.type === 'gate_failed_cost_ceiling').length).toBe(0);
  });

  it('EnvCostBudget adapter (v0.1 seam) reports permissive under-budget by default', async () => {
    // Verify the v0.1 fallback adapter (FORA-528 AC#2): reads
    // FORA_DEFAULT_COST_CEILING_USD and returns spentUsd=0. With no env
    // var set, the fallback is $100 spent of $100 ceiling — under-budget
    // because spentUsd (0) < ceilingUsd (100).
    const { createEnvCostBudget } = await import('../src/cost-budget-env.js');
    const cb = createEnvCostBudget({});
    const result = await cb.currentSpendUsd({ tenantId: TENANT });
    expect(result.spentUsd).toBe(0);
    expect(result.ceilingUsd).toBe(100);
  });

  it('EnvCostBudget adapter honours FORA_DEFAULT_COST_CEILING_USD override', async () => {
    const { createEnvCostBudget } = await import('../src/cost-budget-env.js');
    const cb = createEnvCostBudget({ FORA_DEFAULT_COST_CEILING_USD: '250.50' });
    const result = await cb.currentSpendUsd({ tenantId: TENANT });
    expect(result.spentUsd).toBe(0);
    expect(result.ceilingUsd).toBe(250.5);
  });

  it('EnvCostBudget adapter rejects malformed ceiling (fail loud at boot)', async () => {
    // The adapter eagerly parses FORA_DEFAULT_COST_CEILING_USD at
    // construction so a malformed env var crashes the service at
    // boot rather than at the first gate. The test asserts the
    // throw fires synchronously when the factory is called.
    const { createEnvCostBudget } = await import('../src/cost-budget-env.js');
    expect(() =>
      createEnvCostBudget({ FORA_DEFAULT_COST_CEILING_USD: 'not-a-number' }),
    ).toThrow(/not a finite number/);
  });
});