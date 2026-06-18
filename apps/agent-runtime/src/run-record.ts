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

import type {
  IdempotencyKey,
  Observation,
  RunId,
  RunRecord,
  RunRecordStep,
  TypedError,
} from './types.js';

export type RunRecordEvent =
  | { kind: 'stage.entered'; runId: RunId; stage: 'plan' | 'act' | 'observe' | 'reflect'; at: string }
  | { kind: 'plan.emitted'; runId: RunId; planId: string; stepCount: number; at: string }
  | { kind: 'observation'; runId: RunId; observation: Observation; at: string }
  | {
      kind: 'idempotency.hit';
      runId: RunId;
      stepId: string;
      tool: string;
      key: IdempotencyKey;
      storedAt: string;
      at: string;
    }
  | { kind: 'reflection'; runId: RunId; done: boolean; note: string; at: string }
  | { kind: 'replan'; runId: RunId; cycle: number; at: string }
  | { kind: 'error'; runId: RunId; error: TypedError; at: string }
  | { kind: 'finished'; runId: RunId; status: RunRecord['status']; at: string };

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
export class FileSystemRunRecordSink implements RunRecordSink {
  private readonly streamFile: string;
  private readonly recordFile: string;
  private readonly buf: RunRecordEvent[] = [];

  constructor(private readonly runId: RunId, private readonly workspace: string) {
    const dir = resolve(workspace, 'runs');
    this.streamFile = join(dir, `${runId}.jsonl`);
    this.recordFile = join(dir, `${runId}.json`);
  }

  async append(event: RunRecordEvent): Promise<void> {
    await mkdir(dirname(this.streamFile), { recursive: true });
    await appendFile(this.streamFile, JSON.stringify(event) + '\n', 'utf-8');
    this.buf.push(event);
  }

  async finalize(record: RunRecord): Promise<void> {
    await mkdir(dirname(this.recordFile), { recursive: true });
    await writeFile(this.recordFile, JSON.stringify(record, null, 2) + '\n', 'utf-8');
  }

  streamPath(): string {
    return this.streamFile;
  }

  recordPath(): string {
    return this.recordFile;
  }

  /** In-memory event buffer — tests use this to assert on the stream. */
  events(): readonly RunRecordEvent[] {
    return this.buf;
  }
}

/** In-memory sink for tests. */
export class InMemoryRunRecordSink implements RunRecordSink {
  private readonly events: RunRecordEvent[] = [];
  private readonly records: RunRecord[] = [];

  constructor(
    private readonly runId: RunId,
    public readonly streamPathValue = `:memory:${runId}.jsonl`,
    public readonly recordPathValue = `:memory:${runId}.json`,
  ) {}

  async append(event: RunRecordEvent): Promise<void> {
    this.events.push(event);
  }
  async finalize(record: RunRecord): Promise<void> {
    this.records.push(record);
  }
  streamPath(): string {
    return this.streamPathValue;
  }
  recordPath(): string {
    return this.recordPathValue;
  }
  all(): readonly RunRecordEvent[] {
    return this.events;
  }
  last(): RunRecord | undefined {
    return this.records[this.records.length - 1];
  }
}

/**
 * Build a `RunRecord` from the captured step outcomes + the current
 * terminal state. Pure; does not touch the filesystem.
 */
export function buildRunRecord(args: {
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
}): RunRecord {
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
