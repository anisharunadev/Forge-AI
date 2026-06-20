/**
 * FORA-200.1 / FORA-402 — issue-mirror contract tests.
 *
 * Acceptance bar (FORA-402 description + FORA-200 plan §2 AC#1 + §4
 * verification bar):
 *
 *   1. `mirrorIssueOutbound` with NO existing remote-issue-link
 *      calls `lookupRemoteIssueLink` once, then `createIssue` once,
 *      and returns `{operation: 'create', jiraKey: 'PROJ-N', firstClaim: true}`.
 *   2. `mirrorIssueOutbound` WITH an existing remote-issue-link
 *      calls `lookupRemoteIssueLink` once, does NOT call
 *      `createIssue`, and returns
 *      `{operation: 'link-existing', jiraKey: 'PROJ-N', firstClaim: true}`.
 *   3. `mirrorIssueInbound` normalizes a Jira `jira:issue_created`
 *      webhook into a canonical `sync.issue.created.v1` event and
 *      publishes it via `SyncPlanePublisher.publish` exactly once.
 *
 * The audit-log bar (FORA-200 §4 "All 6 Audit events observed in
 * the audit log") is asserted on the outbound create path:
 *   - `sync.source.issue.ok` — present (Paperclip → Jira)
 *   - `sync.target.issue.ok` — present (Jira mirror landed)
 *
 * The two events the FORA-402 AC calls out specifically are
 * present on the first claim and absent on every replay
 * (per the FORA-401 / claim() contract).
 *
 * The tests use the same `FakeExecutor` as `idempotency.test.ts`
 * (simulates `INSERT ... ON CONFLICT DO NOTHING`) plus a
 * `RecordingJiraClient` and `RecordingSyncPlanePublisher` that
 * capture every call without touching the network. No real
 * Postgres, no real Jira, no real bus.
 *
 * Running:
 *   pnpm --filter @fora/jira-adapter test issue-mirror
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  mirrorIssueOutbound,
  mirrorIssueInbound,
  type JiraClient,
  type SyncPlanePublisher,
  type PaperclipIssueEvent,
  type JiraIssueCreatedWebhook,
  type MirrorInboundInput,
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
const ACTOR = 'user:okta-integration-engineer';
const ISSUE_ID = 'FORA-402';
const PAPERCLIP_REF = `paperclip:issue/${ISSUE_ID}`;

const BASE_OUTBOUND_EVENT: PaperclipIssueEvent = {
  tenantId: TENANT_A,
  issueId: ISSUE_ID,
  summary: 'Ship FORA-200 v0.1 — Paperclip ↔ Jira adapter',
  description: 'Day-one vertical slice per FORA-200 plan §2 AC#1.',
  labels: ['forge:pipeline', `forge:tenant:${TENANT_A}`],
  actor: ACTOR,
  source: PAPERCLIP_REF,
};

const BASE_INBOUND_INPUT: MirrorInboundInput = {
  tenantId: TENANT_A,
  paperclipIssueId: ISSUE_ID,
  actor: ACTOR,
};

const BASE_INBOUND_WEBHOOK: JiraIssueCreatedWebhook = {
  webhookEventId: 'wh-evt-2026-06-20-001',
  issue: {
    id: '10042',
    key: 'PROJ-101',
    fields: {
      summary: 'Mirror of Paperclip issue FORA-402',
      description: 'Inbound webhook body.',
      labels: ['forge:pipeline', `forge:tenant:${TENANT_A}`],
    },
  },
};

// ---------------------------------------------------------------------------
// FakeExecutor — replicates the FORA-401 sync_op dedupe primitive.
// ---------------------------------------------------------------------------
//
// Same `INSERT ... ON CONFLICT DO NOTHING` simulation as
// `idempotency.test.ts`. Lives here as a copy (rather than a
// shared helper) to keep the two test files independent; a
// future test scaffold can factor it out.

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
}

// ---------------------------------------------------------------------------
// Recording fakes — capture every call without touching the network.
// ---------------------------------------------------------------------------

interface JiraClientCall {
  method: 'lookupRemoteIssueLink' | 'createIssue';
  args: Record<string, unknown>;
}

class RecordingJiraClient implements JiraClient {
  readonly calls: JiraClientCall[] = [];

  /**
   * Pre-scripted responses. Each `lookupRemoteIssueLink` call
   * pops the next entry; a missing entry throws
   * `lookupRemoteIssueLink-not-scripted`. `createIssue` does
   * the same. Tests seed the script before calling the mirror.
   */
  private readonly lookupScript: Array<
    { jiraKey: string } | null
  >;
  private readonly createScript: Array<{ jiraKey: string; id: string }> = [];

  constructor(
    lookupScript: Array<{ jiraKey: string } | null>,
  ) {
    this.lookupScript = lookupScript;
  }

  /** Push a `createIssue` response. The mirror consumes one per outbound create. */
  pushCreateResponse(response: { jiraKey: string; id: string }): void {
    this.createScript.push(response);
  }

  async lookupRemoteIssueLink(
    externalIssueId: string,
  ): Promise<{ jiraKey: string } | null> {
    this.calls.push({
      method: 'lookupRemoteIssueLink',
      args: { externalIssueId },
    });
    const next = this.lookupScript.shift();
    if (next === undefined) {
      throw new Error('lookupRemoteIssueLink-not-scripted');
    }
    return next;
  }

  async createIssue(input: {
    summary: string;
    description?: string;
    labels?: string[];
    externalIssueId: string;
  }): Promise<{ jiraKey: string; id: string }> {
    this.calls.push({ method: 'createIssue', args: { ...input } });
    const next = this.createScript.shift();
    if (next === undefined) {
      throw new Error('createIssue-not-scripted');
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('mirrorIssueOutbound — FORA-200.1 / FORA-402 AC#1', () => {
  let audit: ReturnType<typeof createAuditSink>;
  let executor: FakeExecutor;
  let deps: ClaimDeps;
  let jira: RecordingJiraClient;
  let publisher: RecordingSyncPlanePublisher;

  beforeEach(() => {
    audit = createAuditSink();
    executor = new FakeExecutor();
    deps = { executor, audit };
    jira = new RecordingJiraClient([]);
    publisher = new RecordingSyncPlanePublisher();
  });

  it('outbound create — Paperclip issue with no existing link calls createIssue and returns operation=create', async () => {
    // No existing link — the lookup returns null, the mirror
    // calls createIssue, and the result is `operation: 'create'`.
    jira = new RecordingJiraClient([null]);
    jira.pushCreateResponse({ jiraKey: 'PROJ-101', id: '10042' });

    const result = await mirrorIssueOutbound(BASE_OUTBOUND_EVENT, jira, deps);

    // The two Jira client calls the AC#1 contract requires.
    const lookupCalls = jira.calls.filter(
      (c) => c.method === 'lookupRemoteIssueLink',
    );
    const createCalls = jira.calls.filter((c) => c.method === 'createIssue');
    expect(lookupCalls).toHaveLength(1);
    expect(createCalls).toHaveLength(1);

    // The deterministic external id is the lookup + create
    // argument — proves the FORA-200 §3 "externalIssueId =
    // paperclip:<issueId>" contract.
    expect(lookupCalls[0]?.args.externalIssueId).toBe('paperclip:FORA-402');
    expect(createCalls[0]?.args.externalIssueId).toBe('paperclip:FORA-402');

    // The mirror surfaces the Jira-issued key + a first-claim
    // signal the caller can thread into remote_refs["jira"].
    expect(result).toEqual({
      operation: 'create',
      jiraKey: 'PROJ-101',
      externalIssueId: 'paperclip:FORA-402',
      tenantId: TENANT_A,
      firstClaim: true,
    });

    // FORA-200 §4 audit bar: sync.source.issue.ok +
    // sync.target.issue.ok are present on the first claim.
    const eventTypes = audit.events.map((e) => e.event_type);
    expect(eventTypes).toContain('sync.source.issue.ok');
    expect(eventTypes).toContain('sync.target.issue.ok');
    // The full six-event closed set is present (FORA-401 spine).
    const distinctTypes = new Set<SyncEventType>(eventTypes);
    expect(distinctTypes.size).toBe(6);

    // The audit row carries the FORA-253 actor envelope +
    // the deterministic external id.
    const sourceIssueEvent = audit.events.find(
      (e) => e.event_type === 'sync.source.issue.ok',
    );
    expect(sourceIssueEvent?.actor).toBe(ACTOR);
    expect(sourceIssueEvent?.external_id).toBe('paperclip:FORA-402');
    expect(sourceIssueEvent?.op_kind).toBe('issue.create');

    // The mirror does NOT publish anything to the sync-plane
    // resolver on the outbound path — that's the inbound path's job.
    expect(publisher.published).toHaveLength(0);
  });

  it('outbound link-existing — Paperclip issue with an existing link returns the cached Jira key without a second write', async () => {
    // Pre-existing link — the lookup returns the Jira key,
    // the mirror skips `createIssue` and surfaces the link.
    jira = new RecordingJiraClient([{ jiraKey: 'PROJ-77' }]);

    const result = await mirrorIssueOutbound(BASE_OUTBOUND_EVENT, jira, deps);

    // The single Jira call is the lookup; no `createIssue`
    // was made — the FORA-200 §3 "remoteIssueLink lookup
    // before createIssue" idempotency contract.
    const lookupCalls = jira.calls.filter(
      (c) => c.method === 'lookupRemoteIssueLink',
    );
    const createCalls = jira.calls.filter((c) => c.method === 'createIssue');
    expect(lookupCalls).toHaveLength(1);
    expect(createCalls).toHaveLength(0);

    // The mirror returns the existing Jira key + the
    // link-existing operation marker the caller uses to
    // confirm "no second write happened".
    expect(result).toEqual({
      operation: 'link-existing',
      jiraKey: 'PROJ-77',
      externalIssueId: 'paperclip:FORA-402',
      tenantId: TENANT_A,
      firstClaim: true,
    });

    // Audit bar still holds: the spine emitted the
    // FORA-200 §4 closed set on the first claim.
    const eventTypes = audit.events.map((e) => e.event_type);
    expect(eventTypes).toContain('sync.source.issue.ok');
    expect(eventTypes).toContain('sync.target.issue.ok');
    const distinctTypes = new Set<SyncEventType>(eventTypes);
    expect(distinctTypes.size).toBe(6);
  });

  it('outbound replay — the second call returns firstClaim=false and does not re-call createIssue', async () => {
    // First call creates the Jira issue. The shared `deps`
    // (and its `executor`) carry the sync_op row forward.
    jira = new RecordingJiraClient([null]);
    jira.pushCreateResponse({ jiraKey: 'PROJ-101', id: '10042' });
    const first = await mirrorIssueOutbound(BASE_OUTBOUND_EVENT, jira, deps);
    expect(first.firstClaim).toBe(true);
    expect(first.operation).toBe('create');
    expect(first.jiraKey).toBe('PROJ-101');
    expect(executor.size()).toBe(1);

    // Replay: the claim() primitive dedupes on the
    // (tenant, paperclip:FORA-402, issue.create) row. The
    // second call's `lookupRemoteIssueLink` is the
    // best-effort recovery lookup the mirror runs to
    // recover the existing Jira key — a fresh
    // RecordingJiraClient pre-scripted with the same
    // answer production would query.
    const replayJira = new RecordingJiraClient([{ jiraKey: 'PROJ-101' }]);
    const second = await mirrorIssueOutbound(
      BASE_OUTBOUND_EVENT,
      replayJira,
      deps,
    );

    // Replay path: no second create, firstClaim=false.
    expect(second.firstClaim).toBe(false);
    expect(second.operation).toBe('link-existing');
    expect(second.jiraKey).toBe('PROJ-101');

    // No additional sync_op row was created.
    expect(executor.size()).toBe(1);

    // Replays emit zero additional audit events per the
    // FORA-401 contract; the six events the first claim
    // emitted are still the only ones in the audit sink.
    expect(audit.events).toHaveLength(6);
  });
});

describe('mirrorIssueInbound — FORA-200.1 / FORA-402 AC#1', () => {
  let audit: ReturnType<typeof createAuditSink>;
  let executor: FakeExecutor;
  let deps: ClaimDeps;
  let publisher: RecordingSyncPlanePublisher;

  beforeEach(() => {
    audit = createAuditSink();
    executor = new FakeExecutor();
    deps = { executor, audit };
    publisher = new RecordingSyncPlanePublisher();
  });

  it('inbound normalize — Jira jira:issue_created webhook is normalized to sync.issue.created.v1 and published exactly once', async () => {
    const result = await mirrorIssueInbound(
      BASE_INBOUND_INPUT,
      BASE_INBOUND_WEBHOOK,
      publisher,
      deps,
    );

    // The publish call is the contract: one event per inbound
    // webhook (the spine dedupes replays).
    expect(publisher.published).toHaveLength(1);
    const published = publisher.published[0];
    if (!published) throw new Error('expected one published event');

    // ADR-0006 §3.1 subject naming + canonical eventType.
    expect(published.subject).toBe(
      `fora.events.${TENANT_A}.issue.created.v1`,
    );
    expect(published.eventType).toBe('issue.created.v1');

    // Deterministic eventId — the (key, webhookEventId)
    // pair is the dedupe boundary at the resolver.
    expect(published.eventId).toBe(
      'evt-jira-issue-PROJ-101-wh-evt-2026-06-20-001',
    );
    expect(published.tenantId).toBe(TENANT_A);

    // Payload carries the FORA-200 §3 "Boundary contracts" fields.
    const payload = published.payload as Record<string, unknown>;
    expect(payload['paperclip_id']).toBe(ISSUE_ID);
    expect(payload['jira_key']).toBe('PROJ-101');
    expect(payload['jira_issue_id']).toBe('10042');
    expect(payload['jira_summary']).toBe(
      'Mirror of Paperclip issue FORA-402',
    );
    expect(payload['actor']).toBe(ACTOR);
    expect(payload['webhook_event_id']).toBe('wh-evt-2026-06-20-001');

    // The result struct mirrors the published event for the
    // caller's bus-side dedupe + observability.
    expect(result).toEqual({
      eventId: 'evt-jira-issue-PROJ-101-wh-evt-2026-06-20-001',
      subject: `fora.events.${TENANT_A}.issue.created.v1`,
      eventType: 'issue.created.v1',
      jiraKey: 'PROJ-101',
      paperclipIssueId: ISSUE_ID,
      tenantId: TENANT_A,
      firstClaim: true,
    });

    // The two FORA-402-AC audit events are present on the
    // first claim (the spine emits all six, the AC calls
    // out these two).
    const eventTypes = audit.events.map((e) => e.event_type);
    expect(eventTypes).toContain('sync.source.issue.ok');
    expect(eventTypes).toContain('sync.target.issue.ok');
    const distinctTypes = new Set<SyncEventType>(eventTypes);
    expect(distinctTypes.size).toBe(6);
  });

  it('inbound replay — the second call returns firstClaim=false and does not re-publish', async () => {
    // First call publishes one event. The shared `deps`
    // (and its `executor`) carry the sync_op row forward.
    const first = await mirrorIssueInbound(
      BASE_INBOUND_INPUT,
      BASE_INBOUND_WEBHOOK,
      publisher,
      deps,
    );
    expect(first.firstClaim).toBe(true);
    expect(publisher.published).toHaveLength(1);
    expect(executor.size()).toBe(1);

    // Replay: the claim() primitive dedupes on the
    // (tenant, jira:PROJ-101, issue.create) key. A fresh
    // publisher's `published` list stays empty (the second
    // mirror call short-circuits before calling publish()).
    const replayPublisher = new RecordingSyncPlanePublisher();
    const second = await mirrorIssueInbound(
      BASE_INBOUND_INPUT,
      BASE_INBOUND_WEBHOOK,
      replayPublisher,
      deps,
    );
    expect(second.firstClaim).toBe(false);
    expect(second.eventId).toBe(first.eventId);
    expect(replayPublisher.published).toHaveLength(0);

    // No additional sync_op row was created.
    expect(executor.size()).toBe(1);

    // Audit invariant: replay emits zero additional events
    // — the original six are the only ones in the audit sink.
    expect(audit.events).toHaveLength(6);
  });
});

describe('FORA-402 cross-cutting — audit-bar invariants', () => {
  it('both FORA-402 AC audit events appear on the first claim of every code path', async () => {
    const audit = createAuditSink();
    const deps: ClaimDeps = { executor: new FakeExecutor(), audit };

    // Outbound create path.
    const jira = new RecordingJiraClient([null]);
    jira.pushCreateResponse({ jiraKey: 'PROJ-101', id: '10042' });
    await mirrorIssueOutbound(BASE_OUTBOUND_EVENT, jira, deps);

    let eventTypes = audit.events.map((e) => e.event_type);
    expect(eventTypes).toContain('sync.source.issue.ok');
    expect(eventTypes).toContain('sync.target.issue.ok');

    // Reset + inbound path.
    audit.reset();
    const publisher = new RecordingSyncPlanePublisher();
    const inboundDeps: ClaimDeps = {
      executor: new FakeExecutor(),
      audit,
    };
    await mirrorIssueInbound(
      BASE_INBOUND_INPUT,
      BASE_INBOUND_WEBHOOK,
      publisher,
      inboundDeps,
    );

    eventTypes = audit.events.map((e) => e.event_type);
    expect(eventTypes).toContain('sync.source.issue.ok');
    expect(eventTypes).toContain('sync.target.issue.ok');
  });
});
