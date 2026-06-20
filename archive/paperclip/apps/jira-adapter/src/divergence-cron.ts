/**
 * FORA-200.4 / FORA-406 — nightly divergence detector.
 *
 * Implements the FORA-200 plan §2 AC#4 "Nightly cron over the
 * DivergenceQueue" vertical slice for the Paperclip ↔ Jira
 * adapter. The cron walks the sync state per tenant, compares
 * the canonical Paperclip side against the last-observed Jira
 * side on every synced entity, and emits a `DivergenceReport`
 * describing the disagreements.
 *
 * Scope (v0.1 per FORA-200 plan §2 AC#4):
 *
 *   - Compares `status` (paperclip.status vs jira.mirror_state).
 *   - Compares the comment-id set (paperclip.comments ⊕ jira.comments).
 *   - Emits the report to `stdout` AND writes a stable JSON
 *     artefact to the configured `auditDir`. No Slack / email
 *     fanout (deferred to v0.2 per the deliverable spec).
 *   - The detector is **read-only** — it never writes to Jira,
 *     Paperclip, or the sync spine. Recovery is the operator's
 *     job (the FORA-265 workbench is the surface they use).
 *
 * Out of scope (per the FORA-200 §2 AC#4 acceptance bar):
 *
 *   - Schema divergence (ADR-0010 §7.2 #1) — not in v0.1; the
 *     adapter's day-one field set is the closed Jira Software
 *     default, so schema drift is an explicit v0.2 follow-up.
 *   - Audit divergence (ADR-0010 §7.2 #4, R-SYNC-05) — owned by
 *     the cross-platform Sync Plane service (FORA-204), not the
 *     per-adapter cron. The detector does NOT page on P0; a
 *     silent re-run is the desired behaviour.
 *   - Attachment sync (FORA-200.6 / FORA-407 sibling).
 *   - GitHub Issues / ClickUp mirrors.
 *
 * Idempotency: the detector is a pure function of the
 * `MirrorState` seam + the clock. Two runs with the same
 * mirror snapshot + the same `scannedAt` produce identical
 * reports (same `tenantId`, same `scannedAt`, same `mismatches`,
 * same `scannedEntities`). The artefact path
 * `divergence_<tenantId>_<scannedAtCompact>.json` is therefore
 * deterministic for a given clock; the file is overwritten on
 * re-run rather than accumulating stale copies. This matches
 * the FORA-406 acceptance bar "idempotent re-run".
 *
 * Operational routine (per FORA-200 plan §4 "One operational
 * routine"):
 *
 *   - Schedule:  `0 2 * * *` UTC (low-traffic window).
 *   - Owner:     `integration-engineer`.
 *   - Command:   `pnpm --filter @fora/jira-adapter run sweep -- <tenantSlug>`.
 *   - Audit:     every run emits a `sync.divergence.sweep_completed`
 *                row via the `PaperclipRoutinesClient` so the
 *                close-gate reviewer can `GET /routines` and see
 *                the registered cron plus its run history.
 *
 * The seam (`MirrorState`) is intentionally narrow — a single
 * `listEntities(tenantId)` method returning the canonical
 * `(externalIssueId, paperclipStatus, jiraStatus,
 * paperclipCommentIds, jiraCommentIds, lastSyncedAt)` tuple per
 * entity. Production wires a Postgres-backed
 * `sync.mirror_state` reader (FORA-204 owns the table); the
 * tests wire an in-memory fake. The seam is the same one the
 * Python §7.2 detector (FORA-257) reads from, so the TS + Python
 * detectors stay in lock-step on the report shape.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Mirror-state seam
// ---------------------------------------------------------------------------

/**
 * One synced entity as the cron observes it. The shape is the
 * minimal tuple the status + comment comparators need; the
 * `paperclip_status` / `jira_status` strings are the canonical
 * Paperclip enum (`approved` / `in_progress` / `in_review` /
 * `blocked` / `done` / `cancelled`) and the Jira-side status
 * display name respectively. Either side may be `null` when the
 * entity is not yet observed on that platform (cold-start
 * window); the comparator treats a `null` side as "no
 * comparison" rather than "mismatch".
 *
 * `lastSyncedAt` is the most recent successful `claim()`
 * `claimed_at` for any op_kind on this entity (per FORA-401 /
 * `sync_op` table). The cron threads it into every mismatch so
 * the operator can see how stale the disagreement is.
 */
