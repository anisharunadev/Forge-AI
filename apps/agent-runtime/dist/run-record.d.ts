/**
 * Run record writer.
 *
 * Per §8 of the design doc:
 *   - During execution, the writer streams one JSONL line per event to
 *     `workspace/runs/{runId}.jsonl`. This is the live tail.
 *   - On `finish`, the writer finalizes a single `RunRecord` JSON file at
 *     `workspace/runs/{runId}.json`. This is the canonical record.
 *
 * The sink is pluggable so 0.2.4 (and the audit system) can swap the
 * filesystem sink for a S3 sink without touching the stage machine.
 *
 * 0.2.3 additions: an `idempotency.hit` event is emitted when the gateway
 * short-circuits a handler call and replays a cached result.
 */
import type { IdempotencyKey, Observation, RunId, RunRecord, RunRecordStep, TypedError } from './types.js';
export type RunRecordEvent = {
    kind: 'stage.entered';
    runId: RunId;
    stage: 'plan' | 'act' | 'observe' | 'reflect';
    at: string;
} | {
    kind: 'plan.emitted';
    runId: RunId;
    planId: string;
    stepCount: number;
    at: string;
} | {
    kind: 'observation';
    runId: RunId;
    observation: Observation;
    at: string;
} | {
    kind: 'idempotency.hit';
    runId: RunId;
    stepId: string;
    tool: string;
    key: IdempotencyKey;
    storedAt: string;
    at: string;
} | {
    kind: 'reflection';
    runId: RunId;
    done: boolean;
    note: string;
    at: string;
} | {
    kind: 'replan';
    runId: RunId;
    cycle: number;
    at: string;
} | {
    kind: 'error';
    runId: RunId;
    error: TypedError;
    at: string;
} | {
    kind: 'finished';
    runId: RunId;
    status: RunRecord['status'];
    at: string;
};
/** Pluggable sink. JSONL during execution, JSON at finish. */
export interface RunRecordSink {
    /** Append a single event to the live stream. */
    append(event: RunRecordEvent): Promise<void>;
    /** Write the finalized record. Replaces any prior file. */
    finalize(record: RunRecord): Promise<void>;
    /** Resolve the path the live stream is written to (for tests). */
    streamPath(): string;
    /** Resolve the path the finalized record is written to (for tests). */
    recordPath(): string;
}
/** Filesystem-backed sink. `workspace` defaults to `process.cwd()/workspace`. */
export declare class FileSystemRunRecordSink implements RunRecordSink {
    private readonly runId;
    private readonly workspace;
    private readonly streamFile;
    private readonly recordFile;
    private readonly buf;
    constructor(runId: RunId, workspace: string);
    append(event: RunRecordEvent): Promise<void>;
    finalize(record: RunRecord): Promise<void>;
    streamPath(): string;
    recordPath(): string;
    /** In-memory event buffer — tests use this to assert on the stream. */
    events(): readonly RunRecordEvent[];
}
/** In-memory sink for tests. */
export declare class InMemoryRunRecordSink implements RunRecordSink {
    private readonly runId;
    readonly streamPathValue: string;
    readonly recordPathValue: string;
    private readonly events;
    private readonly records;
    constructor(runId: RunId, streamPathValue?: string, recordPathValue?: string);
    append(event: RunRecordEvent): Promise<void>;
    finalize(record: RunRecord): Promise<void>;
    streamPath(): string;
    recordPath(): string;
    all(): readonly RunRecordEvent[];
    last(): RunRecord | undefined;
}
/**
 * Build a `RunRecord` from the captured step outcomes + the current
 * terminal state. Pure; does not touch the filesystem.
 */
export declare function buildRunRecord(args: {
    runId: RunId;
    agentId: import('./types.js').AgentId;
    tenantId: string;
    traceId: string;
    startedAt: string;
    finishedAt: string;
    status: RunRecord['status'];
    steps: RunRecordStep[];
    replanCycles: number;
    errors: TypedError[];
    finalReflection?: import('./types.js').Reflection;
    budget?: RunRecord['budget'];
}): RunRecord;
