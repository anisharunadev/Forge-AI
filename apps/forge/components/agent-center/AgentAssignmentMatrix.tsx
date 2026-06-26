'use client';

import * as React from 'react';
import { Users, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/src/components/empty-state';
import type {
  Agent,
  AgentAssignment,
  ModelProvider,
} from '@/lib/agent-center/data';

export interface AgentAssignmentMatrixProps {
  agents: ReadonlyArray<Agent>;
  providers: ReadonlyArray<ModelProvider>;
  assignments: ReadonlyArray<AgentAssignment>;
  taskTypes: ReadonlyArray<string>;
  onCreateAssignment?: () => void;
}

export function AgentAssignmentMatrix({
  agents,
  providers,
  assignments,
  taskTypes,
  onCreateAssignment,
}: AgentAssignmentMatrixProps) {
  const agentById = React.useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );
  const providerById = React.useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers],
  );

  if (agents.length === 0) {
    return (
      <div data-testid="assignment-matrix-empty">
        <EmptyState
          illustration={<Users size={40} strokeWidth={1.5} />}
          title="No assignments yet"
          description="Assign agents to projects to start orchestrating work."
          primaryAction={
            onCreateAssignment
              ? { label: 'Create Assignment', onClick: onCreateAssignment, icon: <Plus size={14} /> }
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-md border border-forge-800"
      data-testid="assignment-matrix"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-forge-800 text-left text-[10px] uppercase tracking-wider text-forge-300">
            <th className="px-3 py-2">Task</th>
            {agents.map((a) => (
              <th
                key={a.id}
                className="px-3 py-2 text-center"
                data-testid={`matrix-col-${a.id}`}
              >
                {a.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {taskTypes.map((task) => (
            <tr
              key={task}
              className="border-t border-forge-800"
              data-testid={`matrix-row-${task}`}
            >
              <td className="px-3 py-2 font-medium text-forge-100">{task}</td>
              {agents.map((agent) => {
                const match = assignments.find(
                  (a) => a.taskType === task && a.agentId === agent.id,
                );
                if (!match) {
                  return (
                    <td
                      key={agent.id}
                      className="px-3 py-2 text-center text-forge-400"
                      aria-label="not assigned"
                    >
                      —
                    </td>
                  );
                }
                const provider = providerById.get(match.providerId);
                return (
                  <td
                    key={agent.id}
                    className={cn(
                      'px-3 py-2 text-center align-middle',
                      match.enabled ? '' : 'opacity-60',
                    )}
                    data-testid={`matrix-cell-${task}-${agent.id}`}
                    data-enabled={String(match.enabled)}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <Badge
                        variant={match.enabled ? 'default' : 'secondary'}
                        className="font-mono text-[10px]"
                      >
                        {provider?.name ?? match.providerId}
                      </Badge>
                      {match.notes ? (
                        <span className="text-[10px] italic text-forge-300">
                          {match.notes}
                        </span>
                      ) : null}
                      {!agentById.has(agent.id) ? null : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