export interface MirrorEntity {
  /** Stable per-entity id (the Jira-side issue key, e.g. `PROJ-123`). */
  externalIssueId: string;
  /** Canonical Paperclip status, or `null` if not yet observed. */
  paperclipStatus: string | null;
  /** Last-observed Jira-side status, or `null` if not yet observed. */
  jiraStatus: string | null;
  /** Comment ids present on the Paperclip side. */
  paperclipCommentIds: readonly string[];
  /** Comment ids present on the Jira side. */
  jiraCommentIds: readonly string[];
  /** ISO 8601 timestamp of the most recent successful sync op. */
  lastSyncedAt: string;
}

/**
 * The seam that knows the canonical per-tenant mirror state.
 * Production wires a Postgres-backed reader over the
 * `sync.mirror_state` table (FORA-204). Tests wire an in-memory
 * fake. The interface is sync-or-async so a future driver
 * change is a one-file edit.
 */
export interface MirrorState {
  listEntities(tenantId: string): Promise<readonly MirrorEntity[]> | readonly MirrorEntity[];
}

// ---------------------------------------------------------------------------
// Detector output types
// ---------------------------------------------------------------------------

/**
 * The closed set of fields the FORA-200 v0.1 detector compares.
 * Schema divergence (ADR-0010 §7.2 #1) is reserved for v0.2; a
 * future field is a one-line addition to the union + a new
 * row in `compareMirrorEntity`.
 */
export type MismatchField = 'status' | 'comment';

/**
 * One disagreement surfaced by the cron. The shape is the
 * deliverable spec's `mismatches[]` element exactly:
 *
 *   - `externalIssueId` — the Jira issue key (the canonical
 *     cross-platform ref).
 *   - `field` — what disagrees (`status` | `comment`).
 *   - `paperclipValue` — the canonical Paperclip-side value.
 *   - `jiraValue` — the last-observed Jira-side value.
 *   - `lastSyncedAt` — ISO 8601 timestamp of the most recent
 *     successful sync op on this entity, so the operator can
 *     see how stale the disagreement is.
 */
export interface Mismatch {
  externalIssueId: string;
  field: MismatchField;
  paperclipValue: string;
  jiraValue: string;
  lastSyncedAt: string;
}

/**
 * The full sweep result. The shape is the deliverable spec's
 * report exactly:
 *
 *   `{ tenantId, scannedAt, mismatches: [...] }`
 *
 * Plus the operational counters (`scannedEntities`,
 * `mismatchCounts`) the v0.2 Slack fanout will need — cheap to
 * carry now and lets the close-gate reviewer assert the report
 * without re-deriving the counts.
 */
export interface DivergenceReport {
  tenantId: string;
  scannedAt: string;
  mismatches: readonly Mismatch[];
  scannedEntities: number;
  mismatchCounts: Readonly<Record<MismatchField, number>>;
}

/**
 * The seam that talks to the orchestrator's routine registry.
 * Production wires the FORA-460 customer-cloud-broker-backed
 * `POST /routines` client; tests wire a recording fake.
 */
export interface PaperclipRoutinesClient {
  registerRoutine(
    input: CronRegistration,
  ): Promise<{ id: string; created_at: string }>;
  listRoutines(): Promise<readonly { id: string; name: string; schedule: string }[]>;
}

/**
 * The cron registration descriptor. Matches the
 * `CronDescriptor` shape in `apps/sync-plane-job/src/nightly_cron.ts`
 * (the FORA-438 per-adapter cron) so the orchestrator's
 * registration handler can be shared. `idempotent: true` is the
 * detector's invariant — the orchestrator's
 * `POST /routines` handler MUST dedupe on `(name, schedule,
 * owner)` and return the existing id rather than creating a
 * second row.
 */
export interface CronRegistration {
  name: string;
  schedule: string;
  owner: string;
  command: readonly string[];
  idempotent: boolean;
  audit_event_type: string;
  description: string;
}

/**
 * The closed cron schedule for FORA-406. `0 2 * * *` UTC =
 * 02:00 daily, the low-traffic window the FORA-200 plan §4
 * names. The expression is the literal cron string (no
 * timezone-shift helpers) so the orchestrator's parser sees it
 * verbatim.
 */
export const DIVERGENCE_CRON_SCHEDULE = '0 2 * * *';

/**
 * The detector's audit event type. Per ADR-0010 §8.1 the
 * routine registration emits `sync.divergence.sweep_completed`
 * on every sweep run — the orchestrator's `GET /routines`
 * history surfaces the latest sweep time so the operator can
 * confirm the cron actually ran.
 */
export const DIVERGENCE_AUDIT_EVENT_TYPE = 'sync.divergence.sweep_completed';

/**
 * Owner agent slug. The FORA-200 charter names IntegrationEngineer
 * as the owner; the slug mirrors the Paperclip agent registry
 * convention (`<role>-<specialty>`).
 */
