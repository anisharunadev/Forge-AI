'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { LifecycleVerb, RunStatus } from '@/lib/types';

export interface RunActionsProps {
  runId: string;
  status: RunStatus;
}

/**
 * Operator action bar — pause / resume / cancel. Visible only on the
 * Engineering Lead dashboard (parent hides it for PM and CTO). Buttons
 * are disabled when the verb is not valid for the current status, per
 * the orchestrator state machine (FORA-50 §2.2).
 */
export function RunActions({ runId, status }: RunActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<LifecycleVerb | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allowed = {
    pause: status === 'running' || status === 'waiting_approval',
    resume: status === 'paused',
    cancel:
      status !== 'aborted' && status !== 'finished' && status !== 'done',
  } as const;

  async function call(verb: LifecycleVerb) {
    setPending(verb);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/${verb}`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="run-actions">
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!allowed.pause || pending !== null}
          onClick={() => call('pause')}
          data-action="pause"
        >
          {pending === 'pause' ? 'Pausing…' : 'Pause'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!allowed.resume || pending !== null}
          onClick={() => call('resume')}
          data-action="resume"
        >
          {pending === 'resume' ? 'Resuming…' : 'Resume'}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!allowed.cancel || pending !== null}
          onClick={() => call('cancel')}
          data-action="cancel"
        >
          {pending === 'cancel' ? 'Cancelling…' : 'Cancel'}
        </button>
      </div>
      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}