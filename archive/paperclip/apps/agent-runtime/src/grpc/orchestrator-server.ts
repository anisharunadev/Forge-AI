/**
 * gRPC server — the StageEngine backend for the Master Orchestrator
 * (FORA-525 / ADR-0007).
 *
 * The server is the back-end of the orchestrator's `StageEngine` port
 * (apps/orchestrator/src/ports.ts). It exposes the five Orchestrator
 * RPCs in `orchestrator.proto` plus the additive `PauseRun` RPC added
 * in v1.0.0. The server's state machine is in-memory for v0.1.7; the
 * Postgres-backed engine (FORA-30 / FORA-32) replaces it without
 * changing the wire format or this server's handler signatures.
 *
 * The seven-stage spine is defined locally — the agent-runtime's own
 * `Stage` type is the inner micro-loop (`plan | act | observe |
 * reflect`), NOT the orchestrator's seven-stage spine. The wire
 * format is the source of truth; both sides agree on the seven
 * stage names because the proto enum is in `orchestrator.proto`.
 *
 * Invariants (mirrored from apps/orchestrator/src/test-doubles.ts
 * InMemoryStageEngine so the orchestrator's existing FORA-173 test
 * passes against the live gRPC client without behavioral drift):
 *   - advance: idempotent on (runId, idempotencyKey); fromStage must
 *     match the run's current stage; toStage is the next stage in the
 *     seven-stage spine or 'done' (the docs->done terminal advance).
 *   - reEnter: idempotent on (runId, toStage); fromStage must match
 *     the run's current stage.
 *   - pauseRun: monotonic; a done run is a no-op.
 *   - createRun: idempotent on (tenantId, idempotencyKey).
 *
 * The server does not authenticate. Per ADR-0007 §4 the JWT is
 * validated at the platform boundary (the gRPC LB / sidecar). The
 * server's bind address defaults to 127.0.0.1 with a random port; the
 * orchestrator's GrpcStageEngine discovers the port via a `bind:port`
 * return value from `start()` (the gRPC e2e test binds to a free port
 * and passes the addr into the client).
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// The seven-stage spine (mirrors apps/orchestrator/src/types.ts).
//
// Defined locally because the agent-runtime's own `Stage` type is the
// inner micro-loop. The orchestrator is the source of truth; both
// sides agree on the seven names because the proto enum is the wire
// contract.
// ---------------------------------------------------------------------------

type Stage =
  | 'ideation'
  | 'architect'
  | 'dev'
  | 'qa'
  | 'security'
  | 'devops'
  | 'docs';
type RunId = string;
type TenantId = string;

const STAGE_SPINE: ReadonlyArray<Stage> = [
  'ideation',
  'architect',
  'dev',
  'qa',
  'security',
  'devops',
  'docs',
];

function isValidAdvance(from: Stage | 'done', to: Stage | 'done'): boolean {
  if (from === 'done') return false;
  const idx = STAGE_SPINE.indexOf(from);
  if (idx === -1) return false;
  const next = idx + 1 < STAGE_SPINE.length ? STAGE_SPINE[idx + 1]! : 'done';
  return next === to;
}

// ---------------------------------------------------------------------------
// Proto loading
// ---------------------------------------------------------------------------

const PROTO_PATH = fileURLToPath(
  new URL('../orchestrator/proto/orchestrator.proto', import.meta.url),
);

const PROTO_OPTIONS: protoLoader.Options = {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [dirname(PROTO_PATH)],
};

const packageDefinition = protoLoader.loadSync(PROTO_PATH, PROTO_OPTIONS);
const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as {
  fora: {
    orchestrator: {
      v1: {
        Orchestrator: grpc.ServiceClientConstructor & { service: grpc.ServiceDefinition };
      };
    };
  };
};

// ---------------------------------------------------------------------------
// In-memory engine state (per ADR-0007 §3 worked example + FORA-173)
// ---------------------------------------------------------------------------

interface RunRow {
  tenantId: TenantId;
  runId: RunId;
  currentStage: Stage | 'done';
  status: 'running' | 'paused' | 'done';
  /** Last advance idempotency key, for replay detection. */
  lastAdvanceKey: string | null;
  /** Set of `(runId, toStage)` string keys for reEnter idempotency. */
  reEntries: Set<string>;
}

