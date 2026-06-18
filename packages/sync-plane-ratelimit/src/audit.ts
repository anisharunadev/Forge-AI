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

export type SyncAuditEventType =
  | 'sync.platform.degraded'
  | 'sync.platform.recovered'
  | 'sync.outbound.rate_limited'
  | 'sync.outbound.coalesced'
  | 'sync.outbound.circuit_open';

export interface SyncAuditEvent {
  readonly schema_version: 1;
  readonly type: SyncAuditEventType;
  readonly occurred_at: string; // ISO 8601
  readonly tenant_id: string | null;
  readonly platform: PlatformId | null;
  readonly actor: 'system:outbound-reliability';
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AuditSink {
  emit(event: SyncAuditEvent): void;
}

export class InMemoryAuditSink implements AuditSink {
  private readonly events: SyncAuditEvent[] = [];

  emit(event: SyncAuditEvent): void {
    this.events.push(event);
  }

  list(): readonly SyncAuditEvent[] {
    return this.events;
  }

  listOfType(type: SyncAuditEventType): readonly SyncAuditEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  clear(): void {
    this.events.length = 0;
  }
}

export class NoopAuditSink implements AuditSink {
  emit(_event: SyncAuditEvent): void {
    // intentionally empty
  }
}

export function makeEvent(
  type: SyncAuditEventType,
  tenant_id: string | null,
  platform: PlatformId | null,
  payload: Record<string, unknown>,
  now: () => Date = () => new Date(),
): SyncAuditEvent {
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
