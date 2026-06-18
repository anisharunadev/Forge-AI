/**
 * Typed ports for the gate router.
 *
 * The router depends only on these interfaces; concrete adapters
 * (Postgres, NATS, PagerDuty, Paperclip HTTP) live in the rest of
 * the package or in a follow-up sub-task. Tests inject in-memory
 * implementations (test-doubles.ts) so the algorithm is testable
 * without a live Postgres or Paperclip server.
 *
 * Per architecture.md §2.1 the Orchestrator is the only writer of run
 * state. The ports encode that contract: every state change goes
 * through `approvalsRepo` and every external side effect through the
 * other ports.
 */

import type { IdempotencyKey, RunId, Stage, TenantId } from './types.js';
import type {
  ApprovalRecord,
  ApprovalStatus,
  Decision,
  GateKind,
  PaperclipInteraction,
  RoleOfRecord,
} from './router-types.js';

/** Wall-clock + scheduled-event surface (test seam for the sweeper). */
export interface Clock {
  now(): Date;
}

/** Pager (PagerDuty service `orchestrator-approvals` per FORA-50 §6.3). */
export interface Pager {
  /**
   * Page the approver. `idempotencyKey` is required — the sweeper
   * pages each pending approval once at 50% TTL, not once per minute.
   * A replay with the same key returns the original page id; the
   * pager is the dedupe boundary.
   */
  pageApprover(args: {
    approvalId: string;
    runId: RunId;
    role: RoleOfRecord;
    reason: 'ttl_50_percent' | 'ttl_100_percent_expired';
    idempotencyKey: IdempotencyKey;
  }): Promise<{ pageId: string }>;
}

/** The approvals store. Soft-delete aware per ADR-0009 §6. */
export interface ApprovalsRepo {
  /** Insert a pending row. Returns the persisted record. */
  /**
   * DecideArgs for applyDecision. The `decision` triple is what the
   * router fingerprints for idempotency.
   */
  insertPending(args: {
    runId: RunId;
    tenantId: TenantId;
    stage: Stage | null;
    gateKind: GateKind;
    requiredRole: RoleOfRecord;
    expiresAt: Date;
    artefactRefs: ReadonlyArray<{ kind: string; url: string; sha256?: string }>;
    reason?: string | undefined;
  }): Promise<ApprovalRecord>;

  /**
   * Mark the stage's `agent_run_stages` row as `waiting_approval`.
   * Called inside the same transaction as `insertPending` so the
   * pair is durable; the repo implementation owns the transaction.
   */
  markStageWaitingApproval(args: {
    runId: RunId;
    stage: Stage;
  }): Promise<void>;

  /**
   * Find a pending approval by id within the tenant. Returns `null`
   * on miss. Soft-deleted rows are invisible (ADR-0009 §6).
   */
  findById(args: {
    approvalId: string;
    tenantId: TenantId;
  }): Promise<ApprovalRecord | null>;

  /**
   * Find a pending approval for a specific stage of a run. Used by
   * the `return` HTTP wrapper to resolve the approval handle.
   */
  findPendingByStage(args: {
    runId: RunId;
    stage: Stage;
    tenantId: TenantId;
  }): Promise<ApprovalRecord | null>;

  /**
   * Apply a decision. The repo enforces the status transition —
   * a `pending → approved/rejected` is allowed; a re-decision of a
   * terminal row raises `ApprovalAlreadyDecidedError`. Returns the
   * post-decision row.
   */
  applyDecision(args: {
    approvalId: string;
    tenantId: TenantId;
    decision: Decision;
    decidedBy: { actor: string; role: RoleOfRecord | 'board' };
    reason: string;
  }): Promise<ApprovalRecord>;

  /**
   * Expire the row and (atomically) transition the run to `paused`
   * per ADR-0008 §4 step 7. Returns the post-expiry row.
   */
  expire(args: {
    approvalId: string;
    tenantId: TenantId;
    expiredAt: Date;
  }): Promise<ApprovalRecord>;

  /**
   * Extend the TTL — the operator action referenced in ADR-0008 §8
   * ("the operator can extend or cancel"). Returns the post-extend
   * row with the new `expires_at`.
   */
  extend(args: {
    approvalId: string;
    tenantId: TenantId;
    newExpiresAt: Date;
    extendedBy: string;
  }): Promise<ApprovalRecord>;

