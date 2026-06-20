/**
 * Idempotency spine — `claim()` primitive.
 *
 * FORA-200.5 / FORA-401: every adapter operation runs through
 * `claim()` BEFORE its side effect. The `INSERT ... ON CONFLICT
 * DO NOTHING` against the `sync_op` table is the at-most-once
 * primitive — a replay of the same `(tenant_id, external_id,
 * op_kind)` short-circuits with `false`.
 *
 * Acceptance bar (FORA-200 plan §4):
 *   - Property test replays 10x the same key and asserts
 *     `claim()` returns `true` exactly once.
 *   - The first successful claim emits all six
 *     `sync.{source,target}.{ok,fail}` audit event types
 *     (per the audit emitter).
 *   - Replays emit ZERO audit events.
 *
 * The transaction wraps `INSERT` + the first-call audit emission
 * so a crash between them does NOT leave a "claimed but never
 * audited" row. If the audit sink throws, the transaction
 * rolls back the sync_op row and the next replay claims again
 * — at-least-once semantics for the audit trail are guaranteed
 * by the caller invoking `claim()` under the same transaction
 * as the side effect (or separately, per the operation's own
 * contract; see FORA-402/404/405).
 *
 * Per ADR-0003 §4.2 the `PoolExecutor` (passed in by the caller)
 * is the runtime gate; the application-level check here is the
 * first gate.
 */

import type { PoolExecutor } from './pool_executor.js';
import {
  type AuditSink,
  type SyncEventType,
  SIX_OK_EVENT_TYPES,
  emitSyncEvent,
} from './audit.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The closed `op_kind` enum for v0.1 (FORA-200 §3 "Idempotency
 * spine"). New op_kinds are a forward migration to 0009+.
 *
 * Mirrored exactly by the CHECK constraint in
 * `migrations/0008_jira_adapter.sql` — keep the two in lock-step.
 */
export type OpKind =
  | 'issue.create'
  | 'issue.update'
  | 'comment.create'
  | 'comment.update'
  | 'stage.transition'
  | 'webhook.received';

/** Tuple identity for a claim. The unique index boundary. */
export interface ClaimKey {
  tenant_id: string;
  external_id: string;
  op_kind: OpKind;
}

/** Outcome of a claim attempt. */
export type ClaimResult =
  | { firstTime: true; claimed_at: Date }
  | { firstTime: false };

/** Optional context carried on the sync_op row at claim time. */
export interface ClaimContext {
  /** FORA-253 author envelope (e.g. `user:<idp-id>` or `agent:<type>:<run-id>`). */
  actor: string;
  /** Paperclip-issued source reference, e.g. `paperclip:issue/123`. */
  source?: string;
  /** Platform-issued target reference, e.g. `jira:issue/PROJ-456`. */
  target?: string;
  /** Free-form structured metadata for the audit trail. */
  metadata?: Record<string, unknown>;
}

/**
 * Dependencies for `claim()`. The `executor` is the
 * `TenantAwarePool`-checked-out transactional handle; `audit`
 * is the audit emitter from `./audit.js`.
 */
export interface ClaimDeps {
  executor: PoolExecutor;
  audit: AuditSink;
}

// ---------------------------------------------------------------------------
// claim() primitive
// ---------------------------------------------------------------------------

/**
 * Attempt to claim `(tenant_id, external_id, op_kind)` for the
 * current tenant. Returns `true` on the first successful claim,
 * `false` on every subsequent replay.
 *
 * Implementation:
 *   1. `INSERT INTO sync_op (...) VALUES (...) ON CONFLICT DO NOTHING`.
 *      `rowCount === 1` ⇒ first time. `rowCount === 0` ⇒ already
 *      applied; skip.
 *   2. On the first successful claim, the audit sink is invoked
 *      inside the same transaction. If audit throws, the
 *      transaction rolls back the sync_op row and the next
 *      replay claims again. This keeps audit emission
 *      at-least-once with the claim itself.
 *
 * The function does NOT close the `executor` — the caller owns
 * the transaction boundary so the side effect (the actual
 * Jira / Paperclip call) can join the same transaction when
 * the operation's contract requires it.
 */
export async function claim(
  key: ClaimKey,
  ctx: ClaimContext,
  deps: ClaimDeps,
): Promise<ClaimResult> {
  const { executor, audit } = deps;

  // 1. INSERT ... ON CONFLICT DO NOTHING. The PRIMARY KEY on
  //    (tenant_id, external_id, op_kind) is the dedupe index.
  const result = await executor.query<{ claimed_at: Date }>({
    sql: `
      INSERT INTO sync_op
        (tenant_id, external_id, op_kind, source, target, claimed_by, metadata)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (tenant_id, external_id, op_kind) DO NOTHING
      RETURNING claimed_at
    `,
    params: [
      key.tenant_id,
      key.external_id,
      key.op_kind,
      ctx.source ?? '',
      ctx.target ?? '',
      ctx.actor,
      JSON.stringify(ctx.metadata ?? {}),
    ],
  });

  if (result.rowCount === 0) {
    // Replay. No audit emission (per FORA-200 §4 acceptance bar
    // "0 audit events on replays").
    return { firstTime: false };
  }

  // First successful claim. Emit the full closed set of six
  // `sync.{source,target}.{issue,comment,stage}.ok` audit
  // events in one transaction. The spine's contract (FORA-200.5
  // acceptance bar) is: the first claim emits all six distinct
  // event types; the per-op_kind finer-grained emissions belong
  // on the FORA-402/404/405 mirror implementations.
  //
  // If any emit throws, the caller's transaction rolls back the
  // sync_op row and the next replay retries the full set —
  // audit emission is at-least-once with the claim itself.
  const claimed_at = result.rows[0]?.claimed_at ?? new Date();
  const payload = {
    tenant_id: key.tenant_id,
    external_id: key.external_id,
    op_kind: key.op_kind,
    actor: ctx.actor,
    source: ctx.source ?? '',
    target: ctx.target ?? '',
    outcome: 'ok' as const,
    claimed_at: claimed_at.toISOString(),
    metadata: ctx.metadata ?? {},
  };
  for (const event_type of SIX_OK_EVENT_TYPES) {
    await emitSyncEvent(audit, event_type satisfies SyncEventType, payload);
  }

  return { firstTime: true, claimed_at };
}