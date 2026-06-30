'use client';

/**
 * StepProvision — step-61 Zone 3.
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
 */

import * as React from 'react';
import { Check, Loader2, PartyPopper, RotateCw, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api/client';
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
}

/** 5 sub-stages — each ticks over when the backend reports it done. */
const STAGES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'manifest', label: 'Submitting tenant manifest' },
  { id: 'graph', label: 'Spinning up project graph shard' },
  { id: 'connectors', label: 'Provisioning connectors' },
  { id: 'audit', label: 'Seeding audit channel' },
  { id: 'ready', label: 'Project online' },
];

/** Shape returned by ``GET /onboarding/provision/status``. */
interface ProvisionProgress {
  job_id?: string;
  status: 'idle' | 'running' | 'done' | 'failed';
  current_stage: string | null;
  completed_stages: string[];
  error: string | null;
}

const POLL_INTERVAL_MS = 1_000;

export function StepProvision({
  state,
  onProvision,
  onReset,
  tenantUrl,
  onStateChange,
}: StepProvisionProps) {
  // Local mirror of the polling progress. Kept separate from the
  // parent's `state` so an external `setProvisionState('done')`
  // doesn't reset our progress rendering mid-render.
  const [progress, setProgress] = React.useState<ProvisionProgress>({
    status: 'idle',
    current_stage: null,
    completed_stages: [],
    error: null,
  });

  // Poll the backend every POLL_INTERVAL_MS while running. The polling
  // effect is the single source of truth for transition out of
  // 'running' — the parent fires the initial POST and flips `state`
  // to 'running', then this loop drives the rest.
  React.useEffect(() => {
    if (state !== 'running') return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const data = await api.get<ProvisionProgress>(
          '/onboarding/provision/status',
        );
        if (cancelled) return;
        setProgress({
          status: data.status,
          current_stage: data.current_stage,
          completed_stages: data.completed_stages ?? [],
          error: data.error,
        });

        if (data.status === 'done') {
          if (intervalId) clearInterval(intervalId);
          toast.success('Project provisioned');
          onStateChange?.('done');
        } else if (data.status === 'failed') {
          if (intervalId) clearInterval(intervalId);
          toast.error(`Provisioning failed: ${data.error ?? 'unknown error'}`);
          onStateChange?.('failed');
        }
      } catch (err) {
        if (cancelled) return;
        // Network blip — surface the error but keep polling; the
        // backend may recover on the next tick.
        const message =
          err instanceof ApiError
            ? `HTTP ${err.status}`
            : err instanceof Error
              ? err.message
              : 'unknown error';
        setProgress((prev) => ({ ...prev, error: message }));
      }
    };

    poll(); // immediate first call
    intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [state, onStateChange]);

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