/**
 * FORA-200.4 / FORA-406 — nightly divergence sweep tests.
 *
 * Acceptance bar (FORA-406 description + FORA-200 plan §2 AC#4):
 *
 *   1. Status mismatch surfaces a `Mismatch` row with
 *      `field: 'status'`.
 *   2. Comment mismatch surfaces `Mismatch` rows with
 *      `field: 'comment'` for each orphan id.
 *   3. Agreement-baseline: a mirror state where every entity
 *      agrees on every field produces an empty `mismatches`
 *      list and the `scannedEntities` counter reflects the
 *      scanned volume.
 *   4. Idempotent re-run: two consecutive `runNightlySweep`
 *      calls with the same `MirrorState` + the same clock
 *      produce identical reports (deep-equal), and each call
 *      writes exactly one artefact file.
 *
 * Plus a dedicated cron-registration suite that asserts the
 * descriptor shape (`schedule`, `owner`, `idempotent`,
 * `audit_event_type`) and the `POST /routines` call is made
 * via the seam — closes the "Routine registered and visible
 * in `GET /routines`" AC the FORA-406 description names.
 *
 * The seam is `MirrorState` (an in-memory fake) +
 * `PaperclipRoutinesClient` (a recording fake) + a temp
 * `auditDir` (mkdtempSync, cleaned up in `afterEach`). No
 * real Postgres, no real Jira, no real bus — same shape as
 * the FORA-401/402/404/405 test files.
 *
 * Running:
 *   pnpm --filter @fora/jira-adapter test divergence-cron
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runNightlySweep,
  compareMirrorEntity,
  diffCommentIds,
  buildCronRegistration,
  applyCronRegistration,
  serialiseReport,
  buildReportPath,
  writeReport,
  DIVERGENCE_CRON_SCHEDULE,
  DIVERGENCE_CRON_OWNER,
  DIVERGENCE_AUDIT_EVENT_TYPE,
  type MirrorEntity,
  type MirrorState,
  type PaperclipRoutinesClient,
  type DivergenceReport,
  type Mismatch,
} from '../src/divergence-cron.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_SLUG = 'dogfood';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

// A fixed clock so the idempotency test (case 4) can
// assert deep-equal reports AND a deterministic artefact path.
const FIXED_CLOCK = (): Date => new Date('2026-06-20T02:00:00.000Z');

// ---------------------------------------------------------------------------
// In-memory fakes — MirrorState + PaperclipRoutinesClient
// ---------------------------------------------------------------------------

/**
 * `MirrorState` fake — captures the requested tenant id and
 * returns the configured entity list. `listEntities()` is
 * intentionally sync (returns the list directly) so the
 * detector's `await` covers both sync and async seam
 * implementations; the FORA-406 AC does not require async.
 */
class FakeMirrorState implements MirrorState {
  /** tenantId → entity list */
  private readonly byTenant = new Map<string, MirrorEntity[]>();

  set(tenantId: string, entities: readonly MirrorEntity[]): void {
    this.byTenant.set(tenantId, [...entities]);
  }

  listEntities(tenantId: string): readonly MirrorEntity[] {
    return this.byTenant.get(tenantId) ?? [];
  }
}

/**
 * `PaperclipRoutinesClient` fake — captures every
 * `registerRoutine` call. Mirrors the test seam shape from
 * `workflow-mapping.test.ts` so the orchestrator's
 * `GET /routines` history assertion is a `expect(client.calls[0])`
 * away.
 */
class FakeRoutinesClient implements PaperclipRoutinesClient {
  readonly calls: Array<{ input: ReturnType<typeof buildCronRegistration>; result: { id: string; created_at: string } }> = [];
  private nextId = 1;

  async registerRoutine(
    input: ReturnType<typeof buildCronRegistration>,
  ): Promise<{ id: string; created_at: string }> {
    const result = {
      id: `routine_${this.nextId++}`,
      created_at: new Date('2026-06-20T02:00:01.000Z').toISOString(),
    };
    this.calls.push({ input, result });
    return result;
  }

