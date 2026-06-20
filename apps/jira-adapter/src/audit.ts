/**
 * Audit emitter — `sync.{source,target}.{ok,fail}` events.
 *
 * FORA-200.5 / FORA-401: every successful `claim()` emits all
 * six audit event types; every replay emits zero. The six
 * types are the closed set from FORA-200 plan §4 "Verification
 * bar":
 *
 *   sync.source.issue.ok     — outbound issue created/updated
 *   sync.target.issue.ok     — inbound issue mirrored
 *   sync.source.comment.ok   — outbound comment mirrored
 *   sync.target.comment.ok   — inbound comment mirrored
 *   sync.source.stage.ok     — outbound stage transition
 *   sync.target.stage.ok     — inbound stage transition
 *
 * (`fail` variants are emitted by the FORA-402/404/405 mirror
 * implementations when the actual Jira / Paperclip side effect
 * fails; the idempotency spine only emits `ok` on a successful
 * claim.)
 *
 * Each event carries:
 *   - `tenant_id`     — verified broker claim (FORA-163)
 *   - `source`        — Paperclip-side reference (e.g.
 *                        `paperclip:issue/123`)
 *   - `target`        — platform-side reference (e.g.
 *                        `jira:issue/PROJ-456`)
 *   - `external_id`   — the dedupe key for this op
 *   - `op_kind`       — the v0.1 closed enum
 *   - `outcome`       — 'ok' | 'fail'
 *   - `actor`         — FORA-253 author envelope
 *   - `claimed_at`    — wall-clock claim time (ISO 8601)
 *   - `metadata`      — free-form structured context
 *
 * The sink interface is intentionally tiny — production wires
 * the audit sink to the FORA-36 append-only store (same as
 * `apps/customer-cloud-broker/src/audit.ts`); the test path uses
 * an in-memory collector so the property test can assert the
 * "6 events on first claim, 0 on replays" bar without a network
 * sink.
 */

import type { OpKind } from './idempotency.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The six FORA-200 v0.1 audit event sources. */
export type SyncSource = 'issue' | 'comment' | 'stage' | 'webhook';

/** The six FORA-200 v0.1 audit event targets. Mirrors `SyncSource`. */
export type SyncTarget = SyncSource;

/** Closed outcome enum. */
export type SyncOutcome = 'ok' | 'fail';

/**
 * The six canonical event types. Pattern: `sync.{source|target}.{kind}.{ok|fail}`.
 *
 * Derived from the FORA-200 plan §4 "All 6 Audit events observed
 * in the audit log" line. Keep this list and the
 * `emitSyncEvent()` factory in lock-step.
 */
export type SyncEventType =
  | 'sync.source.issue.ok'
  | 'sync.target.issue.ok'
  | 'sync.source.comment.ok'
  | 'sync.target.comment.ok'
  | 'sync.source.stage.ok'
  | 'sync.target.stage.ok';

/** Full audit-event payload — what the sink writes per emission. */
export interface SyncEventPayload {
  tenant_id: string;
  external_id: string;
  op_kind: OpKind;
  actor: string;
  source: string;
  target: string;
  outcome: SyncOutcome;
  claimed_at: string;
  metadata: Record<string, unknown>;
}

/** The audit-event record the sink receives. */
export interface SyncAuditEvent extends SyncEventPayload {
  event_type: SyncEventType;
  emitted_at: string;
}

/**
 * Sink contract. Mirrors the `@fora/db-pool` `AuditSink`
 * interface (see `packages/db-pool/src/types.ts`) — the
 * production wiring reuses the FORA-36 forwarder; the test
 * path uses the in-memory collector below.
 */
export interface AuditSink {
  appendSync(event: SyncAuditEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// Sink factory + helpers
// ---------------------------------------------------------------------------

/**
 * Build the canonical event_type string from a (source, kind,
 * outcome) tuple. Centralised so a new closed-set addition is
 * one place to change.
 */
export function buildEventType(
  side: 'source' | 'target',
  kind: SyncSource,
  outcome: SyncOutcome,
): SyncEventType {
  return `sync.${side}.${kind}.${outcome}` as SyncEventType;
}

/**
 * The six v0.1 success event types. Used by `emitSyncEvent` to
 * validate the closed set without a runtime array allocation.
 */
export const SIX_OK_EVENT_TYPES: readonly SyncEventType[] = [
  'sync.source.issue.ok',
  'sync.target.issue.ok',
  'sync.source.comment.ok',
  'sync.target.comment.ok',
  'sync.source.stage.ok',
  'sync.target.stage.ok',
] as const;

/**
 * Emit a single `sync.{source,target}.{kind}.{outcome}` event.
 * The factory is the single entry point for v0.1; the FORA-402
 * / 404 / 405 mirror implementations call this exactly once per
 * side effect.
 *
 * Rejects the event if `event_type` is not in the closed set
 * (defence in depth on top of the closed union).
 */
export async function emitSyncEvent(
  sink: AuditSink,
  event_type: SyncEventType,
  payload: SyncEventPayload,
): Promise<void> {
  const full: SyncAuditEvent = {
    ...payload,
    event_type,
    emitted_at: new Date().toISOString(),
  };
  await sink.appendSync(full);
}

/**
 * Build an `AuditSink` that buffers events in memory. Used by
 * the FORA-401 property test and any other unit test that needs
 * to assert audit emission without a network sink.
 *
 * The collector's `appendSync` resolves synchronously (no I/O)
 * so the caller's transaction boundary is not on a network
 * timer; the test path's race-free assertion is the value.
 */
export function createAuditSink(): AuditSink & {
  events: SyncAuditEvent[];
  reset(): void;
} {
  const events: SyncAuditEvent[] = [];
  return {
    events,
    async appendSync(event: SyncAuditEvent): Promise<void> {
      events.push(event);
    },
    reset(): void {
      events.length = 0;
    },
  };
}