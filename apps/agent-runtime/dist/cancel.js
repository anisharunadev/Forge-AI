/**
 * Cancellation token — §7 of the design doc.
 *
 *   cancelToken = { isCancelled, whenCancelled: Promise<{ reason }> }
 *
 *   - `runtime.cancel(runId, reason)` is the external entry point. It
 *     marks the run as cancelled and resolves `whenCancelled` with the
 *     reason.
 *   - The stage machine polls `isCancelled` between awaits and surfaces
 *     a `Cancelled` typed error. The retry loop also checks the token
 *     to short-circuit backoff sleeps.
 *
 * The registry is in-process; the design is pluggable so a future
 * distributed control plane (Redis, NATS) can replace the storage.
 */
export class InMemoryCancelTokenRegistry {
    tokens = new Map();
    token(runId) {
        let entry = this.tokens.get(runId);
        if (!entry) {
            let resolve;
            const promise = new Promise((r) => {
                resolve = r;
            });
            entry = { resolve, promise, cancelled: false };
            this.tokens.set(runId, entry);
        }
        const e = entry;
        return {
            get isCancelled() { return e.cancelled; },
            get whenCancelled() { return e.promise; },
            get reason() { return e.reason; },
        };
    }
    request(runId, reason) {
        const entry = this.tokens.get(runId) ?? this.ensureEntry(runId);
        if (entry.cancelled)
            return;
        entry.cancelled = true;
        entry.reason = reason;
        entry.resolve({ reason });
    }
    isCancelled(runId) {
        return this.tokens.get(runId)?.cancelled === true;
    }
    reset() {
        this.tokens.clear();
    }
    ensureEntry(runId) {
        let resolve;
        const promise = new Promise((r) => {
            resolve = r;
        });
        const entry = { resolve, promise, cancelled: false };
        this.tokens.set(runId, entry);
        return entry;
    }
}
//# sourceMappingURL=cancel.js.map