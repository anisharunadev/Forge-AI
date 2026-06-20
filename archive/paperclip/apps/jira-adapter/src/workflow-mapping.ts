/**
 * Workflow mapping — Paperclip ↔ Jira status transitions.
 *
 * FORA-200.3 / FORA-405. Implements the AC#3 vertical slice:
 * "A Paperclip status change (approved / in_progress / in_review /
 * blocked / done / cancelled) transitions the linked Jira issue
 * to the corresponding Jira status, and a Jira status change
 * mirrors back to Paperclip" (FORA-200 plan §2 AC#3 + §3
 * "Status-transition config").
 *
 * The module is the only writer to Jira workflow transitions
 * for the FORA Sync Plane on the v0.1 day-one scope. It
 * encapsulates:
 *
 *   * The declarative `paperclip.status → jira.transition` table
 *     (this file's `DEFAULT_STAGE_TRANSITIONS`) + per-project
 *     override via the `sync.stage.<status>.v1.jira_status` env
 *     var convention (CTO-approved per comment `8abb9965-…`).
 *     The table is the *only* place in the adapter that knows
 *     the Jira-side status name shape; a future customer override
 *     in `tenants/<slug>/workflow.yaml` is a one-line change.
 *
 *   * Outbound (`mirrorStageOutbound`): a Paperclip
 *     `stage.transitioned.v1` event is translated to a Jira
 *     `transitionIssue` REST call, looked up by name (not id —
 *     ids are project-local and brittle). The `JiraStageClient`
 *     seam is the only place that knows the Jira REST shape;
 *     production wires a customer-cloud-broker (FORA-126) backed
 *     implementation, the contract test wires a recording fake.
 *
 *   * Inbound (`mirrorStageInbound`): a Jira `jira:issue_updated`
 *     webhook payload (the `changelog` carries the `from`/`to`
 *     status names) is normalized into a canonical
 *     `sync.stage.transitioned.v1` event and published to the
 *     Sync Plane resolver.
 *
 *   * Idempotency: every call runs through the `claim()` spine
 *     (FORA-401) BEFORE the side effect. The
 *     `(tenant_id, external_id, op_kind)` triple is the dedupe
 *     index; the `op_kind` for stage transitions is
 *     `stage.transition`. The first claim emits all six
 *     `sync.{source,target}.{ok,fail}` event types (per the audit
 *     emitter); the two events the FORA-405 AC calls out
 *     (`sync.source.stage.ok` + `sync.target.stage.ok`) are
 *     emitted by the spine on the first claim and absent on
 *     every replay.
 *
 *   * External id: the deterministic id FORA-200 §3 specifies,
 *     `paperclip:<issueId>:<from>-><to>`, is the `external_id`
 *     on the outbound path. Including the from/to pair in the
 *     key means a re-issued Paperclip transition from the same
 *     source state to a different target state is a NEW claim
 *     (the operator may legitimately re-route through "In
 *     Progress" → "In Review" → "Done" within the same issue
 *     lifetime), but a duplicate replay of the EXACT same
 *     transition short-circuits with `firstClaim: false`.
 *
 * Concurrency: the mapper is stateless across tenants. Two
 * tenants running through the same adapter instance see no
 * cross-talk. The dedupe index is the Postgres `sync_op`
 * PRIMARY KEY; the audit emission is the per-claim emit on
 * top of that index.
 */

import {
  claim,
  type ClaimContext,
  type ClaimDeps,
  type ClaimKey,
} from './idempotency.js';
import type { AuditSink } from './audit.js';
import type { PoolExecutor } from './pool_executor.js';

// ---------------------------------------------------------------------------
// Paperclip status enum (the closed v0.1 set)
// ---------------------------------------------------------------------------

/**
 * The six FORA-200 v0.1 primary Paperclip statuses that the
 * adapter mirrors to Jira. The set is the "all 6 primary stages"
 * the FORA-405 AC mentions; a new status is a forward migration
 * to the table below + a new mapping row.
 *
 * The names are the same as the Paperclip issue status enum
 * (the Jira-side `transitionName` is what we look up in
 * `DEFAULT_STAGE_TRANSITIONS`).
 */