export const DIVERGENCE_CRON_OWNER = 'integration-engineer';

// ---------------------------------------------------------------------------
// Sweep options
// ---------------------------------------------------------------------------

/**
 * Inputs to `runNightlySweep`. The detector is a pure function
 * of these inputs — the seam interfaces (`MirrorState`,
 * `PaperclipRoutinesClient`) are the only I/O surface. A test
 * that injects in-memory fakes for both is the canonical
 * verification path.
 */
export interface SweepOptions {
  /** Verified broker-claim tenant id (FORA-163 / ADR-0003 §4.2). */
  tenantId: string;
  /** The mirror-state seam (production: Postgres; tests: in-memory). */
  mirror: MirrorState;
  /**
   * Wall-clock override — defaults to `() => new Date()`. Tests
   * pin the clock to assert `scannedAt` deterministically; the
   * idempotency test relies on a fixed clock for that reason.
   */
  clock?: () => Date;
  /**
   * Directory the JSON report is written to. Created on demand
   * (recursive `mkdirSync`). The detector does NOT delete
   * existing files; it overwrites the deterministic filename
   * for the same `(tenantId, scannedAt)` pair so re-runs are
   * idempotent.
   */
  auditDir: string;
  /**
   * Whether to emit a one-line JSON summary to `stdout`. The
   * production cron worker wires this to `true`; tests wire it
   * to `false` to keep the vitest output clean. Defaults to
   * `true`.
   */
  logToStdout?: boolean;
  /**
   * Optional logger — defaults to `console`. Tests inject a
   * recording fake to assert the stdout line without
   * contaminating vitest's output.
   */
  logger?: { log(line: string): void };
  /**
   * Optional routines client — when provided, the detector
   * emits the `sync.divergence.sweep_completed` audit event via
   * the client so the orchestrator's `GET /routines` history
   * shows the latest sweep. The cron registration itself lives
   * in `applyCronRegistration()` (separate concern, separate
   * call) — the detector's audit is the per-run heartbeat.
   */
  routines?: PaperclipRoutinesClient;
}

// ---------------------------------------------------------------------------
// Pure comparators
// ---------------------------------------------------------------------------

/**
 * Compare one mirror entity against the canonical Paperclip
 * side. Returns the empty array when the entity is in
 * agreement on every observed field, otherwise one `Mismatch`
 * per disagreement.
 *
 * Rules (FORA-200 §2 AC#4 + ADR-0010 §7.2 #2 + #3):
 *
 *   - `status` mismatch: `paperclipStatus !== jiraStatus` AND
 *     BOTH sides are non-null. A `null` side means the entity
 *     is not yet observed on that platform; that is cold-start
 *     state, NOT a mismatch (a `null` Jira-side on a brand-new
 *     Paperclip issue is the expected happy path).
 *
 *   - `comment` mismatch: the symmetric set difference
 *     `(paperclip - jira) ∪ (jira - paperclip)`. Each side
 *     surfaces a distinct `Mismatch` row so the operator can
 *     see which side has the orphan. Comment ids that are
 *     equal on both sides are NOT surfaced.
 *
 * The comparator is **pure** (no I/O, no clock) so the test
 * suite can assert its output without a fake clock or fake
 * filesystem. Exported for direct unit coverage.
 */
export function compareMirrorEntity(entity: MirrorEntity): readonly Mismatch[] {
  const out: Mismatch[] = [];

  // --- Status (ADR-0010 §7.2 #2) ---------------------------------
  // Both sides must be observed; a null side is cold-start,
  // not a disagreement. A disagreement surfaces a single row
  // regardless of which side changed last — the cron reports
  // state, not causation.
  if (
    entity.paperclipStatus !== null &&
    entity.jiraStatus !== null &&
    entity.paperclipStatus !== entity.jiraStatus
  ) {
    out.push({
      externalIssueId: entity.externalIssueId,
      field: 'status',
      paperclipValue: entity.paperclipStatus,
      jiraValue: entity.jiraStatus,
      lastSyncedAt: entity.lastSyncedAt,
    });
  }

  // --- Comments (ADR-0010 §7.2 #3) -------------------------------
  // XOR of the two comment-id sets. Each side of the diff gets
  // its own row so the operator can tell `only_paperclip` from
  // `only_remote` at a glance (the paperclipValue / jiraValue
  // encoding carries that distinction: one side holds the
  // orphan id, the other holds the empty string).
  const pcSet = new Set(entity.paperclipCommentIds);
  const jrSet = new Set(entity.jiraCommentIds);
  for (const cid of entity.paperclipCommentIds) {
    if (!jrSet.has(cid)) {
      out.push({
        externalIssueId: entity.externalIssueId,
        field: 'comment',
        paperclipValue: cid,
        jiraValue: '',
        lastSyncedAt: entity.lastSyncedAt,
      });
    }
  }
  for (const cid of entity.jiraCommentIds) {
    if (!pcSet.has(cid)) {
      out.push({
        externalIssueId: entity.externalIssueId,
        field: 'comment',
        paperclipValue: '',
        jiraValue: cid,
        lastSyncedAt: entity.lastSyncedAt,
      });
    }
  }

  return out;
}

