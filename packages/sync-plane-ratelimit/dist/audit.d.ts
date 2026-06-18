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
import type { PlatformId } from './coalescer.js';
export type SyncAuditEventType = 'sync.platform.degraded' | 'sync.platform.recovered' | 'sync.outbound.rate_limited' | 'sync.outbound.coalesced' | 'sync.outbound.circuit_open';
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
