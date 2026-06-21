'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface WizardProgressProps {
  currentStep: number;
  totalSteps: number;
}

export function WizardProgress({ currentStep, totalSteps }: WizardProgressProps) {
  const pct = Math.max(0, Math.min(100, ((currentStep - 1) / (totalSteps - 1)) * 100));
  return (
    <div className="space-y-2" data-testid="wizard-progress">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-forge-300">
        <span>Step {currentStep} of {totalSteps}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-forge-800">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
          data-testid="wizard-progress-bar"
          data-pct={Math.round(pct)}
        />
      </div>
    </div>
  );
}

export interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  steps: ReadonlyArray<{ id: number; title: string; description: string }>;
  onJump?: (step: number) => void;
}

export function StepIndicator({
  currentStep,
  totalSteps,
  steps,
  onJump,
}: StepIndicatorProps) {
  return (
    <ol
      className="flex flex-wrap items-center gap-2"
      data-testid="wizard-step-indicator"
    >
      {steps.map((s) => {
        const active = s.id === currentStep;
        const done = s.id < currentStep;
        return (
          <li key={s.id}>
            <button
              type="button"
              disabled={!onJump}
              onClick={() => onJump?.(s.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs',
                active
                  ? 'border-primary text-primary'
                  : done
                    ? 'border-emerald-500/40 text-emerald-200'
                    : 'border-forge-700 text-forge-300',
              )}
              data-testid={`wizard-step-${s.id}`}
              data-state={active ? 'active' : done ? 'done' : 'pending'}
            >
              <span className="font-mono">{s.id}</span>
              <span>{s.title}</span>
            </button>
          </li>
        );
      })}
      <li className="ml-auto text-[10px] text-forge-300">
        {totalSteps} steps
      </li>
    </ol>
  );
}
