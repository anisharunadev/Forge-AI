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
import type { EventBusPort, IdempotencyPort, OrchestratorDeps, RunStorePort } from './ports.js';
import type { OrchestratorEvent, RunHeader, RunId, Stage, StageStatus } from './types.js';
export declare class InMemoryRunStore implements RunStorePort {
    private readonly runs;
    private readonly stageStatus;
    constructor(seed?: ReadonlyArray<RunHeader>);
    getRun(runId: RunId): Promise<RunHeader | null>;
    applyStageTransition(args: {
        readonly runId: RunId;
        readonly expectedFromStage: Stage;
        readonly newStage: Stage | 'done';
        readonly newRunStatus: RunHeader['status'];
        readonly decisionBy: string;
        readonly decisionAt: string;
    }): Promise<RunHeader>;
    getStageStatus(runId: RunId, stage: Stage): Promise<StageStatus | null>;
    setStageStatus(runId: RunId, stage: Stage, status: StageStatus): void;
}
export declare class InMemoryEventBus implements EventBusPort {
    private readonly subscribers;
    readonly published: OrchestratorEvent[];
    publish(event: OrchestratorEvent): Promise<void>;
    publishBatch(events: ReadonlyArray<OrchestratorEvent>): Promise<void>;
    subscribe(fn: (e: OrchestratorEvent) => void): () => void;
}
export declare class InMemoryIdempotencyStore implements IdempotencyPort {
    private readonly map;
    lookup(key: string): Promise<unknown | null>;
    store(key: string, response: unknown): Promise<void>;
}
export declare function defaultDeps(): OrchestratorDeps;
