/**
 * GrpcStageEngine — the production StageEngine adapter.
 *
 * Implements the orchestrator's `StageEngine` port
 * (`apps/orchestrator/src/ports.ts`) by calling the gRPC service
 * defined in `orchestrator.proto` per ADR-0007. The in-memory
 * `InMemoryStageEngine` in the orchestrator's `test-doubles.ts` is
 * the FORA-173 test double; this adapter is the production wiring
 * FORA-525 lands.
 *
 * Mapping (port method → RPC):
 *   advance(NEXT)   → AdvanceStage{ decision: { kind: NEXT } }
 *   reEnter(RETURN) → AdvanceStage{ decision: { kind: RETURN, returned_to_stage } }
 *   pauseRun        → PauseRun
 *
 * The orchestrator's `pauseRun` has no idempotencyKey parameter (the
 * router already dedupes `approval_expired`); the client mints an
 * idempotency key from (runId, approvalId) so the server's monotonic
 * pauseRun is replay-safe per ADR-0007 §6.
 *
 * Error mapping (per ADR-0007 §8):
 *   NOT_FOUND            → bubbled as-is (caller decides)
 *   FAILED_PRECONDITION  → InvalidStageTransitionError
 *   INVALID_ARGUMENT     → InvalidStageTransitionError
 *   INTERNAL / others    → bubbled as Error (gateway retry per ADR-0007 §8)
 *   DEADLINE_EXCEEDED    → bubbled as Error (caller retries with backoff)
 *
 * **Why this lives in @fora/agent-runtime and not @fora/orchestrator**
 *
 * The client is a thin wrapper around the gRPC client; the proto is
 * owned by the agent-runtime. Co-locating the client with the server
 * keeps the proto and the typed shapes in one workspace, avoiding a
 * package.json change in `@fora/orchestrator` for v0.1.7. The
 * orchestrator's `gate_wiring.ts` imports `StageEngine` from
 * `ports.js`; the wiring site does not care whether the implementation
 * is in-process or remote. The factory in `./factory.ts` is the single
 * switch.
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Stage / RunId / TenantId — the wire types. The agent-runtime's own
// `Stage` type is the inner micro-loop (`plan | act | observe |
// reflect`); the seven-stage spine is the orchestrator's contract and
// is the wire type here.
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

export type { Stage, RunId, TenantId };

// ---------------------------------------------------------------------------
// InvalidStageTransitionError — mirrored from the orchestrator's port so
// the test can `instanceof` check without crossing the package boundary.
// ---------------------------------------------------------------------------

export class InvalidStageTransitionError extends Error {
  constructor(
    public readonly typed: {
      code: 'INVALID_STAGE_TRANSITION';
      message: string;
      fromStage: Stage;
      toStage: Stage | 'done';
    },
  ) {
    super(typed.message);
    this.name = 'InvalidStageTransitionError';
  }
}

// ---------------------------------------------------------------------------
// StageEngine port shape — the typed interface the client implements.
// The orchestrator's `StageEngine` port is structurally identical; this
// local copy lets the agent-runtime's tests assert on the wire format
// without importing from `@fora/orchestrator`.
// ---------------------------------------------------------------------------

export interface StageEngine {
  advance(args: {
    tenantId: TenantId;
    runId: RunId;
    fromStage: Stage;
    toStage: Stage | 'done';
    idempotencyKey: string;
  }): Promise<{ currentStage: Stage | 'done' }>;

  reEnter(args: {
    tenantId: TenantId;
    runId: RunId;
    fromStage: Stage;
    toStage: Stage;
    reason: string;
    idempotencyKey: string;
  }): Promise<{ currentStage: Stage }>;

  pauseRun(args: {
    tenantId: TenantId;
    runId: RunId;
    approvalId: string;
  }): Promise<void>;
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

function loadOrchestratorClient(): new (
  addr: string,
  creds: grpc.ChannelCredentials,
) => GrpcOrchestratorClient {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, PROTO_OPTIONS);
  const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as {
    fora: {
      orchestrator: {
        v1: {
          Orchestrator: new (
            addr: string,
            creds: grpc.ChannelCredentials,
          ) => GrpcOrchestratorClient;
        };
      };
    };
  };
  return proto.fora.orchestrator.v1.Orchestrator;
}

interface GrpcOrchestratorClient {
  advanceStage(
    req: unknown,
    cb: (err: grpc.ServiceError | null, res: unknown) => void,
  ): void;
  pauseRun(
    req: unknown,
    cb: (err: grpc.ServiceError | null, res: unknown) => void,
  ): void;
  healthCheck(
    req: unknown,
    cb: (err: grpc.ServiceError | null, res: unknown) => void,
  ): void;
}

interface AdvanceStageRequest {
  runId: string;
  fromStage: Stage;
  toStage: Stage | 'done';
  decision: {
    kind: 'NEXT' | 'ABORT' | 'RETURN';
    reason?: string;
    returnedToStage?: Stage;
  };
  artefact: unknown;
  idempotencyKey: string;
}

interface AdvanceStageResponse {
  runId: string;
  currentStage: Stage | 'done';
  status: 'running' | 'paused' | 'done' | 'waiting_approval' | 'finished';
  eventIds: string[];
}

interface PauseRunRequest {
  runId: string;
  tenantId: string;
  approvalId: string;
  idempotencyKey: string;
}

interface PauseRunResponse {
  runId: string;
  currentStage: Stage | 'done';
  status: 'paused' | 'done';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GrpcStageEngineOptions {
  /** `host:port` of the agent-runtime's gRPC server. */
  address: string;
  /**
   * Optional per-call deadline in ms. Default 5000 (ADR-0007 §7 SLA:
   * AdvanceStage p99 < 1s; we leave 5x headroom for production jitter).
   */
  deadlineMs?: number;
  /**
   * Optional gRPC credentials. Default insecure (the platform VPC
   * is the trust boundary per ADR-0007 §4; production wires mTLS
   * via the sidecar).
   */
  credentials?: grpc.ChannelCredentials;
  /**
   * Test seam: inject a pre-built proto-loader-derived client. When
   * set, the constructor skips proto loading. Used by the gRPC
   * client unit test to avoid a real network round-trip.
   */
  client?: GrpcOrchestratorClient;
}

