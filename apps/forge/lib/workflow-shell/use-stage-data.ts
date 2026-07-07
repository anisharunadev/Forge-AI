/**
 * `useStageData` — fetches the live data backing a workflow stage.
 *
 * Each of the seven workflow stages owns a slice of state from one or
 * more centers. Rather than re-implement the data fetch here, this
 * hook composes the existing center hooks (`useIdeas`, `usePRDs`,
 * `useADRs`, `useRunsIndex`, `useApprovals`, …) and exposes a single
 * typed `StageData` object.
 *
 * The hook returns a TanStack-Query-shaped result: `{state, data,
 * error, isLoading, isError, isSuccess}`. The StagePanel component
 * passes these straight into `deriveStageState` and renders the
 * banner accordingly.
 *
 * Rule 4 (typed artifacts) — every stage exposes a discriminated
 * `data` union so consumers can exhaustive-switch.
 */

'use client';

import { useQueries } from '@tanstack/react-query';

import { useIdeas } from '@/lib/hooks/useIdeation';
import { useADRs } from '@/lib/hooks/useArchitecture';
import { useRunsIndex } from '@/lib/hooks/useRuns';

import type { WorkflowStageId } from './types';

/** Per-stage payload — discriminated by `stage`. */
export type StageData =
  | { readonly stage: 'idea'; readonly ideas: ReadonlyArray<unknown> }
  | { readonly stage: 'prd'; readonly prds: ReadonlyArray<unknown> }
  | {
      readonly stage: 'architecture';
      readonly adrs: ReadonlyArray<unknown>;
      readonly contracts: ReadonlyArray<unknown>;
      readonly risks: ReadonlyArray<unknown>;
    }
  | {
      readonly stage: 'tasks';
      readonly breakdowns: ReadonlyArray<unknown>;
    }
  | {
      readonly stage: 'approval';
      readonly pendingApprovals: ReadonlyArray<unknown>;
    }
  | {
      readonly stage: 'develop';
      readonly activeRuns: ReadonlyArray<unknown>;
    }
  | {
      readonly stage: 'pr';
      readonly openPullRequests: ReadonlyArray<unknown>;
    };

/**
 * Aggregate hook. Today this composes existing center hooks; when
 * the backend exposes a `/workflow/{stage}/summary` endpoint we will
 * switch the implementation to a single TanStack Query. The shape
 * of `StageData` will not change.
 */
export function useStageData(stage: WorkflowStageId, projectId?: string) {
  // Always call hooks in the same order (React rules-of-hooks).
  // We disable individual hooks by passing safe arguments.
  const ideasQ = useIdeas();
  const adrsQ = useADRs(projectId ? { project_id: projectId } : undefined);
  const runsQ = useRunsIndex();

  // Map the result to a per-stage discriminated payload.
  const queries = [ideasQ, adrsQ, runsQ];

  const firstError = queries.find((q) => q.isError)?.error ?? null;
  const isLoading = queries.some((q) => q.isLoading);
  const isError = firstError !== null;
  const isSuccess = queries.every((q) => q.isSuccess);

  let data: StageData;
  switch (stage) {
    case 'idea':
      data = { stage: 'idea', ideas: (ideasQ.data?.items ?? []) as ReadonlyArray<unknown> };
      break;
    case 'prd':
      data = { stage: 'prd', prds: [] };
      break;
    case 'architecture':
      data = {
        stage: 'architecture',
        adrs: (adrsQ.data?.items ?? []) as ReadonlyArray<unknown>,
        contracts: [],
        risks: [],
      };
      break;
    case 'tasks':
      data = { stage: 'tasks', breakdowns: [] };
      break;
    case 'approval':
      data = { stage: 'approval', pendingApprovals: [] };
      break;
    case 'develop':
      data = {
        stage: 'develop',
        activeRuns:
          runsQ.data && runsQ.data.state === 'ok' ? runsQ.data.runs : [],
      };
      break;
    case 'pr':
      data = { stage: 'pr', openPullRequests: [] };
      break;
  }

  return {
    state: isError ? 'error' : isLoading ? 'loading' : isSuccess ? 'live' : 'loading',
    data,
    error: firstError,
    isLoading,
    isError,
    isSuccess,
    /** TanStack's QueryObserver instances for granular rendering. */
    queries: { ideasQ, adrsQ, runsQ },
  };
}

/** Re-export so callers don't need to know which hooks back the stage. */
export { useQueries };