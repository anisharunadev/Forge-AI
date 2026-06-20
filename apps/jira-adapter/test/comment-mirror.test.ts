/**
 * FORA-200.2 / FORA-404 — comment-mirror contract tests.
 *
 * Acceptance bar (FORA-404 description + FORA-200 plan §2 AC#2 + §4
 * verification bar):
 *
 *   1. `mirrorCommentOutbound` happy path — Paperclip comment
 *      with NO existing remote-comment-link calls
 *      `lookupRemoteCommentLink` once, then `addComment` once,
 *      and returns `{operation: 'create', jiraCommentId,
 *      jiraIssueKey, firstClaim: true}`. The two FORA-404 AC
 *      audit events — `sync.source.comment.ok` +
 *      `sync.target.comment.ok` — are present on the first
 *      claim (per the FORA-401 spine contract).
 *
 *   2. `mirrorCommentInbound` with an AGENT actor — the
 *      `JiraAuthorMapper` resolves a known bot accountId to a
 *      `MappedPaperclipAuthor` with `author_kind: 'agent'`
 *      and the FORA-253 envelope
 *      `agent:jira-automation:<run-id>`. The canonical
 *      `sync.comment.created.v1` event carries the mapped
 *      envelope (NOT the raw Jira accountId) on its `actor`
 *      field.
 *
 *   3. `mirrorCommentInbound` with a HUMAN actor — the
 *      `JiraAuthorMapper` resolves a known user accountId to a
 *      `MappedPaperclipAuthor` with `author_kind: 'user'` and
 *      the FORA-253 envelope `user:okta-integration-engineer`.
 *      The canonical event carries the user envelope.
 *
 *   4. `mirrorCommentOutbound` dedupe-on-replay — the second
 *      call returns `firstClaim: false` and does NOT re-call
 *      `addComment`. Replays emit ZERO additional audit
 *      events (the FORA-401 contract).
 *
 * The tests use the same `FakeExecutor` (simulates
 * `INSERT ... ON CONFLICT DO NOTHING`) plus a
 * `RecordingJiraCommentClient`, a `RecordingSyncPlanePublisher`,
 * and a `StaticJiraAuthorMapper` that captures every call
 * without touching the network. No real Postgres, no real
 * Jira, no real bus.
 *
 * Running:
 *   pnpm --filter @fora/jira-adapter test comment-mirror
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  mirrorCommentOutbound,
  mirrorCommentInbound,
  resolveInboundAuthor,
  AuthorMappingError,
  EnvBackedJiraAuthorMapper,
  type JiraCommentClient,
  type JiraAuthorMapper,
  type MappedPaperclipAuthor,
  type PaperclipCommentEvent,
  type JiraCommentCreatedWebhook,
  type CommentInboundInput,
} from '../src/comment-mirror.js';
import {
  type SyncPlanePublisher,
} from '../src/issue-mirror.js';
import {
  createAuditSink,
  type AuditSink,
  type SyncEventType,
} from '../src/audit.js';
import {
  type ClaimDeps,
} from '../src/idempotency.js';
import type {
  PoolExecutor,
  QueryArgs,
  QueryResult,
  QueryResultRow,
} from '../src/pool_executor.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TENANT_A = '11111111-1111-1111-1111-111111111111';

const PAPERCLIP_ACTOR = 'user:okta-integration-engineer';
const COMMENT_ID = 'FORA-404-c-1';
const JIRA_ISSUE_KEY = 'PROJ-201';
const JIRA_AUTHOR_USER = '5d8e...jira-user-acct';
const JIRA_AUTHOR_BOT = 'jira-bot-acct';
const JIRA_AUTHOR_UNKNOWN = 'unknown-jira-acct-9999';

const PAPERCLIP_REF = `paperclip:comment/${COMMENT_ID}`;

const MAPPED_USER: MappedPaperclipAuthor = {
  author_kind: 'user',
  author_id: 'user:okta-integration-engineer',
  author_display_name: 'Integration Engineer',
};

const MAPPED_BOT: MappedPaperclipAuthor = {
  author_kind: 'agent',
  author_id: 'agent:jira-automation:run-7c2f',
  author_display_name: 'Jira Automation',
};

const BASE_OUTBOUND_EVENT: PaperclipCommentEvent = {
  tenantId: TENANT_A,
  commentId: COMMENT_ID,
  jiraIssueKey: JIRA_ISSUE_KEY,
  body: 'Smoke: FORA-404 round-trip body.',
  actor: PAPERCLIP_ACTOR,
  source: PAPERCLIP_REF,
};

const BASE_INBOUND_USER_WEBHOOK: JiraCommentCreatedWebhook = {
  webhookEventId: 'wh-evt-2026-06-20-cmt-001',
  comment: {
    id: 'c-9001',
    issueKey: JIRA_ISSUE_KEY,
    body: 'Mirror of Paperclip comment FORA-404-c-1',
    author: {
      accountId: JIRA_AUTHOR_USER,
      displayName: 'Integration Engineer',
    },
  },
};

const BASE_INBOUND_BOT_WEBHOOK: JiraCommentCreatedWebhook = {
  webhookEventId: 'wh-evt-2026-06-20-cmt-002',
  comment: {
    id: 'c-9002',
    issueKey: JIRA_ISSUE_KEY,
    body: 'Automated comment from Jira automation',
    author: {
      accountId: JIRA_AUTHOR_BOT,
      displayName: 'Jira Automation',
    },
  },
};

// ---------------------------------------------------------------------------
// FakeExecutor — replicates the FORA-401 sync_op dedupe primitive.
// ---------------------------------------------------------------------------
//
// Same `INSERT ... ON CONFLICT DO NOTHING` simulation as
// `idempotency.test.ts` and `issue-mirror.test.ts`. Lives here
// as a copy (rather than a shared helper) to keep the three
// test files independent; a future test scaffold can factor
// it out.

interface SyncOpRow {
  claimed_at: Date;
  source: string;
  target: string;
  claimed_by: string;
  metadata: Record<string, unknown>;
}

class FakeExecutor implements PoolExecutor {
  private readonly rows = new Map<string, SyncOpRow>();

  async query<R extends QueryResultRow = QueryResultRow>(
    args: QueryArgs<R>,
  ): Promise<QueryResult<R>> {
    if (!args.sql.includes('INSERT INTO sync_op')) {
      throw new Error(`FakeExecutor only supports sync_op INSERT; got: ${args.sql}`);
    }
    const params = args.params ?? [];
    const tenant_id = params[0] as string;
    const external_id = params[1] as string;
    const op_kind = params[2] as string;
    const source = (params[3] as string) ?? '';
    const target = (params[4] as string) ?? '';
    const claimed_by = (params[5] as string) ?? '';
    const metadata_raw = params[6];
    const metadata =
      typeof metadata_raw === 'string' && metadata_raw.length > 0
        ? (JSON.parse(metadata_raw) as Record<string, unknown>)
        : {};

    const k = `${tenant_id}|${external_id}|${op_kind}`;
    const existing = this.rows.get(k);
    if (existing !== undefined) {
      return { rowCount: 0, rows: [] as R[] };
    }
    const claimed_at = new Date();
    this.rows.set(k, { claimed_at, source, target, claimed_by, metadata });
    return {
      rowCount: 1,
      rows: [{ claimed_at } as unknown as R],
    };
  }

  size(): number {
    return this.rows.size;
  }

  /** Test seam — read a row by the (tenant, external_id, op_kind) tuple. */
  get(tenant_id: string, external_id: string, op_kind: string): SyncOpRow | undefined {
    return this.rows.get(`${tenant_id}|${external_id}|${op_kind}`);
  }
}

