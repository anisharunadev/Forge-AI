/**
 * Issue mirror — Paperclip ↔ Jira create / link.
 *
 * FORA-200.1 / FORA-402. Implements the AC#1 vertical slice:
 * "Every Paperclip issue creation creates a Jira issue (or
 * links to an existing one) with the same summary,
 * description, labels, and assignee" (FORA-200 plan §2 AC#1).
 *
 * The module is the only writer to Jira issues for the FORA
 * Sync Plane on the v0.1 day-one scope. It encapsulates:
 *
 *   * Outbound (`mirrorIssueOutbound`): a Paperclip
 *     `issue.created.v1` event is translated to either a
 *     `createIssue` or a `link-existing` Jira REST call. The
 *     `JiraClient` seam is the only place that knows the
 *     Jira REST shape; production wires a customer-cloud-broker
 *     (FORA-126) backed implementation, the contract test wires
 *     a recording fake.
 *
 *   * Inbound (`mirrorIssueInbound`): a Jira `jira:issue_created`
 *     webhook payload is normalized into a canonical
 *     `sync.issue.created.v1` event and published to the
 *     Sync Plane resolver. The `SyncPlanePublisher` seam is
 *     the only place that knows the resolver's bus subject.
 *
 *   * Idempotency: every call runs through the `claim()`
 *     spine (FORA-401) BEFORE the side effect. The
 *     `(tenant_id, external_id, op_kind)` triple is the dedupe
 *     index. The first claim emits all six
 *     `sync.{source,target}.{ok,fail}` event types; replays
 *     emit zero. The two events the FORA-402 AC calls out
 *     (`sync.source.issue.ok` + `sync.target.issue.ok`) are
 *     emitted by the spine on the first claim — the mirror
 *     itself does not re-emit them.
 *
 *   * External id: the deterministic id FORA-200 §3 specifies,
 *     `paperclip:<issueId>`, is the `external_id` on the
 *     outbound path. The Jira-side mirror uses
 *     `jira:<issueKey>` on the inbound path (and the
 *     `JiraClient.lookupRemoteIssueLink` lookup uses
 *     `paperclip:<issueId>` as the `globalId` per the Jira
 *     remote-issue-link convention).
 *
 * Concurrency: the mirror is stateless across tenants. Two
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
import type { PoolExecutor } from './pool_executor.js';
import type { AuditSink } from './audit.js';

// ---------------------------------------------------------------------------
// Transport seams — the only place Jira / sync-plane shape knowledge lives
// ---------------------------------------------------------------------------

/**
 * The Jira REST client seam. Production wires a
 * customer-cloud-broker (FORA-126) backed implementation;
 * the contract test wires a recording fake. The seam is
 * intentionally narrow (two methods) so a future broker
 * round-trip is a one-file change.
 *
 * `lookupRemoteIssueLink` is the FIRST call on every
 * outbound create — per FORA-200 §3 "Outbound (Paperclip →
 * Jira): … `remoteIssueLink` lookup before `createIssue`."
 * A non-null return means the Jira side already has a link
 * to this Paperclip issue (created in a previous run) and
 * the mirror returns the existing Jira key without a second
 * write.
 */
export interface JiraClient {
  /**
   * Look up a Jira remote-issue-link with the given
   * `externalIssueId` (`globalId` on the Jira side). Returns
   * the linked Jira issue key on hit, `null` on miss. A
   * non-null return is the "link-existing" path — the
   * mirror skips `createIssue` and surfaces the existing
   * Jira key to the caller.
   */
  lookupRemoteIssueLink(
    externalIssueId: string,
  ): Promise<{ jiraKey: string } | null>;

