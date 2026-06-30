'use client';

/**
 * Agent card (step-54 — Phase 2).
 *
 * Adds two real actions to the existing visual card:
 *   - **Test connection** — calls `POST /agents/{id}/test`.
 *   - **Delete** — calls `DELETE /agents/{id}` via the optimistic
 *     `useDeleteAgent` mutation (row disappears immediately, rolls
 *     back on error).
 *
 * Skill rules adopted:
 *   - **Confirmation before destructive action** — the delete button
 *     asks the browser to confirm before firing.
 *   - **Toast on every action** — test and delete results surface as
 *     toasts so the user always knows what happened.
 */

import * as React from 'react';
import { Bot, Cpu, Zap, Trash2, Play } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useDeleteAgent, useTestAgent } from '@/lib/query/hooks';
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
  const testAgent = useTestAgent();
  const deleteAgent = useDeleteAgent();
  const { toast } = useToast();

  const handleTest = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await testAgent.mutateAsync(agent.id);
      toast({
        title: res.status === 'ok' ? 'Agent reachable' : 'Agent unreachable',
        description: res.message,
        variant: res.status === 'ok' ? 'default' : 'destructive',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: 'Test failed',
        description: message,
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${agent.name}?`)) {
      return;
    }
    try {
      await deleteAgent.mutateAsync(agent.id);
      toast({
        title: `Agent "${agent.name}" deleted`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: 'Delete failed — restored',
        description: message,
        variant: 'destructive',
      });
    }
  };

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

      {agent.description ? (
        <p className="text-xs text-forge-200">{agent.description}</p>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-forge-300">Type</dt>
        <dd className="text-forge-100">{TYPE_LABEL[agent.type]}</dd>
        <dt className="text-forge-300">Default provider</dt>
        <dd className="font-mono text-forge-100">
          {agent.defaultProvider || '—'}
        </dd>
        <dt className="text-forge-300">Invocations (24h)</dt>
        <dd className="font-mono text-forge-100">{agent.invocations24h}</dd>
        <dt className="text-forge-300">Cost (24h)</dt>
        <dd className="font-mono text-forge-100">${agent.costUsd24h.toFixed(2)}</dd>
        <dt className="text-forge-300">Last invoked</dt>
        <dd className="font-mono text-forge-100">
          {agent.lastInvokedAt
            ? new Date(agent.lastInvokedAt).toLocaleString()
            : '—'}
        </dd>
      </dl>

      <div className="flex flex-wrap items-center gap-1.5">
        {agent.supportedTasks.map((t) => (
          <Badge key={t} variant="outline" className="text-[10px]">
            {t}
          </Badge>
        ))}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-forge-800 pt-3">
        <div className="flex items-center gap-2 text-[10px] text-forge-300">
          <Cpu className="h-3 w-3" aria-hidden="true" />
          {agent.invocations24h} calls · ${agent.costUsd24h.toFixed(2)}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleTest}
            disabled={testAgent.isPending}
            data-testid="agent-card-test"
            className="text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
          >
            <Play className="h-3 w-3" aria-hidden="true" />
            {testAgent.isPending ? 'Testing…' : 'Test'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            disabled={deleteAgent.isPending}
            data-testid="agent-card-delete"
            className="text-[var(--fg-tertiary)] hover:bg-rose-500/10 hover:text-rose-300"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            Delete
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSelect?.(agent)}
            data-testid="agent-card-open"
          >
            <Zap className="h-3 w-3" aria-hidden="true" />
            Open
          </Button>
        </div>
      </footer>
    </article>
  );
}