// ---------------------------------------------------------------------------
// Recording fakes — capture every call without touching the network.
// ---------------------------------------------------------------------------

interface JiraCommentClientCall {
  method: 'lookupRemoteCommentLink' | 'addComment';
  args: Record<string, unknown>;
}

class RecordingJiraCommentClient implements JiraCommentClient {
  readonly calls: JiraCommentClientCall[] = [];

  /**
   * Pre-scripted responses. Each `lookupRemoteCommentLink` call
   * pops the next entry; a missing entry throws
   * `lookupRemoteCommentLink-not-scripted`. `addComment` does
   * the same. Tests seed the script before calling the mirror.
   */
  private readonly lookupScript: Array<
    { jiraCommentId: string; jiraIssueKey: string } | null
  >;
  private readonly addCommentScript: Array<{ jiraCommentId: string; id: string }> = [];

  constructor(
    lookupScript: Array<{ jiraCommentId: string; jiraIssueKey: string } | null>,
  ) {
    this.lookupScript = lookupScript;
  }

  /** Push an `addComment` response. The mirror consumes one per outbound create. */
  pushAddCommentResponse(response: { jiraCommentId: string; id: string }): void {
    this.addCommentScript.push(response);
  }

  async lookupRemoteCommentLink(
    externalCommentId: string,
  ): Promise<{ jiraCommentId: string; jiraIssueKey: string } | null> {
    this.calls.push({
      method: 'lookupRemoteCommentLink',
      args: { externalCommentId },
    });
    const next = this.lookupScript.shift();
    if (next === undefined) {
      throw new Error('lookupRemoteCommentLink-not-scripted');
    }
    return next;
  }