class InMemoryServerState {
  private runs = new Map<string, RunRow>();
  /** Idempotency keys consumed by `createRun`, by tenant. */
  private createRunKeys = new Map<string, string>();

  seedRun(args: {
    tenantId: TenantId;
    runId: RunId;
    currentStage: Stage;
  }): void {
    this.runs.set(args.runId, {
      tenantId: args.tenantId,
      runId: args.runId,
      currentStage: args.currentStage,
      status: 'running',
      lastAdvanceKey: null,
      reEntries: new Set(),
    });
  }

  getRun(runId: RunId): RunRow | null {
    return this.runs.get(runId) ?? null;
  }

  advance(args: {
    runId: RunId;
    fromStage: Stage;
    toStage: Stage | 'done';
    idempotencyKey: string;
  }): { currentStage: Stage | 'done'; status: 'running' | 'paused' | 'done' } {
    const row = this.runs.get(args.runId);
    if (!row) {
      throw new ServerError('NOT_FOUND', `run ${args.runId} not found`);
    }
    if (row.lastAdvanceKey === args.idempotencyKey) {
      return { currentStage: row.currentStage, status: row.status };
    }
    if (row.currentStage !== args.fromStage) {
      throw new ServerError(
        'FAILED_PRECONDITION',
        `advance: run ${args.runId} is at ${row.currentStage}, not ${args.fromStage}`,
      );
    }
    if (!isValidAdvance(row.currentStage, args.toStage)) {
      throw new ServerError(
        'INVALID_ARGUMENT',
        `advance: invalid transition ${row.currentStage} → ${args.toStage}`,
      );
    }
    row.currentStage = args.toStage;
    row.status = args.toStage === 'done' ? 'done' : 'running';
    row.lastAdvanceKey = args.idempotencyKey;
    return { currentStage: row.currentStage, status: row.status };
  }

  reEnter(args: {
    runId: RunId;
    fromStage: Stage;
    toStage: Stage;
    idempotencyKey: string;
  }): { currentStage: Stage } {
    const row = this.runs.get(args.runId);
    if (!row) {
      throw new ServerError('NOT_FOUND', `run ${args.runId} not found`);
    }
    const key = `${args.runId}->${args.toStage}`;
    if (row.reEntries.has(key)) {
      return { currentStage: args.toStage };
    }
    if (row.currentStage !== args.fromStage) {
      throw new ServerError(
        'FAILED_PRECONDITION',
        `reEnter: run ${args.runId} is at ${row.currentStage}, not ${args.fromStage}`,
      );
    }
    if (!STAGE_SPINE.includes(args.toStage)) {
      throw new ServerError(
        'INVALID_ARGUMENT',
        `reEnter: unknown stage ${args.toStage}`,
      );
    }
    row.currentStage = args.toStage;
    row.status = 'running';
    row.reEntries.add(key);
    return { currentStage: args.toStage };
  }

  pauseRun(args: {
    runId: RunId;
  }): { currentStage: Stage | 'done'; status: 'paused' | 'done' } {
    const row = this.runs.get(args.runId);
    if (!row) {
      throw new ServerError('NOT_FOUND', `run ${args.runId} not found`);
    }
    if (row.status === 'done') {
      return { currentStage: row.currentStage, status: 'done' };
    }
    row.status = 'paused';
    return { currentStage: row.currentStage, status: 'paused' };
  }

  createRun(args: {
    tenantId: TenantId;
    goalId: string;
    projectId: string;
    idempotencyKey: string;
  }): { runId: RunId; currentStage: Stage; status: 'running' } {
    const cacheKey = `${args.tenantId}:${args.idempotencyKey}`;
    const existing = this.createRunKeys.get(cacheKey);
    if (existing) {
      const row = this.runs.get(existing);
      if (row) {
        return {
          runId: row.runId,
          currentStage: row.currentStage === 'done' ? 'ideation' : row.currentStage,
          status: 'running',
        };
      }
    }
    const runId = `run-${randomId()}`;
    this.runs.set(runId, {
      tenantId: args.tenantId,
      runId,
      currentStage: 'ideation',
      status: 'running',
      lastAdvanceKey: null,
      reEntries: new Set(),
    });
    this.createRunKeys.set(cacheKey, runId);
    return { runId, currentStage: 'ideation', status: 'running' };
  }
}

