'use client';

import * as React from 'react';
import { Command as CommandIcon, History } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { CategoryNav } from '@/components/forge-commands/CategoryNav';
import { CommandCard } from '@/components/forge-commands/CommandCard';
import { CommandSearch } from '@/components/forge-commands/CommandSearch';
import {
  commandsByCategory,
  searchCommands,
  type ForgeCommandCategoryId,
} from '@/lib/forge-commands';
import { Input } from '@/components/ui/input';

export default function ForgeCommandCenterPage() {
  const [category, setCategory] =
    React.useState<ForgeCommandCategoryId>('development');
  const [query, setQuery] = React.useState('');

  const visible = React.useMemo(() => {
    if (query.trim()) return searchCommands(query);
    return commandsByCategory(category);
  }, [category, query]);

  return (
    <AdminShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Forge Command Center
          </p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <CommandIcon className="h-5 w-5" aria-hidden="true" />
            Run a forge-* command
          </h1>
          <p className="text-sm text-muted-foreground">
            Browse, search, and execute the white-labeled <code>forge-*</code>{' '}
            command catalog. All commands are routed through the backend
            orchestrator.
          </p>
        </header>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CommandSearch value={query} onChange={setQuery} />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <History className="h-3 w-3" aria-hidden="true" />
            History is captured per command. Recent runs surface here.
          </div>
        </div>

        <div className="flex min-h-[60vh] rounded-lg border border-border bg-card">
          <CategoryNav active={category} onChange={setCategory} />
          <div className="flex-1 p-4">
            {query.trim() ? (
              <p className="mb-3 text-xs text-muted-foreground">
                Showing {visible.length} match
                {visible.length === 1 ? '' : 'es'} for{' '}
                <span className="font-mono">{query}</span>.
              </p>
            ) : null}
            {visible.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No commands match. Try a different search term.
              </p>
            ) : (
              <ul
                role="list"
                className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
              >
                {visible.map((cmd) => (
                  <li key={cmd.name}>
                    <CommandCard command={cmd} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Hidden shadcn Input reference to keep tree-shaking quiet if a future
            form uses it without an explicit import. */}
        <span className="sr-only" aria-hidden="true">
          <Input />
        </span>
      </div>
    </AdminShell>
  );
}