  async addComment(input: {
    jiraIssueKey: string;
    body: string;
    externalCommentId: string;
  }): Promise<{ jiraCommentId: string; id: string }> {
    this.calls.push({ method: 'addComment', args: { ...input } });
    const next = this.addCommentScript.shift();
    if (next === undefined) {
      throw new Error('addComment-not-scripted');
    }
    return next;
  }
}

interface PublishedEvent {
  eventId: string;
  tenantId: string;
  subject: string;
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

class RecordingSyncPlanePublisher implements SyncPlanePublisher {
  readonly published: PublishedEvent[] = [];

  async publish(event: PublishedEvent): Promise<void> {
    this.published.push(event);
  }
}

/**
 * Static author mapper for tests. Backed by an in-memory
 * `Map<accountId, MappedPaperclipAuthor>`. Throws
 * `AuthorMappingError` on unknown account ids — the
 * FORA-201.2 verdict invariant.
 */
class StaticJiraAuthorMapper implements JiraAuthorMapper {
  private readonly byTenant = new Map<
    string,
    Map<string, MappedPaperclipAuthor>
  >();

  set(tenantId: string, accountId: string, author: MappedPaperclipAuthor): void {
    let table = this.byTenant.get(tenantId);
    if (!table) {
      table = new Map<string, MappedPaperclipAuthor>();
      this.byTenant.set(tenantId, table);
    }
    table.set(accountId, author);
  }

  mapJiraAccount(tenantId: string, accountId: string): MappedPaperclipAuthor {
    const table = this.byTenant.get(tenantId);
    const mapped = table?.get(accountId);
    if (!mapped) {
      throw new AuthorMappingError(accountId);
    }
    return mapped;
  }

