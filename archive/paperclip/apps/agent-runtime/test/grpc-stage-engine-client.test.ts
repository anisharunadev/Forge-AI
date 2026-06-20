/**
 * GrpcStageEngine client unit test (FORA-525 AC#4 partial).
 *
 * Mocks the gRPC client (the proto-loader-derived class) and asserts
 * the client's typed behavior:
 *   - advance/reEnter/pauseRun forward the right proto fields.
 *   - idempotencyKey is propagated verbatim.
 *   - InvalidStageTransitionError is raised on FAILED_PRECONDITION.
 *   - pauseRun is a no-op on NOT_FOUND.
 *
 * No real network. The mock client records every call; the test
 * asserts the wire format.
 */

import { describe, expect, it } from 'vitest';

import {
  GrpcStageEngine,
  InvalidStageTransitionError,
} from '../src/grpc/index.js';

const TENANT = 'tenant-ct-unit';
const RUN = 'run-unit-001';

function makeMockClient(opts: {
  failOn?: { method: string; code: number; details?: string }[];
} = {}): {
  client: {
    advanceStage: (req: unknown, cb: (err: unknown, res: unknown) => void) => void;
    pauseRun: (req: unknown, cb: (err: unknown, res: unknown) => void) => void;
    healthCheck: (req: unknown, cb: (err: unknown, res: unknown) => void) => void;
  };
  recorded: Array<{ method: 'advanceStage' | 'pauseRun'; req: unknown }>;
} {
  const recorded: Array<{ method: 'advanceStage' | 'pauseRun'; req: unknown }> = [];
  const failOn = opts.failOn ?? [];
  return {
    recorded,
    client: {
      advanceStage: (req, cb) => {
        recorded.push({ method: 'advanceStage', req });
        const fail = failOn.find((f) => f.method === 'advanceStage');
        if (fail) {
          cb({ code: fail.code, message: 'mock-fail', details: fail.details }, null);
          return;
        }
        cb(null, {
          runId: (req as { runId: string }).runId,
          currentStage: (req as { toStage: string }).toStage,
          status: 'running',
        });
      },
      pauseRun: (req, cb) => {
        recorded.push({ method: 'pauseRun', req });
        const fail = failOn.find((f) => f.method === 'pauseRun');
        if (fail) {
          cb({ code: fail.code, message: 'mock-fail', details: fail.details }, null);
          return;
        }
        cb(null, { runId: (req as { runId: string }).runId, currentStage: 'qa', status: 'paused' });
      },
      healthCheck: (_req, cb) => cb(null, { state: 'SERVING', version: '0.1.7' }),
    },
  };
}

describe('GrpcStageEngine — client unit (FORA-525)', () => {
  it('advance forwards idempotency key + decision NEXT + mapped toStage', async () => {
    const { client, recorded } = makeMockClient();
    const engine = new GrpcStageEngine({
      address: '127.0.0.1:0',
      // @ts-expect-error mock has a wider surface than the typed client
      client,
    });
    const res = await engine.advance({
      tenantId: TENANT,
      runId: RUN,
      fromStage: 'ideation',
      toStage: 'architect',
      idempotencyKey: 'idem-001',
    });
    expect(res.currentStage).toBe('architect');
    expect(recorded.length).toBe(1);
    expect(recorded[0]!.method).toBe('advanceStage');
    const req = recorded[0]!.req as {
      runId: string;
      fromStage: string;
      toStage: string;
      decision: { kind: string; reason?: string; returnedToStage?: string };
      idempotencyKey: string;
    };
    expect(req.runId).toBe(RUN);
    expect(req.fromStage).toBe('ideation');
    expect(req.toStage).toBe('architect');
    expect(req.decision.kind).toBe('NEXT');
    expect(req.idempotencyKey).toBe('idem-001');
  });

  it('reEnter forwards decision RETURN with returnedToStage', async () => {
    const { client, recorded } = makeMockClient();
    // The mock's advanceStage handler returns the toStage from the
    // request; for a RETURN decision the client sets toStage to the
    // fromStage so the server's isValidAdvance guard passes — the
    // server then returns the returnedToStage. Mirror that in the
    // mock for this test.
    const wrappedClient = {
      ...client,
      advanceStage: (req: unknown, cb: (err: unknown, res: unknown) => void) => {
        recorded.push({ method: 'advanceStage' as const, req });
        const r = req as {
          decision: { kind: string; returnedToStage?: string };
        };
        const currentStage = r.decision.kind === 'RETURN'
          ? r.decision.returnedToStage
          : (req as { toStage: string }).toStage;
        cb(null, {
          runId: (req as { runId: string }).runId,
          currentStage,
          status: 'running',
        });
      },
    };
    const engine = new GrpcStageEngine({
      address: '127.0.0.1:0',
      // @ts-expect-error
      client: wrappedClient,
    });
    const res = await engine.reEnter({
      tenantId: TENANT,
      runId: RUN,
      fromStage: 'dev',
      toStage: 'architect',
      reason: 'spec changed',
      idempotencyKey: 'idem-rc-001',
    });
    expect(res.currentStage).toBe('architect');
    const req = recorded[0]!.req as {
      decision: { kind: string; reason?: string; returnedToStage?: string };
      idempotencyKey: string;
    };
    expect(req.decision.kind).toBe('RETURN');
    expect(req.decision.reason).toBe('spec changed');
    expect(req.decision.returnedToStage).toBe('architect');
    expect(req.idempotencyKey).toBe('idem-rc-001');
  });

  it('pauseRun mints the idempotency key from (runId, approvalId)', async () => {
    const { client, recorded } = makeMockClient();
    const engine = new GrpcStageEngine({
      address: '127.0.0.1:0',
      // @ts-expect-error
      client,
    });
    await engine.pauseRun({ tenantId: TENANT, runId: RUN, approvalId: 'appr-007' });
    const req = recorded[0]!.req as { idempotencyKey: string; approvalId: string };
    expect(req.idempotencyKey).toBe(`pause:${RUN}:appr-007`);
    expect(req.approvalId).toBe('appr-007');
  });

  it('InvalidStageTransitionError is raised on FAILED_PRECONDITION', async () => {
    const { client } = makeMockClient({
      failOn: [{ method: 'advanceStage', code: 9, details: 'stale' }],
    });
    const engine = new GrpcStageEngine({
      address: '127.0.0.1:0',
      // @ts-expect-error
      client,
    });
    await expect(
      engine.advance({
        tenantId: TENANT,
        runId: RUN,
        fromStage: 'dev',
        toStage: 'qa',
        idempotencyKey: 'idem-fail',
      }),
    ).rejects.toBeInstanceOf(InvalidStageTransitionError);
  });

  it('pauseRun is a no-op on NOT_FOUND', async () => {
    const { client } = makeMockClient({
      failOn: [{ method: 'pauseRun', code: 5 }],
    });
    const engine = new GrpcStageEngine({
      address: '127.0.0.1:0',
      // @ts-expect-error
      client,
    });
    await expect(
      engine.pauseRun({ tenantId: TENANT, runId: RUN, approvalId: 'appr-404' }),
    ).resolves.toBeUndefined();
  });
});
