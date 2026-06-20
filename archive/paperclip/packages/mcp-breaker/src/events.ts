/**
 * @fora/mcp-breaker — event sink
 *
 * Three event types per FORA-48 §3.3:
 *
 *   - breaker.trip     — closed → open (or half_open → open). Carries the
 *                        reason (`consecutive_failures` | `error_rate`)
 *                        and the current error rate so dashboards can
 *                        chart "what tipped us".
 *   - breaker.recover  — half_open → closed (probe success).
 *   - breaker.reject   — every time a call is short-circuited with
 *                        `circuit_open`. Carries `retry_after_ms`.
 *
 * The sink interface mirrors `@fora/sync-plane-ratelimit/src/audit.ts` —
 * the production wiring is a one-line adapter that forwards to the
 * existing `@fora/event-bus` producer. v0.1 ships:
 *
 *   - `InMemoryBreakerEventSink` for tests + smoke
 *   - `NoopBreakerEventSink`     for callers who want to opt out
 *   - `toEventBusSink`           — the documented production adapter
 *                                  helper (see README §"Production wiring")
 *
 * Why an interface and not a direct dep on `@fora/event-bus`:
 *   - the breaker is a hot-path primitive; the bus is a NATS producer
 *     with its own connection lifecycle. Keeping them decoupled means the
 *     breaker can run in-process (router, tests) or be embedded in a
 *     worker without a NATS dependency.
 *   - the v1 MCP router (FORA-460) already owns the bus connection; the
 *     router passes the adapter in. The breaker never opens a NATS
 *     socket on its own.
 */

import type { BreakerState } from './types.js';

export type BreakerEventType = 'breaker.trip' | 'breaker.recover' | 'breaker.reject';

export type TripReason = 'consecutive_failures' | 'error_rate' | 'probe_failure';

export interface BreakerEvent {
  /** Wire-format version. Bump on a breaking shape change. */
  readonly schema_version: 1;
  readonly type: BreakerEventType;
  /** ISO-8601 timestamp the event was constructed. */
  readonly occurred_at: string;
  readonly tenant_id: string;
  readonly server_name: string;
  readonly state: BreakerState;
  readonly actor: 'system:mcp-breaker';
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Pluggable sink. `emit` is fire-and-forget; throws are caught by the breaker. */
export interface BreakerEventSink {
  emit(event: BreakerEvent): void | Promise<void>;
}

/** Default test sink — captures every event in memory, ordered by arrival. */
export class InMemoryBreakerEventSink implements BreakerEventSink {
  private readonly events: BreakerEvent[] = [];

  emit(event: BreakerEvent): void {
    this.events.push(event);
  }

  /** All events captured so far. */
  list(): readonly BreakerEvent[] {
    return this.events;
  }

  /** Filter helper — convenience for tests. */
  listOfType(type: BreakerEventType): readonly BreakerEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /** Per-tenant, per-server event stream (ordered by arrival). */
  listFor(tenant_id: string, server_name: string): readonly BreakerEvent[] {
    return this.events.filter(
      (e) => e.tenant_id === tenant_id && e.server_name === server_name,
    );
  }

  /** Test-only: drop all captured events. */
  clear(): void {
    this.events.length = 0;
  }
}

/** Opt-out sink for callers who don't care about breaker events. */
export class NoopBreakerEventSink implements BreakerEventSink {
  emit(_event: BreakerEvent): void {
    // intentionally empty
  }
}

/** Construct an event with the standard envelope. `now` is injectable for tests. */
export function makeEvent(
  type: BreakerEventType,
  tenant_id: string,
  server_name: string,
  state: BreakerState,
  payload: Record<string, unknown>,
  now: () => Date = () => new Date(),
): BreakerEvent {
  return {
    schema_version: 1,
    type,
    occurred_at: now().toISOString(),
    tenant_id,
    server_name,
    state,
    actor: 'system:mcp-breaker',
    payload: Object.freeze(payload),
  };
}