  async listRoutines(): Promise<readonly { id: string; name: string; schedule: string }[]> {
    return this.calls.map((c) => ({ id: c.result.id, name: c.input.name, schedule: c.input.schedule }));
  }
}

/**
 * `logger` fake — captures every `log()` call. The detector
 * wires `logger.log(...)` for the one-line JSON summary; the
 * tests assert the call shape without contaminating vitest's
 * stdout.
 */
class FakeLogger {
  readonly lines: string[] = [];
  log(line: string): void {
    this.lines.push(line);
  }
}

// ---------------------------------------------------------------------------
// Test fixtures — entities
// ---------------------------------------------------------------------------

/**
 * Entity where Paperclip and Jira disagree on status. The
 * canonical Paperclip side says `done`; the last-observed Jira
 * side says `In Progress`. This is the FORA-406 case 1 fixture.
 */
const STATUS_MISMATCH_ENTITY: MirrorEntity = {
  externalIssueId: 'PROJ-401',
  paperclipStatus: 'done',
  jiraStatus: 'In Progress',
  paperclipCommentIds: [],
  jiraCommentIds: [],
  lastSyncedAt: '2026-06-19T23:00:00.000Z',
};

/**
 * Entity where Paperclip and Jira disagree on comments. The
 * Paperclip side has `cmt_a1` and `cmt_a2`; the Jira side has
 * `cmt_a2` and `cmt_a3`. The symmetric difference is
 * `{onlyPaperclip: [cmt_a1], onlyJira: [cmt_a3]}` — the
 * detector surfaces both as `field: 'comment'` rows. This is
 * the FORA-406 case 2 fixture.
 *
 * Note: the status strings are intentionally the SAME
 * (`'in_progress'` on both sides) so this fixture isolates
 * the comment-comparator branch. The comparator does strict
 * string equality on status — a Jira display-name like `In
 * Progress` is the FORA-405 mapper's concern, not the cron
 * detector's.
 */
const COMMENT_MISMATCH_ENTITY: MirrorEntity = {
  externalIssueId: 'PROJ-402',
  paperclipStatus: 'in_progress',
  jiraStatus: 'in_progress',
  paperclipCommentIds: ['cmt_a1', 'cmt_a2'],
  jiraCommentIds: ['cmt_a2', 'cmt_a3'],
  lastSyncedAt: '2026-06-19T23:30:00.000Z',
};

/**
 * Entity where Paperclip and Jira fully agree. Status strings
 * match exactly (`'in_review'` on both sides), comments match
 * exactly. This is the FORA-406 case 3 fixture (the
 * "agreement-baseline" branch of the comparator).
 */
const AGREEMENT_ENTITY: MirrorEntity = {
  externalIssueId: 'PROJ-403',
  paperclipStatus: 'in_review',
  jiraStatus: 'in_review',
  paperclipCommentIds: ['cmt_b1'],
  jiraCommentIds: ['cmt_b1'],
  lastSyncedAt: '2026-06-19T23:45:00.000Z',
};

// ---------------------------------------------------------------------------
// Test suite — case 1: status mismatch
// ---------------------------------------------------------------------------

