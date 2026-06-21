'use client';

import * as React from 'react';
import { Bot, Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { AssignableAgent } from '@/lib/onboarding/data';

export interface StepConfigureAgentsProps {
  agents: ReadonlyArray<AssignableAgent>;
  selected: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
}

export function StepConfigureAgents({
  agents,
  selected,
  onChange,
}: StepConfigureAgentsProps) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <section
      className="card space-y-4"
      data-testid="step-configure-agents"
    >
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Bot className="h-4 w-4" aria-hidden="true" />
          Configure agents
        </h2>
        <p className="text-sm text-forge-300">
          Pick which agents can run on this project. You can change
          assignments later from the Agent Center.
        </p>
      </header>

      <ul role="list" className="space-y-2" data-testid="agent-list">
        {agents.map((a) => {
          const active = selected.includes(a.id);
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => toggle(a.id)}
                className={cn(
                  'card flex w-full items-center justify-between gap-3 text-left transition-colors',
                  active ? 'ring-1 ring-ring' : 'hover:bg-forge-800/60',
                )}
                data-testid={`agent-toggle-${a.id}`}
                data-selected={String(active)}
              >
                <div>
                  <p className="text-sm font-medium">{a.name}</p>
                  <p className="text-[10px] text-forge-300">
                    {a.type} · {a.defaultProvider}
                  </p>
                  <p className="mt-1 text-xs text-forge-200">{a.description}</p>
                </div>
                {active ? (
                  <Check
                    className="h-4 w-4 text-emerald-300"
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
