'use client';

import * as React from 'react';

import { api } from '@/lib/api/client';
export interface CommandArtifact {
  command: string;
  /** Path of the source file inside @forge-ai/forge-core. */
  path: string;
  content: string;
  /** RFC 3339 timestamp. */
  lastModified: string;
  /** Etag for optimistic concurrency. */
  etag: string;
}

export interface UseCommandArtifactResult {
  artifact: CommandArtifact | null;
  loading: boolean;
  error: string | null;
  save: (content: string) => Promise<void>;
  saving: boolean;
}

/**
 * Read/write the SKILL.md artifact for a forge-* command.
 *
 * - `GET  /api/v1/commands/{name}/artifact` → fetch
 * - `PUT  /api/v1/commands/{name}/artifact` → save
 *
 * Fetch is only triggered when `enabled` becomes true (i.e. when the
 * ViewMDDialog opens), so the modal mounts lazily without network calls.
 */
export function useCommandArtifact(
  name: string,
  enabled: boolean,
): UseCommandArtifactResult {
  const [artifact, setArtifact] = React.useState<CommandArtifact | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset when the command changes.
  React.useEffect(() => {
    setArtifact(null);
    setError(null);
  }, [name]);

  React.useEffect(() => {
    if (!enabled || !name) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<CommandArtifact>(`/commands/${encodeURIComponent(name)}/artifact`)
      .then((data) => {
        if (cancelled) return;
        setArtifact(data);
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
  }, [enabled, name]);

  const save = React.useCallback(
    async (content: string) => {
      if (!name) return;
      setSaving(true);
      setError(null);
      try {
        const updated = await api.put<CommandArtifact>(`/commands/${encodeURIComponent(name)}/artifact`, { content }, {
            headers: artifact?.etag
              ? { 'If-Match': artifact.etag }
              : undefined
});
        setArtifact(updated);
      } finally {
        setSaving(false);
      }
    },
    [name, artifact?.etag],
  );

  return { artifact, loading, error, save, saving };
}
