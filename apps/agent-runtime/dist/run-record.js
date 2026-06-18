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
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
/** Filesystem-backed sink. `workspace` defaults to `process.cwd()/workspace`. */
export class FileSystemRunRecordSink {
    runId;
    workspace;
    streamFile;
    recordFile;
    buf = [];
    constructor(runId, workspace) {
        this.runId = runId;
        this.workspace = workspace;
        const dir = resolve(workspace, 'runs');
        this.streamFile = join(dir, `${runId}.jsonl`);
        this.recordFile = join(dir, `${runId}.json`);
    }
    async append(event) {
        await mkdir(dirname(this.streamFile), { recursive: true });
        await appendFile(this.streamFile, JSON.stringify(event) + '\n', 'utf-8');
        this.buf.push(event);
    }
    async finalize(record) {
        await mkdir(dirname(this.recordFile), { recursive: true });
        await writeFile(this.recordFile, JSON.stringify(record, null, 2) + '\n', 'utf-8');
    }
    streamPath() {
        return this.streamFile;
    }
    recordPath() {
        return this.recordFile;
    }
    /** In-memory event buffer — tests use this to assert on the stream. */
    events() {
        return this.buf;
    }
}
/** In-memory sink for tests. */
export class InMemoryRunRecordSink {
    runId;
    streamPathValue;
    recordPathValue;
    events = [];
    records = [];
    constructor(runId, streamPathValue = `:memory:${runId}.jsonl`, recordPathValue = `:memory:${runId}.json`) {
        this.runId = runId;
        this.streamPathValue = streamPathValue;
        this.recordPathValue = recordPathValue;
    }
    async append(event) {
        this.events.push(event);
    }
    async finalize(record) {
        this.records.push(record);
    }
    streamPath() {
        return this.streamPathValue;
    }
    recordPath() {
        return this.recordPathValue;
    }
    all() {
        return this.events;
    }
    last() {
        return this.records[this.records.length - 1];
    }
}
/**
 * Build a `RunRecord` from the captured step outcomes + the current
 * terminal state. Pure; does not touch the filesystem.
 */
export function buildRunRecord(args) {
    const base = {
        runId: args.runId,
        agentId: args.agentId,
        tenantId: args.tenantId,
        traceId: args.traceId,
        startedAt: args.startedAt,
        finishedAt: args.finishedAt,
        status: args.status,
        steps: args.steps,
        replanCycles: args.replanCycles,
        errors: args.errors,
        ...(args.budget ? { budget: args.budget } : {}),
    };
    return args.finalReflection !== undefined
        ? { ...base, finalReflection: args.finalReflection }
        : base;
}
//# sourceMappingURL=run-record.js.map