  /**
   * Update the persisted Paperclip interaction id — used by the
   * stale-target recovery path (ADR-0008 §5). The original row stays;
   * `paperclip_interaction_id` flips to the new id and the audit log
   * carries the re-issue.
   */
  setInteractionId(args: {
    approvalId: string;
    tenantId: TenantId;
    interactionId: string;
  }): Promise<ApprovalRecord>;

  /**
   * Mark the row as `paged_at_50_percent` so the sweeper pages each
   * row exactly once, not once per minute. Idempotent under retry.
   */
  markPagedAt50Percent(args: {
    approvalId: string;
    tenantId: TenantId;
  }): Promise<void>;

  /**
   * Sweeper read: every pending approval for a tenant whose TTL
   * tick is due. Soft-deleted rows are excluded (ADR-0009 §6).
   * `asOf` is the wall-clock the sweeper is operating on; the repo
   * implementation should NOT use `now()` internally.
   */
  listPendingForSweep(args: {
    tenantId?: TenantId | undefined;
    asOf: Date;
    /** Maximum rows returned; sweepers chunk to avoid hot loops. */
    limit: number;
  }): Promise<ReadonlyArray<ApprovalRecord>>;
}

/**
 * Raised by `ApprovalsRepo.applyDecision` when the row is already
 * terminal (already approved / rejected / expired). The HTTP layer
 * maps this to a 409 with code `INVALID_TRANSITION` per the spec
 * §4.1 error envelope. (The decide endpoint is idempotent on retry
 * of the SAME decision; this error fires only when the second
 * decision disagrees with the first.)
 */
export class ApprovalAlreadyDecidedError extends Error {
  constructor(
    public readonly typed: {
      code: 'APPROVAL_ALREADY_DECIDED';
      message: string;
      currentStatus: ApprovalStatus;
    },
  ) {
    super(typed.message);
    this.name = 'ApprovalAlreadyDecidedError';
  }
}

/**
 * Paperclip HTTP client port. The router issues one interaction per
 * pending approval; the response carries the interaction id which the
 * router stores on `agent_run_approvals.paperclip_interaction_id`.
 *
 * The port deliberately does NOT expose the Paperclip wire surface —
 * the router passes the typed `PaperclipInteraction` shape and the
 * implementation marshals to the Paperclip `POST /api/issues/.../
 * interactions` payload per ADR-0008 §4 step 3.
 */
export interface PaperclipClient {
  issue(args: {
    /** The Paperclip issue that owns the gate's run. */
    issueId: string;
    interaction: PaperclipInteraction;
  }): Promise<{ interactionId: string }>;

  /**
   * Re-issue against a fresh target (stale-target recovery per
   * ADR-0008 §5). The interaction shape is identical except the
   * target revisionId and the `idempotencyKey` suffix `:rev{N}`.
   */
  reissue(args: {
    issueId: string;
    interaction: PaperclipInteraction;
    /** The previous interaction id; recorded in the audit log. */
    supersededInteractionId: string;
  }): Promise<{ interactionId: string }>;
}

/**
 * Event bus port. The Orchestrator is the only writer (per
 * architecture.md §2.1); this port surfaces the typed events the
 * router emits. The concrete implementation publishes to NATS per
 * ADR-0006 (FORA-136).
 */
export interface EventBus {
  /**
   * Emit a bus event. The Orchestrator publishes both router-owned
   * `ApprovalEvent`s and stage-engine-owned `RunLifecycleEvent`s on
   * the same NATS subject family per ADR-0006 §3.3; the port's
   * parameter type is the union so the wiring in `gate_wiring.ts`
   * can emit `run_paused` (a `RunLifecycleEvent`) without a second
   * port.
   */
  emit(event: ApprovalEvent | RunLifecycleEvent): Promise<void>;
}

/**
 * Approval events emitted by the router. The full bus vocabulary is
 * in FORA-50 §5.1; this slice is what the router owns. Other slices
 * (cost_reported, run_started, etc.) belong to the run lifecycle and
 * the stage engine.
 *
 * Every variant carries `tenantId` so the NATS adapter can route the
 * publish to `fora.events.<tenant_id>.<event_type>.v1` per ADR-0006 §3.3.
 * The envelope also embeds `tenant_id` per ADR-0006 §3.2 — the two are
 * the same value; the typed event carries it once so the adapter does
 * not need a second lookup.
 */
