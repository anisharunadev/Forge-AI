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
import { EVENT_SCHEMAS } from './events.js';
import { buildSubject } from './subject.js';
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
export async function replayRun(params) {
    const { source, producer, runId, onRowPublished } = params;
    const start = Date.now();
    const rows = await source(runId);
    let tenantId = '';
    let published = 0;
    let errored = 0;
    for (const row of rows) {
        tenantId = row.tenant_id;
        const entry = EVENT_SCHEMAS[row.event_type];
        if (!entry) {
            errored += 1;
            continue;
        }
        try {
            const envelope = await producer.publish(row.event_type, row.payload, {
                eventId: row.event_id,
                occurredAt: row.occurred_at,
            });
            published += 1;
            if (onRowPublished)
                onRowPublished(row, envelope);
        }
        catch {
            errored += 1;
        }
    }
    await producer.flush();
    const summary = {
        run_id: runId,
        tenant_id: tenantId,
        row_count: rows.length,
        published_count: published,
        deduped_count: 0,
        error_count: errored,
        duration_ms: Date.now() - start,
    };
    return summary;
}
/**
 * Helper used by tests + the consumer: build the subject a row would be
 * replayed to. Mirrors the producer's logic without touching the broker.
 */
export function subjectForRow(row) {
    const entry = EVENT_SCHEMAS[row.event_type];
    if (!entry) {
        throw new Error(`unknown event_type "${row.event_type}" on row ${row.event_id}`);
    }
    return buildSubject({
        tenantId: row.tenant_id,
        eventType: row.event_type,
        major: entry.major,
    });
}
//# sourceMappingURL=replay.js.map