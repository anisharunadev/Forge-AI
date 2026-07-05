'use client';

/**
 * useOnboardingTour — M9-G1 (Track B / T-B2).
 *
 * State machine for the guided product tour shown on the Onboarding
 * Wizard. A returning pilot who has already completed (or skipped)
 * the tour should not see it again — the hook persists that fact
 * under the `forge.onboarding.tour.v1` localStorage key.
 *
 * State shape:
 *   { isOpen: boolean, stopIndex: number, completed: boolean, skipped: boolean }
 *
 * Public methods:
 *   open()    — call when the user clicks "Take a quick tour" on
 *                StepWelcome. Resets `stopIndex` to 0 and shows
 *                the overlay.
 *   close()   — close the overlay WITHOUT persisting completion or
 *                skip. Used when the parent wants to remove the
 *                overlay transiently (e.g. a higher-priority
 *                dialog). Most flows should prefer `complete()`
 *                or `skip()`.
 *   next()    — advance `stopIndex` by 1. On the last stop this
 *                is a no-op (use `complete()` instead).
 *   prev()    — retreat `stopIndex` by 1. On the first stop this
 *                is a no-op.
 *   complete()— close the overlay AND persist `completed: true`.
 *   skip()    — close the overlay AND persist `skipped: true`.
 *   reset()   — clear the localStorage flag so the tour reappears
 *                on next mount. Useful for QA / "Run wizard again".
 *   goTo(i)   — jump to an arbitrary stop (exposed for tests and
 *                for potential future deep-link support).
 *
 * Storage semantics:
 *   - The hook only writes to localStorage after either
 *     `complete()` or `skip()` is called. Intermediate states
 *     (stopIndex mid-walk) are NEVER persisted — a refresh mid-
 *     tour should restart from stop 0 (not silently resume).
 *   - `reset()` clears the storage key entirely.
 *   - All hooks read the storage key once on mount and never
 *     listen for the storage event. This is intentional — the
 *     hook owns its lifecycle within a single page load.
 */

import * as React from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Bump the `version` field when the on-disk shape changes
 * incompatibly. v1 = initial release. */
export const TOUR_STORAGE_KEY = 'forge.onboarding.tour.v1';

/** Default number of stops. Exposed so `reset()` can validate
 * hydration against the expected tour length — currently used by
 * tests to assert the persistent state. */
export const TOUR_STOP_COUNT = 6;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OnboardingTourState {
  /** Whether the overlay is currently rendered. The page reads
   * this to conditionally mount `<ProductTourOverlay>`. */
  isOpen: boolean;
  /** Index of the active stop (0..stopCount - 1). */
  stopIndex: number;
  /** True after the user clicks "Done" on the final stop. */
  completed: boolean;
  /** True after the user clicks "Skip". Mutually exclusive with
   * `completed` — a single tour walk produces exactly one
   * terminal flag. */
  skipped: boolean;

  open: () => void;
  close: () => void;
  next: (stopCount?: number) => void;
  prev: () => void;
  goTo: (index: number) => void;
  /** Persist completion + close the overlay. */
  complete: () => void;
  /** Persist skip + close the overlay. */
  skip: () => void;
  /** Clear persisted state so the tour reappears on next mount. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read the persisted flag from localStorage. Tolerates quota
 * errors, corrupt JSON, and SSR (no window) — all by returning
 * `null`, which callers treat as "no opinion, show the tour".
 */
function readPersistedFlag(): { completed: boolean; skipped: boolean } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TOUR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      state?: { completed?: unknown; skipped?: unknown };
    };
    const c = parsed?.state?.completed === true;
    const s = parsed?.state?.skipped === true;
    if (!c && !s) return null;
    return { completed: c, skipped: s };
  } catch {
    return null;
  }
}

/**
 * Hook that owns the tour lifecycle. Combining Zustand (for the
 * reactive store + localStorage persistence) with a tiny
 * hydration helper (so we can hide the overlay immediately on
 * mount for pilots who already dismissed it).
 */
