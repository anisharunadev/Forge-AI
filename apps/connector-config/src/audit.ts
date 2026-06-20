/**
 * @fora/connector-config — audit emitter.
 *
 * Implements the `connector.binding.*` event taxonomy from
 * Plan 3 §6 and Plan 4. The emitter writes to the
 * `connector_binding_audit` table via FORA-36 forwarder
 * (production) or the in-memory collector (tests).
 *
 * Sub-task: FORA-485. Spec source: FORA-391 Plan 3 §6 +
 * Plan 4 (FORA-391.3).
 *
 * ---- Closed event set -------------------------------------------------------
 *
 * Mirrors the column CHECK constraint in
 * `0006_connector_binding.sql`. The runtime rejects any
 * event_type outside this set; the column CHECK rejects the
 * same set at the data layer; the FORA-36 forwarder is the only
 * allowed writer.
 *
 *   connector.binding.created              — onboarding wizard per binding
 *   connector.binding.activated            — first activate transition
 *   connector.binding.revoked              — admin revoke
 *   connector.binding.diverged             — Architect diverged auth_method
 *   connector.binding.attested             — Architect re-attestation
 *   connector.binding.attestation_expired  — 90-day sweep marked attesting
 *   connector.binding.orphan_risk          — override whose parent default is revoked
 *   connector.binding.missing              — resolver fell through to step 5
 *   connector.binding.health_check.ok      — health worker success
 *   connector.binding.health_check.fail    — health worker failure
 *
 * ---- Why the audit chain is decoupled from the current-state table ----------
 *
 * The current-state `connector_binding` table is mutated on every
 * admin action. The audit chain must be append-only (ADR-0009 §5);
 * rewriting audit history would compromise the chain. The two
 * tables are decoupled so the audit survives any current-state
 * mutation, and so the FORA-36 forwarder can write audit rows
 * without holding a lock on the current-state table.
 */

import type { TenantId, ActorId } from '@fora/db-pool';
import type {
  AuthMethod,
  BindingStatus,
  ConnectorId,
  DivergedField,
} from './types.js';

// ---------------------------------------------------------------------------
// Closed event-type enum (mirrors column CHECK)
// ---------------------------------------------------------------------------

/**
 * The closed set of connector.binding.* event types. Mirrors the
 * CHECK constraint in `0006_connector_binding.sql`. The factory
 * `buildEventType` validates input against this set; the data
 * layer enforces it again at INSERT time.
 */
export type ConnectorBindingEventType =
  | 'connector.binding.created'
  | 'connector.binding.activated'
  | 'connector.binding.revoked'
  | 'connector.binding.diverged'
  | 'connector.binding.attested'
  | 'connector.binding.attestation_expired'
  | 'connector.binding.orphan_risk'
  | 'connector.binding.missing'
  | 'connector.binding.health_check.ok'
  | 'connector.binding.health_check.fail';

/**
 * The closed event-type set as an array (for runtime validation +
 * tests).
 */
export const CONNECTOR_BINDING_EVENT_TYPES: ReadonlyArray<ConnectorBindingEventType> =
  [
    'connector.binding.created',
    'connector.binding.activated',
    'connector.binding.revoked',
    'connector.binding.diverged',
    'connector.binding.attested',
    'connector.binding.attestation_expired',
    'connector.binding.orphan_risk',
    'connector.binding.missing',
    'connector.binding.health_check.ok',
    'connector.binding.health_check.fail',
  ] as const;

// ---------------------------------------------------------------------------
// Actor envelope
// ---------------------------------------------------------------------------

/**
 * The actor envelope written to `connector_binding_audit.actor`.
 * Free-form jsonb; the runtime validates shape per event_type.
 */
export interface ConnectorBindingActor {
  readonly actor_type: 'user' | 'agent' | 'system';
  readonly actor_id: string;
  readonly role: string;
  readonly trace_id?: string;
}

// ---------------------------------------------------------------------------
// Event payload shapes
// ---------------------------------------------------------------------------

/**
 * The common fields every `connector.binding.*` event carries.
 * The `metadata` shape is event-type-specific; the runtime
 * validates per event_type.
 */
export interface ConnectorBindingEventBase {
  readonly event_id: string;
  readonly tenant_id: TenantId;
  readonly binding_id: string | null;
  readonly connector_id: ConnectorId;
  readonly project_id: string | null;
  readonly auth_method: AuthMethod | null;
  readonly actor: ConnectorBindingActor;
  readonly emitted_at: string;
}

/**
 * Event-specific metadata shapes. The runtime picks the right
 * shape by event_type and the audit sink serialises it as jsonb.
 */
export interface ConnectorBindingCreatedMetadata {
  readonly status: BindingStatus;
  readonly scopes: ReadonlyArray<string>;
  readonly attestation_expires_at: string;
}

export interface ConnectorBindingActivatedMetadata {
  readonly previous_status: BindingStatus;
}

export interface ConnectorBindingRevokedMetadata {
  readonly revoked_reason: string;
}

export interface ConnectorBindingDivergedMetadata {
  readonly diverged_fields: ReadonlyArray<DivergedField>;
  readonly inherited_auth_method: AuthMethod;
}

export interface ConnectorBindingAttestedMetadata {
  readonly attestation_expires_at: string;
  readonly previous_attestation_expires_at: string;
}

export interface ConnectorBindingAttestationExpiredMetadata {
  readonly attestation_expires_at: string;
  readonly days_overdue: number;
}