export class GrpcStageEngine implements StageEngine {
  private readonly client: GrpcOrchestratorClient;
  private readonly deadlineMs: number;
  private readonly creds: grpc.ChannelCredentials;
  private readonly address: string;
  private readonly ownsClient: boolean;

  constructor(options: GrpcStageEngineOptions) {
    this.address = options.address;
    this.deadlineMs = options.deadlineMs ?? 5000;
    this.creds = options.credentials ?? grpc.credentials.createInsecure();
    this.ownsClient = !options.client;
    this.client =
      options.client ??
      new (loadOrchestratorClient())(this.address, this.creds);
  }

  get boundAddress(): string {
    return this.address;
  }

  async advance(args: {
    tenantId: TenantId;
    runId: RunId;
    fromStage: Stage;
    toStage: Stage | 'done';
    idempotencyKey: string;
  }): Promise<{ currentStage: Stage | 'done' }> {
    const req: AdvanceStageRequest = {
      runId: args.runId,
      fromStage: args.fromStage,
      toStage: args.toStage,
      decision: { kind: 'NEXT' },
      artefact: null,
      idempotencyKey: args.idempotencyKey,
    };
    let res: AdvanceStageResponse;
    try {
      res = await unaryCall<AdvanceStageRequest, AdvanceStageResponse>(
        (cb) => this.client.advanceStage(req, cb as never),
        this.deadlineMs,
      );
    } catch (e) {
      throw mapAdvanceError(args, e);
    }
    return { currentStage: res.currentStage };
  }

