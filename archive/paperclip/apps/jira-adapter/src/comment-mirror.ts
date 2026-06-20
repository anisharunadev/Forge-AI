/**
 * Comment mirror — Paperclip ↔ Jira bidirectional.
 *
 * FORA-200.2 / FORA-404. Implements the AC#2 vertical slice:
 * "Comments posted on either side are mirrored to the other
 * with the FORA-253 author envelope" (FORA-200 plan §2 AC#2).
 *
 * The module is the only writer to Jira comments for the
 * FORA Sync Plane on the v0.1 day-one scope. It encapsulates:
 *
 *   * Outbound (`mirrorCommentOutbound`): a Paperclip
 *     `comment.created.v1` event is translated to either an
 *     `addComment` or a `link-existing` Jira REST call. The
 *     `JiraCommentClient` seam is the only place that knows the
 *     Jira REST shape for comments; production wires a
 *     customer-cloud-broker (FORA-126) backed implementation,
 *     the contract test wires a recording fake.
 *
 *   * Inbound (`mirrorCommentInbound`): a Jira
 *     `comment_created` webhook payload is normalized into a
 *     canonical `sync.comment.created.v1` event and published
 *     to the Sync Plane resolver. The `JiraAuthorMapper` seam
 *     resolves the inbound Jira `author.accountId` to a
 *     Paperclip author identity per the FORA-253 author
 *     envelope (`user:<idp-id>` / `agent:<type>:<run-id>`).
 *     Per the FORA-201.2 verdict invariant (FORA-433 S10)
 *     re-applied to Jira (FORA-404): "unknown author ->
 *     AuthorMappingError, never post as Paperclip user". The
 *     adapter catches this and returns a `firstClaim: false`
 *     failure result with NO claim, NO publish, NO
 *     `sync.source.comment.ok` audit row — the FORA-36
 *     `tool_call` failure path records the exception.
 *
 *   * Idempotency: every call runs through the `claim()`
 *     spine (FORA-401) BEFORE the side effect. The
 *     `(tenant_id, external_id, op_kind)` triple is the dedupe
 *     index; the `op_kind` for comments is `comment.create`.
 *     The first claim emits all six
 *     `sync.{source,target}.{ok,fail}` event types (per the
 *     audit emitter); the two events the FORA-404 AC calls
 *     out (`sync.source.comment.ok` + `sync.target.comment.ok`)
 *     are emitted by the spine on the first claim and absent
 *     on every replay.
 *
 *   * External id: the deterministic id FORA-200 §3 specifies,
 *     `paperclip:comment:<commentId>`, is the `external_id`
 *     on the outbound path. The Jira-side mirror uses
 *     `jira:comment:<commentId>` on the inbound path.
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
import type { SyncPlanePublisher } from './issue-mirror.js';

// ---------------------------------------------------------------------------
// Author envelope (FORA-253)
// ---------------------------------------------------------------------------

/**
 * The FORA-253 author envelope kinds. The closed union:
 *
 *   - `user`  → human identity, `author_id = user:<idp-id>`
 *   - `agent` → service / bot identity,
 *               `author_id = agent:<type>:<run-id>` (or
 *               `agent:<type>` for stateless integrations
 *               like Jira automation accounts)
 *   - `system` → system-generated, no upstream user
 *   - `board` → Board / governance actor (FORA-249 / ADR-0011)
 *
 * Mirrors the GitHub adapter's `MappedPaperclipAuthor.author_kind`
 * field (FORA-433 / FORA-201.2). Keep in lock-step across
 * adapters — the sync-plane resolver maps this 1:1 to the
 * canonical `actor` field on inbound events.
 */
export type AuthorKind = 'user' | 'agent' | 'system' | 'board';

/**
 * The mapped Paperclip author identity for an inbound
 * Jira comment author. `author_id` is the FORA-253 envelope
 * value (`user:<idp-id>` / `agent:<type>:<run-id>` / etc);
 * `display_name` is what the Paperclip owner plane renders
 * next to the comment timestamp.
 */
export interface MappedPaperclipAuthor {
  author_kind: AuthorKind;
  /** FORA-253 envelope value (`user:okta-integration-engineer`, etc.). */
  author_id: string;
  /** Display name rendered by the Paperclip owner plane. */
  author_display_name: string;
}

