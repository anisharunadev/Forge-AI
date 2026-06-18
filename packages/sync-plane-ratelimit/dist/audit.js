/**
 * Audit event emitter for the Sync Plane outbound reliability layer.
 *
 * Implements ADR-0010 §8.1 — sync.* event types. The audit forwarder
 * (FORA-36) is the production sink; the smoke test uses the
 * InMemoryAuditSink to capture events for assertion.
 *
 * The emitter is a thin facade: it tags every event with
 * `actor=system:outbound-reliability`, ISO timestamp, and tenant /
 * platform. Future schema migrations (FORA-204) flow through this
 * seam.
 */
export class InMemoryAuditSink {
    events = [];
    emit(event) {
        this.events.push(event);
    }
    list() {
        return this.events;
    }
    listOfType(type) {
        return this.events.filter((e) => e.type === type);
    }
    clear() {
        this.events.length = 0;
    }
}
export class NoopAuditSink {
    emit(_event) {
        // intentionally empty
    }
}
export function makeEvent(type, tenant_id, platform, payload, now = () => new Date()) {
    return {
        schema_version: 1,
        type,
        occurred_at: now().toISOString(),
        tenant_id,
        platform,
        actor: 'system:outbound-reliability',
        payload: Object.freeze(payload),
    };
}
//# sourceMappingURL=audit.js.map