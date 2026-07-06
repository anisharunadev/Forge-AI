'use client';

/**
 * apps/forge/lib/workflow/use-workflow-state.ts — localStorage-backed
 * stage progress (Sprint 1, stage-state gap).
 *
 * Tracks `current` (where the user is) and `completed` (which stages
 * are done). The hook degrades silently if localStorage is blocked
 * (private mode, quota exceeded, etc.) — never throws.
 *
 * Ponytail: this is a stub. Sprint 2 swaps it for StageStateService
 * (backend) so progress survives across devices and tenants. Until
 * then, localStorage is honest enough to validate the bar's ✓ ▶ ○
 * semantics without touching the backend.
 */

import { useEffect, useState } from 'react';

import { FIRST_STAGE, isValidStage, STAGES, type StageSlug } from './stages';

const STORAGE_KEY = 'forge.workflow.state.v1';

export interface WorkflowState {
  current: StageSlug;
  completed: ReadonlyArray<StageSlug>;
}

const INITIAL: WorkflowState = { current: FIRST_STAGE, completed: [] };

function readStorage(): WorkflowState {
  if (typeof window === 'undefined') return INITIAL;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL;
    const parsed = JSON.parse(raw) as {
      current?: unknown;
      completed?: unknown;
    };
    const current = isValidStage(parsed.current)
      ? parsed.current
      : INITIAL.current;
    const completed = Array.isArray(parsed.completed)
      ? parsed.completed.filter(isValidStage)
      : [];
    // ponytail: if the user reduced the STAGES list and the saved
    // `current` is now beyond the end, clamp to FIRST_STAGE.
    if (!STAGES.some((s) => s.slug === current)) {
      return { current: INITIAL.current, completed };
    }
    return { current, completed };
  } catch {
    return INITIAL;
  }
}

function writeStorage(state: WorkflowState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ponytail: storage may be full / blocked — degrade silently.
  }
}

export interface UseWorkflowState {
  state: WorkflowState;
  setCurrent: (slug: StageSlug) => void;
  markComplete: (slug: StageSlug) => void;
  reset: () => void;
  isReady: boolean;
}

export function useWorkflowState(): UseWorkflowState {
  const [state, setState] = useState<WorkflowState>(INITIAL);
  const [isReady, setIsReady] = useState(false);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    setState(readStorage());
    setIsReady(true);
  }, []);

  // Persist on change (skip the initial render).
  useEffect(() => {
    if (!isReady) return;
    writeStorage(state);
  }, [state, isReady]);

  return {
    state,
    setCurrent: (slug) =>
      setState((prev) => ({ ...prev, current: slug })),
    markComplete: (slug) =>
      setState((prev) =>
        prev.completed.includes(slug)
          ? prev
          : { ...prev, completed: [...prev.completed, slug] },
      ),
    reset: () => setState(INITIAL),
    isReady,
  };
}