/**
 * Raised by `JiraAuthorMapper.mapJiraAccount` when the
 * inbound Jira `author.accountId` cannot be translated to a
 * Paperclip author identity.
 *
 * Per FORA-404 (mirroring the FORA-201.2 verdict invariant
 * from FORA-433 S10): "unknown author -> AuthorMappingError,
 * never post as a Paperclip user". The inbound mirror
 * catches this BEFORE `claim()` runs and returns a
 * `firstClaim: false` failure result — no claim, no publish,
 * no `sync.source.comment.ok` audit row. The FORA-36
 * `tool_call` failure path records the exception via the
 * service's standard failure sink.
 */
export class AuthorMappingError extends Error {
  readonly source_account_id: string;
  readonly reason: string;

  constructor(source_account_id: string, reason?: string) {
    const msg =
      reason ??
      `unknown jira author '${source_account_id}'; refusing to post as a Paperclip user`;
    super(msg);
    this.name = 'AuthorMappingError';
    this.source_account_id = source_account_id;
    this.reason = msg;
  }
}

/**
 * The author-mapping seam for inbound comment webhooks.
 * Production wires the per-tenant table (FORA-253) populated
 * from the identity-broker (FORA-161). The day-one impl
 * (`EnvBackedJiraAuthorMapper`, below) reads from env vars;
 * the contract test wires a recording fake.
 *
 * `mapJiraAccount` MUST raise `AuthorMappingError` on unknown
 * account ids — the closed-set return type does not include
 * `undefined` so a misconfigured mapper cannot silently
 * post as a Paperclip user.
 */
export interface JiraAuthorMapper {
  /**
   * Translate a Jira `author.accountId` to a Paperclip
   * author identity. Raises `AuthorMappingError` if the
   * account id is not in the per-tenant mapping table.
   */
  mapJiraAccount(
    tenantId: string,
    accountId: string,
  ): MappedPaperclipAuthor;

  /** Introspection aid — known accounts for the tenant. */
  knownAccounts(tenantId: string): string[];
}

/**
 * Day-one `JiraAuthorMapper` impl. Reads the per-tenant
 * mapping from env vars of the form
 *
 *   FORA_TENANT_<SLUG>_JIRA_AUTHOR_MAP
 *
 * whose value is a JSON object mapping `accountId` to a
 * 3-key object (`kind`, `id`, `display_name`). Example:
 *
 *   FORA_TENANT_ACME_CO_JIRA_AUTHOR_MAP='{
 *     "5d8e...jira-user-acct": {"kind":"user","id":"user:okta-integration-engineer","display_name":"Integration Engineer"},
 *     "jira-bot-acct":         {"kind":"agent","id":"agent:jira-automation","display_name":"Jira Automation"}
 *   }'
 *
 * A tenant with no env var returns an empty mapping; every
 * inbound comment raises `AuthorMappingError` (the safe
 * default — the FORA-404 AC says "unknown author ->
 * AuthorMappingError, never post as Paperclip user").
 *
 * Phase 2 replaces this with the broker-fed per-tenant table
 * (FORA-126) without changing the `JiraAuthorMapper` Protocol.
 */
export class EnvBackedJiraAuthorMapper implements JiraAuthorMapper {
  private readonly cache = new Map<
    string,
    Map<string, MappedPaperclipAuthor>
  >();

  mapJiraAccount(
    tenantId: string,
    accountId: string,
  ): MappedPaperclipAuthor {
    const table = this.load(tenantId);
    const mapped = table.get(accountId);
    if (mapped === undefined) {
      throw new AuthorMappingError(accountId);
    }
    return mapped;
  }

  knownAccounts(tenantId: string): string[] {
    return Array.from(this.load(tenantId).keys()).sort();
  }

  private load(tenantId: string): Map<string, MappedPaperclipAuthor> {
    const cached = this.cache.get(tenantId);
    if (cached !== undefined) return cached;
    const slug = tenantId.toUpperCase().replace(/-/g, '_');
    const raw =
      typeof process !== 'undefined' && process.env
        ? process.env[`FORA_TENANT_${slug}_JIRA_AUTHOR_MAP`] ?? ''
        : '';
    const table = new Map<string, MappedPaperclipAuthor>();
    if (raw.length > 0) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
          for (const [accountId, entry] of Object.entries(parsed)) {
            if (!entry || typeof entry !== 'object') continue;
            const e = entry as Record<string, unknown>;
            const kind = String(e['kind'] ?? 'agent') as AuthorKind;
            const id = String(e['id'] ?? '');
            const name = String(e['display_name'] ?? accountId);
            if (id.length > 0) {
              table.set(accountId, {
                author_kind: kind,
                author_id: id,
                author_display_name: name,
              });
            }
          }
        }
      } catch {
        // Malformed env var is a config bug; treat as "no
        // mappings known" so the safe-default path (raise
        // AuthorMappingError) wins. The smoke test does not
        // exercise this path.
      }
    }
    this.cache.set(tenantId, table);
    return table;
  }
}

