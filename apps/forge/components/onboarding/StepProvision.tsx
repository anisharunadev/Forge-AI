'use client';

/**
 * StepProvision — step-61 Zone 3, M9-G4 (Track B / T-B5).
 *
 * Wires the wizard's final 5-stage provisioning step to the real
 * backend job (`POST /onboarding/provision` + polled
 * `GET /onboarding/provision/status`) instead of a fake `setInterval`
 * that just animates over 600ms intervals and reports 100% complete
 * regardless of what the orchestrator did.
 *
 * State machine:
 *   idle    → click "Provision project" → POST /onboarding/provision
 *   running → poll /onboarding/provision/status every 1s; stages
 *             tick over as the backend marks them complete
 *   done    → backend reports `status=done`; surface the open-project CTA
 *   failed  → backend reports `status=failed`; surface retry + the error
 *
 * The 5 UX labels (manifest / graph / connectors / audit / ready)
 * are preserved — only the *driver* changes (backend-reported
 * progress vs. wall-clock interval).
 *
 * M9-G4 — once the bootstrap is complete (parent passes a parsed
 * `BootstrapReport` payload), render the `<BootstrapReportCard />`
 * underneath the success CTA. When the parent has not yet polled
 * a report (or the backend hasn't emitted one yet), render the
 * "Pending — provisioning still running" state from the card.
 */

import * as React from 'react';
import { Check, Loader2, PartyPopper, RotateCw, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useProvisionStatus } from '@/lib/api/onboarding-hooks';
import { BootstrapReportCard } from '@/components/onboarding/BootstrapReportCard';
import type { BootstrapReportShape } from '@/components/onboarding/BootstrapReportCard';
import { toast } from 'sonner';

export type ProvisionState = 'idle' | 'running' | 'done' | 'failed';

export interface StepProvisionProps {
  state: ProvisionState;
  onProvision: () => void;
  onReset: () => void;
  /** Tenant URL surfaced after provisioning succeeds. */
  tenantUrl?: string;
  /** Optional callback fired when polling detects a terminal state. */
  onStateChange?: (next: ProvisionState) => void;
  /**
   * Day-one bootstrap report payload (M9-G4). When `null` (the
   * default), the card renders its Pending state. The page is
   * expected to source this payload from
   * `GET /v1/onboarding/provision/report` (or a future equivalent);
   * until that endpoint is live the card stays in Pending.
   */
  report?: BootstrapReportShape | null;
}

/** 5 sub-stages — each ticks over when the backend reports it done. */
const STAGES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'manifest', label: 'Submitting tenant manifest' },
  { id: 'graph', label: 'Spinning up project graph shard' },
  { id: 'connectors', label: 'Provisioning connectors' },
  { id: 'audit', label: 'Seeding audit channel' },
  { id: 'ready', label: 'Project online' },
];

const POLL_INTERVAL_MS = 1_000;

