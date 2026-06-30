'use client';

/**
 * Terminal workspace selector — step-61 Zone 10.
 *
 * Replaced the hardcoded ``WORKSPACES`` array (default / forge-core /
 * forge-ui / sandbox) with a live fetch from ``GET /auth/me/tenants``
 * via TanStack Query. The slug is used as the value because the
 * terminal PTY sidecar accepts a workspace slug, not a UUID.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { listMyTenants } from '@/lib/api/auth';
import { useTerminalStore } from '@/lib/store';

export function WorkspaceSelector() {
  const workspace = useTerminalStore((s) => s.workspace);
  const setWorkspace = useTerminalStore((s) => s.setWorkspace);

  const { data: tenants, isLoading, error } = useQuery({
    queryKey: ['tenants', 'mine'],
    queryFn: () => listMyTenants(),
    staleTime: 60_000,
  });

  if (isLoading) {
    return <Skeleton className="h-8 w-44" />;
  }

  const items = (tenants ?? []).map((t) => ({
    id: t.slug,
    label: t.name,
  }));

  if (items.length === 0) {
    return (
      <span
        className="px-2 text-xs"
        style={{ color: 'var(--fg-tertiary)' }}
        data-testid="workspace-selector-empty"
      >
        {error ? 'Workspaces unavailable' : 'No workspaces'}
      </span>
    );
  }

  return (
    <Select
      value={workspace}
      onValueChange={setWorkspace}
    >
      <SelectTrigger
        className="h-8 w-44"
        aria-label="Workspace"
        data-testid="workspace-selector"
      >
        <SelectValue placeholder="Workspace" />
      </SelectTrigger>
      <SelectContent>
        {items.map((w) => (
          <SelectItem key={w.id} value={w.id}>
            {w.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}