// ---------------------------------------------------------------------------
// Transport seam — Jira REST for comments
// ---------------------------------------------------------------------------

/**
 * The Jira comment REST client seam. Production wires a
 * customer-cloud-broker (FORA-126) backed implementation;
 * the contract test wires a recording fake. The seam is
 * intentionally narrow (two methods) so a future broker
 * round-trip is a one-file change.
 *
 * `lookupRemoteCommentLink` is the FIRST call on every
 * outbound add — mirrors the FORA-200 §3 "Outbound
 * (Paperclip → Jira): … `remoteIssueLink` lookup before
 * `createIssue`" rule for issues. A non-null return means
 * the Jira side already has a link to this Paperclip
 * comment (created in a previous run) and the mirror
 * returns the existing Jira comment id without a second
 * write.
 */
export interface JiraCommentClient {
  /**
   * Look up a Jira remote-comment-link with the given
   * `externalCommentId`. Returns the linked Jira comment
   * id on hit, `null` on miss.
   */
  lookupRemoteCommentLink(
    externalCommentId: string,
  ): Promise<{ jiraCommentId: string; jiraIssueKey: string } | null>;

  /**
   * Add a Jira comment to the issue identified by
   * `jiraIssueKey`. The `externalCommentId` is set as the
   * `globalId` on the created comment so a future
   * `lookupRemoteCommentLink` round-trips. Returns the
   * Jira-assigned `jiraCommentId`.
   *
   * Throws on transport failure or non-2xx; the mirror does
   * not catch — the caller's recovery path is the sync
   * plane's Tier 3 divergence queue (per FORA-200 §3
   * "backpressure & circuit-breakers").
   */
  addComment(input: {
    jiraIssueKey: string;
    body: string;
    externalCommentId: string;
  }): Promise<{ jiraCommentId: string; id: string }>;
}

// ---------------------------------------------------------------------------
// Public event shapes
// ---------------------------------------------------------------------------

/**
 * The outbound event shape — a Paperclip `comment.created.v1`
 * (or any comment-state event) carried in via the sync plane
 * resolver. The mirror is intentionally thin: it does not
 * know the Paperclip comment schema beyond the few fields
 * the Jira REST write needs. Author mapping is the
 * FORA-405 workflow-mapping sibling's job on the issue
 * side; the comment side carries the FORA-253 envelope
 * directly (the comment was authored from inside Paperclip,
 * so the envelope is already known).
 */
export interface PaperclipCommentEvent {
  /** Verified broker-claim tenant id (FORA-163 / ADR-0003 §4.2). */
  tenantId: string;
  /** Paperclip-issued comment id; the `paperclip:comment:<commentId>` external id. */
  commentId: string;
  /** The Jira-side issue key this comment attaches to (e.g. `PROJ-123`). */
  jiraIssueKey: string;
  /** Comment body, free text in ADF or wiki markup (per FORA-200 §3). */
  body: string;
  /** FORA-253 author envelope (`user:<idp-id>` / `agent:<type>:<run-id>`). */
  actor: string;
  /**
   * Optional Paperclip-issued source reference (e.g.
   * `paperclip:comment/<commentId>`). Defaults to
   * `paperclip:comment/<commentId>`.
   */
  source?: string;
}

/**
 * The inbound webhook shape — a Jira Cloud
 * `comment_created` webhook payload, normalized to the
 * fields the FORA-200 v0.1 scope needs. The mirror is
 * thin here too: only `webhookEventId` (the Jira-issued
 * globally unique delivery id) and the comment fields the
 * canonical event carries.
 */
export interface JiraCommentCreatedWebhook {
  /** Jira-issued globally unique delivery id (Jira webhook header). */
  webhookEventId: string;
  comment: {
    /** Jira internal numeric id. */
    id: string;
    /** Jira human-readable key, e.g. `PROJ-123`. */
    issueKey: string;
    /** Comment body in ADF / wiki markup. */
    body: string;
    /** Jira author — the FORA-253 mapper key. */
    author: {
      /** Jira `accountId` (globally unique, immutable). */
      accountId: string;
      /** Optional display name carried for diagnostics only. */
      displayName?: string;
    };
  };
}

