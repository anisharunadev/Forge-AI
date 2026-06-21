/**
 * Thin typed client for the FORA Orchestrator REST API (FORA-50 §4.1).
 *
 * The Forge console only reads / mutates the seven canonical endpoints
 * shipped in `the FastAPI backend` 0.1.x. Every mutating call sends an
 * `Idempotency-Key` (the Orchestrator contract requires one — see
 * apps/orchestrator/README.md).
 *
 * The base URL is read from `FORA_FORGE_API_URL` (server side) or the
 * `FORGE_API_URL` env exposed to the browser. In dev it defaults to
 * `http://localhost:4000`.
 */

import type { LifecycleVerb, RunId, RunRecord, StageRecord } from './types';

export { FORGE_WS_BASE_URL } from './forge-api';

const ENV_BASE = process.env.FORA_FORGE_API_URL;

function resolveStubPort(): string | null {
  if (ENV_BASE) return null; // env wins
  try {
    // Same trick as `app/api/proxy/[...path]/route.ts` — the dev stub
    // writes `.stub-port` on startup, so server-side fetches in
    // `lib/api.ts` (runs, etc.) resolve to the same port the UI hits.
    // Production: env var takes over; this is a no-op.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const portFile = path.join(process.cwd(), '.stub-port');
    if (fs.existsSync(portFile)) {
      const p = fs.readFileSync(portFile, 'utf8').trim();
      if (p && /^\d+$/.test(p)) return p;
    }
  } catch {
    /* serverless / edge runtime: ignore */
  }
  return null;
}

const STUB_PORT = resolveStubPort();

const SERVER_BASE = ENV_BASE ?? (STUB_PORT ? `http://localhost:${STUB_PORT}` : 'http://localhost:4000');
const PUBLIC_BASE =
  process.env.NEXT_PUBLIC_FORGE_API_URL ??
  ENV_BASE ??
  (STUB_PORT ? `http://localhost:${STUB_PORT}` : 'http://localhost:4000');


const DEV_TENANT_UUID = '00000000-0000-4000-8000-000000000ace';

function base(): string {
  return typeof window === 'undefined' ? SERVER_BASE : PUBLIC_BASE;
}

export class OrchestratorError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'OrchestratorError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  // Single-tenant dev: every orchestrator call carries the demo
  // tenant UUID. Production: gateway injects this from the broker JWT.
  if (!headers.has('x-fora-tenant-id')) {
    headers.set('x-fora-tenant-id', DEV_TENANT_UUID);
  }
  if (init.idempotencyKey) headers.set('Idempotency-Key', init.idempotencyKey);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, { ...init, headers, cache: 'no-store' });
  } catch (err) {
    // Wrap low-level transport errors (ECONNREFUSED, DNS, etc.) so the
    // persona pages can pattern-match `OrchestratorError` and render the
    // empty state instead of throwing a 500.
    const message = err instanceof Error ? err.message : String(err);
    throw new OrchestratorError(`orchestrator unreachable: ${message}`, 0, null);
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body — leave it as text */
  }
  if (!res.ok) {
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : `orchestrator returned ${res.status}`;
    throw new OrchestratorError(message, res.status, body);
  }
  return body as T;
}

/** GET /healthz — liveness. Returns the raw text "ok" from the orchestrator. */
export async function ping(): Promise<string> {
  const res = await fetch(`${base()}/healthz`, { cache: 'no-store' });
  if (!res.ok) throw new OrchestratorError(`healthz ${res.status}`, res.status, null);
  return res.text();
}

/** GET /v1/runs/{id} — read run header. */
export async function getRun(id: RunId): Promise<RunRecord> {
  return request<RunRecord>(`/v1/runs/${encodeURIComponent(id)}`);
}

/** GET /v1/runs/{id}/stages — list the seven stage rows in canonical order. */
export async function getRunStages(id: RunId): Promise<ReadonlyArray<StageRecord>> {
  // Orchestrator returns `{stages: StageRecord[]}` per FORA-50 §4.1;
  // unwrap the array so the Timeline's `indexStages` consumer sees a
  // flat list.
  const body = await request<{ stages: ReadonlyArray<StageRecord> }>(
    `/v1/runs/${encodeURIComponent(id)}/stages`,
  );
  return body.stages;
}

/**
 * Tenant-scoped index of every non-deleted run. FORA-378 ships the
 * `GET /v1/runs` endpoint on the orchestrator; the persona dashboards
 * call this instead of probing a single seed id so the empty state
 * ("No runs yet") only appears for tenants that genuinely have no runs.
 *
 * `FORA_SEED_RUN_ID` is retained as an override: a downstream caller
 * (e.g. a doc screenshot, a one-off smoke probe) can pin the list to a
 * specific run id by setting the env var. The default is the orchestrator's
 * full tenant index.
 */
export async function listRuns(): Promise<ReadonlyArray<RunRecord>> {
  const seedOverride = process.env.FORA_SEED_RUN_ID;
  if (seedOverride && seedOverride.length > 0) {
    try {
      const run = await getRun(seedOverride);
      return [run];
    } catch (err) {
      if (err instanceof OrchestratorError && err.status === 404) {
        return request<ReadonlyArray<RunRecord>>('/v1/runs');
      }
      throw err;
    }
  }
  return request<ReadonlyArray<RunRecord>>('/v1/runs');
}

