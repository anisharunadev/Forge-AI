/**
 * Ports — the interfaces the orchestrator depends on.
 *
 * Per ADR-0001 §2.3 and FORA-50 spec §7, the Master Orchestrator is the only
 * component that talks to the Agent Runtime, Memory, Cost, and Audit
 * directly. This module is the typed seam; concrete implementations live
 * in their respective sub-goals (FORA-30, FORA-32, FORA-36, FORA-75) and
 * are wired by the runtime factory.
 *
 * Everything here is a pure interface. The first-pass CTO module ships
 * in-memory implementations (./memory-store.ts, ./memory-bus.ts) so the
 * engine is unit-testable end-to-end without standing up the full NATS
 * stack; production wires the real EventBus + RunStore once the DB
 * migrations land in FORA-30 / FORA-32.
 */
import type { OrchestratorEvent, RunHeader, RunId, Stage, StageStatus } from './types.js';
/**
 * Publish typed events to the platform event bus. The first-pass ships an
 * in-memory implementation; FORA-30 / FORA-36 wire the real NATS JetStream
 * + SQS/SNS bridge per ADR-0006.
 *
 * The bus is the only path for sub-agents to observe run changes.
 */
export interface EventBusPort {
    /** Publish a single event. Returns the assigned event id on success. */
    publish(event: OrchestratorEvent): Promise<void>;
    /**
     * Publish a batch in a single transaction-like unit. The first-pass
     * in-memory impl simply awaits each publish; the production impl
     * (FORA-36) uses NATS publisher confirms per ADR-0006.
     */
    publishBatch(events: ReadonlyArray<OrchestratorEvent>): Promise<void>;
}
/**
 * Run header read/write. The first-pass ships an in-memory impl; the real
 * impl persists to Postgres per FORA-50 §3.1.
 */
export interface RunStorePort {
    /**
     * Read the current run header. Returns `null` when the run does not exist
     * or has been soft-deleted per ADR-0009.
     */
    getRun(runId: RunId): Promise<RunHeader | null>;
    /**
     * Atomically apply a stage transition. The store is the only writer of
     * `agent_runs.current_stage` and `agent_run_stages.status`; the engine
     * drives all mutations through this seam so a future sub-task can swap
     * the in-memory impl for a Postgres impl without changing the engine.
     *
     * Returns the updated header on success. The store MUST refuse the
     * transition if the persisted header's `currentStage` does not match
     * `expectedFromStage` (optimistic concurrency per FORA-50 §6.2).
     */
    applyStageTransition(args: {
        readonly runId: RunId;
        readonly expectedFromStage: Stage;
        readonly newStage: Stage | 'done';
        readonly newRunStatus: RunHeader['status'];
        readonly decisionBy: string;
        readonly decisionAt: string;
    }): Promise<RunHeader>;
    /** Look up the persisted stage-row status (used by `request_approval` flow). */
    getStageStatus(runId: RunId, stage: Stage): Promise<StageStatus | null>;
}
/**
 * Idempotency cache for AdvanceStage. The first-pass ships an in-memory
 * LRU; production wires a Redis-backed store per FORA-30.
 *
 * The engine stores the response the first time an `idempotencyKey` is
 * seen; subsequent calls with the same key return the cached response
 * without re-running the transition.
 */
export interface IdempotencyPort {
    /** Look up a cached response by idempotency key. */
    lookup(key: string): Promise<unknown | null>;
    /** Persist a response keyed by idempotency key. */
    store(key: string, response: unknown): Promise<void>;
}
export interface OrchestratorDeps {
    readonly runs: RunStorePort;
    readonly bus: EventBusPort;
    readonly idempotency?: IdempotencyPort;
    /** Optional clock seam; defaults to `Date.now`. */
    readonly now?: () => number;
    /** Optional event-id mint; defaults to a uuid-like string. */
    readonly mintEventId?: () => string;
    /** Optional actor-id mint for system-originated calls. */
    readonly systemActorId?: string;
}
