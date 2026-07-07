/**
 * Workflow state types — the five states a workflow stage can be in.
 *
 * Per the audit's P0 critical blocker list, every page must surface
 * the data-source state. The legacy nine-center grid used ad-hoc
 * banners (or worse, silent mock fallbacks). The workflow shell
 * collapses those into a single typed state machine:
 *
 *   - `live`    — fresh data from the API, no degradation
 *   - `cached`  — stale data, API unavailable (read-only)
 *   - `demo`    — demo / seed data, never trusted for production
 *   - `error`   — the underlying API returned a fatal error
 *   - `loading` — initial fetch in flight
 *
 * State derivation is a pure function (`deriveStageState`) so the
 * banner is deterministic given the inputs. `useStageData` (in
 * `use-stage-data.ts`) is the React hook that supplies those inputs.
 *
 * Rule 4 (typed artifacts) applies — no free-form blobs. The error
 * envelope mirrors the backend's `Phase4Error.to_envelope()` shape.
 */

// NOTE: deliberately no `@/lib/api/client` import here — this module
// must compile in isolation (for the regression script) and the
// ApiError type is structural (`extends Error`), so we type the
// error as a plain `Error` here. `toErrorEnvelope` handles ApiError
// instances by recognizing the `body` wrapper field.

/** The five typed states a workflow stage can be in. */
export type CenterState = 'live' | 'cached' | 'demo' | 'error' | 'loading';

/** Render priority for the banner (live trumps all, error is loudest). */
export const STATE_PRIORITY: Readonly<Record<CenterState, number>> = {
  error: 5,
  loading: 4,
  demo: 3,
  cached: 2,
  live: 1,
};

/** Mirror of backend `Phase4Error.to_envelope()`. */
export interface ErrorEnvelope {
  readonly error: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly occurred_at: string;
}

/** Inputs to `deriveStageState`. */
export interface StageStateInputs {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error?: Error | null;
  /** True if the data is from a demo/seed source (never trusted). */
  readonly isDemo?: boolean;
  /** True if the data is stale (server indicated cache, or query older than 60s). */
  readonly isCached?: boolean;
  /** Set to true when the data has been freshly fetched. */
  readonly isSuccess?: boolean;
}

/**
 * Pure derivation. Returns the banner state given a TanStack Query
 * result + data-source hints. Higher-priority states win when
 * multiple apply (e.g. `loading + error` → `error`).
 */
export function deriveStageState(inputs: StageStateInputs): CenterState {
  if (inputs.isError) return 'error';
  if (inputs.isLoading) return 'loading';
  if (inputs.isDemo === true) return 'demo';
  if (inputs.isCached === true) return 'cached';
  if (inputs.isSuccess === true) return 'live';
  return 'loading';
}

/** Type guard for the error envelope shape returned by the backend. */
export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.error === 'string' &&
    typeof v.message === 'string' &&
    typeof v.details === 'object' &&
    v.details !== null &&
    typeof v.occurred_at === 'string'
  );
}

/**
 * Extract a typed `ErrorEnvelope` from an unknown thrown value.
 * Falls back to a synthesized envelope when the body is not shaped
 * like one (e.g. an uncaught runtime error).
 */
export function toErrorEnvelope(value: unknown): ErrorEnvelope {
  if (value instanceof Error) {
    return {
      error: 'UNEXPECTED_ERROR',
      message: value.message,
      details: { name: value.name },
      occurred_at: new Date().toISOString(),
    };
  }
  if (isErrorEnvelope(value)) return value;
  // Body may be wrapped under a `body` field on `ApiError`.
  if (value && typeof value === 'object' && 'body' in value) {
    const wrapped = (value as { body: unknown }).body;
    if (isErrorEnvelope(wrapped)) return wrapped;
  }
  return {
    error: 'UNKNOWN_ERROR',
    message: 'An unexpected error occurred.',
    details: { value: String(value) },
    occurred_at: new Date().toISOString(),
  };
}

/** Human-readable label for each state, used by the banner. */
export const STATE_LABEL: Readonly<Record<CenterState, string>> = {
  live: 'Live data',
  cached: 'Cached data',
  demo: 'Demo data',
  error: 'Error',
  loading: 'Loading',
};

/** Stable testid suffix per state (used by e2e selectors). */
export const STATE_TESTID: Readonly<Record<CenterState, string>> = {
  live: 'workflow-state-live',
  cached: 'workflow-state-cached',
  demo: 'workflow-state-demo',
  error: 'workflow-state-error',
  loading: 'workflow-state-loading',
};