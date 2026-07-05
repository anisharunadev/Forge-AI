/**
 * Runs Center data layer (Phase 1 — Runs Center).
 *
 * Re-exports the typed fetchers from `lib/api.ts` and adds a
 * `fetchRunsIndex()` helper that returns the discriminated
 * `RunsView` shape used by the page chrome (so the table can
 * render an empty / unreachable banner consistently with the
 * persona dashboards).
 *
 * Server-side only. Client code should NOT import this file —
 * use the TanStack Query hooks in `lib/hooks/useRuns.ts` so
 * realtime updates flow through the `useRealtime` hook.
 */

import {
  getRun,
  getRunStages,
  getRunsView,
  listRuns,
  type RunRecord,
  type RunsView,
  type StageRecord,
} from '@/lib/api';
import { api } from '@/lib/api/client';
import type { RunExplainability } from '@/lib/api/runs-types';

export { createRun, getRun, getRunStages, getRunsView, listRuns } from '@/lib/api';
export type { CreateRunInput, RunRecord, RunsView, StageRecord } from '@/lib/api';

/**
 * M6-G2: per-RUN live budget surface (FORA-50 §4.1).
 *
 *   - `ceiling_usd`     declared per-RUN cap (from the project budget
 *                       at create time, or the tenant default if not).
 *   - `spent_usd`       confirmed spend so far (cost_ledger aggregate).
 *   - `remaining_usd`   `ceiling_usd - spent_usd`, clamped at zero.
 *   - `headroom_pct`    `(remaining / ceiling) * 100`, or null when
 *                       the ceiling is zero / unknown.
 *   - `status`          mirrors the WorkflowBudgetStatus vocabulary —
 *                       `active | exhausted | closed | no_budget`.
 *   - `frozen_at`       when the budget was locked (terminal state).
 *                       `null` while the run is still in motion.
 *
 * The endpoint lives at `/runs/{id}/budget` (FastAPI). The M6 spec
 * also relaxes the phase guard so this returns 200 for *any* phase,
 * not only PLANNING/DISCOVERY — Track A M6-G3 ships that fix.
 */
export type RunBudgetStatus =
  | 'active'
  | 'exhausted'
  | 'closed'
  | 'no_budget';

export interface RunBudget {
  run_id: string;
  ceiling_usd: number;
  spent_usd: number;
  remaining_usd: number;
  headroom_pct: number | null;
  status: RunBudgetStatus;
  frozen_at: string | null;
}

/** GET /api/v1/runs/{id}/budget — live per-run budget surface. */
export async function getRunBudget(runId: string): Promise<RunBudget> {
  return api.get<RunBudget>(`/runs/${encodeURIComponent(runId)}/budget`);
}

/**
 * M6-G1: POST /api/v1/runs/{id}/replay — operator replays a finished
 * or failed run. Returns the freshly-seeded run header so the UI
 * can navigate the operator to `/runs/{newId}`.
 */
export interface ReplayRunInput {
  /** Optional Idempotency-Key for the replay click; auto-generated when omitted. */
  idempotencyKey?: string;
}

export interface ReplayRunResponse {
  /** The newly-created run header. */
  run: RunRecord;
  /** The id of the source run we replayed (echoed for logging). */
  source_run_id: string;
}

export async function replayRun(
  runId: string,
  input: ReplayRunInput = {},
): Promise<ReplayRunResponse> {
  return api.post<ReplayRunResponse>(
    `/runs/${encodeURIComponent(runId)}/replay`,
    {},
    input.idempotencyKey
      ? {
          headers: { 'Idempotency-Key': input.idempotencyKey },
        }
      : undefined,
  );
}

/**
 * GET /api/v1/runs/{id}/explainability — CodeRabbit 5-question bundle
 * (Step-64 Sub-step A). Recomputed on every request from existing
 * tables; no caching layer on the server.
 */
export async function getRunExplainability(runId: string): Promise<RunExplainability> {
  return api.get<RunExplainability>(`/runs/${encodeURIComponent(runId)}/explainability`);
}

/**
 * High-level helper for the `/runs` index page. Returns the
 * discriminated `RunsView` (unreachable / ok / empty) so the
 * page can render the right banner without re-implementing the
 * try/catch dance.
 */
export async function fetchRunsIndex(): Promise<RunsView> {
  return getRunsView();
}

/**
 * Convenience wrapper that pairs a run header with its stages.
 * Used by the detail page when it needs the full run context in
 * a single client-side call.
 */
export async function fetchRunWithStages(
  id: string,
): Promise<{ run: RunRecord; stages: ReadonlyArray<StageRecord> }> {
  const [run, stages] = await Promise.all([getRun(id), getRunStages(id)]);
  return { run, stages };
}
