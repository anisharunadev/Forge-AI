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

export { createRun, getRun, getRunStages, getRunsView, listRuns } from '@/lib/api';
export type { CreateRunInput, RunRecord, RunsView, StageRecord } from '@/lib/api';

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