export const useOnboardingTourStore = create<OnboardingTourState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      stopIndex: 0,
      completed: false,
      skipped: false,

      open: () =>
        set((state) => {
          // If the user is already past a terminal flag, `open()`
          // is a no-op (the page must call `reset()` first). This
          // prevents a stale "completed" user from accidentally
          // re-entering a tour they thought they had finished.
          if (state.completed || state.skipped) return state;
          return { isOpen: true, stopIndex: 0 };
        }),

      close: () =>
        set({
          isOpen: false,
          // Leave stopIndex as-is so a transient close (e.g. an
          // emergency dialog) can re-open at the same stop.
        }),

      next: (stopCount: number = TOUR_STOP_COUNT) => {
        const { stopIndex } = get();
        if (stopIndex >= stopCount - 1) {
          // Reached the last stop — move to the implicit "after
          // the tour" state without auto-completing. The user
          // must click "Done" explicitly; on the final stop the
          // overlay renders `onDone` rather than `onNext`.
          return;
        }
        set({ stopIndex: stopIndex + 1 });
      },

      prev: () => {
        const { stopIndex } = get();
        if (stopIndex <= 0) return;
        set({ stopIndex: stopIndex - 1 });
      },

      goTo: (index: number) => {
        if (!Number.isFinite(index)) return;
        const clamped = Math.max(0, Math.floor(index));
        set({ stopIndex: clamped });
      },

      complete: () => set({ isOpen: false, completed: true, skipped: false }),

      skip: () => set({ isOpen: false, completed: false, skipped: true }),

      reset: () => {
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.removeItem(TOUR_STORAGE_KEY);
          } catch {
            /* ignore quota errors */
          }
        }
        set({
          isOpen: false,
          stopIndex: 0,
          completed: false,
          skipped: false,
        });
      },
    }),
    {
      name: TOUR_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Persist ONLY the terminal flags. The transient state
      // (isOpen, stopIndex) is intentionally NOT persisted — a
      // refresh mid-tour should restart the walk from stop 0,
      // not silently resume.
      partialize: (state) => ({
        completed: state.completed,
        skipped: state.skipped,
      }),
      version: 1,
    },
  ),
);

/**
 * Drop-in hook for components. Wraps the Zustand selector with a
 * one-shot hydration guard so a returning pilot does not see the
 * overlay flash before the persisted state resolves.
 *
 * Usage (page-level):
 *   const tour = useOnboardingTour();
 *   ...
 *   return (
 *     <>
 *       {tour.isOpen ? <ProductTourOverlay {...tour} /> : null}
 *     </>
 *   );
 */
export function useOnboardingTour(): OnboardingTourState {
  const state = useOnboardingTourStore();
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    // Read once on mount. The Zustand `persist` middleware has
    // already rehydrated by now (it runs synchronously during
    // store creation), so this is a defensive cross-check used
    // by the test suite. We expose it as a no-op for now and
    // keep the `hydrated` flag for future use (e.g. showing a
    // fallback while waiting for a backend-driven session).
    const persisted = readPersistedFlag();
    if (persisted) {
      // Don't overwrite if the store already has a terminal flag.
      // Just sync the flag for callers that read it directly.
      if (!state.completed && persisted.completed) {
        useOnboardingTourStore.setState({
          completed: persisted.completed,
          skipped: persisted.skipped,
        });
      }
    }
    setHydrated(true);
    // We only run this once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Returning pilots: never auto-open. The page owns the trigger
  // (the "Take a quick tour" button on StepWelcome).
  return React.useMemo(
    () => ({
      ...state,
      // If the hook has hydrated and the user is past a terminal
      // flag, suppress `isOpen` so the overlay never flashes.
      isOpen: state.isOpen && !state.completed && !state.skipped && hydrated,
    }),
    [state, hydrated],
  );
}

/**
 * Test-only: peek at the current persisted flags without going
 * through the React hook. Used by the tour overlay's "skip
 * persists" test to confirm localStorage was written.
 */
export function readTourPersistedFlag(): {
  completed: boolean;
  skipped: boolean;
} | null {
  return readPersistedFlag();
}

export default useOnboardingTour;
