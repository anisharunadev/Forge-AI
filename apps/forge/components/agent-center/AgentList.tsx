'use client';


import { Bot, Plus } from 'lucide-react';

import { AgentCard } from '@/components/agent-center/AgentCard';
import type { Agent } from '@/lib/agent-center/data';
import { EmptyState } from '@/src/components/empty-state';

export interface AgentListProps {
  agents: ReadonlyArray<Agent>;
  onSelect?: (agent: Agent) => void;
  emptyMessage?: string;
  onRegister?: () => void;
  onBrowseTemplates?: () => void;
}

export function AgentList({ agents, onSelect, emptyMessage, onRegister, onBrowseTemplates }: AgentListProps) {
  if (agents.length === 0) {
    return (
      <EmptyState
        illustration={<Bot size={40} strokeWidth={1.5} />}
        title={emptyMessage ? 'No agents match the current filters' : 'Register your first agent'}
        description={
          emptyMessage
            ? 'Try clearing your filters or register a new agent to see it here.'
            : 'Agents are AI workers you can assign runs to. Register one to get started.'
        }
        primaryAction={
          onRegister
            ? { label: 'Register Agent', onClick: onRegister, icon: <Plus size={14} /> }
            : undefined
        }
        secondaryAction={
          onBrowseTemplates
            ? { label: 'Browse templates', onClick: onBrowseTemplates }
            : undefined
        }
        suggestions={
          emptyMessage
            ? undefined
            : ['Code reviewer', 'Research analyst', 'Customer support']
        }
      />
    );
  }

  return (
    <ul
      role="list"
      aria-label="Agents"
      data-testid="agent-list"
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
    >
      {agents.map((agent) => (
        <li key={agent.id}>
          <AgentCard agent={agent} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}