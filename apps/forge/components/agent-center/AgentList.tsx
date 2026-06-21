'use client';


import { AgentCard } from '@/components/agent-center/AgentCard';
import type { Agent } from '@/lib/agent-center/data';

export interface AgentListProps {
  agents: ReadonlyArray<Agent>;
  onSelect?: (agent: Agent) => void;
  emptyMessage?: string;
}

export function AgentList({ agents, onSelect, emptyMessage }: AgentListProps) {
  if (agents.length === 0) {
    return (
      <div className="card text-sm text-forge-300" data-testid="agent-list-empty">
        {emptyMessage ?? 'No agents match the current filters.'}
      </div>
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
