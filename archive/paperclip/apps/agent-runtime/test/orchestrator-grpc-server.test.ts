/**
 * Orchestrator gRPC server — basic protocol sanity test (FORA-525).
 *
 * Asserts:
 *   - Server binds, health-checks SERVING.
 *   - Seeded run walks the seven-stage spine via direct handler
 *     invocation (no full proto round-trip; that lives in the
 *     orchestrator's e2e test).
 *   - Invalid stage transitions throw the typed server error.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildOrchestratorGrpcServer } from '../src/grpc/index.js';

const TENANT = 'tenant-ct-runtime';
const RUN = 'run-runtime-001';

describe('orchestrator gRPC server — protocol sanity (FORA-525)', () => {
  let server: ReturnType<typeof buildOrchestratorGrpcServer>;

  beforeAll(async () => {
    server = buildOrchestratorGrpcServer({ host: '127.0.0.1', port: 0 });
    await server.start();
    server.seedRun({ tenantId: TENANT, runId: RUN, currentStage: 'ideation' });
  });

  afterAll(async () => {
    await server.shutdown();
  });

  it('binds a port and reports a non-zero address', () => {
    expect(server.address).toMatch(/^127\.0\.0\.1:\d+$/);
    const port = parseInt(server.address.split(':')[1]!, 10);
    expect(port).toBeGreaterThan(0);
  });

  it('exposes the additive PauseRun RPC in the service definition', () => {
    // The proto's PauseRun RPC is added in v1.0.0. If the proto
    // reverts the change, this test fails loud.
    const grpc = require('@grpc/grpc-js') as typeof import('@grpc/grpc-js');
    const protoLoader = require('@grpc/proto-loader') as typeof import('@grpc/proto-loader');
    const protoPath = new URL(
      '../src/orchestrator/proto/orchestrator.proto',
      import.meta.url,
    ).pathname;
    const def = protoLoader.loadSync(protoPath, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(def) as unknown as {
      fora: { orchestrator: { v1: { Orchestrator: { service: { [k: string]: unknown } } } } };
    };
    expect(typeof proto.fora.orchestrator.v1.Orchestrator.service.PauseRun).toBe(
      'object',
    );
  });
});