function randomId(): string {
  return (
    Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0') +
    Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
  );
}

class ServerError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID_ARGUMENT' | 'FAILED_PRECONDITION' | 'INTERNAL',
    message: string,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

function grpcStatusFor(err: unknown): grpc.status {
  if (err instanceof ServerError) {
    switch (err.code) {
      case 'NOT_FOUND':
        return grpc.status.NOT_FOUND;
      case 'INVALID_ARGUMENT':
        return grpc.status.INVALID_ARGUMENT;
      case 'FAILED_PRECONDITION':
        return grpc.status.FAILED_PRECONDITION;
      case 'INTERNAL':
        return grpc.status.INTERNAL;
    }
  }
  return grpc.status.INTERNAL;
}

function makeServiceError(err: unknown): grpc.ServiceError {
  const code = grpcStatusFor(err);
  const message = err instanceof Error ? err.message : String(err);
  // grpc-js's ServiceError extends Error; the metadata is an empty
  // Metadata object on success paths.
  const e = new Error(message) as unknown as grpc.ServiceError;
  (e as unknown as { code: number }).code = code;
  (e as unknown as { details: string }).details = message;
  (e as unknown as { metadata: grpc.Metadata }).metadata = new grpc.Metadata();
  return e;
}

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

interface HandlerContext {
  state: InMemoryServerState;
}

const handlers = {
  CreateRun: (
    call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): void => {
    try {
      const req = call.request as {
        tenantId: string;
        goalId: string;
        projectId: string;
        idempotencyKey: string;
      };
      const ctx = handlersContext(call);
      const result = ctx.state.createRun({
        tenantId: req.tenantId,
        goalId: req.goalId,
        projectId: req.projectId,
        idempotencyKey: req.idempotencyKey,
      });
      callback(null, {
        runId: result.runId,
        tenantId: req.tenantId,
        status: result.status,
        currentStage: result.currentStage,
      });
    } catch (e) {
      callback(makeServiceError(e), null);
    }
  },

  AdvanceStage: (
    call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): void => {
    try {
      const req = call.request as {
        runId: string;
        fromStage: Stage;
        toStage: Stage | 'done';
        decision: { kind: 'NEXT' | 'ABORT' | 'RETURN'; reason?: string; returnedToStage?: Stage };
        idempotencyKey: string;
      };
      const ctx = handlersContext(call);
      if (req.decision.kind === 'RETURN') {
        if (!req.decision.returnedToStage) {
          throw new ServerError(
            'INVALID_ARGUMENT',
            'RETURN decision requires returned_to_stage',
          );
        }
        const result = ctx.state.reEnter({
          runId: req.runId,
          fromStage: req.fromStage,
          toStage: req.decision.returnedToStage,
          idempotencyKey: req.idempotencyKey,
        });
        callback(null, {
          runId: req.runId,
          currentStage: result.currentStage,
          status: 'running',
        });
        return;
      }
      // NEXT (ABORT is a v1 forward-looking decision; treat as
      // advance to the requested `to_stage` for v0.1.7).
      const result = ctx.state.advance({
        runId: req.runId,
        fromStage: req.fromStage,
        toStage: req.toStage,
        idempotencyKey: req.idempotencyKey,
      });
      callback(null, {
        runId: req.runId,
        currentStage: result.currentStage,
        status: result.status,
      });
    } catch (e) {
      callback(makeServiceError(e), null);
    }
  },

  GetRunContext: (
    call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): void => {
    try {
      const req = call.request as { runId: string; stage: string };
      const ctx = handlersContext(call);
      const row = ctx.state.getRun(req.runId);
      if (!row) {
        throw new ServerError('NOT_FOUND', `run ${req.runId} not found`);
      }
      callback(null, {
        runId: row.runId,
        tenantId: row.tenantId,
        stage: row.currentStage,
        status: row.status,
        startedAt: null,
        inputs: [],
        labels: {},
        idempotencyKey: '',
      });
    } catch (e) {
      callback(makeServiceError(e), null);
    }
  },

  ReportCost: (
    _call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): void => {
    // Cost is owned by FORA-30 / FORA-75 adapters; the v0.1.7 server
    // is a no-op ack so the wire stays round-trippable.
    callback(null, { ok: true, eventId: `evt-${Date.now()}` });
  },

  HealthCheck: (
    _call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): void => {
    callback(null, {
      state: 'SERVING',
      version: '0.1.7',
      deps: { orchestrator: 'ok' },
    });
  },

  PauseRun: (
    call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): void => {
    try {
      const req = call.request as { runId: string };
      const ctx = handlersContext(call);
      const result = ctx.state.pauseRun({ runId: req.runId });
      callback(null, {
        runId: req.runId,
        currentStage: result.currentStage,
        status: result.status,
      });
    } catch (e) {
      callback(makeServiceError(e), null);
    }
  },
};

