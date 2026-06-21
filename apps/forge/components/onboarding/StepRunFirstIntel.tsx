'use client';

import * as React from 'react';
import { PlayCircle, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

export type IntelState = 'idle' | 'running' | 'done' | 'failed';

export interface StepRunFirstIntelProps {
  state: IntelState;
  onRun: () => void;
}

export function StepRunFirstIntel({ state, onRun }: StepRunFirstIntelProps) {
  return (
    <section
      className="card space-y-4"
      data-testid="step-run-first-intel"
    >
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <PlayCircle className="h-4 w-4" aria-hidden="true" />
          Run first project intelligence
        </h2>
        <p className="text-sm text-forge-300">
          Kicks off the initial scan to map dependencies, conventions, and
          risks for the selected repos.
        </p>
      </header>

      <div
        className="rounded-md border border-forge-800 bg-forge-900 p-3 text-xs"
        data-testid="intel-status"
        data-state={state}
      >
        {state === 'idle' ? (
          <span>Ready to start. The first pass takes 2–5 minutes.</span>
        ) : null}
        {state === 'running' ? (
          <span className="inline-flex items-center gap-2 text-sky-300">
            <RotateCw className="h-3 w-3 animate-spin" aria-hidden="true" />
            Running…
          </span>
        ) : null}
        {state === 'done' ? (
          <span className="text-emerald-300">
            Done. 4 repos scanned, 6 stacks confirmed, 0 anomalies.
          </span>
        ) : null}
        {state === 'failed' ? (
          <span className="text-rose-300">Failed — retry from the dashboard.</span>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={onRun}
          disabled={state === 'running'}
          data-testid="intel-run"
        >
          <PlayCircle className="h-3 w-3" aria-hidden="true" />
          {state === 'running' ? 'Running…' : 'Run first pass'}
        </Button>
      </div>
    </section>
  );
}
