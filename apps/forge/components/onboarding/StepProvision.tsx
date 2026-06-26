'use client';

import * as React from 'react';
import { Check, Loader2, PartyPopper, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

export type ProvisionState = 'idle' | 'running' | 'done' | 'failed';

export interface StepProvisionProps {
  state: ProvisionState;
  onProvision: () => void;
  onReset: () => void;
  /** Tenant URL surfaced after provisioning succeeds. */
  tenantUrl?: string;
}

/** 5 sub-stages surfaced as a checklist while provisioning runs.
 *  Each one ticks over with a tiny delay so the UI feels alive
 *  without faking the whole orchestrator round-trip. */
const STAGES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'manifest', label: 'Submitting tenant manifest' },
  { id: 'graph', label: 'Spinning up project graph shard' },
  { id: 'connectors', label: 'Provisioning connectors' },
  { id: 'audit', label: 'Seeding audit channel' },
  { id: 'ready', label: 'Project online' },
];

const STAGE_DELAY_MS = 600;

export function StepProvision({
  state,
  onProvision,
  onReset,
  tenantUrl,
}: StepProvisionProps) {
  const [completed, setCompleted] = React.useState(0);

  React.useEffect(() => {
    if (state !== 'running') {
      setCompleted(state === 'done' ? STAGES.length : 0);
      return;
    }
    setCompleted(0);
    let idx = 0;
    const id = window.setInterval(() => {
      idx += 1;
      setCompleted(Math.min(STAGES.length, idx));
      if (idx >= STAGES.length) {
        window.clearInterval(id);
      }
    }, STAGE_DELAY_MS);
    return () => window.clearInterval(id);
  }, [state]);

  return (
    <section
      className="space-y-6"
      data-testid="step-provision"
    >
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
            <RotateCw
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
              ? 'Something went wrong while bringing the project online. Retry from here or check the audit log.'
              : 'Forge is bringing your project online. You can keep working in other tabs while this runs.'}
        </p>
      </header>

      <ol
        className="space-y-2"
        data-testid="provision-stages"
        aria-live="polite"
      >
        {STAGES.map((stage, idx) => {
          const isDone = idx < completed;
          const isCurrent = idx === completed && state === 'running';
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
              data-state={isDone ? 'done' : isCurrent ? 'running' : 'pending'}
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
      </div>
    </section>
  );
}