'use client';

import * as React from 'react';
import { GitBranch, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SampleRepo } from '@/lib/onboarding/data';

export interface StepConnectReposProps {
  selected: ReadonlyArray<SampleRepo>;
  onChange: (next: SampleRepo[]) => void;
  catalog: ReadonlyArray<SampleRepo>;
}

export function StepConnectRepos({
  selected,
  onChange,
  catalog,
}: StepConnectReposProps) {
  const [draftUrl, setDraftUrl] = React.useState('');

  const isSelected = (id: string) => selected.some((r) => r.id === id);

  const toggle = (repo: SampleRepo) => {
    if (isSelected(repo.id)) {
      onChange(selected.filter((r) => r.id !== repo.id));
    } else {
      onChange([...selected, repo]);
    }
  };

  const addCustom = () => {
    const url = draftUrl.trim();
    if (!url) return;
    const next: SampleRepo = {
      id: `repo-${Date.now().toString(36)}`,
      url,
      defaultBranch: 'main',
      language: 'Unknown',
      size: '—',
      lastCommitAt: '—',
    };
    onChange([...selected, next]);
    setDraftUrl('');
  };

  const remove = (id: string) => onChange(selected.filter((r) => r.id !== id));

  return (
    <section className="card space-y-4" data-testid="step-connect-repos">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Connect repositories</h2>
        <p className="text-sm text-forge-300">
          Pick from the catalog or add a custom repo URL.
        </p>
      </header>

      <div className="grid gap-2 md:grid-cols-2">
        {catalog.map((r) => {
          const active = isSelected(r.id);
          return (
            <button
              type="button"
              key={r.id}
              onClick={() => toggle(r)}
              className={
                active
                  ? 'card text-left ring-1 ring-ring'
                  : 'card text-left hover:bg-forge-800/60'
              }
              data-testid={`repo-toggle-${r.id}`}
              data-selected={String(active)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 font-medium">
                  <GitBranch className="h-4 w-4 text-forge-300" aria-hidden="true" />
                  {r.url.replace(/^https?:\/\//, '')}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-forge-300">
                  {r.language}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-forge-300">
                {r.size} · {r.lastCommitAt}
              </p>
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="https://github.com/acme/another-repo"
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          data-testid="repo-add-url"
        />
        <Button
          type="button"
          variant="outline"
          onClick={addCustom}
          data-testid="repo-add-button"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          Add
        </Button>
      </div>

      {selected.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-forge-300">
            Selected ({selected.length})
          </h3>
          <ul
            role="list"
            data-testid="repo-selected-list"
            className="space-y-1"
          >
            {selected.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-md border border-forge-800 bg-forge-900 px-2 py-1 text-xs"
              >
                <span className="font-mono">{r.url}</span>
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  className="text-forge-300 hover:text-rose-300"
                  data-testid={`repo-remove-${r.id}`}
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
