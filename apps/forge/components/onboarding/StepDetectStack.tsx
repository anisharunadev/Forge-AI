'use client';

import * as React from 'react';
import { Layers, Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { DetectedStack, SampleRepo } from '@/lib/onboarding/data';

const CONFIDENCE_TONE: Record<DetectedStack['confidence'], string> = {
  high: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  low: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

export interface StepDetectStackProps {
  stacks: ReadonlyArray<DetectedStack>;
  repos: ReadonlyArray<SampleRepo>;
  accepted: ReadonlyArray<string>;
  onAccept: (next: string[]) => void;
}

export function StepDetectStack({
  stacks,
  repos,
  accepted,
  onAccept,
}: StepDetectStackProps) {
  const repoById = React.useMemo(
    () => new Map(repos.map((r) => [r.id, r])),
    [repos],
  );

  const toggle = (id: string) => {
    if (accepted.includes(id)) {
      onAccept(accepted.filter((s) => s !== id));
    } else {
      onAccept([...accepted, id]);
    }
  };

  return (
    <section className="card space-y-4" data-testid="step-detect-stack">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Layers className="h-4 w-4" aria-hidden="true" />
          Stack detection
        </h2>
        <p className="text-sm text-forge-300">
          Confirm the languages, frameworks, and tooling we detected.
          {accepted.length > 0
            ? ` ${accepted.length} of ${stacks.length} confirmed.`
            : null}
        </p>
      </header>

      <ul role="list" className="space-y-2" data-testid="stack-list">
        {stacks.map((s) => {
          const active = accepted.includes(s.id);
          const repo = repoById.get(s.repoId);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => toggle(s.id)}
                className={cn(
                  'card flex w-full items-center justify-between gap-3 text-left transition-colors',
                  active ? 'ring-1 ring-ring' : 'hover:bg-forge-800/60',
                )}
                data-testid={`stack-item-${s.id}`}
                data-accepted={String(active)}
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    {s.language}
                    {s.framework ? ` · ${s.framework}` : ''}
                  </p>
                  <p className="text-[10px] text-forge-300">
                    {repo?.url ?? s.repoId}
                    {s.buildTool ? ` · build: ${s.buildTool}` : ''}
                    {s.testFramework ? ` · test: ${s.testFramework}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                      CONFIDENCE_TONE[s.confidence],
                    )}
                  >
                    {s.confidence}
                  </span>
                  {active ? (
                    <Check
                      className="h-3 w-3 text-emerald-300"
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
