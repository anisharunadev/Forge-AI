'use client';

import * as React from 'react';
import { Bot } from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { AssignableAgent } from '@/lib/onboarding/data';

export interface StepConfigureAgentsProps {
  agents: ReadonlyArray<AssignableAgent>;
  selected: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
}

/**
 * Step 4 — Configure agents. Each row is a toggle card with the
 * agent's name, type, default provider, and a brief description.
 */
export function StepConfigureAgents({
  agents,
  selected,
  onChange,
}: StepConfigureAgentsProps) {
  const isSelected = (id: string) => selected.includes(id);

  const setSelected = (id: string, next: boolean) => {
    if (next) {
      if (!selected.includes(id)) onChange([...selected, id]);
    } else {
      onChange(selected.filter((s) => s !== id));
    }
  };

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5 space-y-5"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
      }}
      data-testid="step-configure-agents"
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
          <Bot className="h-4 w-4" aria-hidden="true" />
          Configure agents
        </h2>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--fg-secondary)',
            lineHeight: 'var(--leading-base)',
          }}
        >
          Pick which agents can run on this project. You can change
          assignments later from the Agent Center.
        </p>
      </header>

      <ul role="list" className="space-y-2" data-testid="agent-list">
        {agents.map((a) => {
          const active = isSelected(a.id);
          return (
            <li key={a.id}>
              <label
                htmlFor={`agent-${a.id}`}
                className={cn(
                  'flex items-start justify-between gap-3 rounded-[var(--radius-md)] border p-3 transition-colors cursor-pointer',
                  active && 'shadow-[var(--shadow-glow-primary)]',
                )}
                style={{
                  background: 'var(--bg-elevated)',
                  borderColor: active
                    ? 'var(--accent-primary)'
                    : 'var(--border-subtle)',
                }}
                data-testid={`agent-toggle-${a.id}`}
                data-selected={String(active)}
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p
                    style={{
                      fontSize: 'var(--text-sm)',
                      fontWeight: 'var(--font-weight-medium)',
                      color: 'var(--fg-primary)',
                    }}
                  >
                    {a.name}
                  </p>
                  <p
                    style={{
                      fontSize: '10px',
                      color: 'var(--fg-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                    }}
                  >
                    {a.type} · {a.defaultProvider}
                  </p>
                  <p
                    className="mt-1"
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--fg-secondary)',
                      lineHeight: 'var(--leading-base)',
                    }}
                  >
                    {a.description}
                  </p>
                </div>
                <Switch
                  id={`agent-${a.id}`}
                  checked={active}
                  onCheckedChange={(c) => setSelected(a.id, c)}
                />
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}