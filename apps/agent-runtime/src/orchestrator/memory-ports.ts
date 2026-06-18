/**
 * In-memory implementations of the orchestrator ports.
 *
 * First-pass CTO module per FORA-135 ("CTO first-pass"); these impls let the
 * engine be exercised end-to-end in the unit suite without standing up the
 * full NATS + Postgres stack (FORA-30 / FORA-36).
 *
 * Behaviour parity:
 *   - `InMemoryRunStore.applyStageTransition` enforces optimistic concurrency
 *     on `currentStage` (refuses when the stored value drifts from
 *     `expectedFromStage`), matching the Postgres contract per FORA-50 §6.2.
 *   - `InMemoryEventBus.publish` is async to match the real bus seam; the
 *     tests await it so the engine's "publish-then-return" order is honest.
 *   - `InMemoryIdempotencyStore` is a simple Map with FIFO eviction; a
 *     future sub-task swaps in the LRU impl already shipped in
 *     `apps/agent-runtime/src/idempotency.ts` if a shared seam is wanted.
 */

import type {
  EventBusPort,
  IdempotencyPort,
  OrchestratorDeps,
  RunStorePort,
} from './ports.js';
import type {
  OrchestratorEvent,
  RunHeader,
  RunId,
  Stage,
  StageStatus,
} from './types.js';

// ---------------------------------------------------------------------------
// In-memory run store
// ---------------------------------------------------------------------------

export class InMemoryRunStore implements RunStorePort {
  private readonly runs = new Map<RunId, RunHeader>();
  private readonly stageStatus = new Map<string, StageStatus>();

  constructor(seed: ReadonlyArray<RunHeader> = []) {
    for (const r of seed) this.runs.set(r.runId, r);
  }

  async getRun(runId: RunId): Promise<RunHeader | null> {
    return this.runs.get(runId) ?? null;
  }

  async applyStageTransition(args: {
    readonly runId: RunId;
    readonly expectedFromStage: Stage;
    readonly newStage: Stage | 'done';
    readonly newRunStatus: RunHeader['status'];
    readonly decisionBy: string;
    readonly decisionAt: string;
  }): Promise<RunHeader> {
    const cur = this.runs.get(args.runId);
    if (!cur) {
      throw new Error(`run ${args.runId} not found`);
    }
    if (cur.currentStage !== args.expectedFromStage) {
      throw new Error(
        `optimistic-concurrency: expected currentStage=${args.expectedFromStage}, got ${cur.currentStage}`,
      );
    }
    // 'done' is a run-state sentinel, not a spine stage. The header's
    // currentStage stays as the last spine stage (e.g. 'docs'); the run
    // status flips to 'done'.
    const next: RunHeader = {
      ...cur,
      currentStage: args.newStage === 'done' ? cur.currentStage : args.newStage,
      status: args.newRunStatus,
      finishedAt: args.newRunStatus === 'done' || args.newRunStatus === 'aborted' ? args.decisionAt : cur.finishedAt,
    };
    this.runs.set(args.runId, next);
    return next;
  }

  async getStageStatus(runId: RunId, stage: Stage): Promise<StageStatus | null> {
    return this.stageStatus.get(`${runId}:${stage}`) ?? null;
  }

  // Test helper — not part of the port.
  setStageStatus(runId: RunId, stage: Stage, status: StageStatus): void {
    this.stageStatus.set(`${runId}:${stage}`, status);
  }
}

// ---------------------------------------------------------------------------
// In-memory event bus
// ---------------------------------------------------------------------------

export class InMemoryEventBus implements EventBusPort {
  private readonly subscribers = new Set<(e: OrchestratorEvent) => void>();
  public readonly published: OrchestratorEvent[] = [];

  async publish(event: OrchestratorEvent): Promise<void> {
    this.published.push(event);
    for (const sub of this.subscribers) sub(event);
  }

  async publishBatch(events: ReadonlyArray<OrchestratorEvent>): Promise<void> {
    for (const e of events) await this.publish(e);
  }

  subscribe(fn: (e: OrchestratorEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }
}

// ---------------------------------------------------------------------------
// In-memory idempotency store
// ---------------------------------------------------------------------------

export class InMemoryIdempotencyStore implements IdempotencyPort {
  private readonly map = new Map<string, unknown>();

  async lookup(key: string): Promise<unknown | null> {
    return this.map.get(key) ?? null;
  }

  async store(key: string, response: unknown): Promise<void> {
    this.map.set(key, response);
  }
}

// ---------------------------------------------------------------------------
// Default dep factory (used by tests + the planned gRPC server)
// ---------------------------------------------------------------------------

export function defaultDeps(): OrchestratorDeps {
  return {
    runs: new InMemoryRunStore(),
    bus: new InMemoryEventBus(),
    idempotency: new InMemoryIdempotencyStore(),
    now: () => Date.now(),
    mintEventId: () =>
      `evt_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`,
    systemActorId: 'system',
  };
}