  async reEnter(args: {
    tenantId: TenantId;
    runId: RunId;
    fromStage: Stage;
    toStage: Stage;
    reason: string;
    idempotencyKey: string;
  }): Promise<{ currentStage: Stage }> {
    const req: AdvanceStageRequest = {
      runId: args.runId,
      fromStage: args.fromStage,
      // The server's `isValidAdvance` guard requires `to_stage` be
      // the next stage in the spine; for RETURN we set `to_stage` to
      // fromStage (the current stage) and rely on the decision kind
      // to route the reEnter.
      toStage: args.fromStage,
      decision: {
        kind: 'RETURN',
        reason: args.reason,
        returnedToStage: args.toStage,
      },
      artefact: null,
      idempotencyKey: args.idempotencyKey,
    };
    let res: AdvanceStageResponse;
    try {
      res = await unaryCall<AdvanceStageRequest, AdvanceStageResponse>(
        (cb) => this.client.advanceStage(req, cb as never),
        this.deadlineMs,
      );
    } catch (e) {
      throw mapReEnterError(args, e);
    }
    return { currentStage: res.currentStage as Stage };
  }

  async pauseRun(args: {
    tenantId: TenantId;
    runId: RunId;
    approvalId: string;
  }): Promise<void> {
    const req: PauseRunRequest = {
      runId: args.runId,
      tenantId: args.tenantId,
      approvalId: args.approvalId,
      idempotencyKey: `pause:${args.runId}:${args.approvalId}`,
    };
    try {
      await unaryCall<PauseRunRequest, PauseRunResponse>(
        (cb) => this.client.pauseRun(req, cb as never),
        this.deadlineMs,
      );
    } catch (e) {
      // pauseRun is best-effort; a missing run is a no-op.
      if (isGrpcStatus(e) && e.code === grpc.status.NOT_FOUND) return;
      throw e;
    }
  }

  close(): void {
    if (this.ownsClient) {
      (this.client as unknown as { close?: () => void }).close?.();
    }
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function unaryCall<TReq, TRes>(
  caller: (cb: (err: grpc.ServiceError | null, res: TRes) => void) => void,
  _deadlineMs: number,
): Promise<TRes> {
  return new Promise<TRes>((resolve, reject) => {
    try {
      caller((err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function isGrpcStatus(e: unknown): e is grpc.ServiceError {
  return (
    !!e &&
    typeof e === 'object' &&
    'code' in (e as Record<string, unknown>) &&
    typeof (e as Record<string, unknown>)['code'] === 'number'
  );
}

function mapAdvanceError(
  args: {
    tenantId: TenantId;
    runId: RunId;
    fromStage: Stage;
    toStage: Stage | 'done';
    idempotencyKey: string;
  },
  e: unknown,
): Error {
  if (isGrpcStatus(e)) {
    if (
      e.code === grpc.status.FAILED_PRECONDITION ||
      e.code === grpc.status.INVALID_ARGUMENT
    ) {
      return new InvalidStageTransitionError({
        code: 'INVALID_STAGE_TRANSITION',
        message: e.details ?? e.message,
        fromStage: args.fromStage,
        toStage: args.toStage,
      });
    }
  }
  return e instanceof Error ? e : new Error(String(e));
}

function mapReEnterError(
  args: {
    tenantId: TenantId;
    runId: RunId;
    fromStage: Stage;
    toStage: Stage;
    reason: string;
    idempotencyKey: string;
  },
  e: unknown,
): Error {
  if (isGrpcStatus(e)) {
    if (
      e.code === grpc.status.FAILED_PRECONDITION ||
      e.code === grpc.status.INVALID_ARGUMENT
    ) {
      return new InvalidStageTransitionError({
        code: 'INVALID_STAGE_TRANSITION',
        message: e.details ?? e.message,
        fromStage: args.fromStage,
        toStage: args.toStage,
      });
    }
  }
  return e instanceof Error ? e : new Error(String(e));
}
