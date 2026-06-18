/**
 * Replay contract — the path that makes Orchestrator crashes safe.
 *
 * Per FORA-50 spec §10 + ADR-0009 §5: `agent_run_events` is append-only. On
 * Orchestrator restart, the writer can rebuild the run's event stream by
 * reading the rows for a run_id in occurred_at order and re-publishing them
 * to the bus. Because `event_id` is the dedupe key, consumers that already
 * processed the event will no-op; new consumers or recovered consumers can
 * backfill from the row store.
 *
 * The contract has three parts:
 *   1. `ReplaySource` — the read side. Provided by the `agent_run_events`
 *      table (Postgres); abstracted behind a function so the test harness
 *      can substitute an in-memory source.
 *   2. `ReplayTarget` — the publish side. Typically an `EventProducer`.
 *   3. `replayRun(runId)` — the orchestrator-facing helper that wires the two
 *      and emits a `replay_completed` summary metric.
 */
import type { EventProducer } from './producer.js';
import { type EventType, type TypedEvent } from './events.js';
/** A row from `agent_run_events`, narrowed to the fields needed for replay. */
export interface AgentRunEventRow {
    readonly run_id: string;
    readonly tenant_id: string;
    readonly stage: string | null;
    readonly event_type: string;
    readonly payload: unknown;
    readonly actor: {
        type: 'agent' | 'user' | 'system';
        id: string;
    };
    readonly occurred_at: string;
    /**
     * The original event_id. When the row was written by the Orchestrator, this
     * matches the envelope. When re-publishing during replay, the same
     * event_id is preserved — consumers will dedupe.
     */
    readonly event_id: string;
    /** Semver of the original envelope. */
    readonly v: string;
}
/**
 * Source contract. Production implementation queries `agent_run_events` for
 * `WHERE run_id = $1 ORDER BY occurred_at, id`.
 */
export type ReplaySource = (runId: string) => Promise<ReadonlyArray<AgentRunEventRow>>;
/** Summary metric emitted at the end of a replay. */
export interface ReplaySummary {
    readonly run_id: string;
    readonly tenant_id: string;
    readonly row_count: number;
    readonly published_count: number;
    readonly deduped_count: number;
    readonly error_count: number;
    readonly duration_ms: number;
}
/**
 * Replay a run's events back to the bus.
 *
 * The contract:
 *   - Rows are read in `occurred_at` order.
 *   - Each row is re-published with its original `event_id` (preserving dedupe).
 *   - The producer's `flush()` is awaited before returning; downstream
 *     consumers see the events as a contiguous batch.
 *   - Per-event payload validation re-runs against the current schema; if a
 *     row's payload no longer parses (e.g. the schema tightened), the row is
 *     counted as an error and skipped — the run's audit row still exists.
 *   - A summary is returned; the caller is responsible for emitting the
 *     `replay_completed` metric (typically to the Cost agent).
 */
export declare function replayRun(params: {
    source: ReplaySource;
    producer: EventProducer;
    runId: string;
    /**
     * Hook fired after each row is published. Default: no-op.
     * Useful for the bridge service to ship replay events to SNS.
     */
    onRowPublished?: (row: AgentRunEventRow, envelope: TypedEvent<EventType>) => void;
}): Promise<ReplaySummary>;
/**
 * Helper used by tests + the consumer: build the subject a row would be
 * replayed to. Mirrors the producer's logic without touching the broker.
 */
export declare function subjectForRow(row: AgentRunEventRow): string;