  knownAccounts(tenantId: string): string[] {
    const table = this.byTenant.get(tenantId);
    return table ? Array.from(table.keys()).sort() : [];
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('mirrorCommentOutbound — FORA-200.2 / FORA-404 AC#2 (case 1)', () => {
  let audit: ReturnType<typeof createAuditSink>;
  let executor: FakeExecutor;
  let deps: ClaimDeps;
  let jira: RecordingJiraCommentClient;
  let publisher: RecordingSyncPlanePublisher;

  beforeEach(() => {
    audit = createAuditSink();
    executor = new FakeExecutor();
    deps = { executor, audit };
    jira = new RecordingJiraCommentClient([]);
    publisher = new RecordingSyncPlanePublisher();
  });

  it('outbound create — Paperclip comment with no existing link calls addComment and returns operation=create', async () => {
    // No existing link — the lookup returns null, the mirror
    // calls addComment, and the result is `operation: 'create'`.
    jira = new RecordingJiraCommentClient([null]);
    jira.pushAddCommentResponse({ jiraCommentId: 'jira-c-9001', id: '9001' });

    const result = await mirrorCommentOutbound(BASE_OUTBOUND_EVENT, jira, deps);

    // The two Jira client calls the AC#2 contract requires.
    const lookupCalls = jira.calls.filter(
      (c) => c.method === 'lookupRemoteCommentLink',
    );
    const addCalls = jira.calls.filter((c) => c.method === 'addComment');
    expect(lookupCalls).toHaveLength(1);
    expect(addCalls).toHaveLength(1);

    // The deterministic external id is the lookup + addComment
    // argument — proves the FORA-200 §3 "externalCommentId =
    // paperclip:comment:<commentId>" contract for comments.
    expect(lookupCalls[0]?.args.externalCommentId).toBe('paperclip:comment:FORA-404-c-1');
    expect(addCalls[0]?.args.externalCommentId).toBe('paperclip:comment:FORA-404-c-1');
    expect(addCalls[0]?.args.jiraIssueKey).toBe(JIRA_ISSUE_KEY);
    expect(addCalls[0]?.args.body).toBe(BASE_OUTBOUND_EVENT.body);

    // The mirror surfaces the Jira-issued comment id + a
    // first-claim signal the caller can thread into
    // remote_refs["jira"].
    expect(result).toEqual({
      operation: 'create',
      jiraCommentId: 'jira-c-9001',
      jiraIssueKey: JIRA_ISSUE_KEY,
      externalCommentId: 'paperclip:comment:FORA-404-c-1',
      tenantId: TENANT_A,
      firstClaim: true,
    });

    // FORA-200 §4 + FORA-404 AC audit bar:
    // sync.source.comment.ok + sync.target.comment.ok are
    // present on the first claim.
    const eventTypes = audit.events.map((e) => e.event_type);
    expect(eventTypes).toContain('sync.source.comment.ok');
    expect(eventTypes).toContain('sync.target.comment.ok');
    // The full six-event closed set is present (FORA-401 spine).
    const distinctTypes = new Set<SyncEventType>(eventTypes);
    expect(distinctTypes.size).toBe(6);

    // The audit row carries the FORA-253 actor envelope +
    // the deterministic external id + the comment.create
    // op_kind.
    const sourceCommentEvent = audit.events.find(
      (e) => e.event_type === 'sync.source.comment.ok',
    );
    expect(sourceCommentEvent?.actor).toBe(PAPERCLIP_ACTOR);
    expect(sourceCommentEvent?.external_id).toBe('paperclip:comment:FORA-404-c-1');
    expect(sourceCommentEvent?.op_kind).toBe('comment.create');

    // The mirror does NOT publish anything to the sync-plane
    // resolver on the outbound path — that's the inbound
    // path's job.
    expect(publisher.published).toHaveLength(0);
  });
});

describe('mirrorCommentInbound — FORA-200.2 / FORA-404 AC#2 (case 2 + case 3)', () => {
  let audit: ReturnType<typeof createAuditSink>;
  let executor: FakeExecutor;
  let deps: ClaimDeps;
  let publisher: RecordingSyncPlanePublisher;
  let authorMapper: StaticJiraAuthorMapper;

  beforeEach(() => {
    audit = createAuditSink();
    executor = new FakeExecutor();
    deps = { executor, audit };
    publisher = new RecordingSyncPlanePublisher();
    authorMapper = new StaticJiraAuthorMapper();
    authorMapper.set(TENANT_A, JIRA_AUTHOR_USER, MAPPED_USER);
    authorMapper.set(TENANT_A, JIRA_AUTHOR_BOT, MAPPED_BOT);
  });

  it('inbound with agent actor — known bot accountId maps to agent envelope and is published as actor', async () => {
    // Resolve the bot actor through the mapper BEFORE the
    // mirror call — this is the contract the FORA-201.2
    // verdict invariant prescribes.
    const resolved = resolveInboundAuthor(
      authorMapper,
      TENANT_A,
      JIRA_AUTHOR_BOT,
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return; // narrow for TS

    const input: CommentInboundInput = {
      tenantId: TENANT_A,
      paperclipCommentId: COMMENT_ID,
      mappedActor: resolved.author,
    };

    const result = await mirrorCommentInbound(
      input,
      BASE_INBOUND_BOT_WEBHOOK,
      publisher,
      deps,
    );

    // The success path contract: ok=true, firstClaim=true,
    // canonical eventType, deterministic eventId.
    expect(result.ok).toBe(true);
    expect(result.firstClaim).toBe(true);
    expect(result.eventType).toBe('comment.created.v1');
    expect(result.eventId).toBe('evt-jira-comment-c-9002-wh-evt-2026-06-20-cmt-002');
    expect(result.subject).toBe(`fora.events.${TENANT_A}.comment.created.v1`);
    expect(result.jiraCommentId).toBe('c-9002');
    expect(result.paperclipCommentId).toBe(COMMENT_ID);
    expect(result.tenantId).toBe(TENANT_A);
    expect(result.error).toBeUndefined();

    // The published event carries the FORA-253 agent envelope
    // (NOT the raw Jira accountId) on the `actor` field.
    expect(publisher.published).toHaveLength(1);
    const published = publisher.published[0]!;
    expect(published.eventId).toBe('evt-jira-comment-c-9002-wh-evt-2026-06-20-cmt-002');
    expect(published.subject).toBe(`fora.events.${TENANT_A}.comment.created.v1`);
    expect(published.eventType).toBe('comment.created.v1');
    expect(published.payload['actor']).toBe('agent:jira-automation:run-7c2f');
    expect(published.payload['actor_kind']).toBe('agent');
    expect(published.payload['actor_display_name']).toBe('Jira Automation');
    // The raw Jira accountId is preserved for diagnostics
    // alongside the mapped envelope.
    expect(published.payload['jira_author_account_id']).toBe(JIRA_AUTHOR_BOT);
    expect(published.payload['jira_comment_id']).toBe('c-9002');
    expect(published.payload['jira_issue_key']).toBe(JIRA_ISSUE_KEY);
    expect(published.payload['paperclip_id']).toBe(COMMENT_ID);
    expect(published.payload['webhook_event_id']).toBe('wh-evt-2026-06-20-cmt-002');

    // FORA-200 §4 audit bar: sync.source.comment.ok +
    // sync.target.comment.ok on the first claim.
    const eventTypes = audit.events.map((e) => e.event_type);
    expect(eventTypes).toContain('sync.source.comment.ok');
    expect(eventTypes).toContain('sync.target.comment.ok');

    // The spine carries the FORA-253 envelope as `claimed_by`
    // — the agent envelope is what the operator console joins
    // on when tracing the inbound path.
    const sourceCommentEvent = audit.events.find(
      (e) => e.event_type === 'sync.source.comment.ok',
    );
    expect(sourceCommentEvent?.actor).toBe('agent:jira-automation:run-7c2f');
    expect(sourceCommentEvent?.external_id).toBe('jira:comment:c-9002');
    expect(sourceCommentEvent?.op_kind).toBe('comment.create');

    // The sync_op row carries the FORA-253 envelope as
    // `claimed_by` and the raw Jira accountId + display
    // name in the structured metadata for audit.
    const row = executor.get(TENANT_A, 'jira:comment:c-9002', 'comment.create');
    expect(row?.claimed_by).toBe('agent:jira-automation:run-7c2f');
    expect(row?.source).toBe('jira:comment/c-9002');
    expect(row?.target).toBe(`paperclip:comment/${COMMENT_ID}`);
    expect(row?.metadata['jira_author_account_id']).toBe(JIRA_AUTHOR_BOT);
    expect(row?.metadata['author_kind']).toBe('agent');
    expect(row?.metadata['author_display_name']).toBe('Jira Automation');
  });

  it('inbound with human actor — known user accountId maps to user envelope and is published as actor', async () => {
    const resolved = resolveInboundAuthor(
      authorMapper,
      TENANT_A,
      JIRA_AUTHOR_USER,
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return; // narrow for TS

    const input: CommentInboundInput = {
      tenantId: TENANT_A,
      paperclipCommentId: COMMENT_ID,
      mappedActor: resolved.author,
    };

    const result = await mirrorCommentInbound(
      input,
      BASE_INBOUND_USER_WEBHOOK,
      publisher,
      deps,
    );

    // The success path contract — same shape as the bot case.
    expect(result.ok).toBe(true);
    expect(result.firstClaim).toBe(true);
    expect(result.eventType).toBe('comment.created.v1');
    expect(result.jiraCommentId).toBe('c-9001');

    // The published event carries the FORA-253 user envelope
    // (NOT the raw Jira accountId) on the `actor` field.
    expect(publisher.published).toHaveLength(1);
    const published = publisher.published[0]!;
    expect(published.payload['actor']).toBe('user:okta-integration-engineer');
    expect(published.payload['actor_kind']).toBe('user');
    expect(published.payload['actor_display_name']).toBe('Integration Engineer');
    // The raw Jira accountId is preserved for diagnostics.
    expect(published.payload['jira_author_account_id']).toBe(JIRA_AUTHOR_USER);

    // The spine carries the FORA-253 envelope as `claimed_by`.
    const sourceCommentEvent = audit.events.find(
      (e) => e.event_type === 'sync.source.comment.ok',
    );
    expect(sourceCommentEvent?.actor).toBe('user:okta-integration-engineer');
    expect(sourceCommentEvent?.external_id).toBe('jira:comment:c-9001');

    const row = executor.get(TENANT_A, 'jira:comment:c-9001', 'comment.create');
    expect(row?.claimed_by).toBe('user:okta-integration-engineer');
    expect(row?.metadata['author_kind']).toBe('user');
  });

  it('inbound AuthorMappingError — unknown Jira accountId never posts (verdict invariant)', async () => {
    // The FORA-201.2 verdict invariant re-applied to Jira
    // (FORA-404): unknown author -> AuthorMappingError, never
    // post as Paperclip user. The resolveInboundAuthor seam
    // surfaces the error before the mirror sees it; if the
    // caller mistakenly threads an empty envelope through,
    // the mirror's defence-in-depth check refuses to publish.
    const resolved = resolveInboundAuthor(
      authorMapper,
      TENANT_A,
      JIRA_AUTHOR_UNKNOWN,
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return; // narrow for TS

    expect(resolved.error).toMatch(/unknown jira author/);
    expect(resolved.error).toContain(JIRA_AUTHOR_UNKNOWN);

    // No claim, no publish, no audit.
    expect(publisher.published).toHaveLength(0);
    expect(executor.size()).toBe(0);
    expect(audit.events).toHaveLength(0);

    // Direct AuthorMappingError construction also surfaces.
    expect(() =>
      authorMapper.mapJiraAccount(TENANT_A, JIRA_AUTHOR_UNKNOWN),
    ).toThrow(AuthorMappingError);
  });
});

describe('mirrorCommentOutbound — FORA-200.2 / FORA-404 AC#2 dedupe-on-replay (case 4)', () => {
  let audit: ReturnType<typeof createAuditSink>;
  let executor: FakeExecutor;
  let deps: ClaimDeps;
  let jira: RecordingJiraCommentClient;

  beforeEach(() => {
    audit = createAuditSink();
    executor = new FakeExecutor();
    deps = { executor, audit };
    jira = new RecordingJiraCommentClient([]);
  });

  it('replay — second call returns firstClaim=false and does not re-call addComment; zero new audit events', async () => {
    // First call creates the Jira comment. The shared `deps`
    // (and its `executor`) carry the sync_op row forward.
    jira = new RecordingJiraCommentClient([null]);
    jira.pushAddCommentResponse({ jiraCommentId: 'jira-c-9001', id: '9001' });
    const first = await mirrorCommentOutbound(BASE_OUTBOUND_EVENT, jira, deps);
    expect(first.firstClaim).toBe(true);
    expect(first.operation).toBe('create');
    expect(first.jiraCommentId).toBe('jira-c-9001');
    expect(executor.size()).toBe(1);
    expect(audit.events).toHaveLength(6);

    // Replay: the claim() primitive dedupes on the
    // (tenant, paperclip:comment:FORA-404-c-1, comment.create)
    // row. The second call's `lookupRemoteCommentLink` is
    // the best-effort recovery lookup the mirror runs to
    // recover the existing Jira comment id — a fresh
    // RecordingJiraCommentClient pre-scripted with the same
    // answer production would query.
    const replayJira = new RecordingJiraCommentClient([
      { jiraCommentId: 'jira-c-9001', jiraIssueKey: JIRA_ISSUE_KEY },
    ]);
    const second = await mirrorCommentOutbound(
      BASE_OUTBOUND_EVENT,
      replayJira,
      deps,
    );

    // Replay path: no second addComment, firstClaim=false.
    expect(second.firstClaim).toBe(false);
    expect(second.operation).toBe('link-existing');
    expect(second.jiraCommentId).toBe('jira-c-9001');
    expect(second.jiraIssueKey).toBe(JIRA_ISSUE_KEY);
    expect(second.externalCommentId).toBe('paperclip:comment:FORA-404-c-1');

    // The replay made exactly one lookup (the recovery
    // lookup) and zero addComment calls.
    const lookupCalls = replayJira.calls.filter(
      (c) => c.method === 'lookupRemoteCommentLink',
    );
    const addCalls = replayJira.calls.filter((c) => c.method === 'addComment');
    expect(lookupCalls).toHaveLength(1);
    expect(addCalls).toHaveLength(0);

    // No additional sync_op row was created.
    expect(executor.size()).toBe(1);

    // Replays emit zero additional audit events per the
    // FORA-401 contract; the six events the first claim
    // emitted are still the only ones in the audit sink.
    expect(audit.events).toHaveLength(6);
  });
});

describe('EnvBackedJiraAuthorMapper — day-one env-var reader (FORA-253)', () => {
  // The mapper derives the env-var slug from the tenantId
  // (uppercased + dashes → underscores). Mirror that here so
  // the env var name matches what the loader reads.
  const ENV_VAR = `FORA_TENANT_${TENANT_A.toUpperCase().replace(/-/g, '_')}_JIRA_AUTHOR_MAP`;

  it('returns a MappedPaperclipAuthor for a known accountId from the env-var map', () => {
    const previous = process.env[ENV_VAR];
    process.env[ENV_VAR] = JSON.stringify({
      [JIRA_AUTHOR_USER]: {
        kind: 'user',
        id: 'user:okta-integration-engineer',
        display_name: 'Integration Engineer',
      },
    });
    try {
      const mapper = new EnvBackedJiraAuthorMapper();
      const author = mapper.mapJiraAccount(TENANT_A, JIRA_AUTHOR_USER);
      expect(author).toEqual(MAPPED_USER);
    } finally {
      if (previous === undefined) {
        delete process.env[ENV_VAR];
      } else {
        process.env[ENV_VAR] = previous;
      }
    }
  });

  it('throws AuthorMappingError for an unknown accountId (verdict invariant)', () => {
    const previous = process.env[ENV_VAR];
    // Intentionally do not seed the env var — empty mapping.
    if (previous !== undefined) {
      delete process.env[ENV_VAR];
    }
    try {
      const mapper = new EnvBackedJiraAuthorMapper();
      expect(() => mapper.mapJiraAccount(TENANT_A, JIRA_AUTHOR_UNKNOWN)).toThrow(
        AuthorMappingError,
      );
    } finally {
      if (previous !== undefined) {
        process.env[ENV_VAR] = previous;
      }
    }
  });
});
