/**
 * Thin typed client for the FORA Orchestrator REST API (FORA-50 §4.1).
 *
 * The Forge console only reads / mutates the seven canonical endpoints
 * shipped in `@fora/orchestrator` 0.1.x. Every mutating call sends an
 * `Idempotency-Key` (the Orchestrator contract requires one — see
 * apps/orchestrator/README.md).
 *
 * The base URL is read from `FORA_FORGE_API_URL` (server side) or the
 * `FORGE_API_URL` env exposed to the browser. In dev it defaults to
 * `http://localhost:4000`.
 */

import type { LifecycleVerb, RunId, RunRecord, StageRecord } from './types';

const SERVER_BASE = process.env.FORA_FORGE_API_URL ?? 'http://localhost:4000';
const PUBLIC_BASE =
  process.env.NEXT_PUBLIC_FORGE_API_URL ??
  process.env.FORA_FORGE_API_URL ??
  'http://localhost:4000';

// In dev the orchestrator is single-tenant: the demo tenant is the
// 00000000-0000-0000-0000-000000000ace UUID seeded by scripts/dev-up.sh
// step 6b. The forge app sends that as `x-fora-tenant-id` on every
// orchestrator call so the gateway's tenant extractor accepts the
// request (FORA-50 §4.2). Production wires this through the identity
// broker's JWT claim — see FORA-123.
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