export type PaperclipStatus =
  | 'approved'
  | 'in_progress'
  | 'in_review'
  | 'blocked'
  | 'done'
  | 'cancelled';

/**
 * The closed tuple of v0.1 primary statuses. Used by the test
 * suite and the YAML loader to validate the keys of a
 * `StageTransitionMap` without a runtime array allocation.
 */
export const PRIMARY_STATUSES: readonly PaperclipStatus[] = [
  'approved',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'cancelled',
] as const;

/**
 * The default declarative `paperclip.status → jira.transition`
 * table. Per CTO-approved convention (comment `8abb9965-…`),
 * the `approved` row maps to `"Approved"` (matching the default
 * Jira Software workflow), and the rest follow the Jira
 * Software default workflow's transition names. A per-project
 * override is read from the `sync.stage.<status>.v1.jira_status`
 * env var at resolution time (see `resolveJiraTransitionName`).
 */
export const DEFAULT_STAGE_TRANSITIONS: Readonly<
  Record<PaperclipStatus, string>
> = {
  approved: 'Approved',
  in_progress: 'In Progress',
  in_review: 'In Review',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

// ---------------------------------------------------------------------------
// Resolution: paperclip status → jira transition name
// ---------------------------------------------------------------------------

/**
 * The env-var naming convention for per-project stage
 * overrides (CTO-approved per comment `8abb9965-…`).
 *
 * Pattern: `sync.stage.<paperclip_status>.v1.jira_status`
 *
 * Example: `sync.stage.approved.v1.jira_status="Shipped"`
 * remaps Paperclip `approved` to Jira `"Shipped"` for the
 * running process. The env var is read at resolution time,
 * NOT at module load, so a test that mutates `process.env`
 * mid-run sees the new value on the next `resolveJiraTransitionName`
 * call (per the FORA-405 AC: "per-project override via
 * `sync.stage.approved.v1.jira_status` env var").
 */
export function stageOverrideEnvVar(
  status: PaperclipStatus,
): string {
  return `sync.stage.${status}.v1.jira_status`;
}

/**
 * Optional override table — the parsed contents of a
 * `tenants/<slug>/workflow.yaml` file. The day-one surface
 * is the env var (above); the YAML shape is reserved for the
 * FORA-200.3 sibling's follow-up so the per-tenant override
 * can travel with the customer's source-controlled config
 * (rather than process env, which is per-pod).
 */
export interface StageTransitionMap {
  version: 1;
  transitions: Record<PaperclipStatus, string>;
}

/**
 * Resolve the Jira-side transition name for a Paperclip status.
 *
 * Lookup order (per CTO-approved convention):
 *
 *   1. `process.env[stageOverrideEnvVar(status)]` if set and
 *      non-empty. This is the per-project / per-pod override
 *      gate.
 *   2. The `overrides` argument, if provided (the YAML-loaded
 *      `StageTransitionMap.transitions` row for the same key).
 *   3. `DEFAULT_STAGE_TRANSITIONS[status]` — the closed-set
 *      default.
 *
 * Returns the resolved name. Never throws on a missing
 * override — the default is always the fallback.
 */
export function resolveJiraTransitionName(
  status: PaperclipStatus,
  overrides?: Partial<Record<PaperclipStatus, string>>,
): string {
  const envKey = stageOverrideEnvVar(status);
  const fromEnv = process.env[envKey];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv;
  }
  const fromOverrides = overrides?.[status];
  if (typeof fromOverrides === 'string' && fromOverrides.length > 0) {
    return fromOverrides;
  }
  const fromDefault = DEFAULT_STAGE_TRANSITIONS[status];
  // The DEFAULT_STAGE_TRANSITIONS row is exhaustive over the
  // union, but TypeScript's `noUncheckedIndexedAccess` cannot
  // prove that — defensive guard so a future enum widening
  // fails loud.
  if (typeof fromDefault !== 'string') {
    throw new Error(
      `workflow-mapping: no default Jira transition for Paperclip status "${status}"`,
    );
  }
  return fromDefault;
}