describe('compareMirrorEntity — case 1: status mismatch', () => {
  it('surfaces a status Mismatch when paperclipStatus !== jiraStatus (both non-null)', () => {
    const mismatches = compareMirrorEntity(STATUS_MISMATCH_ENTITY);
    expect(mismatches).toHaveLength(1);
    const m = mismatches[0]!;
    expect(m.field).toBe('status');
    expect(m.externalIssueId).toBe('PROJ-401');
    expect(m.paperclipValue).toBe('done');
    expect(m.jiraValue).toBe('In Progress');
    expect(m.lastSyncedAt).toBe('2026-06-19T23:00:00.000Z');
  });

  it('a null jiraStatus does NOT count as a mismatch (cold-start)', () => {
    // Cold-start window: a brand-new Paperclip issue that has
    // not yet been observed on the Jira side. The detector
    // MUST NOT report a status disagreement — that would
    // page the operator on the happy path.
    const entity: MirrorEntity = {
      ...STATUS_MISMATCH_ENTITY,
      jiraStatus: null,
    };
    expect(compareMirrorEntity(entity)).toEqual([]);
  });

  it('a null paperclipStatus does NOT count as a mismatch (cold-start)', () => {
    // The inverse cold-start: a Jira-only entity the
    // Paperclip side has not yet observed. Same rule.
    const entity: MirrorEntity = {
      ...STATUS_MISMATCH_ENTITY,
      paperclipStatus: null,
    };
    expect(compareMirrorEntity(entity)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test suite — case 2: comment mismatch
// ---------------------------------------------------------------------------

describe('compareMirrorEntity — case 2: comment mismatch', () => {
  it('surfaces both directions of the symmetric difference', () => {
    const mismatches = compareMirrorEntity(COMMENT_MISMATCH_ENTITY);
    expect(mismatches).toHaveLength(2);

    const onlyPaperclip = mismatches.find(
      (m) => m.paperclipValue === 'cmt_a1',
    );
    expect(onlyPaperclip).toBeDefined();
    expect(onlyPaperclip?.field).toBe('comment');
    expect(onlyPaperclip?.jiraValue).toBe('');
    expect(onlyPaperclip?.externalIssueId).toBe('PROJ-402');

    const onlyJira = mismatches.find(
      (m) => m.jiraValue === 'cmt_a3',
    );
    expect(onlyJira).toBeDefined();
    expect(onlyJira?.field).toBe('comment');
    expect(onlyJira?.paperclipValue).toBe('');
    expect(onlyJira?.externalIssueId).toBe('PROJ-402');
  });

  it('an exact comment-id set produces zero comment mismatches', () => {
    const mismatches = compareMirrorEntity({
      ...AGREEMENT_ENTITY,
      paperclipCommentIds: ['cmt_b1', 'cmt_b2'],
      jiraCommentIds: ['cmt_b1', 'cmt_b2'],
    });
    expect(mismatches).toEqual([]);
  });

  it('diffCommentIds is the comparator building block (pure function, unit-testable)', () => {
    const diff = diffCommentIds(['cmt_a1', 'cmt_a2'], ['cmt_a2', 'cmt_a3']);
    expect(diff.onlyPaperclip).toEqual(['cmt_a1']);
    expect(diff.onlyJira).toEqual(['cmt_a3']);
  });
});

// ---------------------------------------------------------------------------
// Test suite — case 3: agreement-baseline
// ---------------------------------------------------------------------------

describe('runNightlySweep — case 3: agreement-baseline', () => {
  let auditDir: string;
  let logger: FakeLogger;

  beforeEach(() => {
    auditDir = mkdtempSync(join(tmpdir(), 'divergence-baseline-'));
    logger = new FakeLogger();
  });

  afterEach(() => {
    if (existsSync(auditDir)) rmSync(auditDir, { recursive: true, force: true });
  });

  it('returns an empty mismatches list when every entity agrees on every field', async () => {
    const mirror = new FakeMirrorState();
    // Two fully-agreeing entities + one with status disagreement
    // — the agreement-baseline is the "no disagreement at all"
    // case the FORA-406 description names.
    mirror.set(TENANT_A, [AGREEMENT_ENTITY, { ...AGREEMENT_ENTITY, externalIssueId: 'PROJ-404' }]);

    const report = await runNightlySweep({
      tenantId: TENANT_A,
      mirror,
      clock: FIXED_CLOCK,
      auditDir,
      logToStdout: true,
      logger,
    });

    expect(report.tenantId).toBe(TENANT_A);
    expect(report.scannedAt).toBe('2026-06-20T02:00:00.000Z');
    expect(report.scannedEntities).toBe(2);
    expect(report.mismatches).toEqual([]);
    expect(report.mismatchCounts).toEqual({ status: 0, comment: 0 });

    // The artefact was written exactly once with the empty
    // mismatches list.
    const files = readdirSync(auditDir);
    expect(files).toHaveLength(1);
    const onDisk = JSON.parse(readFileSync(join(auditDir, files[0]!), 'utf-8'));
    expect(onDisk.mismatches).toEqual([]);
    expect(onDisk.scannedEntities).toBe(2);
  });

  it('returns a non-error report for an empty mirror (dogfood tenant cold-start AC)', async () => {
    // The FORA-406 acceptance bar: "Manual cron tick against
    // dogfood tenant returns a non-error report even when no
    // mismatches." The dogfood tenant on day-one has no
    // synced entities; the detector must return a clean
    // report, not throw.
    const mirror = new FakeMirrorState();
    mirror.set(TENANT_SLUG, []);

    const report = await runNightlySweep({
      tenantId: TENANT_SLUG,
      mirror,
      clock: FIXED_CLOCK,
      auditDir,
      logToStdout: true,
      logger,
    });

    expect(report.tenantId).toBe(TENANT_SLUG);
    expect(report.scannedEntities).toBe(0);
    expect(report.mismatches).toEqual([]);
    expect(report.mismatchCounts).toEqual({ status: 0, comment: 0 });

    // Stdout summary is still emitted on the cold-start path
    // so the orchestrator's log scraper sees the run.
    expect(logger.lines).toHaveLength(1);
    const summary = JSON.parse(logger.lines[0]!);
    expect(summary.event_type).toBe(DIVERGENCE_AUDIT_EVENT_TYPE);
    expect(summary.tenant_id).toBe(TENANT_SLUG);
    expect(summary.scanned_entities).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test suite — case 4: idempotent re-run
// ---------------------------------------------------------------------------

describe('runNightlySweep — case 4: idempotent re-run', () => {
  let auditDir: string;
  let logger: FakeLogger;

  beforeEach(() => {
    auditDir = mkdtempSync(join(tmpdir(), 'divergence-idempotent-'));
    logger = new FakeLogger();
  });

  afterEach(() => {
    if (existsSync(auditDir)) rmSync(auditDir, { recursive: true, force: true });
  });

  it('two consecutive runs with the same input produce deep-equal reports AND a single artefact file', async () => {
    const mirror = new FakeMirrorState();
    mirror.set(TENANT_A, [
      STATUS_MISMATCH_ENTITY,
      COMMENT_MISMATCH_ENTITY,
      AGREEMENT_ENTITY,
    ]);

    const first = await runNightlySweep({
      tenantId: TENANT_A,
      mirror,
      clock: FIXED_CLOCK,
      auditDir,
      logToStdout: true,
      logger,
    });

    const second = await runNightlySweep({
      tenantId: TENANT_A,
      mirror,
      clock: FIXED_CLOCK,
      auditDir,
      logToStdout: true,
      logger,
    });

    // Deep-equal: every field matches — `scannedAt`,
    // `scannedEntities`, the mismatches array, and the
    // counts. Two runs with the same mirror snapshot + same
    // clock MUST agree.
    expect(second).toEqual(first);
    expect(second.mismatches).toHaveLength(3);
    expect(second.mismatchCounts).toEqual({ status: 1, comment: 2 });

    // Single artefact file: the deterministic
    // `divergence_<tenantId>_<scannedAtCompact>.json` path
    // is the same for both runs, so the second write
    // overwrites the first rather than accumulating.
    const files = readdirSync(auditDir);
    expect(files).toHaveLength(1);

    // The on-disk artefact matches the in-memory report
    // exactly — round-trip stable, no hidden envelope.
    const onDisk = JSON.parse(readFileSync(join(auditDir, files[0]!), 'utf-8'));
    expect(onDisk).toEqual(first);
  });

  it('the artefact path embeds the tenant id + the compact UTC stamp', () => {
    const path = buildReportPath(TENANT_SLUG, new Date('2026-06-20T02:00:00.000Z'));
    // Stable: divergence_<tenantId>_<15-digit compact UTC>.json.
    // Matches the `nightly_cron.ts` Python wrapper's stamp
    // shape (`replace(/[^0-9]/g, '').slice(0, 15)`) so the
    // orchestrator's file-rotation rule is consistent across
    // the per-adapter + sync-plane crons.
    expect(path).toBe('divergence_dogfood_202606200200000.json');
  });

  it('serialiseReport is a stable JSON representation (no hidden envelope)', () => {
    const report: DivergenceReport = {
      tenantId: TENANT_A,
      scannedAt: '2026-06-20T02:00:00.000Z',
      mismatches: [],
      scannedEntities: 0,
      mismatchCounts: { status: 0, comment: 0 },
    };
    const json = serialiseReport(report);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(report);
    // No envelope key — the close-gate reviewer can `jq .mismatches`
    // the file directly.
    expect(Object.keys(parsed).sort()).toEqual([
      'mismatchCounts',
      'mismatches',
      'scannedAt',
      'scannedEntities',
      'tenantId',
    ]);
  });

  it('writeReport overwrites an existing file at the same path (idempotent re-run on disk)', async () => {
    const mirror = new FakeMirrorState();
    mirror.set(TENANT_A, [STATUS_MISMATCH_ENTITY]);

    const first = await runNightlySweep({
      tenantId: TENANT_A,
      mirror,
      clock: FIXED_CLOCK,
      auditDir,
      logToStdout: false,
      logger,
    });
    const second = await runNightlySweep({
      tenantId: TENANT_A,
      mirror,
      clock: FIXED_CLOCK,
      auditDir,
      logToStdout: false,
      logger,
    });

    // Same report, same path.
    expect(second).toEqual(first);
    expect(readdirSync(auditDir)).toHaveLength(1);

    // writeReport is also exposed for direct unit coverage;
    // calling it twice with the same report produces the
    // same path and the same content.
    const pathA = writeReport(first, auditDir);
    const pathB = writeReport(first, auditDir);
    expect(pathA).toBe(pathB);
    expect(readFileSync(pathA, 'utf-8')).toBe(readFileSync(pathB, 'utf-8'));
  });
});

// ---------------------------------------------------------------------------
// Test suite — multi-entity aggregation
// ---------------------------------------------------------------------------

describe('runNightlySweep — aggregation across multiple entities', () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = mkdtempSync(join(tmpdir(), 'divergence-aggregate-'));
  });

  afterEach(() => {
    if (existsSync(auditDir)) rmSync(auditDir, { recursive: true, force: true });
  });

  it('aggregates per-field counts across entities and isolates tenants', async () => {
    const mirror = new FakeMirrorState();
    mirror.set(TENANT_A, [
      STATUS_MISMATCH_ENTITY,
      COMMENT_MISMATCH_ENTITY,
      AGREEMENT_ENTITY,
    ]);
    // Tenant B is unrelated to the scan; the detector MUST
    // NOT pull its entities (per-tenant isolation).
    mirror.set(TENANT_B, [STATUS_MISMATCH_ENTITY]);

    const report = await runNightlySweep({
      tenantId: TENANT_A,
      mirror,
      clock: FIXED_CLOCK,
      auditDir,
      logToStdout: false,
      logger: new FakeLogger(),
    });

    expect(report.scannedEntities).toBe(3);
    // status mismatch (1) + comment mismatch on PROJ-402 (2 rows: onlyPaperclip + onlyJira)
    expect(report.mismatches).toHaveLength(3);
    expect(report.mismatchCounts).toEqual({ status: 1, comment: 2 });

    // Every mismatch carries the tenant's id and the
    // correct external issue id — no cross-tenant leak.
    const mismatchIssueIds = report.mismatches.map((m) => m.externalIssueId).sort();
    expect(mismatchIssueIds).toEqual(['PROJ-401', 'PROJ-402', 'PROJ-402']);

    // Per-tenant isolation: PROJ-401 (tenant B's entity) is
    // NOT in the mismatches list.
    expect(report.mismatches.some((m: Mismatch) => m.externalIssueId === 'PROJ-401')).toBe(true);
    // The detector did NOT include tenant B's status
    // mismatch — there's only ONE status mismatch row, and
    // it carries tenant A's PROJ-401 id (not a duplicate).
    const statusRows = report.mismatches.filter((m) => m.field === 'status');
    expect(statusRows).toHaveLength(1);
    expect(statusRows[0]!.externalIssueId).toBe('PROJ-401');
  });
});

// ---------------------------------------------------------------------------
// Test suite — cron registration (FORA-200 §4 "One operational routine")
// ---------------------------------------------------------------------------

describe('cron registration — FORA-200 §4 / FORA-406 routine', () => {
  it('buildCronRegistration returns the canonical descriptor', () => {
    const reg = buildCronRegistration();
    expect(reg.name).toBe('sync.divergence.nightly');
    expect(reg.schedule).toBe(DIVERGENCE_CRON_SCHEDULE);
    expect(DIVERGENCE_CRON_SCHEDULE).toBe('0 2 * * *');
    expect(reg.owner).toBe(DIVERGENCE_CRON_OWNER);
    expect(DIVERGENCE_CRON_OWNER).toBe('integration-engineer');
    expect(reg.idempotent).toBe(true);
    expect(reg.audit_event_type).toBe(DIVERGENCE_AUDIT_EVENT_TYPE);
    expect(reg.audit_event_type).toBe('sync.divergence.sweep_completed');
    // The command wires through the workspace filter; the
    // `${tenantSlug}` placeholder is the orchestrator's job
    // to substitute at install time.
    expect(reg.command).toEqual([
      'pnpm',
      '--filter',
      '@fora/jira-adapter',
      'run',
      'sweep',
      '--',
      '${tenantSlug}',
    ]);
  });

  it('applyCronRegistration POSTs the descriptor to the routines seam (idempotent)', async () => {
    const client = new FakeRoutinesClient();
    const result = await applyCronRegistration(client);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.input).toEqual(buildCronRegistration());
    expect(result.id).toBe('routine_1');
    expect(result.created_at).toBe('2026-06-20T02:00:01.000Z');
  });

  it('runNightlySweep surfaces the sweep completion via the routines seam', async () => {
    // The detector's per-run heartbeat calls
    // `registerRoutine(buildCronRegistration())` so the
    // orchestrator's `GET /routines` history shows the
    // latest sweep. This is separate from the install-time
    // `applyCronRegistration()` call above.
    const auditDir = mkdtempSync(join(tmpdir(), 'divergence-routines-'));
    try {
      const mirror = new FakeMirrorState();
      mirror.set(TENANT_A, [AGREEMENT_ENTITY]);
      const routines = new FakeRoutinesClient();

      await runNightlySweep({
        tenantId: TENANT_A,
        mirror,
        clock: FIXED_CLOCK,
        auditDir,
        logToStdout: false,
        logger: new FakeLogger(),
        routines,
      });

      expect(routines.calls).toHaveLength(1);
      const registered = routines.calls[0]!.input;
      expect(registered.name).toBe('sync.divergence.nightly');
      expect(registered.schedule).toBe('0 2 * * *');
      expect(registered.owner).toBe('integration-engineer');
      expect(registered.idempotent).toBe(true);
    } finally {
      if (existsSync(auditDir)) rmSync(auditDir, { recursive: true, force: true });
    }
  });
});