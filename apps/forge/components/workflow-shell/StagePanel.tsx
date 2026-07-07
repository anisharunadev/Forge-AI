/**
 * StagePanel — the production-grade wrapper every `/workflow/[stage]`
 * page is rendered through.
 *
 * Composes:
 *
 *   - `InternalErrorBoundary` — catches uncaught render-time errors
 *     and renders the typed INTERNAL_ERROR envelope.
 *   - `CenterStateBanner` — surfaces the data-source state (live,
 *     cached, demo, error, loading) at the top of the panel.
 *   - `StageLoadingSkeleton` — replaces content while the data fetch
 *     is in flight.
 *   - `StageEmptyState` — replaces content when the data is empty.
 *   - The children prop — the actual stage content, rendered only
 *     when the data is loaded and non-empty.
 *
 * The panel is intentionally a thin orchestrator: each sub-component
 * is independently testable. The panel does NOT mutate the data; it
 * reads from `useStageData` and dispatches to the right sub-component.
 *
 * The component is `displayName = 'StagePanel'` for easier debugging
 * in the React DevTools.
 */

'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  deriveStageState,
  STATE_LABEL,
  type ErrorEnvelope,
  type StageStateInputs,
} from '@/lib/workflow-shell/states';
import { useStageSideEffects } from '@/lib/workflow-shell/use-stage-side-effects';
import { getStage } from '@/lib/workflow-shell/stages';
import type { WorkflowStageId } from '@/lib/workflow-shell/types';

import { CenterStateBanner } from './CenterStateBanner';
import { InternalErrorBoundary } from './InternalErrorBoundary';
import { StageEmptyState } from './StageEmptyState';
import { StageErrorFallback } from './StageErrorFallback';
import { StageLoadingSkeleton } from './StageLoadingSkeleton';

export interface StagePanelProps {
  readonly stage: WorkflowStageId;
  readonly projectId?: string;
  /** True when the underlying data fetch is in flight. */
  readonly isLoading?: boolean;
  /** True when the underlying data fetch returned an error. */
  readonly isError?: boolean;
  /** The thrown error, if any. */
  readonly error?: Error | { envelope: ErrorEnvelope } | null;
  /** True when the data source is a demo / seed (never trusted). */
  readonly isDemo?: boolean;
  /** True when the data source is stale (cache or older than 60s). */
  readonly isCached?: boolean;
  /** True when the data has been freshly fetched. */
  readonly isSuccess?: boolean;
  /** Optional override for the empty-state copy. */
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
  readonly emptyCtaHref?: string;
  readonly emptyCtaLabel?: string;
  /** Optional skeleton row count. */
  readonly skeletonRows?: number;
  /** Render prop that receives the ready-state content. */
  readonly children: React.ReactNode;
  readonly className?: string;
}

function isErrorEnvelopeShape(
  value: unknown,
): value is { envelope: ErrorEnvelope } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.envelope === 'object' && v.envelope !== null;
}

function detailForError(error: unknown): string | undefined {
  if (!error) return undefined;
  if (isErrorEnvelopeShape(error)) return error.envelope.error;
  if (error instanceof Error) return error.message;
  return undefined;
}

export function StagePanel(props: StagePanelProps) {
  const {
    stage,
    projectId,
    isLoading = false,
    isError = false,
    error = null,
    isDemo = false,
    isCached = false,
    isSuccess = false,
    emptyTitle,
    emptyDescription,
    emptyCtaHref,
    emptyCtaLabel,
    skeletonRows,
    children,
    className,
  } = props;

  const sideEffects = useStageSideEffects({ stage, ...(projectId !== undefined ? { projectId } : {}) });

  // Pure derivation of the banner state.
  const stateInputs: StageStateInputs = {
    isLoading,
    isError,
    ...(error !== null ? { error: error instanceof Error ? error : undefined } : {}),
    isDemo,
    isCached,
    isSuccess,
  };
  const state = deriveStageState(stateInputs);
  const detail = detailForError(error);
  const stageDef = getStage(stage);

  // RBAC — if the user can't view, render a permission-required
  // empty state with no CTA (we don't want to leak the action).
  if (!sideEffects.canView) {
    return (
      <div
        data-testid={`workflow-stage-panel-${stage}`}
        data-state="permission-required"
        className={cn('flex flex-col gap-4', className)}
      >
        <CenterStateBanner state="error" detail="Permission required" />
        <StageEmptyState
          title="You don't have access to this stage"
          description={sideEffects.deniedReason ?? 'Sign in to the workspace to continue.'}
        />
      </div>
    );
  }

  return (
    <div
      data-testid={`workflow-stage-panel-${stage}`}
      data-state={state}
      className={cn('flex flex-col gap-4', className)}
    >
      <InternalErrorBoundary fallbackTitle={`${stageDef.label} stage failed`}>
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{stageDef.label}</h2>
          <CenterStateBanner state={state} {...(detail !== undefined ? { detail } : {})} />
        </header>

        {isLoading ? (
          <StageLoadingSkeleton {...(skeletonRows !== undefined ? { rows: skeletonRows } : {})} />
        ) : isError ? (
          <StageErrorFallback
            envelope={
              isErrorEnvelopeShape(error)
                ? error.envelope
                : {
                    error: 'STAGE_LOAD_FAILED',
                    message:
                      error instanceof Error
                        ? error.message
                        : 'Unable to load this workflow stage.',
                    details: {},
                    occurred_at: new Date().toISOString(),
                  }
            }
          />
        ) : (
          children
        )}

        {/* Empty-state hint when no content rendered — keeps the
            page scannable when a stage legitimately has nothing to
            show. The component's `aria-live="polite"` ensures screen
            readers announce this when it appears. */}
        {!isLoading && !isError && emptyTitle ? (
          <StageEmptyState
            title={emptyTitle}
            {...(emptyDescription !== undefined ? { description: emptyDescription } : {})}
            {...(emptyCtaHref !== undefined ? { ctaHref: emptyCtaHref } : {})}
            {...(emptyCtaLabel !== undefined ? { ctaLabel: emptyCtaLabel } : {})}
          />
        ) : null}
      </InternalErrorBoundary>
    </div>
  );
}

StagePanel.displayName = 'StagePanel';

// Re-export so consumers can `import { StagePanel } from '…'` and
// also reach the typed state helpers.
export { STATE_LABEL };