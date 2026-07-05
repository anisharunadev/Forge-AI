'use client';

import * as React from 'react';

import { api } from '@/lib/api/client';
export interface CommandRun {
  id: string;
  command: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  message?: string;
  error?: string;
}

export interface UseCommandHistoryResult {
  runs: CommandRun[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetch the run history for a single forge-* command from
 * `GET /api/v1/commands/{name}/runs`. Auto-refreshes when the hook is
 * `enabled` (i.e. when the drawer is open).
 */
export function useCommandHistory(
  name: string,
  enabled: boolean,
): UseCommandHistoryResult {
  const [runs, setRuns] = React.useState<CommandRun[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    if (!enabled || !name) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<CommandRun[]>(`/commands/${encodeURIComponent(name)}/runs`)
      .then((data) => {
        if (cancelled) return;
        setRuns(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, name, nonce]);

  const refresh = React.useCallback(() => setNonce((n) => n + 1), []);

  return { runs, loading, error, refresh };
}
