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
export {
  mirrorIssueOutbound,
  mirrorIssueInbound,
  makeClaimDeps,
  type JiraClient,
  type SyncPlanePublisher,
  type PaperclipIssueEvent,
  type JiraIssueCreatedWebhook,
  type MirrorInboundInput,
  type OutboundIssueResult,
  type InboundIssueResult,
} from './issue-mirror.js';
export {
  mirrorCommentOutbound,
  mirrorCommentInbound,
  resolveInboundAuthor,
  AuthorMappingError,
  EnvBackedJiraAuthorMapper,
  type AuthorKind,
  type MappedPaperclipAuthor,
  type JiraCommentClient,
  type JiraAuthorMapper,
  type PaperclipCommentEvent,
  type JiraCommentCreatedWebhook,
  type CommentInboundInput,
  type OutboundCommentResult,
  type InboundCommentResult,
  type AuthorResolution,
} from './comment-mirror.js';
export {
  resolveJiraTransitionName,
  DEFAULT_STAGE_TRANSITIONS,
  PRIMARY_STATUSES,
  stageOverrideEnvVar,
  mirrorStageOutbound,
  mirrorStageInbound,
  makeClaimDeps as makeStageClaimDeps,
  type PaperclipStatus,
  type StageTransitionMap,
  type JiraStageClient,
  type StageSyncPlanePublisher,
  type PaperclipStageEvent,
  type JiraIssueUpdatedWebhook,
  type StageInboundInput,
  type OutboundStageResult,
  type InboundStageResult,
} from './workflow-mapping.js';
export {
  runNightlySweep,
  compareMirrorEntity,
  diffCommentIds,
  buildReportPath,
  buildCronRegistration,
  applyCronRegistration,
  serialiseReport,
  writeReport,
  DIVERGENCE_CRON_SCHEDULE,
  DIVERGENCE_CRON_OWNER,
  DIVERGENCE_AUDIT_EVENT_TYPE,
  type Mismatch,
  type MismatchField,
  type MirrorEntity,
  type MirrorState,
  type DivergenceReport,
  type CronRegistration,
  type PaperclipRoutinesClient,
  type SweepOptions,
} from './divergence-cron.js';