/**
 * Public surface of the agent-runtime's gRPC module (FORA-525).
 *
 * Exports:
 *   - `buildOrchestratorGrpcServer` — the in-memory gRPC server
 *     that backs the orchestrator's `StageEngine` port per ADR-0007.
 *   - `GrpcStageEngine` — the production client adapter.
 *   - `buildStageEngine` / `resolveStageEngineOptionsFromEnv` —
 *     the factory that picks the production `StageEngine`.
 *   - `InvalidStageTransitionError` — the typed error mirrored from
 *     the orchestrator's port.
 *
 * The orchestrator's `gate_wiring.ts` consumes a `StageEngine` from
 * its `ports.js`; the wiring site does not care which adapter
 * implements the port. The factory in `./factory.ts` is the single
 * switch between the in-process test double and the production gRPC
 * client.
 */

export {
  buildOrchestratorGrpcServer,
  type OrchestratorGrpcServer,
  type OrchestratorGrpcServerOptions,
} from './orchestrator-server.js';

export {
  GrpcStageEngine,
  InvalidStageTransitionError,
  type GrpcStageEngineOptions,
  type StageEngine,
  type Stage,
} from './client.js';

export {
  buildStageEngine,
  resolveStageEngineOptionsFromEnv,
  type BuildStageEngineOptions,
  type StageEngineBackend,
} from './factory.js';

export { InMemoryStageEngine } from './in-memory-engine.js';
