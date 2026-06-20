/**
 * StageEngine gRPC e2e (FORA-525 AC#4 + AC#2).
 *
 * Spins up the agent-runtime's in-memory gRPC server in-process, wires
 * a `GrpcStageEngine` client to it, and walks the seven-stage spine
 * through the live adapter. Mirrors the orchestrator's
 * `gate-wiring.test.ts` end-to-end scenario but uses the wire format
 * instead of the in-process `InMemoryStageEngine`. The two tests are
 * the FORA-173 ↔ FORA-525 regression pair: same shape, different
 * transport.
 *
 * Also exercises the factory: buildStageEngine(backend='grpc') returns
 * a GrpcStageEngine; buildStageEngine(backend='memory') returns an
 * InMemoryStageEngine. The factory's `memory` path is the FORA-173
 * fallback; the `grpc` path is the v0.1.7 production wiring.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildOrchestratorGrpcServer,
  buildStageEngine,
  GrpcStageEngine,
  InMemoryStageEngine,
  InvalidStageTransitionError,
  type OrchestratorGrpcServer,
  type StageEngine,
} from '../src/grpc/index.js';

const TENANT = 'tenant-ct-grpc';
const RUN = 'run-grpc-001';

describe('StageEngine gRPC e2e (FORA-525)', () => {
  let server: OrchestratorGrpcServer;
  let engine: StageEngine;

  beforeAll(async () => {
    server = buildOrchestratorGrpcServer({ host: '127.0.0.1', port: 0 });
    await server.start();
    server.seedRun({ tenantId: TENANT, runId: RUN, currentStage: 'ideation' });
    engine = buildStageEngine({ backend: 'grpc', grpcAddress: server.address });
  });

  afterAll(async () => {
    if (engine instanceof GrpcStageEngine) engine.close();
    await server.shutdown();
  });

  it('walks the full seven-stage spine via the live gRPC adapter', async () => {
    const stages: Array<[Stage, Stage]> = [
      ['ideation', 'architect'],
      ['architect', 'dev'],
      ['dev', 'qa'],
      ['qa', 'security'],
      ['security', 'devops'],
      ['devops', 'docs'],
    ];
    for (const [from, to] of stages) {
      const res = await engine.advance({
        tenantId: TENANT,
        runId: RUN,
        fromStage: from,
        toStage: to,
        idempotencyKey: `advance:${RUN}:${from}->${to}`,
      });
      expect(res.currentStage).toBe(to);
    }
    const terminal = await engine.advance({
      tenantId: TENANT,
      runId: RUN,
      fromStage: 'docs',
      toStage: 'done',
      idempotencyKey: `advance:${RUN}:docs->done`,
    });
    expect(terminal.currentStage).toBe('done');
  });

  it('reEnter is idempotent on the same idempotency key', async () => {
    const server2 = buildOrchestratorGrpcServer({ host: '127.0.0.1', port: 0 });
    await server2.start();
    const RUN2 = 'run-grpc-002';
    const engine2 = buildStageEngine({ backend: 'grpc', grpcAddress: server2.address });
    server2.seedRun({ tenantId: TENANT, runId: RUN2, currentStage: 'dev' });

    const r1 = await engine2.reEnter({
      tenantId: TENANT,
      runId: RUN2,
      fromStage: 'dev',
      toStage: 'architect',
      reason: 'spec changed',
      idempotencyKey: `reenter:${RUN2}:dev->architect`,
    });
    expect(r1.currentStage).toBe('architect');

    // Replay: same idempotency key, same args — should be a no-op.
    const r2 = await engine2.reEnter({
      tenantId: TENANT,
      runId: RUN2,
      fromStage: 'dev',
      toStage: 'architect',
      reason: 'spec changed',
      idempotencyKey: `reenter:${RUN2}:dev->architect`,
    });
    expect(r2.currentStage).toBe('architect');

    if (engine2 instanceof GrpcStageEngine) engine2.close();
    await server2.shutdown();
  });

  it('pauseRun is monotonic; a no-op on terminal', async () => {
    const server3 = buildOrchestratorGrpcServer({ host: '127.0.0.1', port: 0 });
    await server3.start();
    const RUN3 = 'run-grpc-003';
    const engine3 = buildStageEngine({ backend: 'grpc', grpcAddress: server3.address });
    server3.seedRun({ tenantId: TENANT, runId: RUN3, currentStage: 'qa' });

    await engine3.pauseRun({ tenantId: TENANT, runId: RUN3, approvalId: 'appr-1' });
    // Same key replays are no-ops.
    await engine3.pauseRun({ tenantId: TENANT, runId: RUN3, approvalId: 'appr-1' });

    // Drive to done and pause — should be a no-op.
    for (const [from, to] of [
      ['qa', 'security'],
      ['security', 'devops'],
      ['devops', 'docs'],
      ['docs', 'done'],
    ] as Array<[Stage, Stage | 'done']>) {
      await engine3.advance({
        tenantId: TENANT,
        runId: RUN3,
        fromStage: from,
        toStage: to,
        idempotencyKey: `advance:${RUN3}:${from}->${to}`,
      });
    }
    await expect(
      engine3.pauseRun({ tenantId: TENANT, runId: RUN3, approvalId: 'appr-2' }),
    ).resolves.toBeUndefined();

    if (engine3 instanceof GrpcStageEngine) engine3.close();
    await server3.shutdown();
  });

  it('InvalidStageTransitionError is raised on a stale fromStage', async () => {
    const server4 = buildOrchestratorGrpcServer({ host: '127.0.0.1', port: 0 });
    await server4.start();
    const RUN4 = 'run-grpc-004';
    const engine4 = buildStageEngine({ backend: 'grpc', grpcAddress: server4.address });
    server4.seedRun({ tenantId: TENANT, runId: RUN4, currentStage: 'qa' });

    // fromStage='dev' is stale (the run is at 'qa').
    await expect(
      engine4.advance({
        tenantId: TENANT,
        runId: RUN4,
        fromStage: 'dev',
        toStage: 'qa',
        idempotencyKey: `advance:${RUN4}:stale`,
      }),
    ).rejects.toBeInstanceOf(InvalidStageTransitionError);

    if (engine4 instanceof GrpcStageEngine) engine4.close();
    await server4.shutdown();
  });

  it('buildStageEngine picks grpc vs memory from backend', () => {
    const { client } = makeMockClient();
    const grpc = buildStageEngine({
      backend: 'grpc',
      grpcAddress: '127.0.0.1:0',
      // @ts-expect-error - mock has a wider surface
      grpcClient: client,
    });
    expect(grpc).toBeInstanceOf(GrpcStageEngine);

    const mem = buildStageEngine({
      backend: 'memory',
      inMemory: new InMemoryStageEngine(),
    });
    expect(mem).toBeInstanceOf(InMemoryStageEngine);
  });
});

type Stage =
  | 'ideation'
  | 'architect'
  | 'dev'
  | 'qa'
  | 'security'
  | 'devops'
  | 'docs';

interface RecordedCall {
  method: 'advanceStage' | 'pauseRun';
  req: unknown;
}

function makeMockClient(): {
  client: {
    advanceStage: (req: unknown, cb: (err: unknown, res: unknown) => void) => void;
    pauseRun: (req: unknown, cb: (err: unknown, res: unknown) => void) => void;
    healthCheck: (req: unknown, cb: (err: unknown, res: unknown) => void) => void;
  };
  recorded: RecordedCall[];
} {
  const recorded: RecordedCall[] = [];
  return {
    recorded,
    client: {
      advanceStage: (req, cb) => {
        recorded.push({ method: 'advanceStage', req });
        cb(null, {
          runId: (req as { runId: string }).runId,
          currentStage: (req as { toStage: string }).toStage,
          status: 'running',
        });
      },
      pauseRun: (req, cb) => {
        recorded.push({ method: 'pauseRun', req });
        cb(null, { runId: (req as { runId: string }).runId, currentStage: 'qa', status: 'paused' });
      },
      healthCheck: (_req, cb) => cb(null, { state: 'SERVING', version: '0.1.7' }),
    },
  };
}