// ---------------------------------------------------------------------------
// Transport seams
// ---------------------------------------------------------------------------

/**
 * The Jira REST client seam for stage transitions. Production
 * wires a customer-cloud-broker (FORA-126) backed implementation;
 * the contract test wires a recording fake. The seam is
 * intentionally narrow (one method) so a future broker
 * round-trip is a one-file change.
 *
 * The seam takes `transitionName` (not `transitionId`). Project
 * transition ids are project-local numeric ids and brittle across
 * workflow reconfigurations; transition names are stable as long
 * as the Jira workflow's display names are not renamed.
 */
export interface JiraStageClient {
  /**
   * Move a Jira issue to a new workflow status by transition
   * name. The customer-cloud-broker resolves the name to the
   * project-local id; throws on transport failure, on a
   * non-2xx, OR on a 400 with `transition_not_found` (the
   * per-project workflow does not have a transition with the
   * given name).
   */
  transitionIssue(args: {
    issueIdOrKey: string;
    transitionName: string;
  }): Promise<{ key: string; status: string }>;
}

/**
 * The Sync Plane resolver seam. Mirrors the
 * `SyncPlanePublisher` shape from `./issue-mirror.js`. Lives
 * here as a structural alias to keep the workflow-mapping
 * module import-graph flat (the production wiring in the
 * broker reuses the same publisher).
 */