/**
 * Inputs to `mirrorCommentInbound`. The webhook itself
 * does not carry the verified broker-claim tenant id, so
 * the caller passes it in (it came from the webhook URL
 * `?tenant=<slug>` query parameter in production).
 */
export interface CommentInboundInput {
  tenantId: string;
  /**
   * The Paperclip-side identifier to use as the canonical
   * `entity_id` in the published `sync.comment.created.v1`
   * event. Day-one: derived from the Jira webhook's
   * `paperclip:comment:<id>` custom field or the
   * `forge:tenant:<slug>` label; the resolver maps it
   * back via the same key on the outbound mirror.
   */
  paperclipCommentId: string;
  /**
   * FORA-253 author envelope for the inbound actor — the
   * MappedPaperclipAuthor produced by the author mapper
   * (the `actor` field on the published event).
   */
  mappedActor: MappedPaperclipAuthor;
}

/**
 * Result of `mirrorCommentOutbound`. The `operation` field
 * is the contract the caller uses to confirm the
 * "create-or-link" half of the AC#2 deliverable. The
 * `jiraCommentId` is the canonical Jira-side reference the
 * caller stores in Paperclip's `remote_refs["jira"]` slot
 * for the comment.
 */
export interface OutboundCommentResult {
  /** The Jira-side operation the mirror performed. */
  operation: 'create' | 'link-existing';
  /** Jira-issued comment id. Empty when the replay path missed. */
  jiraCommentId: string;
  /** The Jira issue key the comment attaches to (passed through). */
  jiraIssueKey: string;
  /** The deterministic external id (`paperclip:comment:<commentId>`). */
  externalCommentId: string;
  /** Verified tenant id (passed through). */
  tenantId: string;
  /** True on the first claim; false on every replay. */
  firstClaim: boolean;
}

/**
 * Result of `mirrorCommentInbound`. `eventId` is the
 * deterministic id the resolver dedupes on
 * (`evt-jira-comment-<jiraCommentId>-<webhookEventId>`);
 * the caller threads it into its bus-side dedupe.
 * `firstClaim` is the spine signal — false means a
 * redelivered webhook.
 *
 * When `ok` is `false`, `error` carries the verdict
 * invariant reason — the only failure path today is
 * `AuthorMappingError`, surfaced without a claim, publish,
 * or `sync.source.comment.ok` audit row.
 */