export function StepProvision({
  state,
  onProvision,
  onReset,
  tenantUrl,
  onStateChange,
  report,
}: StepProvisionProps) {
  // Local mirror of the polling progress. Kept separate from the
  // parent's `state` so an external `setProvisionState('done')`
  // doesn't reset our progress rendering mid-render.
  const [progress, setProgress] = React.useState({
    status: 'idle' as 'idle' | 'running' | 'done' | 'failed',
    current_stage: null as string | null,
    completed_stages: [] as string[],
    error: null as string | null,
  });

  // The page fires the initial POST and flips `state` to 'running'.
  // We poll `useProvisionStatus` every 1s while running; the hook
  // owns the fetch lifecycle (no manual setInterval / clearInterval).
  const status = useProvisionStatus({
    refetchInterval: state === 'running' ? POLL_INTERVAL_MS : false,
  });

  // Mirror polled backend state into the local view model + fire
  // terminal-state transitions once. The hook is the single source
  // of truth for transition out of 'running'.
  React.useEffect(() => {
    const data = status.data;
    if (!data) return;
    setProgress({
      status: data.status,
      current_stage: data.current_stage,
      completed_stages: data.completed_stages ?? [],
      error: data.error,
    });
    if (data.status === 'done') {
      toast.success('Project provisioned');
      onStateChange?.('done');
    } else if (data.status === 'failed') {
      toast.error(`Provisioning failed: ${data.error ?? 'unknown error'}`);
      onStateChange?.('failed');
    }
  }, [status.data, onStateChange]);

  // When leaving 'running' (success or failure) clear the local
  // progress so the next run starts clean.
  React.useEffect(() => {
    if (state === 'idle') {
      setProgress({
        status: 'idle',
        current_stage: null,
        completed_stages: [],
        error: null,
      });
    }
  }, [state]);

  const completedCount = progress.completed_stages.length;
  const showError = state === 'failed' && Boolean(progress.error);

  return (
    <section className="space-y-6" data-testid="step-provision">
      <header className="space-y-1">
        <h2
          className="flex items-center gap-2"
          style={{
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--fg-primary)',
          }}
        >
          {state === 'done' ? (
            <PartyPopper
              className="h-4 w-4"
              style={{ color: 'var(--accent-emerald)' }}
              aria-hidden="true"
            />
          ) : state === 'failed' ? (
            <AlertTriangle
              className="h-4 w-4"
              style={{ color: 'var(--accent-rose)' }}
              aria-hidden="true"
            />
          ) : (
            <Loader2
              className="h-4 w-4 animate-spin"
              style={{ color: 'var(--accent-primary)' }}
              aria-hidden="true"
            />
          )}
          {state === 'done'
            ? 'Project provisioned'
            : state === 'failed'
              ? 'Provisioning failed'
              : 'Provisioning your project'}
        </h2>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--fg-secondary)',
            lineHeight: 'var(--leading-base)',
          }}
        >
          {state === 'done'
            ? 'Your new project is live. You can revisit any step from the Project Settings page.'
            : state === 'failed'
              ? `Something went wrong while bringing the project online: ${progress.error ?? 'unknown error'}. Retry from here or check the audit log.`
              : 'Forge is bringing your project online. You can keep working in other tabs while this runs.'}
        </p>
      </header>

      {showError ? (
        <div
          role="alert"
          className="rounded-md border p-3"
          style={{
            background: 'rgba(244, 63, 94, 0.06)',
            borderColor: 'rgba(244, 63, 94, 0.30)',
          }}
          data-testid="provision-error"
        >
          <p
            style={{
              fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--accent-rose)',
            }}
          >
            {progress.error}
          </p>
        </div>
      ) : null}

      <ol
        className="space-y-2"
        data-testid="provision-stages"
        aria-live="polite"
      >
        {STAGES.map((stage, idx) => {
          const isDone =
            progress.completed_stages.includes(stage.id) ||
            (state === 'done' && idx < STAGES.length);
          const isCurrent =
            progress.current_stage === stage.id && state === 'running';
          return (
            <li
              key={stage.id}
              className="flex items-center gap-3 rounded-md border p-3"
              style={{
                borderColor: isDone
                  ? 'rgba(16, 185, 129, 0.30)'
                  : isCurrent
                    ? 'var(--accent-primary)'
                    : 'var(--border-subtle)',
                background: isDone
                  ? 'rgba(16, 185, 129, 0.06)'
                  : isCurrent
                    ? 'var(--bg-inset)'
                    : 'var(--bg-elevated)',
                fontSize: 'var(--text-sm)',
                color: isDone
                  ? 'var(--fg-primary)'
                  : isCurrent
                    ? 'var(--fg-primary)'
                    : 'var(--fg-tertiary)',
              }}
              data-testid={`provision-stage-${stage.id}`}
              data-state={
                isDone ? 'done' : isCurrent ? 'running' : 'pending'
              }
            >
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-full"
                style={{
                  background: isDone
                    ? 'var(--accent-emerald)'
                    : isCurrent
                      ? 'var(--accent-primary)'
                      : 'var(--bg-inset)',
                  color:
                    isDone || isCurrent ? 'white' : 'var(--fg-tertiary)',
                }}
                aria-hidden="true"
              >
                {isDone ? (
                  <Check className="h-3 w-3" />
                ) : isCurrent ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span
                    className="font-mono"
                    style={{ fontSize: 10 }}
                  >
                    {idx + 1}
                  </span>
                )}
              </span>
              <span className="flex-1">{stage.label}</span>
            </li>
          );
        })}
      </ol>

      {state === 'done' && tenantUrl ? (
        <div
          className="rounded-md border p-4"
          style={{
            background: 'rgba(16, 185, 129, 0.06)',
            borderColor: 'rgba(16, 185, 129, 0.30)',
          }}
          data-testid="provision-success"
        >
          <p
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--fg-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
            }}
          >
            Tenant URL
          </p>
          <p
            className="mt-1"
            style={{
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--accent-emerald)',
            }}
          >
            {tenantUrl}
          </p>
        </div>
      ) : null}

      {/* M9-G4 (Track B T-B5) — surface the Day-One bootstrap report.
       * The card renders a "Pending" placeholder when `report` is
       * null OR has no `completed_at`; otherwise it shows the
       * 4-row count table (standards, templates, governance,
       * steering) + the run_id badge. The parent is the source of
       * truth for the report payload; we just present it. */}
      <BootstrapReportCard report={report ?? null} />

      <div className="flex items-center gap-2 pt-2">
        {state === 'idle' || state === 'failed' ? (
          <Button
            size="sm"
            onClick={onProvision}
            data-testid="provision-run"
          >
            {state === 'failed' ? 'Retry provisioning' : 'Provision project'}
          </Button>
        ) : null}
        {state === 'done' ? (
          <>
            <Button
              size="sm"
              onClick={() => {
                if (tenantUrl && typeof window !== 'undefined') {
                  window.location.href = tenantUrl;
                }
              }}
              data-testid="provision-open"
            >
              Open project
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onReset}
              data-testid="provision-restart"
            >
              Run wizard again
            </Button>
          </>
        ) : null}
        {state === 'failed' ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onReset}
            data-testid="provision-restart"
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset
          </Button>
        ) : null}
      </div>

      {/* Hidden marker for tests — completed stage count is observable. */}
      <span
        data-testid="provision-progress"
        data-completed={completedCount}
        data-current={progress.current_stage ?? ''}
        className="sr-only"
      >
        {completedCount}/{STAGES.length}
      </span>
    </section>
  );
}