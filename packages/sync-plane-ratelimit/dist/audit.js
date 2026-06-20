/**
 * Audit event emitter for the Sync Plane outbound reliability layer.
 *
 * Implements ADR-0010 §8.1 — `connector.*` event types, per the
 * FORA-391 Plan 3 §6 connector event taxonomy (FORA-487).
 * The audit forwarder (FORA-36) is the production sink; the smoke
 * test uses the InMemoryAuditSink to capture events for assertion.
 *
 * v0.2 (FORA-487.1): renamed from `sync.outbound.*` / `sync.platform.*`
 * to the published Plan 3 §6 `connector.*` namespace:
 *
 *   v0.1 (FORA-256)                     v0.2 (FORA-487 / Plan 3 §6)
 *   ────────────────────────────────────  ────────────────────────────────────
 *   sync.outbound.rate_limited            connector.rate_limit.throttled
 *   sync.outbound.coalesced               connector.coalesce.applied   (informational N→1)
 *   sync.outbound.circuit_open            connector.circuit.opened     (request rejection)
 *   sync.platform.degraded                connector.circuit.opened     (state transition)
 *   sync.platform.recovered               connector.circuit.closed
 *
 * Note: `sync.outbound.circuit_open` and `sync.platform.degraded`
 * collapsed into one event type (`connector.circuit.opened`). The
 * payload disambiguates: state transitions carry `{state, at_ms}`;
 * request rejections carry `{rejected: true, at_ms}`. Consumers
 * that only care about "is the platform degraded" filter on
 * `payload.rejected === undefined`.
 *
 * Note: `connector.rate_limit.consumed` (per-allowed-call event from
 * Plan 3 §6) is RESERVED but not emitted yet — it lands in FORA-487.2
 * when the three-layer stack is wired end-to-end.
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