export interface InboundCommentResult {
  /** `true` on the success path; `false` on AuthorMappingError. */
  ok: boolean;
  /** The event id published to the sync-plane resolver (success path only). */
  eventId: string;
  /** The bus subject published to (success path only). */
  subject: string;
  /** Canonical event type per ADR-0006 §3.1 (success path only). */
  eventType: 'comment.created.v1';
  /** Jira-issued comment id the inbound webhook reported. */
  jiraCommentId: string;
  /** Paperclip-issued id the canonical event carries. */
  paperclipCommentId: string;
  /** Verified tenant id (passed through). */
  tenantId: string;
  /** True on the first claim; false on every replay. */
  firstClaim: boolean;
  /** Verdict-invariant reason on the failure path. `undefined` on success. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Subject + eventType constants
// ---------------------------------------------------------------------------

/**
 * The canonical bus subject for inbound Jira comment-created
 * events. Mirrors the issue mirror's
 * `fora.events.<tenant>.issue.created.v1` shape and the
 * GitHub adapter's
 * `fora.events.<tenant>.comment.created.v1` (FORA-433);
 * the resolver and the paperclip owner plane both consume
 * this subject.
 */
function buildSubject(tenantId: string): string {
  return `fora.events.${tenantId}.comment.created.v1`;
}

/**
 * The deterministic inbound `eventId` per FORA-401's
 * "stable external id" rule. The `(jiraCommentId,
 * webhookEventId)` pair is unique per Jira delivery; a
 * redelivered webhook carries the same pair and the bus-side
 * dedupe + the adapter's id synthesis both keep the
 * canonical state stable across replays.
 */
function buildInboundEventId(
  jiraCommentId: string,
  webhookEventId: string,
): string {
  return `evt-jira-comment-${jiraCommentId}-${webhookEventId}`;
}

// ---------------------------------------------------------------------------
// mirrorCommentOutbound
// ---------------------------------------------------------------------------

/**
 * Outbound: a Paperclip comment event is mirrored to Jira.
 *
 * Steps (per FORA-200 §3 + FORA-404 AC#2):
 *
 *   1. `claim((tenant, paperclip:comment:<commentId>, comment.create))`.
 *      First time: proceeds. Replay: looks up the existing
 *      Jira-side comment link and returns the cached
 *      `jiraCommentId` — no second write, no extra audit
 *      emission.
 *   2. First time only: `lookupRemoteCommentLink(<id>)`.
 *      Hit: returns the existing Jira comment id
 *      (`link-existing`). Miss: calls `addComment(...)` with
 *      the deterministic `externalCommentId =
 *      "paperclip:comment:<commentId>"` so a future
 *      `lookupRemoteCommentLink` round-trips.
 *   3. The spine already emitted all six
 *      `sync.{source,target}.{ok,fail}` event types on
 *      the first claim (FORA-401 contract). The two events
 *      the FORA-404 AC calls out —
 *      `sync.source.comment.ok` + `sync.target.comment.ok` —
 *      are present in the audit sink on the first claim
 *      and absent on replays.
 *
 * The function is **stateless** apart from the side effects
 * it drives via `JiraCommentClient` and `claim()`. Concurrency:
 * two concurrent calls with the same `commentId` on the same
 * tenant race on the `INSERT ... ON CONFLICT DO NOTHING` —
 * exactly one wins (`firstClaim: true`), the other sees
 * `firstClaim: false` and short-circuits. This is the
 * FORA-401 at-most-once primitive at work.
 */
export async function mirrorCommentOutbound(
  event: PaperclipCommentEvent,
  client: JiraCommentClient,
  deps: ClaimDeps,
): Promise<OutboundCommentResult> {
  const externalCommentId = `paperclip:comment:${event.commentId}`;
  const key: ClaimKey = {
    tenant_id: event.tenantId,
    external_id: externalCommentId,
    op_kind: 'comment.create',
  };
  const source = event.source ?? `paperclip:comment/${event.commentId}`;
  const ctx: ClaimContext = {
    actor: event.actor,
    source,
    target: '', // Filled in below on the first-claim path.
    metadata: {
      jira_issue_key: event.jiraIssueKey,
      body_length: event.body.length,
    },
  };

  const claimResult = await claim(key, ctx, deps);

  if (!claimResult.firstTime) {
    // Replay: try to recover the existing jiraCommentId by
    // lookup so the caller has a stable id to thread into
    // `remote_refs["jira"]`. The lookup is best-effort — a
    // miss on a replay is the "row claimed, side effect
    // crashed" recovery window; the next replay will retry.
    const existing = await safeLookupComment(client, externalCommentId);
    return {
      operation: existing ? 'link-existing' : 'create',
      jiraCommentId: existing?.jiraCommentId ?? '',
      jiraIssueKey: event.jiraIssueKey,
      externalCommentId,
      tenantId: event.tenantId,
      firstClaim: false,
    };
  }

  // First-time claim. Look up an existing remote-comment-link
  // BEFORE writing. A non-null return means a prior run
  // created the Jira side and we should link, not duplicate.
  const existing = await client.lookupRemoteCommentLink(externalCommentId);
  if (existing) {
    return {
      operation: 'link-existing',
      jiraCommentId: existing.jiraCommentId,
      jiraIssueKey: event.jiraIssueKey,
      externalCommentId,
      tenantId: event.tenantId,
      firstClaim: true,
    };
  }

  // No existing link — add the Jira comment with the
  // deterministic `externalCommentId` so a future
  // `lookupRemoteCommentLink` round-trips.
  const created = await client.addComment({
    jiraIssueKey: event.jiraIssueKey,
    body: event.body,
    externalCommentId,
  });

  return {
    operation: 'create',
    jiraCommentId: created.jiraCommentId,
    jiraIssueKey: event.jiraIssueKey,
    externalCommentId,
    tenantId: event.tenantId,
    firstClaim: true,
  };
}

// ---------------------------------------------------------------------------
// mirrorCommentInbound
// ---------------------------------------------------------------------------

/**
 * Inbound: a Jira `comment_created` webhook is normalized
 * to a canonical `sync.comment.created.v1` event and
 * published to the Sync Plane resolver.
 *
 * Steps (per FORA-200 §3 + FORA-404 AC#2):
 *
 *   0. Resolve the inbound author. The caller passes
 *      `input.mappedActor` — a `MappedPaperclipAuthor`
 *      produced by `JiraAuthorMapper.mapJiraAccount` BEFORE
 *      this function runs. Per the FORA-253 verdict
 *      invariant: an unknown Jira account MUST raise
 *      `AuthorMappingError`, NOT post as a Paperclip user.
 *      The mirror's contract therefore is: a `mappedActor`
 *      is REQUIRED on the inbound path; a missing or
 *      non-conforming actor envelope is a caller bug and
 *      surfaces as `ok: false` with no claim, no publish,
 *      no audit emission.
 *   1. `claim((tenant, jira:comment:<id>, comment.create))`.
 *      The Jira-side external id (`jira:comment:<id>`) is
 *      the dedupe key — a redelivered webhook for the same
 *      comment id short-circuits with `firstClaim: false`.
 *      The `webhook_dedupe` table is the FIRST gate (FORA-401
 *      / FORA-407 candidate) — the mirror's `claim()` is
 *      the second, idempotency-at-the-`sync_op` gate.
 *   2. First time only: synthesize the canonical
 *      `ReceivedEvent` body and call
 *      `SyncPlanePublisher.publish`. The payload carries the
 *      mapped `actor` envelope (NOT the raw Jira
 *      `accountId`) so the resolver and the Paperclip owner
 *      plane see the FORA-253 envelope directly.
 *   3. The spine already emitted all six audit events on
 *      the first claim — `sync.source.comment.ok` +
 *      `sync.target.comment.ok` are the two the FORA-404
 *      AC calls out.
 *
 * The function does NOT verify the Jira webhook signature
 * (HMAC-SHA256 + `X-Atlassian-Webhook-Identifier`). That
 * gate is the inbound `webhook.ts` route's responsibility
 * (FORA-200.6 / FORA-407 sibling); this module trusts that
 * the caller hands it an authenticated payload.
 */
export async function mirrorCommentInbound(
  input: CommentInboundInput,
  webhook: JiraCommentCreatedWebhook,
  publisher: SyncPlanePublisher,
  deps: ClaimDeps,
): Promise<InboundCommentResult> {
  const jiraCommentId = webhook.comment.id;
  const externalCommentId = `jira:comment:${jiraCommentId}`;
  const subject = buildSubject(input.tenantId);
  const eventId = buildInboundEventId(jiraCommentId, webhook.webhookEventId);

  // Defence in depth: the caller's `mappedActor` MUST be
  // a FORA-253 envelope. The seam contract is that the
  // caller runs `JiraAuthorMapper.mapJiraAccount` first and
  // surfaces the AuthorMappingError; if a bug ever threads a
  // non-envelope value through, we refuse to post as a
  // Paperclip user (mirror the FORA-433 verdict invariant).
  const candidate = input.mappedActor;
  if (!isValidMappedAuthor(candidate)) {
    const idType = typeof (candidate as { author_id?: unknown } | null | undefined)?.author_id;
    return {
      ok: false,
      eventId: '',
      subject: '',
      eventType: 'comment.created.v1',
      jiraCommentId,
      paperclipCommentId: input.paperclipCommentId,
      tenantId: input.tenantId,
      firstClaim: false,
      error: `invalid mapped author envelope: missing or non-string author_id (got ${idType})`,
    };
  }

  const key: ClaimKey = {
    tenant_id: input.tenantId,
    external_id: externalCommentId,
    op_kind: 'comment.create',
  };
  const ctx: ClaimContext = {
    actor: input.mappedActor.author_id,
    source: `jira:comment/${jiraCommentId}`,
    target: `paperclip:comment/${input.paperclipCommentId}`,
    metadata: {
      webhook_event_id: webhook.webhookEventId,
      jira_issue_key: webhook.comment.issueKey,
      jira_author_account_id: webhook.comment.author.accountId,
      author_kind: input.mappedActor.author_kind,
      author_display_name: input.mappedActor.author_display_name,
    },
  };

  const claimResult = await claim(key, ctx, deps);

  if (!claimResult.firstTime) {
    // Replay — the canonical event was already published
    // on the first claim. Return the deterministic
    // `eventId` so the caller can verify the bus side
    // accepted the original delivery.
    return {
      ok: true,
      eventId,
      subject,
      eventType: 'comment.created.v1',
      jiraCommentId,
      paperclipCommentId: input.paperclipCommentId,
      tenantId: input.tenantId,
      firstClaim: false,
    };
  }

  // First-time claim. Publish the canonical event to the
  // Sync Plane resolver. The payload carries the FORA-253
  // author envelope (NOT the raw Jira `accountId`) so the
  // resolver and the Paperclip owner plane see the canonical
  // shape directly.
  await publisher.publish({
    eventId,
    tenantId: input.tenantId,
    subject,
    eventType: 'comment.created.v1',
    occurredAt: new Date().toISOString(),
    payload: {
      paperclip_id: input.paperclipCommentId,
      jira_comment_id: jiraCommentId,
      jira_issue_key: webhook.comment.issueKey,
      jira_body: webhook.comment.body,
      actor: input.mappedActor.author_id,
      actor_kind: input.mappedActor.author_kind,
      actor_display_name: input.mappedActor.author_display_name,
      jira_author_account_id: webhook.comment.author.accountId,
      webhook_event_id: webhook.webhookEventId,
    },
  });

  return {
    ok: true,
    eventId,
    subject,
    eventType: 'comment.created.v1',
    jiraCommentId,
    paperclipCommentId: input.paperclipCommentId,
    tenantId: input.tenantId,
    firstClaim: true,
  };
}

// ---------------------------------------------------------------------------
// Inbound helper — resolve + surface AuthorMappingError
// ---------------------------------------------------------------------------

/**
 * Resolve a Jira `author.accountId` to a `MappedPaperclipAuthor`,
 * surfacing `AuthorMappingError` as a failure result. The
 * caller (the inbound webhook route) calls this BEFORE
 * `mirrorCommentInbound` to keep the mirror itself focused
 * on the (claim → publish) spine.
 *
 * Returning a discriminated `{ ok: true, author }` vs
 * `{ ok: false, error }` shape lets the route handler
 * short-circuit the inbound call without a try/catch on
 * the route layer.
 */
export type AuthorResolution =
  | { ok: true; author: MappedPaperclipAuthor }
  | { ok: false; error: string };

export function resolveInboundAuthor(
  mapper: JiraAuthorMapper,
  tenantId: string,
  accountId: string,
): AuthorResolution {
  try {
    const author = mapper.mapJiraAccount(tenantId, accountId);
    return { ok: true, author };
  } catch (err) {
    if (err instanceof AuthorMappingError) {
      return { ok: false, error: err.reason };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Best-effort `lookupRemoteCommentLink` on the replay path.
 * A throw here would propagate up to the caller, which is
 * not what we want — a replay is a "no new work" path;
 * the audit row is already in the sink; the side effect
 * either succeeded (and `lookupRemoteCommentLink` would
 * find it) or never ran. We catch and return `null` so
 * the caller gets the conservative `operation: 'create'`
 * with an empty `jiraCommentId` and can decide what to do.
 */
async function safeLookupComment(
  client: JiraCommentClient,
  externalCommentId: string,
): Promise<{ jiraCommentId: string; jiraIssueKey: string } | null> {
  try {
    return await client.lookupRemoteCommentLink(externalCommentId);
  } catch {
    return null;
  }
}

/**
 * Defence-in-depth check on the inbound `mappedActor`. The
 * `JiraAuthorMapper.mapJiraAccount` contract guarantees a
 * well-formed envelope; this check is a last-line guard
 * against a caller-side bug that drops the envelope shape.
 *
 * The FORA-253 verdict invariant is "unknown author ->
 * AuthorMappingError, never post as a Paperclip user"; a
 * malformed envelope is the same risk class, so the mirror
 * refuses to publish rather than fall through.
 */
function isValidMappedAuthor(
  author: MappedPaperclipAuthor | undefined | null,
): author is MappedPaperclipAuthor {
  if (!author || typeof author !== 'object') return false;
  const a = author as unknown as Record<string, unknown>;
  if (typeof a['author_id'] !== 'string' || a['author_id'].length === 0) {
    return false;
  }
  const kind = a['author_kind'];
  if (kind !== 'user' && kind !== 'agent' && kind !== 'system' && kind !== 'board') {
    return false;
  }
  if (typeof a['author_display_name'] !== 'string') return false;
  return true;
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