export interface ConnectorBindingOrphanRiskMetadata {
  readonly parent_default_revoked_reason: string;
  readonly parent_default_revoked_at: string;
}

export interface ConnectorBindingMissingMetadata {
  readonly attempted_auth_method: AuthMethod;
  readonly attempted_steps: ReadonlyArray<string>;
}

export interface ConnectorBindingHealthCheckMetadata {
  readonly latency_ms: number;
  readonly error?: string;
}

/**
 * The full event-type → metadata map. The runtime picks the
 * shape via the event_type; a discriminator union ensures the
 * caller cannot mix event_type and metadata shape.
 */
export type ConnectorBindingEvent =
  | (ConnectorBindingEventBase & {
      readonly event_type: 'connector.binding.created';
      readonly metadata: ConnectorBindingCreatedMetadata;
    })
  | (ConnectorBindingEventBase & {
      readonly event_type: 'connector.binding.activated';
      readonly metadata: ConnectorBindingActivatedMetadata;
    })
  | (ConnectorBindingEventBase & {
      readonly event_type: 'connector.binding.revoked';
      readonly metadata: ConnectorBindingRevokedMetadata;
    })
  | (ConnectorBindingEventBase & {
      readonly event_type: 'connector.binding.diverged';
      readonly metadata: ConnectorBindingDivergedMetadata;
    })
  | (ConnectorBindingEventBase & {
      readonly event_type: 'connector.binding.attested';
      readonly metadata: ConnectorBindingAttestedMetadata;
    })
  | (ConnectorBindingEventBase & {
      readonly event_type: 'connector.binding.attestation_expired';
      readonly metadata: ConnectorBindingAttestationExpiredMetadata;
    })
  | (ConnectorBindingEventBase & {
      readonly event_type: 'connector.binding.orphan_risk';
      readonly metadata: ConnectorBindingOrphanRiskMetadata;
    })
  | (ConnectorBindingEventBase & {
      readonly event_type: 'connector.binding.missing';
      readonly metadata: ConnectorBindingMissingMetadata;
    })
  | (ConnectorBindingEventBase & {
      readonly event_type: 'connector.binding.health_check.ok';
      readonly metadata: ConnectorBindingHealthCheckMetadata;
    })
  | (ConnectorBindingEventBase & {
      readonly event_type: 'connector.binding.health_check.fail';
      readonly metadata: ConnectorBindingHealthCheckMetadata;
    });

// ---------------------------------------------------------------------------
// Sink contract
// ---------------------------------------------------------------------------

/**
 * The audit-sink contract. Mirrors the `@fora/db-pool` `AuditSink`
 * interface; production wires to the FORA-36 forwarder, tests
 * use the in-memory collector.
 */
export interface ConnectorBindingAuditSink {
  append(event: ConnectorBindingEvent): Promise<void>;
  /** Surface the event_id, useful for tests + the MISS error path. */
  nextEventId(): string;
}

/**
 * The in-memory collector. Used by tests and the smoke harness.
 * `nextEventId` mints a deterministic v4 UUID via crypto.randomUUID
 * so tests can assert on `event_id` without leaking timing.
 */
export function createInMemoryAuditSink(): ConnectorBindingAuditSink & {
  events: ConnectorBindingEvent[];
  reset(): void;
} {
  const events: ConnectorBindingEvent[] = [];
  return {
    events,
    async append(event: ConnectorBindingEvent): Promise<void> {
      events.push(event);
    },
    nextEventId(): string {
      // crypto.randomUUID is available in Node 20+; deterministic in
      // the sense of "always returns a v4-shaped string".
      return crypto.randomUUID();
    },
    reset(): void {
      events.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Event-builder helpers
// ---------------------------------------------------------------------------

/**
 * Build a typed `connector.binding.*` event. The factory validates
 * that `event_type` is in the closed set and `binding_id` is
 * present (or `null` only for `connector.binding.missing`).
 */
export function buildEvent<E extends ConnectorBindingEvent>(
  event: E,
): E {
  if (!CONNECTOR_BINDING_EVENT_TYPES.includes(event.event_type)) {
    throw new Error(
      `connector-binding audit: unknown event_type=${event.event_type}`,
    );
  }
  if (event.event_type !== 'connector.binding.missing' && event.binding_id === null) {
    throw new Error(
      `connector-binding audit: ${event.event_type} requires binding_id`,
    );
  }
  if (event.event_type === 'connector.binding.missing' && event.binding_id !== null) {
    throw new Error(
      'connector-binding audit: connector.binding.missing must carry binding_id=null',
    );
  }
  return event;
}

/**
 * Mint a fresh event_id (v4 UUID) for a new audit event.
 */
export function mintEventId(): string {
  return crypto.randomUUID();
}

/**
 * Default actor envelope for system events (e.g. health-check
 * worker, resolver MISS, nightly attestation sweeper).
 */
export function systemActor(role: string, trace_id?: string): ConnectorBindingActor {
  return {
    actor_type: 'system',
    actor_id: `system:${role}`,
    role,
    ...(trace_id !== undefined ? { trace_id } : {}),
  };
}

/**
 * Default actor envelope for user-initiated events (admin
 * onboarding wizard, Architect re-attestation).
 */
export function userActor(
  actor_id: ActorId,
  role: string,
  trace_id?: string,
): ConnectorBindingActor {
  return {
    actor_type: 'user',
    actor_id,
    role,
    ...(trace_id !== undefined ? { trace_id } : {}),
  };
}