/**
 * The symmetric set difference for two readonly id lists.
 * Exported so the test suite can assert the comparator's
 * building block without rebuilding the comparator's logic.
 */
export function diffCommentIds(
  paperclip: readonly string[],
  jira: readonly string[],
): { onlyPaperclip: readonly string[]; onlyJira: readonly string[] } {
  const pcSet = new Set(paperclip);
  const jrSet = new Set(jira);
  const onlyPaperclip: string[] = [];
  const onlyJira: string[] = [];
  for (const cid of paperclip) if (!jrSet.has(cid)) onlyPaperclip.push(cid);
  for (const cid of jira) if (!pcSet.has(cid)) onlyJira.push(cid);
  return { onlyPaperclip, onlyJira };
}

// ---------------------------------------------------------------------------
// Report writer
// ---------------------------------------------------------------------------

/**
 * Build the deterministic artefact path for a sweep. The path
 * embeds the tenant id and a compact UTC stamp (yyyymmddTHHmmssZ)
 * so two runs with the same clock write to the same file — the
 * detector's idempotent re-run contract. The path is stable
 * across platforms (no `path.sep` surprises).
 */
export function buildReportPath(tenantId: string, scannedAt: Date): string {
  const stamp = scannedAt
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 15); // yyyymmddTHHmmss
  return join(`divergence_${tenantId}_${stamp}.json`);
}

/**
 * Serialise a `DivergenceReport` to the on-disk artefact
 * shape. The artefact is the report verbatim — no extra
 * envelope, no header — so the close-gate reviewer can
 * `jq .mismatches` the file directly.
 */
