/**
 * @fora/jira-adapter — public surface.
 *
 * The Jira adapter implements the Paperclip ↔ Jira bidirectional
 * sync adapter from FORA-200 / 11.2a, per ADR-0010 and the
 * FORA-199 ADR. Day-one scope:
 *
 *   - Idempotency spine (`./idempotency`) — `sync_op` + `webhook_dedupe`
 *     Postgres primitives backed by `INSERT ... ON CONFLICT DO NOTHING`.
 *   - Audit emitter (`./audit`) — `sync.{source,target}.{ok,fail}`
 *     events with `tenant/source/target/external-ids/outcome`.
 *   - Issue mirror (`./issue-mirror`) — FORA-402.
 *   - Comment mirror (`./comment-mirror`) — FORA-404.
 *   - Workflow mapping (`./workflow-mapping`) — FORA-405.
 *   - Webhook receiver (`./webhook`) — Jira → Paperclip ingest.
 *   - Divergence cron (`./divergence-cron`) — FORA-406.
 *
 * Writes to Jira always route through the customer-cloud-broker
 * (FORA-126) per FORA-200 charter; the adapter never calls Jira
 * write APIs directly.
 */

export { claim, type ClaimKey, type ClaimResult } from './idempotency.js';
export {
  emitSyncEvent,
  createAuditSink,
  type SyncSource,
  type SyncTarget,
  type SyncOutcome,
  type SyncEventPayload,
  type SyncAuditEvent,
  type AuditSink,
} from './audit.js';