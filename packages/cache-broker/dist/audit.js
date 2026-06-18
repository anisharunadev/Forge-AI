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
/** In-memory sink for tests. */
export class InMemoryAuditSink {
    events = [];
    async emit(event) {
        this.events.push(event);
    }
    async flush() {
        // no-op
    }
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
export class JsonlAuditSink {
    stream = null;
    path;
    writeQueue = Promise.resolve();
    constructor(opts = {}) {
        this.path = opts.path ?? process.env.FORA_AUDIT_LOG ?? './.fora/audit/tenancy-denied.jsonl';
    }
    async getStream() {
        if (this.stream)
            return this.stream;
        const { createWriteStream, mkdirSync } = await import('node:fs');
        const { dirname } = await import('node:path');
        mkdirSync(dirname(this.path), { recursive: true });
        this.stream = createWriteStream(this.path, { flags: 'a', encoding: 'utf-8' });
        return this.stream;
    }
    emit(event) {
        // Serialize writes so a single sink instance never interleaves lines.
        this.writeQueue = this.writeQueue.then(async () => {
            const stream = await this.getStream();
            const line = JSON.stringify(event) + '\n';
            await new Promise((resolve, reject) => {
                stream.write(line, (err) => (err ? reject(err) : resolve()));
            });
        });
        return this.writeQueue;
    }
    async flush() {
        await this.writeQueue;
        if (this.stream) {
            await new Promise((resolve) => this.stream.end(() => resolve()));
            this.stream = null;
        }
    }
}
/** No-op sink for when audit is disabled (`FORA_AUDIT_ENABLED=0`). */
export class NullAuditSink {
    async emit(_event) {
        // intentionally empty
    }
    async flush() {
        // intentionally empty
    }
}
/** Pick the right sink for the runtime. The feature flag is `FORA_AUDIT_ENABLED` (default on). */
export function defaultAuditSink() {
    if (process.env.FORA_AUDIT_ENABLED === '0')
        return new NullAuditSink();
    return new JsonlAuditSink();
}
//# sourceMappingURL=audit.js.map