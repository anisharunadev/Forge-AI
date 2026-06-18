/**
 * @fora/cache-broker — audit event shape and sinks
 *
 * The canonical `tenancy.denied` audit event. Defined here (FORA-165) so that
 * 0.7.2b (db-pool), 0.7.2c (object-store), and 0.7.2d (cache-broker) all emit
 * the same shape. The shape is a structural subset of `AuditEventV1` from
 * `docs/architecture/audit-system-design.md §4`; for v0.7.2 we ship the
 * minimum fields the tenancy gate needs and forward the event through a local
 * JSONL sink. FORA-36 0.5 will pick the event up from the JSONL and ingest it
 * into the append-only audit store.
 *
 * The fields are exactly the ones named in the FORA-124 deliverable list and
 * the FORA-165 issue body:
 *   actor, attempted_tenant_id, actual_tenant_id, resource, trace_id, timestamp, metadata
 *
 * `resource` is a typed enum so we can grep the audit log by resource and so
 * the lint rule on the audit side can pin the shape.
 */
export type TenancyResource = 'cache' | 'db_connection' | 'object_store' | 'queue' | 'search_index' | 'memory';
/** The canonical `tenancy.denied` event. Emitted on every cross-tenant read/write rejection. */
export interface ForaAuditEvent {
    /** Always `tenancy.denied` for this shape. Future events will add other `event_type` values. */
    readonly event_type: 'tenancy.denied';
    /** Who attempted the action. `agent:<type>:<run-id>` or `user:<id>`. */
    readonly actor: string;
    /** The tenant the caller CLAIMED to be acting as (from the untrusted envelope). */
    readonly attempted_tenant_id: string;
    /** The tenant the caller is ACTUALLY bound to (from the verified claim). */
    readonly actual_tenant_id: string;
    /** Which resource rejected the action. */
    readonly resource: TenancyResource;
    /** OTel trace id, when available. */
    readonly trace_id: string;
    /** ISO 8601 UTC timestamp with millisecond precision. */
    readonly timestamp: string;
    /** Typed, resource-specific metadata. Keep this small. */
    readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}
/** Sink contract. The broker writes to ONE sink; FORA-36 ingestion is plugged in by replacing the sink. */
export interface AuditSink {
    /** Append a single event. Must not throw on a normal write (sinks must be resilient). */
    emit(event: ForaAuditEvent): Promise<void>;
    /** Flush any buffered events. Called on graceful shutdown. */
    flush(): Promise<void>;
}
/** In-memory sink for tests. */
export declare class InMemoryAuditSink implements AuditSink {
    readonly events: ForaAuditEvent[];
    emit(event: ForaAuditEvent): Promise<void>;
    flush(): Promise<void>;
}
/**
 * JSONL file sink. One event per line. Mirrors the broker's `JsonlAuditSink`
 * referenced in the FORA-165 scope. The file is opened in append mode and
 * flushed per write; for high-throughput production we would batch, but for
 * v0.7.2 the volume is low (only `tenancy.denied` events) and a per-write
 * flush is fine.
 *
 * The path defaults to `process.env.FORA_AUDIT_LOG` if set, otherwise
 * `./.fora/audit/tenancy-denied.jsonl` relative to the working directory.
 */
export declare class JsonlAuditSink implements AuditSink {
    private stream;
    private readonly path;
    private writeQueue;
    constructor(opts?: {
        path?: string;
    });
    private getStream;
    emit(event: ForaAuditEvent): Promise<void>;
    flush(): Promise<void>;
}
/** No-op sink for when audit is disabled (`FORA_AUDIT_ENABLED=0`). */
export declare class NullAuditSink implements AuditSink {
    emit(_event: ForaAuditEvent): Promise<void>;
    flush(): Promise<void>;
}
/** Pick the right sink for the runtime. The feature flag is `FORA_AUDIT_ENABLED` (default on). */
export declare function defaultAuditSink(): AuditSink;