export type ApprovalEvent =
  | {
      type: 'approval_requested';
      tenantId: TenantId;
      runId: RunId;
      stage: Stage | null;
      gateKind: GateKind;
      requiredRole: RoleOfRecord;
      approvalId: string;
      interactionId: string;
      expiresAt: string;
      artefactRefs: ReadonlyArray<{ kind: string; url: string; sha256?: string }>;
    }
  | {
      type: 'approval_decided';
      tenantId: TenantId;
      runId: RunId;
      approvalId: string;
      decision: Decision;
      decidedBy: string;
      decidedAt: string;
    }
  | {
      type: 'approval_expired';
      tenantId: TenantId;
      runId: RunId;
      approvalId: string;
      expiredAt: string;
    }
  | {
      type: 'stage_returned';
      tenantId: TenantId;
      runId: RunId;
      approvalId: string;
      fromStage: Stage;
      toStage: Stage;
      reason: string;
      returnedBy: string;
    };

/**
 * Run-lifecycle events the stage engine emits and consumes. These
 * cross the same NATS bus as `ApprovalEvent` (FORA-50 §5.1) but are
 * owned by the stage engine, not the router. The router consumes
 * `stage_completed` to call `routeGate`; the engine consumes
 * `gate_passed` (router's precursor), `approval_decided` (advance or
 * return), and `approval_expired` (pause the run).
 *
 * Per ADR-0001 §2.3 the engine is the only writer of stage state;
 * the router never touches it directly. The wiring in `gate_wiring.ts`
 * is the only place that bridges the two event vocabularies.
 */
export type RunLifecycleEvent =
  | {
      type: 'stage_completed';
      tenantId: TenantId;
      runId: RunId;
      fromStage: Stage;
      toStage: Stage | 'done';
      artefactRefs: ReadonlyArray<{ kind: string; url: string; sha256?: string }>;
      emittedAt: string;
    }
  | {
      type: 'run_paused';
      tenantId: TenantId;
      runId: RunId;
      approvalId: string;
      reason: 'approval_expired';
      pausedAt: string;
    };

/**
 * Stage-engine port — the seam between the gate router and FORA-135.
 *
 * The router never reads or writes stage state directly. The wiring
 * (`gate_wiring.ts`) calls these typed methods in response to the
 * approval events the router emits; the production adapter is the
 * gRPC client from ADR-0007 (FORA-135). The in-memory adapter
 * (test-doubles.ts) is used by the integration test that walks all
 * seven stages end to end.
 */
export interface StageEngine {
  /**
   * Advance the run to the next stage. Called on `accept` for every
   * per-stage gate. Idempotent: replaying the same call with the
   * same `runId` + target stage is a no-op (ADR-0001 §2.3).
   */
  advance(args: {
    tenantId: TenantId;
    runId: RunId;
    fromStage: Stage;
    toStage: Stage | 'done';
    idempotencyKey: string;
  }): Promise<{ currentStage: Stage | 'done' }>;

  /**
   * Re-enter a prior stage — the "send it back" primitive from
   * ADR-0008 §6. The engine rehydrates the stage context with the
   * same RunContext (no fresh ADR-0001 §2.3 idempotency key;
   * replays are deduped by `(runId, toStage)`).
   */
  reEnter(args: {
    tenantId: TenantId;
    runId: RunId;
    fromStage: Stage;
    toStage: Stage;
    reason: string;
    idempotencyKey: string;
  }): Promise<{ currentStage: Stage }>;

  /**
   * Pause the run header — used when an approval expires. The run
   * stays resumable; an `extend` or a new approval on the next gate
   * resumes via `advance` (ADR-0008 §4 step 7).
   */
  pauseRun(args: {
    tenantId: TenantId;
    runId: RunId;
    approvalId: string;
  }): Promise<void>;
}

/** Raised by `StageEngine` on an invalid transition. The wiring
 *  converts this into a no-op + audit log so a stale event does
 *  not crash the consumer. */
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
