'use client';

import { Bot, Cpu, Zap } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Agent, AgentStatus } from '@/lib/agent-center/data';

const STATUS_TONE: Record<AgentStatus, string> = {
  active: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  idle: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
  degraded: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  offline: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

const TYPE_LABEL: Record<Agent['type'], string> = {
  cli: 'CLI',
  scaffold: 'Scaffold',
  custom: 'Custom',
  sdlc: 'SDLC',
};

export interface AgentCardProps {
  agent: Agent;
  onSelect?: (agent: Agent) => void;
}

export function AgentCard({ agent, onSelect }: AgentCardProps) {
  return (
    <article
      data-testid="agent-card"
      data-agent-id={agent.id}
      data-agent-status={agent.status}
      className="card flex flex-col gap-3"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-forge-700 bg-forge-800 text-forge-200">
            <Bot className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-semibold leading-tight">
              {agent.name}
            </h3>
            <p className="font-mono text-xs text-forge-300">v{agent.version}</p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            STATUS_TONE[agent.status],
          )}
          aria-label={`Status: ${agent.status}`}
        >
          {agent.status}
        </span>
      </header>

      <p className="text-xs text-forge-200">{agent.description}</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-forge-300">Type</dt>
        <dd className="text-forge-100">{TYPE_LABEL[agent.type]}</dd>
        <dt className="text-forge-300">Default provider</dt>
        <dd className="font-mono text-forge-100">{agent.defaultProvider}</dd>
        <dt className="text-forge-300">Invocations (24h)</dt>
        <dd className="font-mono text-forge-100">{agent.invocations24h}</dd>
        <dt className="text-forge-300">Cost (24h)</dt>
        <dd className="font-mono text-forge-100">${agent.costUsd24h.toFixed(2)}</dd>
        <dt className="text-forge-300">Last invoked</dt>
        <dd className="font-mono text-forge-100">{agent.lastInvokedAt}</dd>
      </dl>

      <div className="flex flex-wrap items-center gap-1.5">
        {agent.supportedTasks.map((t) => (
          <Badge key={t} variant="outline" className="text-[10px]">
            {t}
          </Badge>
        ))}
      </div>

      <footer className="flex items-center justify-between border-t border-forge-800 pt-3">
        <div className="flex items-center gap-2 text-[10px] text-forge-300">
          <Cpu className="h-3 w-3" aria-hidden="true" />
          {agent.invocations24h} calls · ${agent.costUsd24h.toFixed(2)}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSelect?.(agent)}
          data-testid="agent-card-open"
        >
          <Zap className="h-3 w-3" aria-hidden="true" />
          Open
        </Button>
      </footer>
    </article>
  );
}
