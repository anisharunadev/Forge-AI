/**
 * StageEngine factory — picks the production StageEngine adapter
 * (FORA-525 / ADR-0007).
 *
 * The factory is the single switch between the in-process test double
 * (the orchestrator's `InMemoryStageEngine`) and the production gRPC
 * client (`GrpcStageEngine`). The orchestrator's `gate_wiring.ts`
 * consumes a `StageEngine`; the factory decides which adapter
 * implements the port.
 *
 * Wiring options (FORA_STAGE_ENGINE_BACKEND):
 *   - `memory` (default in dev/test) — returns the orchestrator's
 *     `InMemoryStageEngine` from `@fora/orchestrator`. The caller
 *     passes an instance via `inMemory`.
 *   - `grpc` — returns a `GrpcStageEngine` pointed at
 *     `FORA_STAGE_ENGINE_GRPC_ADDR`.
 *
 * Production wiring (e.g. in `bin/fora-orchestrator.mjs`):
 *
 *   import { buildStageEngine, resolveStageEngineOptionsFromEnv } from '@fora/agent-runtime/grpc';
 *   import { InMemoryStageEngine } from '@fora/orchestrator';
 *
 *   const opts = resolveStageEngineOptionsFromEnv();
 *   const engine = buildStageEngine({
 *     ...opts,
 *     ...(opts.backend === 'memory' ? { inMemory: new InMemoryStageEngine() } : {}),
 *   });
 */

import { GrpcStageEngine, type StageEngine } from './client.js';
import { InMemoryStageEngine } from './in-memory-engine.js';

export type StageEngineBackend = 'memory' | 'grpc';

export interface BuildStageEngineOptions {
  backend: StageEngineBackend;
  /** Required when backend === 'grpc'. */
  grpcAddress?: string;
  /**
   * Optional pre-built in-memory engine. Required when
   * backend='memory' (the factory cannot import the orchestrator's
   * `InMemoryStageEngine` because that would be a circular dep).
   */
  inMemory?: InMemoryStageEngine;
  /**
   * Optional pre-built gRPC client. When set with backend='grpc',
   * the factory wraps this client. The gRPC client unit test uses
   * the default path.
   */
  grpcClient?: unknown;
}

export function buildStageEngine(
  options: BuildStageEngineOptions,
): StageEngine {
  if (options.backend === 'memory') {
    if (!options.inMemory) {
      throw new Error(
        'buildStageEngine: backend=memory requires an inMemory instance (pass new InMemoryStageEngine() from @fora/orchestrator)',
      );
    }
    return options.inMemory;
  }
  if (!options.grpcAddress) {
    throw new Error(
      'buildStageEngine: backend=grpc requires grpcAddress (set FORA_STAGE_ENGINE_GRPC_ADDR)',
    );
  }
  const client = options.grpcClient as never;
  return new GrpcStageEngine({
    address: options.grpcAddress,
    ...(client ? { client } : {}),
  });
}

/**
 * Resolve the factory options from env. Mirrors `loadConfig` shape;
 * kept here so the factory is independently testable.
 */
export function resolveStageEngineOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BuildStageEngineOptions {
  const backendRaw = (env['FORA_STAGE_ENGINE_BACKEND'] ?? 'memory').toLowerCase();
  if (backendRaw !== 'memory' && backendRaw !== 'grpc') {
    throw new Error(
      `FORA_STAGE_ENGINE_BACKEND must be 'memory' or 'grpc' (got '${backendRaw}')`,
    );
  }
  return {
    backend: backendRaw,
    ...(env['FORA_STAGE_ENGINE_GRPC_ADDR']
      ? { grpcAddress: env['FORA_STAGE_ENGINE_GRPC_ADDR'] }
      : {}),
  };
}