export function serialiseReport(report: DivergenceReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Persist a report to `auditDir` and return the absolute path.
 * Creates `auditDir` on demand (recursive). Overwrites an
 * existing file at the same deterministic path — the
 * idempotent re-run contract.
 *
 * Exposed for direct unit coverage; `runNightlySweep` calls it
 * internally. The function does NOT touch the network, the
 * orchestrator, or the Postgres spine — it's a pure file
 * write.
 */
export function writeReport(
  report: DivergenceReport,
  auditDir: string,
): string {
  if (!existsSync(auditDir)) {
    mkdirSync(auditDir, { recursive: true });
  }
  const filePath = join(auditDir, buildReportPath(report.tenantId, new Date(report.scannedAt)));
  writeFileSync(filePath, serialiseReport(report), 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// runNightlySweep — the cron entry point
// ---------------------------------------------------------------------------

/**
 * Run the nightly divergence sweep for one tenant.
 *
 * The function:
 *
 *   1. Resolves the scan timestamp from the (injected) clock.
 *   2. Lists every entity in the mirror state for the tenant.
 *   3. Runs `compareMirrorEntity()` on each entity.
 *   4. Aggregates the per-entity mismatches into a
 *      `DivergenceReport`.
 *   5. Writes the report to `auditDir` (overwrite-on-same-path
 *      for idempotent re-run).
 *   6. Emits a one-line JSON summary to `logger` (default
 *      `console.log`).
 *   7. When a `routines` client is provided, calls
 *      `registerRoutine(...)` to surface the sweep completion
 *      in `GET /routines`. The call is best-effort — a failure
 *      here does NOT roll back the report; the operator reads
 *      the artefact file instead.
 *
 * The function never throws on a missing tenant or an empty
 * mirror state: the dogfood-tenant AC ("manual cron tick
 * against dogfood tenant returns a non-error report even when
 * no mismatches") is the cold-start case and is the path the
 * FORA-200 §4 acceptance bar names.
 */
export async function runNightlySweep(
  options: SweepOptions,
): Promise<DivergenceReport> {
  const clock = options.clock ?? (() => new Date());
  const logger = options.logger ?? console;
  const logToStdout = options.logToStdout ?? true;

  const scannedAtDate = clock();
  const scannedAt = scannedAtDate.toISOString();

  // 1. Pull the mirror state. `await` covers both sync and
  //    async `MirrorState` implementations; the return-type
  //    union is intentional.
  const entities = await options.mirror.listEntities(options.tenantId);

  // 2. Run the pure comparator on every entity. Flat-reduce
  //    into a single mismatch list.
  const mismatches: Mismatch[] = [];
  for (const entity of entities) {
    mismatches.push(...compareMirrorEntity(entity));
  }

  // 3. Tally per-field counts (the v0.2 Slack fanout will
  //    need these; cheap to carry now).
  const mismatchCounts: Record<MismatchField, number> = {
    status: 0,
    comment: 0,
  };
  for (const m of mismatches) {
    mismatchCounts[m.field] += 1;
  }

  // 4. Assemble the report.
  const report: DivergenceReport = {
    tenantId: options.tenantId,
    scannedAt,
    mismatches,
    scannedEntities: entities.length,
    mismatchCounts,
  };

  // 5. Persist the artefact. The writer is best-effort —
  // a filesystem error throws to the caller so the cron
  // worker can mark the run failed and page on the P0
  // "audit divergence silently masking a missing event"
  // path (R-SYNC-05). Without the artefact the operator
  // has no record of the sweep.
  const artefactPath = writeReport(report, options.auditDir);

  // 6. Stdout summary. The production cron worker scrapes
  // this line; the test path wires a recording fake.
  if (logToStdout) {
    logger.log(
      JSON.stringify({
        event_type: DIVERGENCE_AUDIT_EVENT_TYPE,
        tenant_id: options.tenantId,
        scanned_at: scannedAt,
        scanned_entities: entities.length,
        mismatches: mismatches.length,
        artefact_path: artefactPath,
      }),
    );
  }

  // 7. Surface the sweep completion in the orchestrator's
  // routine history. Best-effort: a failure here does NOT
  // propagate (the artefact is already on disk). The
  // orchestrator's `GET /routines` will surface the last
  // successful registration time.
  if (options.routines) {
    try {
      await options.routines.registerRoutine(buildCronRegistration());
    } catch {
      // Best-effort; the artefact on disk is the source of
      // truth for the sweep.
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// Cron registration
// ---------------------------------------------------------------------------

/**
 * Build the cron registration descriptor. Per FORA-200 plan §4
 * "One operational routine", the routine is:
 *
 *   - `name: 'sync.divergence.nightly'`
 *   - `schedule: '0 2 * * *'` UTC
 *   - `owner: 'integration-engineer'`
 *   - `command: ['pnpm', '--filter', '@fora/jira-adapter', 'run',
 *      'sweep', '--', '${tenantSlug}']`
 *   - `idempotent: true` — the orchestrator's
 *     `POST /routines` handler MUST dedupe on
 *     `(name, schedule, owner)` and return the existing id
 *     rather than create a second row.
 *   - `audit_event_type: 'sync.divergence.sweep_completed'`
 *
 * The descriptor is the value the orchestrator's
 * `POST /routines` accepts; `applyCronRegistration()` wires
 * the actual call.
 */
export function buildCronRegistration(): CronRegistration {
  return {
    name: 'sync.divergence.nightly',
    schedule: DIVERGENCE_CRON_SCHEDULE,
    owner: DIVERGENCE_CRON_OWNER,
    command: [
      'pnpm',
      '--filter',
      '@fora/jira-adapter',
      'run',
      'sweep',
      '--',
      '${tenantSlug}',
    ],
    idempotent: true,
    audit_event_type: DIVERGENCE_AUDIT_EVENT_TYPE,
    description:
      'Nightly Paperclip ↔ Jira divergence sweep per FORA-200 §2 AC#4 / ' +
      'FORA-406. Walks the per-tenant mirror state, compares ' +
      'status + comments, writes the divergence report to ' +
      '`auditDir`, surfaces the sweep completion in ' +
      '`GET /routines`. Idempotent: re-running with the same ' +
      'mirror snapshot + same clock writes the same artefact.',
  };
}

/**
 * Register the cron via the orchestrator's `POST /routines`
 * endpoint. Production wires the FORA-460 customer-cloud-broker
 * client; the test path wires a `RecordingRoutinesClient`.
 *
 * The function is idempotent at the seam level: a second call
 * with the same descriptor is the orchestrator's job to dedupe
 * (per the `idempotent: true` flag). The detector never
 * asserts the second call is a no-op — it just trusts the
 * orchestrator's contract.
 */
export async function applyCronRegistration(
  client: PaperclipRoutinesClient,
): Promise<{ id: string; created_at: string }> {
  return client.registerRoutine(buildCronRegistration());
}