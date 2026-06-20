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
import type { PlatformId } from './coalescer.js';
export type SyncAuditEventType = 'connector.rate_limit.throttled' | 'connector.coalesce.applied' | 'connector.circuit.opened' | 'connector.circuit.half_open' | 'connector.circuit.closed';
export interface SyncAuditEvent {
    readonly schema_version: 1;
    readonly type: SyncAuditEventType;
    readonly occurred_at: string;
    readonly tenant_id: string | null;
    readonly platform: PlatformId | null;
    readonly actor: 'system:outbound-reliability';
    readonly payload: Readonly<Record<string, unknown>>;
}
export interface AuditSink {
    emit(event: SyncAuditEvent): void;
}
export declare class InMemoryAuditSink implements AuditSink {
    private readonly events;
    emit(event: SyncAuditEvent): void;
    list(): readonly SyncAuditEvent[];
    listOfType(type: SyncAuditEventType): readonly SyncAuditEvent[];
    clear(): void;
}
export declare class NoopAuditSink implements AuditSink {
    emit(_event: SyncAuditEvent): void;
}
export declare function makeEvent(type: SyncAuditEventType, tenant_id: string | null, platform: PlatformId | null, payload: Record<string, unknown>, now?: () => Date): SyncAuditEvent;