/**
 * FORA-379: discriminated "orchestrator health" view that the persona
 * dashboards render against. Replaces the previous pattern of catching
 * `OrchestratorError` and silently returning `[]`, which made every
 * page render the misleading "No runs yet" empty state when the real
 * problem was a 5xx / ECONNREFUSED.
 *
 * Three states:
 *   - `unreachable` — the orchestrator call failed (5xx, ECONNREFUSED,
 *     DNS, missing tenant, etc). The page should render an explicit
 *     "Orchestrator unreachable" notice with `error.message`, and not
 *     the misleading "No runs yet" string.
 *   - `ok` — orchestrator responded, with at least one run. The page
 *     renders the real metrics against `runs`.
 *   - `empty` — orchestrator responded with `[]`. The page renders the
 *     honest "No runs yet" empty state (and only here).
 */
export type RunsView =
  | { state: 'unreachable'; error: string; status: number }
  | { state: 'ok'; runs: ReadonlyArray<RunRecord> }
  | { state: 'empty' };

export async function getRunsView(): Promise<RunsView> {
  try {
    const runs = await listRuns();
    return runs.length === 0 ? { state: 'empty' } : { state: 'ok', runs };
  } catch (err) {
    if (err instanceof OrchestratorError) {
      return {
        state: 'unreachable',
        error: err.message,
        status: err.status,
      };
    }
    throw err;
  }
}

/**
 * Canonical seed run id written by `scripts/dev-up.sh` step 6c. The
 * orchestrator maps the human-friendly alias `demo-run-001` to this
 * UUID on `GET /v1/runs/{id}` and `GET /v1/runs/{id}/stages` (see
 * `DEMO_RUN_ALIAS` in apps/orchestrator/src/server.ts). Persona pages
 * render the alias next to the UUID so the smoke gate's
 * `grep 'demo-run-001'` and the human operator's
 * "where is the seeded run?" question both resolve to the same row.
 */
export const SEED_RUN_UUID = '00000000-0000-4000-8000-000000000001';
export const SEED_RUN_ALIAS = 'demo-run-001';

export function seedAliasFor(id: string): string | null {
  return id === SEED_RUN_UUID ? SEED_RUN_ALIAS : null;
}

/**
 * POST /v1/runs/{id}/{verb} — pause | resume | cancel. Idempotent on
 * the orchestrator side; we still send a fresh Idempotency-Key per
 * user-action so the audit log captures the click.
 */
export async function runLifecycle(
  id: RunId,
  verb: LifecycleVerb,
): Promise<RunRecord> {
  const key = crypto.randomUUID();
  return request<RunRecord>(`/v1/runs/${encodeURIComponent(id)}/${verb}`, {
    method: 'POST',
    idempotencyKey: key,
  });
}

/**
 * Render-only helper: build a `Stage` → `StageRecord | null` map so a
 * timeline view can iterate the canonical seven in order even if the
 * orchestrator returns a subset (defensive — the 0.1.x contract says
 * seven rows are always written at create time).
 */
export function indexStages(
  rows: ReadonlyArray<StageRecord>,
): Map<StageRecord['stage'], StageRecord | null> {
  console.log('DEBUG indexStages rows:', rows);
  const map = new Map<StageRecord['stage'], StageRecord | null>();
  for (const stage of [
    'ideation',
    'architect',
    'dev',
    'qa',
    'security',
    'devops',
    'docs',
  ] as const) {
    map.set(stage, rows.find((r) => r.stage === stage) ?? null);
  }
  return map as Map<StageRecord['stage'], StageRecord | null>;
}

// ---------------------------------------------------------------------------
// Code Validator — typed-artifact surfaces (FORA-620)
// ---------------------------------------------------------------------------

/**
 * Severity ranks for `ValidationFinding.severity`. The detail page and
 * the `FindingsTable` sort by this rank (critical first, then high,
 * medium, low) so operators can triage the loudest problems without
 * having to scroll.
 */
export type ValidationSeverity = 'critical' | 'high' | 'medium' | 'low';

/** Rank used for sorting — lower number = higher priority. */
export const VALIDATION_SEVERITY_RANK: Record<ValidationSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** File location attached to a finding. */
export interface ValidationFindingLocation {
  readonly filePath: string;
  readonly line?: number;
  readonly column?: number;
}

/** A single problem surfaced by the validator. */
export interface ValidationFinding {
  readonly id: string;
  readonly ruleId: string;
  readonly severity: ValidationSeverity;
  readonly title: string;
  readonly message: string;
  readonly location: ValidationFindingLocation;
  readonly suggestedFix?: string;
}

/** Aggregate counts so the banner can render `N critical / N high / …`. */
export interface ValidationSummary {
  readonly total: number;
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly passed: number;
}

/** Outcome of a single scan. `pass` ⇒ zero findings of `critical`/`high`. */
export type ValidationStatus = 'pass' | 'fail' | 'running' | 'error';