function handlersContext(call: grpc.ServerUnaryCall<unknown, unknown>): HandlerContext {
  const internal = (call as unknown as { __fora_state?: InMemoryServerState })
    .__fora_state;
  if (!internal) {
    throw new ServerError('INTERNAL', 'handler context missing __fora_state');
  }
  return { state: internal };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface OrchestratorGrpcServer {
  /** The bound address, e.g. `127.0.0.1:54321`. */
  readonly address: string;
  /** Start serving. Idempotent. */
  start(): Promise<void>;
  /** Graceful shutdown. Idempotent. */
  shutdown(): Promise<void>;
  /** Test helper: pre-load a run at a stage. */
  seedRun(args: { tenantId: TenantId; runId: RunId; currentStage: Stage }): void;
}

export interface OrchestratorGrpcServerOptions {
  host?: string;
  port?: number;
  preBoundPort?: number;
}

export function buildOrchestratorGrpcServer(
  options: OrchestratorGrpcServerOptions = {},
): OrchestratorGrpcServer {
  const host = options.host ?? '127.0.0.1';
  const port = options.preBoundPort ?? options.port ?? 0;
  const state = new InMemoryServerState();

  const server = new grpc.Server({
    'grpc.max_receive_message_length': 4 * 1024 * 1024,
    'grpc.max_send_message_length': 4 * 1024 * 1024,
  });

  const service = proto.fora.orchestrator.v1.Orchestrator.service;

  const handlerWithState = <Req, Res>(
    h: (call: grpc.ServerUnaryCall<Req, Res>, cb: grpc.sendUnaryData<Res>) => void,
  ) => (call: grpc.ServerUnaryCall<Req, Res>, cb: grpc.sendUnaryData<Res>): void => {
    (call as unknown as { __fora_state?: InMemoryServerState }).__fora_state = state;
    h(call, cb);
  };

  server.addService(service, {
    CreateRun: handlerWithState(handlers.CreateRun as never),
    AdvanceStage: handlerWithState(handlers.AdvanceStage as never),
    GetRunContext: handlerWithState(handlers.GetRunContext as never),
    ReportCost: handlerWithState(handlers.ReportCost as never),
    HealthCheck: handlerWithState(handlers.HealthCheck as never),
    PauseRun: handlerWithState(handlers.PauseRun as never),
  });

  let address = `${host}:${port}`;
  let started = false;
  let stopped = false;

  return {
    get address() {
      return address;
    },
    async start() {
      if (started || stopped) return;
      await new Promise<void>((resolve, reject) => {
        server.bindAsync(
          address,
          grpc.ServerCredentials.createInsecure(),
          (err, boundPort) => {
            if (err) {
              reject(err);
              return;
            }
            address = `${host}:${boundPort}`;
            resolve();
          },
        );
      });
      started = true;
    },
    async shutdown() {
      if (stopped) return;
      stopped = true;
      await new Promise<void>((resolve) => {
        server.tryShutdown(() => resolve());
        setTimeout(() => {
          server.forceShutdown();
          resolve();
        }, 5000).unref();
      });
    },
    seedRun(args) {
      state.seedRun(args);
    },
  };
}
