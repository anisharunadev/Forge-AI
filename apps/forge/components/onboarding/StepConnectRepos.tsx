'use client';

import * as React from 'react';
import { GitBranch, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { SampleRepo } from '@/lib/onboarding/data';

export interface StepConnectReposProps {
  selected: ReadonlyArray<SampleRepo>;
  onChange: (next: SampleRepo[]) => void;
  catalog: ReadonlyArray<SampleRepo>;
}

type RepoStatus = 'connected' | 'syncing' | 'failed';

/** Synthesize a status dot per repo for visual scanning. */
function statusFor(repo: SampleRepo): RepoStatus {
  if (repo.lastCommitAt === '—') return 'syncing';
  if (repo.size === '—') return 'failed';
  return 'connected';
}

const STATUS_TONE: Record<RepoStatus, { color: string; label: string }> = {
  connected: { color: 'var(--accent-emerald)', label: 'Connected' },
  syncing: { color: 'var(--accent-amber)', label: 'Syncing' },
  failed: { color: 'var(--accent-rose)', label: 'Failed' },
};

/**
 * Step 2 — Connect repositories. Catalog cards with status dots,
 * an inline "Connect new" composer, and a selected list with
 * per-row remove affordances.
 */
export function StepConnectRepos({
  selected,
  onChange,
  catalog,
}: StepConnectReposProps) {
  const [draftUrl, setDraftUrl] = React.useState('');
  const [draftTouched, setDraftTouched] = React.useState(false);

  const isSelected = (id: string) => selected.some((r) => r.id === id);

  const toggle = (repo: SampleRepo) => {
    if (isSelected(repo.id)) {
      onChange(selected.filter((r) => r.id !== repo.id));
    } else {
      onChange([...selected, repo]);
    }
  };

  const draftUrlValid =
    draftUrl.trim().length > 0 &&
    /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(draftUrl.trim());
  const showDraftError = draftTouched && draftUrl.length > 0 && !draftUrlValid;

  const addCustom = () => {
    setDraftTouched(true);
    const url = draftUrl.trim();
    if (!draftUrlValid) return;
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
    setDraftTouched(false);
  };

  const remove = (id: string) =>
    onChange(selected.filter((r) => r.id !== id));

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5 space-y-5"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
      }}
      data-testid="step-connect-repos"
    >
      <header className="space-y-1">
        <h2
          style={{
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--fg-primary)',
          }}
        >
          Connect repositories
        </h2>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--fg-secondary)',
            lineHeight: 'var(--leading-base)',
          }}
        >
          Pick from the catalog or paste a new repo URL. Forge will clone a
          shallow copy to start.
        </p>
      </header>

      <div className="grid gap-2 md:grid-cols-2">
        {catalog.map((r) => {
          const active = isSelected(r.id);
          const status = statusFor(r);
          const tone = STATUS_TONE[status];
          return (
            <button
              type="button"
              key={r.id}
              onClick={() => toggle(r)}
              aria-pressed={active}
              className={cn(
                'group rounded-[var(--radius-md)] border p-3 text-left transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                active
                  ? 'shadow-[var(--shadow-glow-primary)]'
                  : 'hover:bg-[var(--hover)]',
              )}
              style={{
                background: 'var(--bg-elevated)',
                borderColor: active
                  ? 'var(--accent-primary)'
                  : 'var(--border-subtle)',
              }}
              data-testid={`repo-toggle-${r.id}`}
              data-selected={String(active)}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="inline-flex items-center gap-2 font-medium"
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--fg-primary)',
                  }}
                >
                  <GitBranch
                    className="h-4 w-4"
                    style={{ color: 'var(--fg-tertiary)' }}
                    aria-hidden="true"
                  />
                  {r.url.replace(/^https?:\/\//, '')}
                </span>
                <span
                  className="inline-flex items-center gap-1.5 uppercase tracking-wider"
                  style={{
                    fontSize: '10px',
                    color: 'var(--fg-tertiary)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full"
                    style={{ background: tone.color }}
                  />
                  {tone.label}
                </span>
              </div>
              <p
                className="mt-1"
                style={{
                  fontSize: '10px',
                  color: 'var(--fg-tertiary)',
                }}
              >
                {r.language} · {r.size} · {r.lastCommitAt}
              </p>
            </button>
          );
        })}
      </div>

      <div className="grid gap-1.5">
        <label
          htmlFor="repo-add-url"
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--fg-primary)',
          }}
        >
          Connect new
        </label>
        <div className="flex gap-2">
          <Input
            id="repo-add-url"
            placeholder="https://github.com/acme/another-repo"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            onBlur={() => setDraftTouched(true)}
            aria-invalid={showDraftError}
            aria-describedby="repo-add-url-error"
            className={cn(
              'flex-1',
              showDraftError &&
                'border-[var(--accent-rose)] focus-visible:ring-[var(--accent-rose)]',
            )}
            style={{ fontFamily: 'var(--font-mono)' }}
            data-testid="repo-add-url"
          />
          <Button
            type="button"
            variant="outline"
            onClick={addCustom}
            disabled={!draftUrlValid}
            data-testid="repo-add-button"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Connect
          </Button>
        </div>
        {showDraftError ? (
          <p
            id="repo-add-url-error"
            role="alert"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--accent-rose)',
            }}
          >
            Enter a valid HTTPS URL (e.g. https://github.com/org/repo).
          </p>
        ) : null}
      </div>

      {selected.length > 0 ? (
        <div className="space-y-2">
          <h3
            style={{
              fontSize: '10px',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--fg-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
            }}
          >
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
                className="flex items-center justify-between rounded-md border px-2 py-1.5"
                style={{
                  borderColor: 'var(--border-subtle)',
                  background: 'var(--bg-inset)',
                  fontSize: 'var(--text-xs)',
                }}
              >
                <span
                  className="inline-flex items-center gap-2"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--fg-primary)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: 'var(--accent-emerald)' }}
                  />
                  {r.url}
                </span>
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  aria-label={`Remove ${r.url}`}
                  className="rounded-md p-1 transition-colors hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-rose)]"
                  style={{ color: 'var(--fg-tertiary)' }}
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