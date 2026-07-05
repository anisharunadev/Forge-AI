'use client';

import { useCallback, useState } from 'react';

import {
  FORGE_COMMANDS,
  type ForgeCommand,
} from '@/lib/forge-commands';
import { api } from '@/lib/api/client';
export type RunStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';

export interface RunState {
  command: ForgeCommand;
  status: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
}

/**
 * Forge commands hook.
 *
 * Lists the static `FORGE_COMMANDS` catalog and provides a `run()` that
 * dispatches a request to the backend orchestrator. While the backend is
 * not reachable, `run()` simulates a 1.5s success so the UI is usable.
 */
export function useForgeCommands() {
  const [runs, setRuns] = useState<Record<string, RunState>>({});

  const run = useCallback(async (command: ForgeCommand): Promise<RunState> => {
    const id = command.name;
    const initial: RunState = {
      command,
      status: 'queued',
      startedAt: new Date().toISOString(),
    };
    setRuns((prev) => ({ ...prev, [id]: initial }));

    setRuns((prev) => ({
      ...prev,
      [id]: { ...prev[id]!, status: 'running' },
    }));

    try {
      await api.post(`/commands/${encodeURIComponent(command.name)}/run`, { name: command.name }, {
      });
      const finished: RunState = {
        ...initial,
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
        message: `Command ${command.name} dispatched.`,
      };
      setRuns((prev) => ({ ...prev, [id]: finished }));
      return finished;
    } catch {
      // Simulate success so the UI is usable while the backend isn't wired up.
      await new Promise((r) => setTimeout(r, 1500));
      const finished: RunState = {
        ...initial,
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
        message:
          'Backend unreachable — simulated success. Connect orchestrator to enable live dispatch.',
      };
      setRuns((prev) => ({ ...prev, [id]: finished }));
      return finished;
    }
  }, []);

  return {
    commands: FORGE_COMMANDS,
    runs,
    run,
  };
}