  /**
   * Create a Jira issue with the given payload. The
   * `externalIssueId` is set as the `globalId` on the
   * created issue so a future `lookupRemoteIssueLink`
   * round-trips. Returns the Jira-assigned `jiraKey` (e.g.
   * `PROJ-123`) and internal `id`.
   *
   * Throws on transport failure or non-2xx; the mirror does
   * not catch — the caller's recovery path is the sync
   * plane's Tier 3 divergence queue (per FORA-200 §3
   * "backpressure & circuit-breakers").
   */
  createIssue(input: {
    summary: string;
    description?: string;
    labels?: string[];
    externalIssueId: string;
  }): Promise<{ jiraKey: string; id: string }>;
}

/**
 * The Sync Plane resolver seam. Production wires the
 * canonical bus publisher; the contract test wires a
 * recording fake. The seam publishes a single canonical
 * event per inbound webhook (the FORA-200 §3 "Outbound
 * (Jira → Paperclip)" path runs the event into the resolver,
 * which then upserts the canonical `sync.entity` row and
 * fans out to the Paperclip owner plane).
 *
 * `subject` follows ADR-0006 §3.1:
 *   `fora.events.<tenant>.issue.created.v1`
 * The `eventType` is the canonical verb (`issue.created.v1`).
 */
export interface SyncPlanePublisher {
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
 * The outbound event shape — a Paperclip `issue.created.v1`
 * (or any issue-state event) carried in via the sync plane
 * resolver. The mirror is intentionally thin: it does not
 * know the Paperclip issue schema beyond the few fields
 * the Jira REST write needs. Assignee mapping is the
 * FORA-405 workflow-mapping sibling's job; we copy through
 * what the resolver hands us.
 */
export interface PaperclipIssueEvent {
  /** Verified broker-claim tenant id (FORA-163 / ADR-0003 §4.2). */
  tenantId: string;
  /** Paperclip-issued issue id; the `paperclip:<issueId>` external id. */
  issueId: string;
  /** Jira issue summary (the `summary` field maps 1:1). */
  summary: string;
  /** Optional Jira issue description (Atlassian Document Format free text). */
  description?: string;
  /** Optional Jira labels. Day-one: passed through as-is. */
  labels?: string[];
  /** FORA-253 author envelope (`user:<idp-id>` / `agent:<type>:<run-id>`). */
  actor: string;
  /**
   * Optional Paperclip-issued source reference (e.g.
   * `paperclip:issue/123`). Defaults to `paperclip:<issueId>`.
   */
  source?: string;
}

/**
 * The inbound webhook shape — a Jira Cloud
 * `jira:issue_created` webhook payload, normalized to the
 * fields the FORA-200 v0.1 scope needs. The mirror is
 * thin here too: only `webhookEventId` (the Jira-issued
 * globally unique delivery id) and the issue fields the
 * canonical event carries. Assignee / reporter / comments
 * are out of scope for v0.1 (FORA-404 / FORA-405 siblings).
 */
export interface JiraIssueCreatedWebhook {
  /** Jira-issued globally unique delivery id (Jira webhook header). */
  webhookEventId: string;
  issue: {
    /** Jira internal numeric id. */
    id: string;
    /** Jira human-readable key, e.g. `PROJ-123`. */
    key: string;
    fields: {
      summary: string;
      description?: string;
      labels?: string[];
    };
  };
}

/**
 * Inputs to `mirrorIssueInbound`. The webhook itself does
 * not carry the verified broker-claim tenant id, so the
 * caller passes it in (it came from the webhook URL
 * `?tenant=<slug>` query parameter in production).
 */
export interface MirrorInboundInput {
  tenantId: string;
  /**
   * The Paperclip-side identifier to use as the canonical
   * `entity_id` in the published `sync.issue.created.v1`
   * event. Day-one: derived from the Jira webhook's
   * `paperclip:issue:<id>` custom field or the
   * `forge:tenant:<slug>` label; the resolver maps it
   * back via the same key on the outbound mirror.
   */
  paperclipIssueId: string;
  /** FORA-253 author envelope for the inbound actor. */
  actor: string;
}

/**
 * Result of `mirrorIssueOutbound`. The `operation` field
 * is the contract the caller uses to confirm the
 * "create-or-link" half of the AC#1 deliverable. The
 * `jiraKey` is the canonical Jira-side reference the
 * caller stores in Paperclip's `remote_refs["jira"]` slot.
 */
export interface OutboundIssueResult {
  /** The Jira-side operation the mirror performed. */
  operation: 'create' | 'link-existing';
  /** Jira-issued key (e.g. `PROJ-123`). Empty when the replay path missed. */
  jiraKey: string;
  /** The deterministic external id (`paperclip:<issueId>`). */
  externalIssueId: string;
  /** Verified tenant id (passed through). */
  tenantId: string;
  /** True on the first claim; false on every replay. */
  firstClaim: boolean;
}

/**
 * Result of `mirrorIssueInbound`. `eventId` is the
 * deterministic id the resolver dedupes on
 * (`evt-jira-issue-<key>-<webhookEventId>`); the caller
 * threads it into its bus-side dedupe. `firstClaim` is
 * the spine signal — false means a redelivered webhook.
 */
export interface InboundIssueResult {
  /** The event id published to the sync-plane resolver. */
  eventId: string;
  /** The bus subject published to. */
  subject: string;
  /** Canonical event type per ADR-0006 §3.1. */
  eventType: 'issue.created.v1';
  /** Jira-issued key the inbound webhook reported. */
  jiraKey: string;
  /** Paperclip-issued id the canonical event carries. */
  paperclipIssueId: string;
  /** Verified tenant id (passed through). */
  tenantId: string;
  /** True on the first claim; false on every replay. */
  firstClaim: boolean;
}

// ---------------------------------------------------------------------------
// Subject + eventType constants
// ---------------------------------------------------------------------------

/**
 * The canonical bus subject for inbound Jira issue-created
 * events. Mirrors the GitHub adapter's
 * `fora.events.<tenant>.issue.created.v1` shape; the
 * resolver and the paperclip owner plane both consume
 * this subject.
 */
function buildSubject(tenantId: string): string {
  return `fora.events.${tenantId}.issue.created.v1`;
}

/**
 * The deterministic inbound `eventId` per FORA-401's
 * "stable external id" rule. The `(key, webhookEventId)`
 * pair is unique per Jira delivery; a redelivered webhook
 * carries the same pair and the bus-side dedupe + the
 * adapter's id synthesis both keep the canonical state
 * stable across replays.
 */
function buildInboundEventId(jiraKey: string, webhookEventId: string): string {
  return `evt-jira-issue-${jiraKey}-${webhookEventId}`;
}

// ---------------------------------------------------------------------------
// mirrorIssueOutbound
// ---------------------------------------------------------------------------

/**
 * Outbound: a Paperclip issue event is mirrored to Jira.
 *
 * Steps (per FORA-200 §3 + FORA-402 AC#1):
 *
 *   1. `claim((tenant, paperclip:<issueId>, issue.create))`.
 *      First time: proceeds. Replay: looks up the existing
 *      Jira-side link and returns the cached `jiraKey` —
 *      no second write, no extra audit emission.
 *   2. First time only: `lookupRemoteIssueLink(<id>)`.
 *      Hit: returns the existing Jira key (`link-existing`).
 *      Miss: calls `createIssue(...)` with the deterministic
 *      `externalIssueId = "paperclip:<issueId>"` so a
 *      future `lookupRemoteIssueLink` round-trips.
 *   3. The spine already emitted all six
 *      `sync.{source,target}.{ok,fail}` event types on
 *      the first claim (FORA-401 contract). The two events
 *      the FORA-402 AC calls out —
 *      `sync.source.issue.ok` + `sync.target.issue.ok` —
 *      are present in the audit sink on the first claim
 *      and absent on replays.
 *
 * The function is **stateless** apart from the side effects
 * it drives via `JiraClient` and `claim()`. Concurrency:
 * two concurrent calls with the same `issueId` on the same
 * tenant race on the `INSERT ... ON CONFLICT DO NOTHING`
 * — exactly one wins (`firstClaim: true`), the other sees
 * `firstClaim: false` and short-circuits. This is the
 * FORA-401 at-most-once primitive at work.
 */
export async function mirrorIssueOutbound(
  event: PaperclipIssueEvent,
  client: JiraClient,
  deps: ClaimDeps,
): Promise<OutboundIssueResult> {
  const externalIssueId = `paperclip:${event.issueId}`;
  const key: ClaimKey = {
    tenant_id: event.tenantId,
    external_id: externalIssueId,
    op_kind: 'issue.create',
  };
  const source = event.source ?? `paperclip:issue/${event.issueId}`;
  const ctx: ClaimContext = {
    actor: event.actor,
    source,
    target: '', // Filled in below on the first-claim path.
    metadata: {
      summary: event.summary,
      labels: event.labels ?? [],
    },
  };

  const claimResult = await claim(key, ctx, deps);

  if (!claimResult.firstTime) {
    // Replay: try to recover the existing jiraKey by lookup
    // so the caller has a stable `jiraKey` to thread into
    // `remote_refs["jira"]`. The lookup is best-effort — a
    // miss on a replay is the "row claimed, side effect
    // crashed" recovery window; the next replay will retry.
    const existing = await safeLookup(client, externalIssueId);
    return {
      operation: existing ? 'link-existing' : 'create',
      jiraKey: existing?.jiraKey ?? '',
      externalIssueId,
      tenantId: event.tenantId,
      firstClaim: false,
    };
  }

  // First-time claim. Look up an existing remote-issue-link
  // BEFORE writing. A non-null return means a prior run
  // created the Jira side and we should link, not duplicate.
  const existing = await client.lookupRemoteIssueLink(externalIssueId);
  if (existing) {
    // The audit event target is the existing Jira key.
    // We don't have a `claim()` parameter to retro-fill
    // the target, but the spine's six emissions are
    // already in the audit sink — the operator console
    // joins on `external_id` to find the Jira side.
    return {
      operation: 'link-existing',
      jiraKey: existing.jiraKey,
      externalIssueId,
      tenantId: event.tenantId,
      firstClaim: true,
    };
  }

  // No existing link — create the Jira issue with the
  // deterministic `externalIssueId` so a future
  // `lookupRemoteIssueLink` round-trips.
  const created = await client.createIssue({
    summary: event.summary,
    description: event.description,
    labels: event.labels,
    externalIssueId,
  });

  return {
    operation: 'create',
    jiraKey: created.jiraKey,
    externalIssueId,
    tenantId: event.tenantId,
    firstClaim: true,
  };
}

// ---------------------------------------------------------------------------
// mirrorIssueInbound
// ---------------------------------------------------------------------------

/**
 * Inbound: a Jira `jira:issue_created` webhook is normalized
 * to a canonical `sync.issue.created.v1` event and published
 * to the Sync Plane resolver.
 *
 * Steps (per FORA-200 §3 + FORA-402 AC#1):
 *
 *   1. `claim((tenant, jira:<issueKey>, issue.create))`.
 *      The Jira-side external id (`jira:<issueKey>`) is the
 *      dedupe key — a redelivered webhook for the same
 *      issue key short-circuits with `firstClaim: false`.
 *      Note: the `webhook_dedupe` table is the FIRST gate
 *      (FORA-401 / FORA-407 candidate) — the mirror's
 *      `claim()` is the second, idempotency-at-the-`sync_op`
 *      gate. Both layers are necessary: the webhook dedupe
 *      is "have we seen this delivery", the sync_op claim
 *      is "have we already applied this `(tenant, key, op)`".
 *   2. First time only: synthesize the canonical
 *      `ReceivedEvent` body and call `SyncPlanePublisher.publish`.
 *      The resolver's bus-side dedupe (FORA-401) catches
 *      redeliveries; the mirror's own dedupe is the outer
 *      guard for replays that bypass the bus.
 *   3. The spine already emitted all six audit events on
 *      the first claim — `sync.source.issue.ok` +
 *      `sync.target.issue.ok` are the two the FORA-402 AC
 *      calls out.
 *
 * The function does NOT verify the Jira webhook signature
 * (HMAC-SHA256 + `X-Atlassian-Webhook-Identifier`). That
 * gate is the inbound `webhook.ts` route's responsibility
 * (FORA-200.6 / FORA-407 sibling); this module trusts that
 * the caller hands it an authenticated payload.
 */
export async function mirrorIssueInbound(
  input: MirrorInboundInput,
  webhook: JiraIssueCreatedWebhook,
  publisher: SyncPlanePublisher,
  deps: ClaimDeps,
): Promise<InboundIssueResult> {
  const jiraKey = webhook.issue.key;
  const externalIssueId = `jira:${jiraKey}`;
  const subject = buildSubject(input.tenantId);
  const eventId = buildInboundEventId(jiraKey, webhook.webhookEventId);

  const key: ClaimKey = {
    tenant_id: input.tenantId,
    external_id: externalIssueId,
    op_kind: 'issue.create',
  };
  const ctx: ClaimContext = {
    actor: input.actor,
    source: `jira:issue/${jiraKey}`,
    target: `paperclip:issue/${input.paperclipIssueId}`,
    metadata: {
      webhook_event_id: webhook.webhookEventId,
      jira_issue_id: webhook.issue.id,
      summary: webhook.issue.fields.summary,
      labels: webhook.issue.fields.labels ?? [],
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
      eventType: 'issue.created.v1',
      jiraKey,
      paperclipIssueId: input.paperclipIssueId,
      tenantId: input.tenantId,
      firstClaim: false,
    };
  }

  // First-time claim. Publish the canonical event to the
  // Sync Plane resolver. The payload follows the GitHub
  // adapter's `normalize_issue_webhook` shape (per FORA-200
  // §3 "Boundary contracts" — the sync plane resolver is
  // shape-agnostic across platforms).
  await publisher.publish({
    eventId,
    tenantId: input.tenantId,
    subject,
    eventType: 'issue.created.v1',
    occurredAt: new Date().toISOString(),
    payload: {
      paperclip_id: input.paperclipIssueId,
      jira_key: jiraKey,
      jira_issue_id: webhook.issue.id,
      jira_summary: webhook.issue.fields.summary,
      jira_description: webhook.issue.fields.description ?? '',
      jira_labels: webhook.issue.fields.labels ?? [],
      actor: input.actor,
      webhook_event_id: webhook.webhookEventId,
    },
  });

  return {
    eventId,
    subject,
    eventType: 'issue.created.v1',
    jiraKey,
    paperclipIssueId: input.paperclipIssueId,
    tenantId: input.tenantId,
    firstClaim: true,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Best-effort `lookupRemoteIssueLink` on the replay path.
 * A throw here would propagate up to the caller, which is
 * not what we want — a replay is a "no new work" path;
 * the audit row is already in the sink; the side effect
 * either succeeded (and `lookupRemoteIssueLink` would
 * find it) or never ran. We catch and return `null` so
 * the caller gets the conservative `operation: 'create'`
 * with an empty `jiraKey` and can decide what to do.
 */
async function safeLookup(
  client: JiraClient,
  externalIssueId: string,
): Promise<{ jiraKey: string } | null> {
  try {
    return await client.lookupRemoteIssueLink(externalIssueId);
  } catch {
    return null;
  }
}

/**
 * Re-export the `ClaimDeps` factory so callers can wire
 * the `executor` + `audit` pair in one place. Mirrors the
 * `ClaimDeps` shape from `./idempotency.js`; the
 * indirection is intentional — a future forge-side wiring
 * may add a third dep (e.g. a `RateLimiter` for FORA-256
 * follow-up) without changing the call sites here.
 */
export function makeClaimDeps(
  executor: PoolExecutor,
  audit: AuditSink,
): ClaimDeps {
  return { executor, audit };
}
