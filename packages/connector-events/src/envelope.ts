/**
 * Universal connector event envelope — FORA-391 Plan 3 / FORA-484.
 *
 * Every connector call emits an audit event with this exact shape.
 * The envelope is the wire-format contract between the MCP family
 * (Jira / Confluence / GitHub / Slack / Teams) and the audit store.
 * A change to any field name or type is a breaking change: bump
 * `CONNECTOR_EVENT_SCHEMA_VERSION` and update the worked example
 * in the README together.
 *
 * Versioning: 0.1.0 (initial). See FORA-484 acceptance criteria.
 */

import { z } from 'zod';

/** Wire-format schema version. Bump on any breaking change. */
export const CONNECTOR_EVENT_SCHEMA_VERSION = '1.0.0';

/** The five Tier-1 connector families. */
export const ConnectorFamilySchema = z.enum([
  'jira',
  'confluence',
  'github',
  'slack',
  'teams',
]);
export type ConnectorFamily = z.infer<typeof ConnectorFamilySchema>;

/**
 * Cross-connector lifecycle verbs. Per Plan 3 §3, every lifecycle event
 * carries the `connector.` prefix to discriminate from family events
 * (which use `<family>.<verb>` without a `connector.` prefix).
 */
export const LifecycleVerbSchema = z.enum([
  'connector.binding.created',
  'connector.binding.rotated',
  'connector.binding.revoked',
  'connector.binding.overridden',
  'connector.health.checked',
  'connector.call.started',
  'connector.call.succeeded',
  'connector.call.failed',
  'connector.rate_limit.consumed',
  'connector.rate_limit.throttled',
  'connector.circuit.opened',
  'connector.circuit.half_open',
  'connector.circuit.closed',
  'connector.webhook.received',
  'connector.webhook.verified',
  'connector.webhook.rejected',
]);
export type LifecycleVerb = z.infer<typeof LifecycleVerbSchema>;

/** Tier-1 family verbs. Per Plan 3 §3 — Tier-1 connector events. */
export const FamilyVerbSchema = z.enum([
  // Jira
  'jira.issue.observed',
  'jira.issue.ingested',
  'jira.transition.applied',
  'jira.issue.linked',
  'jira.search.executed',
  'jira.health.checked',
  // Confluence
  'confluence.page.observed',
  'confluence.page.indexed',
  'confluence.page.published',
  'confluence.comment.added',
  'confluence.space.scanned',
  // GitHub
  'github.push.received',
  'github.pr.opened',
  'github.pr.review.submitted',
  'github.pr.merged',
  'github.branch_protection.checked',
  'github.action.run.completed',
  'github.repo.scanned',
  // Slack
  'slack.message.received',
  'slack.command.executed',
  'slack.notification.sent',
  'slack.thread.summarized',
  // Teams
  'teams.transcript.received',
  'teams.message.received',
  'teams.card.actioned',
  'teams.call.recorded',
]);
export type FamilyVerb = z.infer<typeof FamilyVerbSchema>;

/** All event types. Either a family verb or a lifecycle verb. */
export const EventTypeSchema = z.union([FamilyVerbSchema, LifecycleVerbSchema]);
export type EventType = z.infer<typeof EventTypeSchema>;

/** Outcome enum. The event succeeded, failed, or was denied by RBAC. */
export const OutcomeSchema = z.enum(['success', 'failure', 'denied']);
export type Outcome = z.infer<typeof OutcomeSchema>;

/** Who initiated the connector call. Mirrors the audit spine's actor shape. */
export const ActorSchema = z.object({
  type: z.enum(['agent', 'user', 'system']),
  id: z.string().min(1),
  /** Role name from config/agent-iam/roles.yaml (e.g. `developer`, `architect`). */
  role: z.string().min(1).optional(),
});
export type Actor = z.infer<typeof ActorSchema>;

/** Request shape — what the connector was asked to do. */
export const RequestShapeSchema = z.object({
  /** The connector operation (e.g. `issue.create`, `pr.merge`). */
  op: z.string().min(1),
  /** Hex SHA-256 of canonical JSON of the args (NEVER the args themselves). */
  args_hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'args_hash must be a 64-char hex SHA-256 digest'),
});
export type RequestShape = z.infer<typeof RequestShapeSchema>;

/** Response shape — what the connector returned. Optional: events on `call.started` have no response yet. */
export const ResponseShapeSchema = z
  .object({
    /** HTTP status (or connector-defined). Null when the call never returned. */
    status: z.number().int().nullable(),
    /** Hex SHA-256 of canonical JSON of the response body. */
    body_hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'body_hash must be a 64-char hex SHA-256 digest'),
    /** Response body size in bytes. */
    size: z.number().int().nonnegative(),
  })
  .nullable();
export type ResponseShape = z.infer<typeof ResponseShapeSchema>;

/** Audit chain — prev + self hash. Populated by the store at append time. */
export const AuditChainSchema = z.object({
  /** Hash of the previous event in the (tenant, binding) chain, or 64 zero hex chars for the first. */
  prev_event_hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'prev_event_hash must be a 64-char hex digest'),
  /** SHA-256 of canonical JSON of this event (minus `audit_chain.event_hash`) plus `prev_event_hash`. */
  event_hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'event_hash must be a 64-char hex digest'),
});
export type AuditChain = z.infer<typeof AuditChainSchema>;

/** The universal envelope. Every connector event conforms to this shape. */
export const ConnectorEventSchema = z.object({
  /** Stable event id (evt-<uuid16>). */
  event_id: z.string().regex(/^evt-[0-9a-f]{16,}$/, 'event_id must be evt-<hex uuid16+>'),
  /** Event type — family verb or lifecycle verb. */
  event_type: EventTypeSchema,
  /** Wire-format schema version. */
  schema_version: z
    .string()
    .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'schema_version must be semver'),
  /** ISO 8601 UTC timestamp when the event was observed. */
  occurred_at: z.string().datetime({ offset: true }),
  /** Tenant id (from config/agent-iam). */
  tenant_id: z.string().min(1),
  /** Project id (FORA-399 multi-tenancy boundary). */
  project_id: z.string().min(1),
  /** Connector identifier (`jira`, `github`, etc.). */
  connector_id: ConnectorFamilySchema,
  /** Per-tenant credential binding id (FORA-125 IAM). */
  binding_id: z.string().min(1),
  /** Initiator. */
  actor: ActorSchema,
  /** Outcome. */
  outcome: OutcomeSchema,
  /** Typed reason code on failure / denial (e.g. `scope_violation`, `rate_limited`). Empty when N/A. */
  reason_code: z.string().default(''),
  /** Wall-clock latency in ms. */
  latency_ms: z.number().nonnegative(),
  /** What the connector was asked to do. */
  request: RequestShapeSchema,
  /** What the connector returned. Null on `call.started`. */
  response: ResponseShapeSchema,
  /** Typed-artifact ids emitted by this event (Plan 3 §7). */
  artifacts_emitted: z.array(z.string().min(1)).default([]),
  /** Hash-chain linkage. Populated by the store. */
  audit_chain: AuditChainSchema,
});
export type ConnectorEvent = z.infer<typeof ConnectorEventSchema>;

/** Convenience: parse a JSON-string event and throw on schema violation. */
export function parseConnectorEvent(json: string): ConnectorEvent {
  return ConnectorEventSchema.parse(JSON.parse(json));
}

/** Convenience: validate an unknown value, returning a typed result. */
export function safeParseConnectorEvent(value: unknown) {
  return ConnectorEventSchema.safeParse(value);
}