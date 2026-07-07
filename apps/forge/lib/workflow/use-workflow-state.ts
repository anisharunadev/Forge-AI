/**
 * Workflow state hook — Day 5 stub.
 *
 * ponytail: created because workflow-progress-bar.tsx imports
 * `useWorkflowState` from this path. The real implementation persists
 * `current` + `completed` to localStorage; this stub returns a static
 * 'spec' default so the progress bar renders. Wire to localStorage
 * (and the `/api/v1/workflow/state` endpoint when it exists) before
 * shipping the workflow editor.
 */
'use client';

import { useState } from 'react';
import type { StageSlug } from './stages';

export interface WorkflowState {
  current: StageSlug;
  completed: ReadonlyArray<StageSlug>;
}

const DEFAULT_STATE: WorkflowState = {
  current: 'spec',
  completed: [],
};

export function useWorkflowState(): { state: WorkflowState } {
  // ponytail: SSR-safe default; client effects would mount after hydration.
  const [state] = useState<WorkflowState>(DEFAULT_STATE);
  return { state };
}
