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
  return request<ReadonlyArray<StageRecord>>(`/v1/runs/${encodeURIComponent(id)}/stages`);
}

/**
 * Best-effort run listing. The 0.1.x orchestrator does not expose a
 * `GET /v1/runs` index endpoint, so the persona views fall back to a
 * known seed id (`demo-run-001`) when no runs are visible. If a real
 * index lands later, swap this for `request<RunRecord[]>('/v1/runs')`.
 */
export async function listRuns(): Promise<ReadonlyArray<RunRecord>> {
  const seedId = process.env.FORA_SEED_RUN_ID ?? 'demo-run-001';
  try {
    const run = await getRun(seedId);
    return [run];
  } catch (err) {
    if (err instanceof OrchestratorError && err.status === 404) return [];
    throw err;
  }
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