export interface ValidationReport {
  readonly reportId: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly status: ValidationStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly summary: ValidationSummary;
  readonly findings: ReadonlyArray<ValidationFinding>;
}

/**
 * GET /v1/validator/projects/{projectId}/reports — tenant-scoped list
 * of recent ValidationReports for the project. Sorted newest first by
 * the orchestrator; the list view passes this straight into
 * `<ValidationReportCard>` rows.
 */
export async function listValidationReports(
  projectId: string,
): Promise<ReadonlyArray<ValidationReport>> {
  return request<ReadonlyArray<ValidationReport>>(
    `/v1/validator/projects/${encodeURIComponent(projectId)}/reports`,
  );
}

/**
 * GET /v1/validator/reports/{reportId} — fetch a single report with
 * the full findings array. The detail page renders the findings in a
 * `FindingsTable` and, per finding, a `RemediationPanel`.
 */
export async function getValidationReport(
  reportId: string,
): Promise<ValidationReport> {
  return request<ValidationReport>(
    `/v1/validator/reports/${encodeURIComponent(reportId)}`,
  );
}

// ---------------------------------------------------------------------------
// Refactor Agent — typed-artifact surfaces (F-213)
// ---------------------------------------------------------------------------

/** Effort sizing bucket per phase. Drives the badge color and ToneTone. */
export type RefactorEffort = 'S' | 'M' | 'L' | 'XL';

/** Lifecycle of a single migration plan phase. */
export type RefactorPhaseStatus =
  | 'pending'
  | 'analyzing'
  | 'awaiting_approval'
  | 'in_progress'
  | 'complete'
  | 'blocked';

/** A single risk surfaced by the refactor analysis, tied to a phase. */
export interface RefactorRisk {
  readonly id: string;
  readonly phaseId: string;
  readonly title: string;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly mitigation: string;
  readonly owner: string;
}

/** One phase in the migration plan. */
export interface RefactorPhase {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly summary: string;
  readonly effort: RefactorEffort;
  readonly estimateHours: number;
  readonly status: RefactorPhaseStatus;
  readonly tasks: ReadonlyArray<string>;
}

/** A complete migration plan. */
export interface MigrationPlan {
  readonly planId: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly source: string;
  readonly target: string;
  readonly title: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: 'draft' | 'pending_approval' | 'approved' | 'in_progress' | 'complete' | 'archived';
  readonly phases: ReadonlyArray<RefactorPhase>;
  readonly risks: ReadonlyArray<RefactorRisk>;
}

/** Input payload for triggering a new analysis run. */
export interface RefactorAnalysisSource {
  readonly projectId: string;
  readonly source: string;
  readonly target?: string;
  readonly notes?: string;
}

/**
 * GET /v1/refactor/projects/{projectId}/plans — tenant-scoped list of
 * recent migration plans for the project. Sorted newest first by the
 * orchestrator; the list view passes this straight into
 * `<MigrationPlanCard>` rows.
 */
export async function listMigrationPlans(
  projectId: string,
): Promise<ReadonlyArray<MigrationPlan>> {
  return request<ReadonlyArray<MigrationPlan>>(
    `/v1/refactor/projects/${encodeURIComponent(projectId)}/plans`,
  );
}

/**
 * GET /v1/refactor/plans/{planId} — fetch a single migration plan with
 * the full phased breakdown + risk register. The detail page renders
 * the phases via `<PhaseTimeline>` and the risks via `<RiskRegister>`.
 */
export async function getMigrationPlan(
  planId: string,
): Promise<MigrationPlan> {
  return request<MigrationPlan>(
    `/v1/refactor/plans/${encodeURIComponent(planId)}`,
  );
}

/**
 * POST /v1/refactor/analyses — trigger a new refactor analysis run.
 * The orchestrator returns the freshly-created `MigrationPlan` once
 * the analysis completes; the wizard redirects to `/refactor/{planId}`
 * on success.
 */
export async function triggerRefactorAnalysis(
  source: RefactorAnalysisSource,
): Promise<MigrationPlan> {
  const key = crypto.randomUUID();
  return request<MigrationPlan>('/v1/refactor/analyses', {
    method: 'POST',
    idempotencyKey: key,
    body: JSON.stringify(source),
  });
}

/**
 * F-213 — `PushToJira` action. Mocks the Jira issue-creation
 * contract: in production this will write an Epic + child Stories
 * derived from `plan.phases`. Today it returns the synthetic ticket
 * identifiers so the wizard can show the push result inline.
 */
export interface JiraPushResult {
  readonly epicKey: string;
  readonly storyKeys: ReadonlyArray<string>;
  readonly pushedAt: string;
}

export async function pushMigrationPlanToJira(
  planId: string,
): Promise<JiraPushResult> {
  const key = crypto.randomUUID();
  return request<JiraPushResult>(
    `/v1/refactor/plans/${encodeURIComponent(planId)}/push-to-jira`,
    {
      method: 'POST',
      idempotencyKey: key,
    },
  );
}