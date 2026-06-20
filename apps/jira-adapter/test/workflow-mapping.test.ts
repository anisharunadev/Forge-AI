/**
 * FORA-200.3 / FORA-405 — workflow-mapping contract tests.
 *
 * Acceptance bar (FORA-405 description + FORA-200 plan §2 AC#3
 * + §4 verification bar):
 *
 *   1. `resolveJiraTransitionName("approved")` returns the
 *      closed-set default `"Approved"` (CTO-approved per
 *      comment `8abb9965-…`).
 *   2. `resolveJiraTransitionName("in_progress")` returns
 *      `"In Progress"`.
 *   3. `resolveJiraTransitionName("in_review")` returns
 *      `"In Review"`.
 *   4. `resolveJiraTransitionName("done")` returns
 *      `"Done"`.
 *   5. The per-project env var override
 *      (`sync.stage.approved.v1.jira_status`) wins over the
 *      default and returns the overridden value
 *      (`"Shipped"` in this test). The override is read at
 *      resolution time, not at module load — the test mutates
 *      `process.env` mid-run and re-resolves.
 *
 * The 5 cases match the FORA-405 description's "5 cases (one
 * per primary stage + override)" shape: 4 primary-stage
 * resolutions + 1 env-var override. The 5th status
 * (`cancelled`) is covered by the
 * `DEFAULT_STAGE_TRANSITIONS` exhaustive map assertion
 * below — a regression in the table would fail the test.
 *
 * The tests use the same `FakeExecutor` as `idempotency.test.ts`
 * (simulates `INSERT ... ON CONFLICT DO NOTHING`) plus a
 * `RecordingJiraStageClient` and a `RecordingStagePublisher`
 * that capture every call without touching the network. No
 * real Postgres, no real Jira, no real bus.
 *
 * Running:
 *   pnpm --filter @fora/jira-adapter test workflow-mapping
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveJiraTransitionName,
  DEFAULT_STAGE_TRANSITIONS,
  stageOverrideEnvVar,
  PRIMARY_STATUSES,
  mirrorStageOutbound,
  mirrorStageInbound,
  type PaperclipStatus,
  type JiraStageClient,
  type StageSyncPlanePublisher,
  type PaperclipStageEvent,
  type JiraIssueUpdatedWebhook,
  type StageInboundInput,
} from '../src/workflow-mapping.js';
import {
  createAuditSink,
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
const ISSUE_ID = 'FORA-405';
const JIRA_ISSUE_KEY = 'PROJ-301';
const APPROVED_ENV_KEY = stageOverrideEnvVar('approved');
const APPROVED_OVERRIDE_VALUE = 'Shipped';

// ---------------------------------------------------------------------------
// FakeExecutor — replicates the FORA-401 sync_op dedupe primitive.
// ---------------------------------------------------------------------------
//
// Same `INSERT ... ON CONFLICT DO NOTHING` simulation as
// `idempotency.test.ts` and `issue-mirror.test.ts`. Lives here
// as a copy (rather than a shared helper) to keep the four
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
}

// ---------------------------------------------------------------------------
// Recording fakes — capture every call without touching the network.
// ---------------------------------------------------------------------------

interface JiraStageClientCall {
  method: 'transitionIssue';
  args: { issueIdOrKey: string; transitionName: string };
}

class RecordingJiraStageClient implements JiraStageClient {
  readonly calls: JiraStageClientCall[] = [];

  async transitionIssue(args: {
    issueIdOrKey: string;
    transitionName: string;
  }): Promise<{ key: string; status: string }> {
    this.calls.push({ method: 'transitionIssue', args: { ...args } });
    return { key: args.issueIdOrKey, status: args.transitionName };
  }
}

interface PublishedStageEvent {
  eventId: string;
  tenantId: string;
  subject: string;
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

class RecordingStagePublisher implements StageSyncPlanePublisher {
  readonly published: PublishedStageEvent[] = [];

  async publish(event: PublishedStageEvent): Promise<void> {
    this.published.push(event);
  }
}

// ---------------------------------------------------------------------------
// Test suite — `resolveJiraTransitionName` (5 cases: 4 stages + override)
// ---------------------------------------------------------------------------

describe('resolveJiraTransitionName — FORA-200.3 / FORA-405 AC#3', () => {
  // Each test mutates process.env — save + restore around the suite so
  // a side-effect leak (e.g. leaving the override set) does not
  // contaminate sibling test files.
  const originalEnvKey = process.env[APPROVED_ENV_KEY];

  beforeEach(() => {
    delete process.env[APPROVED_ENV_KEY];
  });

  afterEach(() => {
    if (originalEnvKey === undefined) {
      delete process.env[APPROVED_ENV_KEY];
    } else {
      process.env[APPROVED_ENV_KEY] = originalEnvKey;
    }
  });

  // --- Case 1: "approved" → "Approved" (CTO-approved default) ---

  it('case 1: approved resolves to "Approved" (closed-set default)', () => {
    // The CTO-approved default (comment 8abb9965-…). With no
    // env var set and no overrides map, the closed-set
    // DEFAULT_STAGE_TRANSITIONS row wins.
    expect(resolveJiraTransitionName('approved')).toBe('Approved');
  });

  // --- Case 2: "in_progress" → "In Progress" ---

  it('case 2: in_progress resolves to "In Progress" (default)', () => {
    // The most common transition. With no env var and no
    // overrides, the default row wins.
    expect(resolveJiraTransitionName('in_progress')).toBe('In Progress');
  });

  // --- Case 3: "in_review" → "In Review" ---

  it('case 3: in_review resolves to "In Review" (default)', () => {
    // Distinct from "in_progress". The Paperclip "in_review"
    // state is the human review gate; Jira's "In Review" is
    // the matching transition in the default Jira Software
    // workflow.
    expect(resolveJiraTransitionName('in_review')).toBe('In Review');
  });

  // --- Case 4: "done" → "Done" ---

  it('case 4: done resolves to "Done" (terminal default)', () => {
    // The terminal state. The adapter drives this transition
    // when Paperclip side transitions to "done".
    expect(resolveJiraTransitionName('done')).toBe('Done');
  });

  // --- Case 5: env var override wins over default ---

  it('case 5: sync.stage.approved.v1.jira_status env var overrides the default', () => {
    // CTO-approved per-project override convention (comment
    // 8abb9965-…). Set the env var to "Shipped" — a real
    // customer that uses "Shipped" instead of "Approved" as
    // the post-review transition name. The resolution
    // returns "Shipped", NOT the closed-set default
    // "Approved".
    process.env[APPROVED_ENV_KEY] = APPROVED_OVERRIDE_VALUE;
    expect(resolveJiraTransitionName('approved')).toBe(
      APPROVED_OVERRIDE_VALUE,
    );

    // The override is per-status — confirming `in_progress`
    // is unaffected proves the lookup is keyed on the env
    // var name, not a process-wide flag.
    expect(resolveJiraTransitionName('in_progress')).toBe('In Progress');
  });
});

// ---------------------------------------------------------------------------
// Test suite — exhaustive DEFAULT_STAGE_TRANSITIONS coverage
// ---------------------------------------------------------------------------
//
// The 5-case suite above is the FORA-405 AC. This additional
// suite asserts the `cancelled` row + the closed-union invariant:
// every `PaperclipStatus` value maps to a non-empty string. A
// future enum widening that forgets a row fails this test loud
// at the CI level.

describe('DEFAULT_STAGE_TRANSITIONS — closed-set invariant', () => {
  it('every primary status has a non-empty Jira transition name', () => {
    for (const status of PRIMARY_STATUSES) {
      const name = DEFAULT_STAGE_TRANSITIONS[status];
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('PRIMARY_STATUSES is the canonical 6-stage set', () => {
    expect(PRIMARY_STATUSES).toHaveLength(6);
    expect([...PRIMARY_STATUSES].sort()).toEqual(
      ['approved', 'blocked', 'cancelled', 'done', 'in_progress', 'in_review']
        .sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Test suite — mirrorStageOutbound (idempotency + audit integration)
// ---------------------------------------------------------------------------
//
// The AC says "5 mapping tests green" — cases 1-5 above cover
// the resolver. This suite proves the resolver is wired into
// the outbound mirror's transitionName argument and the
// idempotency spine emits the two FORA-405 AC audit events
// (`sync.source.stage.ok` + `sync.target.stage.ok`) on the
// first claim. Same shape as FORA-402's outbound suite.

describe('mirrorStageOutbound — FORA-200.3 / FORA-405 integration', () => {
  let audit: ReturnType<typeof createAuditSink>;
  let executor: FakeExecutor;
  let deps: ClaimDeps;
  let jira: RecordingJiraStageClient;

  beforeEach(() => {
    audit = createAuditSink();
    executor = new FakeExecutor();
    deps = { executor, audit };
    jira = new RecordingJiraStageClient();
    // Defensive: clear the env var in case a sibling test set it.
    delete process.env[APPROVED_ENV_KEY];
  });

  it('outbound first-claim: calls transitionIssue with the resolved name and emits stage.ok audit', async () => {
    const event: PaperclipStageEvent = {
      tenantId: TENANT_A,
      issueId: ISSUE_ID,
      jiraIssueKey: JIRA_ISSUE_KEY,
      from: 'in_review',
      to: 'approved',
      actor: ACTOR,
    };

    const result = await mirrorStageOutbound(event, jira, deps);

    // The mirror drives the resolved name through the
    // broker seam. "approved" → "Approved" (default,
    // closed-set, per CTO convention).
    expect(jira.calls).toHaveLength(1);
    expect(jira.calls[0]?.method).toBe('transitionIssue');
    expect(jira.calls[0]?.args).toEqual({
      issueIdOrKey: JIRA_ISSUE_KEY,
      transitionName: 'Approved',
    });

    // The deterministic external id follows the
    // `paperclip:<issueId>:<from>-><to>` contract.
    expect(result).toEqual({
      transitionName: 'Approved',
      jiraIssueKey: JIRA_ISSUE_KEY,
      externalStageId: 'paperclip:FORA-405:in_review->approved',
      tenantId: TENANT_A,
      firstClaim: true,
    });

    // The two FORA-405 AC audit events are present on the
    // first claim. The full six-event closed set is emitted
    // by the FORA-401 spine (per audit.ts).
    const eventTypes = audit.events.map((e) => e.event_type);
    expect(eventTypes).toContain('sync.source.stage.ok');
    expect(eventTypes).toContain('sync.target.stage.ok');
    const distinctTypes = new Set<SyncEventType>(eventTypes);
    expect(distinctTypes.size).toBe(6);

    // The audit row carries the transition name in metadata
    // — the FORA-200 §3 audit bar requires the operator can
    // trace which Jira transition ran.
    const sourceStageEvent = audit.events.find(
      (e) => e.event_type === 'sync.source.stage.ok',
    );
    expect(sourceStageEvent?.metadata).toMatchObject({
      from: 'in_review',
      to: 'approved',
      transition_name: 'Approved',
      jira_issue_key: JIRA_ISSUE_KEY,
    });
  });

  it('outbound replay: second call with the same key returns firstClaim:false and does NOT re-call transitionIssue', async () => {
    const event: PaperclipStageEvent = {
      tenantId: TENANT_A,
      issueId: ISSUE_ID,
      jiraIssueKey: JIRA_ISSUE_KEY,
      from: 'in_progress',
      to: 'in_review',
      actor: ACTOR,
    };

    // First call — claim succeeds, transition runs, full
    // audit emission.
    const first = await mirrorStageOutbound(event, jira, deps);
    expect(first.firstClaim).toBe(true);
    expect(jira.calls).toHaveLength(1);

    // Second call — same key, claim fails, no second
    // transition, no additional audit rows.
    const second = await mirrorStageOutbound(event, jira, deps);
    expect(second.firstClaim).toBe(false);
    expect(jira.calls).toHaveLength(1);
    expect(audit.events).toHaveLength(6); // unchanged from the first claim
  });
});

// ---------------------------------------------------------------------------
// Test suite — mirrorStageInbound (Jira webhook → canonical event)
// ---------------------------------------------------------------------------
//
// The inbound half of AC#3: a Jira `jira:issue_updated` webhook
// with a `Status` change in its changelog is normalized to a
// canonical `sync.stage.transitioned.v1` event and published
// once. Webhooks without a `Status` change return null (the
// caller dispatches to the appropriate sibling mirror).

describe('mirrorStageInbound — FORA-200.3 / FORA-405 AC#3 inbound', () => {
  let audit: ReturnType<typeof createAuditSink>;
  let executor: FakeExecutor;
  let deps: ClaimDeps;
  let publisher: RecordingStagePublisher;

  beforeEach(() => {
    audit = createAuditSink();
    executor = new FakeExecutor();
    deps = { executor, audit };
    publisher = new RecordingStagePublisher();
  });

  it('inbound: a Status change in the changelog is published as sync.stage.transitioned.v1', async () => {
    const input: StageInboundInput = {
      tenantId: TENANT_A,
      paperclipIssueId: ISSUE_ID,
      actor: ACTOR,
    };
    const webhook: JiraIssueUpdatedWebhook = {
      webhookEventId: 'wh-evt-2026-06-20-stage-001',
      issue: {
        id: '10043',
        key: JIRA_ISSUE_KEY,
        fields: {
          status: 'In Review',
        },
      },
      changelog: [
        { field: 'Status', fromString: 'In Progress', toString: 'In Review' },
      ],
    };

    const result = await mirrorStageInbound(input, webhook, publisher, deps);

    // The mirror picks the LAST Status change (the only one
    // in this fixture) and surfaces the from/to pair.
    expect(result).not.toBeNull();
    expect(result?.eventType).toBe('stage.transitioned.v1');
    expect(result?.fromStatus).toBe('In Progress');
    expect(result?.toStatus).toBe('In Review');
    expect(result?.jiraKey).toBe(JIRA_ISSUE_KEY);
    expect(result?.paperclipIssueId).toBe(ISSUE_ID);
    expect(result?.firstClaim).toBe(true);

    // The canonical event is published exactly once with
    // the deterministic eventId per FORA-401.
    expect(publisher.published).toHaveLength(1);
    const published = publisher.published[0]!;
    expect(published.eventType).toBe('stage.transitioned.v1');
    expect(published.subject).toBe(
      `fora.events.${TENANT_A}.stage.transitioned.v1`,
    );
    expect(published.eventId).toBe(
      `evt-jira-stage-${JIRA_ISSUE_KEY}-wh-evt-2026-06-20-stage-001`,
    );
    expect(published.payload).toMatchObject({
      paperclip_id: ISSUE_ID,
      jira_key: JIRA_ISSUE_KEY,
      from_status: 'In Progress',
      to_status: 'In Review',
      actor: ACTOR,
    });

    // The two FORA-405 AC audit events are present on the
    // first claim.
    const eventTypes = audit.events.map((e) => e.event_type);
    expect(eventTypes).toContain('sync.source.stage.ok');
    expect(eventTypes).toContain('sync.target.stage.ok');
  });

  it('inbound: a webhook WITHOUT a Status change returns null (caller dispatches to sibling mirror)', async () => {
    const input: StageInboundInput = {
      tenantId: TENANT_A,
      paperclipIssueId: ISSUE_ID,
      actor: ACTOR,
    };
    const webhook: JiraIssueUpdatedWebhook = {
      webhookEventId: 'wh-evt-2026-06-20-stage-002',
      issue: {
        id: '10043',
        key: JIRA_ISSUE_KEY,
        fields: { status: 'In Progress' },
      },
      // No Status change — this is an `assignee` change, a
      // `labels` change, etc. The FORA-405 mirror is
      // specifically for status transitions; the caller
      // routes the webhook to the appropriate sibling
      // (FORA-402 for issue.update, FORA-404 for comments).
      changelog: [
        { field: 'assignee', fromString: 'old-acct', toString: 'new-acct' },
      ],
    };

    const result = await mirrorStageInbound(input, webhook, publisher, deps);

    expect(result).toBeNull();
    expect(publisher.published).toHaveLength(0);
    // No claim was taken — the executor's sync_op table is
    // empty (the FORA-405 AC only emits audit events on a
    // real claim; non-transition webhooks do not claim).
    expect(executor.size()).toBe(0);
  });

  it('inbound replay: redelivered webhook for the same Jira key short-circuits with firstClaim:false', async () => {
    const input: StageInboundInput = {
      tenantId: TENANT_A,
      paperclipIssueId: ISSUE_ID,
      actor: ACTOR,
    };
    const webhook: JiraIssueUpdatedWebhook = {
      webhookEventId: 'wh-evt-2026-06-20-stage-003',
      issue: {
        id: '10043',
        key: JIRA_ISSUE_KEY,
        fields: { status: 'Done' },
      },
      changelog: [
        { field: 'Status', fromString: 'In Review', toString: 'Done' },
      ],
    };

    const first = await mirrorStageInbound(input, webhook, publisher, deps);
    expect(first?.firstClaim).toBe(true);
    expect(publisher.published).toHaveLength(1);

    // Same key — replay. The FORA-401 spine short-circuits,
    // the publisher is NOT called a second time, and no new
    // audit rows are emitted.
    const second = await mirrorStageInbound(input, webhook, publisher, deps);
    expect(second?.firstClaim).toBe(false);
    expect(publisher.published).toHaveLength(1);
    expect(audit.events).toHaveLength(6); // unchanged from the first claim
  });
});