export interface StageSyncPlanePublisher {
  publish(event: {
    eventId: string;
    tenantId: string;
    subject: string;
    eventType: string;
    occurredAt: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Public event shapes
// ---------------------------------------------------------------------------

/**
 * The outbound event shape — a Paperclip `stage.transitioned.v1`
 * event carried in via the sync plane resolver. The mirror is
 * intentionally thin: it does not know the Paperclip stage
 * state machine beyond the `from` / `to` pair the Jira REST
 * write needs.
 */
export interface PaperclipStageEvent {
  /** Verified broker-claim tenant id (FORA-163 / ADR-0003 §4.2). */
  tenantId: string;
  /** Paperclip-issued issue id (the link source / target). */
  issueId: string;
  /** The Jira-side issue key (e.g. `PROJ-123`) the transition targets. */
  jiraIssueKey: string;
  /** The Paperclip status the issue is leaving. */
  from: PaperclipStatus;
  /** The Paperclip status the issue is moving to. */
  to: PaperclipStatus;
  /** FORA-253 author envelope (`user:<idp-id>` / `agent:<type>:<run-id>`). */
  actor: string;
  /**
   * Optional per-tenant override table — the parsed contents
   * of `tenants/<slug>/workflow.yaml`. When omitted, the
   * resolution falls through to the env var + the default
   * table.
   */
  overrides?: Partial<Record<PaperclipStatus, string>>;
  /**
   * Optional Paperclip-issued source reference. Defaults to
   * `paperclip:issue/<issueId>`.
   */
  source?: string;
}

/**
 * The inbound webhook shape — a Jira Cloud
 * `jira:issue_updated` webhook payload, normalized to the
 * fields the FORA-200 v0.1 scope needs. The mirror is
 * thin here too: only `webhookEventId` (the Jira-issued
 * globally unique delivery id) and the changelog's
 * `from` / `to` status names the canonical event carries.
 */
export interface JiraIssueUpdatedWebhook {
  /** Jira-issued globally unique delivery id (Jira webhook header). */
  webhookEventId: string;
  issue: {
    /** Jira internal numeric id. */
    id: string;
    /** Jira human-readable key, e.g. `PROJ-123`. */
    key: string;
    fields: {
      /** The new (post-transition) status name, per the Jira workflow. */
      status: string;
    };
  };
  /**
   * Jira's `changelog` array. The mirror picks the LAST
   * `Status` change entry — that's the transition the
   * Paperclip side needs to learn about. The `from` /
   * `to` strings are Jira-side status display names.
   */
  changelog: Array<{
    field: string;
    fromString: string | null;
    toString: string | null;
  }>;
}

/**
 * Inputs to `mirrorStageInbound`. The webhook itself does
 * not carry the verified broker-claim tenant id, so the
 * caller passes it in (it came from the webhook URL
 * `?tenant=<slug>` query parameter in production).
 */
export interface StageInboundInput {
  tenantId: string;
  /** The Paperclip-side issue id the canonical event carries. */
  paperclipIssueId: string;
  /** FORA-253 author envelope for the inbound actor. */
  actor: string;
}

/**
 * Result of `mirrorStageOutbound`. `transitionName` is the
 * canonical Jira-side reference the caller surfaces in the
 * audit log + per-tenant observability trace.
 */
export interface OutboundStageResult {
  /** The Jira transition name the mirror invoked. */
  transitionName: string;
  /** The Jira-issued key the transition targeted. */
  jiraIssueKey: string;
  /** The deterministic external id (`paperclip:<issueId>:<from>-><to>`). */
  externalStageId: string;
  /** Verified tenant id (passed through). */
  tenantId: string;
  /** True on the first claim; false on every replay. */
  firstClaim: boolean;
}

/**
 * Result of `mirrorStageInbound`. `eventId` is the
 * deterministic id the resolver dedupes on
 * (`evt-jira-stage-<issueKey>-<webhookEventId>`); the
 * caller threads it into its bus-side dedupe. `firstClaim`
 * is the spine signal — false means a redelivered webhook.
 */
export interface InboundStageResult {
  /** The event id published to the sync-plane resolver. */
  eventId: string;
  /** The bus subject published to. */
  subject: string;
  /** Canonical event type per ADR-0006 §3.1. */
  eventType: 'stage.transitioned.v1';
  /** The Jira-issued key the inbound webhook reported. */
  jiraKey: string;
  /** The Paperclip-side issue id the canonical event carries. */
  paperclipIssueId: string;
  /** The Jira-side status name the issue is leaving. */
  fromStatus: string;
  /** The Jira-side status name the issue is moving to. */
  toStatus: string;
  /** Verified tenant id (passed through). */
  tenantId: string;
  /** True on the first claim; false on every replay. */
  firstClaim: boolean;
}

// ---------------------------------------------------------------------------
// Subject + eventType constants
// ---------------------------------------------------------------------------

/**
 * The canonical bus subject for inbound Jira stage-transitioned
 * events. Mirrors the GitHub adapter's
 * `fora.events.<tenant>.stage.transitioned.v1` shape; the
 * resolver and the paperclip owner plane both consume this
 * subject.
 */
function buildSubject(tenantId: string): string {
  return `fora.events.${tenantId}.stage.transitioned.v1`;
}

/**
 * The deterministic outbound `external_id` per FORA-401's
 * "stable external id" rule. The `(issueId, from, to)` triple
 * is unique per logical transition; a redelivered event for
 * the same transition carries the same triple and the bus-side
 * dedupe + the adapter's id synthesis both keep the
 * canonical state stable across replays.
 */
function buildOutboundExternalId(
  issueId: string,
  from: PaperclipStatus,
  to: PaperclipStatus,
): string {
  return `paperclip:${issueId}:${from}->${to}`;
}

/**
 * The deterministic inbound `eventId` per FORA-401's
 * "stable external id" rule. The `(key, webhookEventId)` pair
 * is unique per Jira delivery.
 */
function buildInboundEventId(
  jiraKey: string,
  webhookEventId: string,
): string {
  return `evt-jira-stage-${jiraKey}-${webhookEventId}`;
}

// ---------------------------------------------------------------------------
// mirrorStageOutbound
// ---------------------------------------------------------------------------

/**
 * Outbound: a Paperclip stage transition is mirrored to Jira.
 *
 * Steps (per FORA-200 §3 + FORA-405 AC#3):
 *
 *   1. Resolve the Jira transition name (env var override →
 *      YAML override → default table).
 *   2. `claim((tenant, paperclip:<issueId>:<from>-><to>,
 *      stage.transition))`. First time: proceeds. Replay:
 *      short-circuits with `firstClaim: false` (and the
 *      audit row from the first claim is the only record).
 *   3. First time only: `transitionIssue(issueIdOrKey,
 *      transitionName)` via the broker. Throws propagate
 *      to the caller — the FORA-200 §3 backpressure path
 *      (the divergence queue) is the recovery window.
 *
 * The function is **stateless** apart from the side effects
 * it drives via `JiraStageClient` and `claim()`. Concurrency:
 * two concurrent calls with the same `(issueId, from, to)`
 * on the same tenant race on the
 * `INSERT ... ON CONFLICT DO NOTHING` — exactly one wins
 * (`firstClaim: true`), the other sees `firstClaim: false`
 * and short-circuits. This is the FORA-401 at-most-once
 * primitive at work.
 */
export async function mirrorStageOutbound(
  event: PaperclipStageEvent,
  client: JiraStageClient,
  deps: ClaimDeps,
): Promise<OutboundStageResult> {
  const transitionName = resolveJiraTransitionName(event.to, event.overrides);
  const externalStageId = buildOutboundExternalId(
    event.issueId,
    event.from,
    event.to,
  );
  const key: ClaimKey = {
    tenant_id: event.tenantId,
    external_id: externalStageId,
    op_kind: 'stage.transition',
  };
  const source = event.source ?? `paperclip:issue/${event.issueId}`;
  const ctx: ClaimContext = {
    actor: event.actor,
    source,
    target: `jira:issue/${event.jiraIssueKey}`,
    metadata: {
      jira_issue_key: event.jiraIssueKey,
      from: event.from,
      to: event.to,
      transition_name: transitionName,
    },
  };

  const claimResult = await claim(key, ctx, deps);

  if (!claimResult.firstTime) {
    // Replay — the canonical Jira transition already ran
    // on the first claim. Return the deterministic
    // `transitionName` + `jiraIssueKey` so the caller can
    // thread the result into the Paperclip audit envelope.
    return {
      transitionName,
      jiraIssueKey: event.jiraIssueKey,
      externalStageId,
      tenantId: event.tenantId,
      firstClaim: false,
    };
  }

  // First-time claim. Drive the Jira REST write via the
  // broker. A throw here propagates to the caller, which
  // is the FORA-200 §3 backpressure path — the divergence
  // queue (FORA-406) catches the side-effect failure and
  // surfaces it to the workbench for retry.
  await client.transitionIssue({
    issueIdOrKey: event.jiraIssueKey,
    transitionName,
  });

  return {
    transitionName,
    jiraIssueKey: event.jiraIssueKey,
    externalStageId,
    tenantId: event.tenantId,
    firstClaim: true,
  };
}

// ---------------------------------------------------------------------------
// mirrorStageInbound
// ---------------------------------------------------------------------------

/**
 * Inbound: a Jira `jira:issue_updated` webhook is normalized
 * to a canonical `sync.stage.transitioned.v1` event and
 * published to the Sync Plane resolver.
 *
 * Steps (per FORA-200 §3 + FORA-405 AC#3):
 *
 *   1. Find the LAST `Status` change in the webhook's
 *      `changelog` array. If there is no `Status` change,
 *      the webhook is a non-transition update (e.g. an
 *      `assignee` change) and the mirror short-circuits
 *      with `null` — the caller is expected to dispatch
 *      the update to the appropriate sibling mirror
 *      (FORA-402 issue update, FORA-404 comment, etc.).
 *   2. `claim((tenant, jira:<issueKey>, stage.transition))`.
 *      The Jira-side external id is the dedupe key — a
 *      redelivered webhook for the same issue key
 *      short-circuits with `firstClaim: false`. The
 *      `webhook_dedupe` table is the FIRST gate (per
 *      FORA-401); the mirror's `claim()` is the second,
 *      idempotency-at-the-`sync_op` gate.
 *   3. First time only: synthesize the canonical
 *      `ReceivedEvent` body and call
 *      `StageSyncPlanePublisher.publish`. The resolver's
 *      bus-side dedupe (FORA-401) catches redeliveries.
 *
 * The function does NOT verify the Jira webhook signature
 * (HMAC-SHA256 + `X-Atlassian-Webhook-Identifier`). That
 * gate is the inbound `webhook.ts` route's responsibility
 * (FORA-200.6 / FORA-407 sibling); this module trusts that
 * the caller hands it an authenticated payload.
 */
export async function mirrorStageInbound(
  input: StageInboundInput,
  webhook: JiraIssueUpdatedWebhook,
  publisher: StageSyncPlanePublisher,
  deps: ClaimDeps,
): Promise<InboundStageResult | null> {
  // Find the LAST Status change. The changelog array is
  // ordered ascending by event time; the last Status
  // entry is the transition the Paperclip side needs to
  // learn about. Other field changes (assignee, priority,
  // labels) are out of scope for FORA-405 — the appropriate
  // sibling mirror (FORA-402 update, FORA-404 comment) is
  // the dispatcher.
  let lastStatusChange:
    | { fromString: string | null; toString: string | null }
    | null = null;
  for (const entry of webhook.changelog) {
    if (entry.field === 'Status') {
      lastStatusChange = entry;
    }
  }
  if (lastStatusChange === null) {
    // Non-transition update — return null so the caller
    // can route the webhook to the right sibling mirror.
    return null;
  }
  const fromStatus = lastStatusChange.fromString ?? '';
  const toStatus = lastStatusChange.toString ?? '';

  const jiraKey = webhook.issue.key;
  const externalIssueId = `jira:${jiraKey}`;
  const subject = buildSubject(input.tenantId);
  const eventId = buildInboundEventId(jiraKey, webhook.webhookEventId);

  const key: ClaimKey = {
    tenant_id: input.tenantId,
    external_id: externalIssueId,
    op_kind: 'stage.transition',
  };
  const ctx: ClaimContext = {
    actor: input.actor,
    source: `jira:issue/${jiraKey}`,
    target: `paperclip:issue/${input.paperclipIssueId}`,
    metadata: {
      webhook_event_id: webhook.webhookEventId,
      jira_issue_id: webhook.issue.id,
      from_status: fromStatus,
      to_status: toStatus,
    },
  };

  const claimResult = await claim(key, ctx, deps);

  if (!claimResult.firstTime) {
    // Replay — the canonical event was already published
    // on the first claim. Return the deterministic
    // `eventId` so the caller can verify the bus side
    // accepted the original delivery.
    return {
      eventId,
      subject,
      eventType: 'stage.transitioned.v1',
      jiraKey,
      paperclipIssueId: input.paperclipIssueId,
      fromStatus,
      toStatus,
      tenantId: input.tenantId,
      firstClaim: false,
    };
  }

  // First-time claim. Publish the canonical event to the
  // Sync Plane resolver. The payload follows the
  // `normalize_issue_webhook` shape (per FORA-200 §3
  // "Boundary contracts" — the sync plane resolver is
  // shape-agnostic across platforms).
  await publisher.publish({
    eventId,
    tenantId: input.tenantId,
    subject,
    eventType: 'stage.transitioned.v1',
    occurredAt: new Date().toISOString(),
    payload: {
      paperclip_id: input.paperclipIssueId,
      jira_key: jiraKey,
      jira_issue_id: webhook.issue.id,
      from_status: fromStatus,
      to_status: toStatus,
      actor: input.actor,
      webhook_event_id: webhook.webhookEventId,
    },
  });

  return {
    eventId,
    subject,
    eventType: 'stage.transitioned.v1',
    jiraKey,
    paperclipIssueId: input.paperclipIssueId,
    fromStatus,
    toStatus,
    tenantId: input.tenantId,
    firstClaim: true,
  };
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

/**
 * Re-export the `ClaimDeps` factory so callers can wire
 * the `executor` + `audit` pair in one place. Mirrors the
 * `ClaimDeps` shape from `./idempotency.js`.
 */
export function makeClaimDeps(
  executor: PoolExecutor,
  audit: AuditSink,
): ClaimDeps {
  return { executor, audit };
}
