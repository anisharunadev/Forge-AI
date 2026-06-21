'use client';

import * as React from 'react';
import { GitBranch, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import type { Repo, RepoStatus } from '@/lib/project-intelligence/data';

const STATUS_TONE: Record<RepoStatus, string> = {
  healthy: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  stale: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  failed: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  ingesting: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
};

const STATUS_ICON: Record<RepoStatus, React.ReactNode> = {
  healthy: <CheckCircle2 className="h-3 w-3" aria-hidden="true" />,
  stale: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
  failed: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
  ingesting: <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />,
};

export interface RepoListProps {
  repos: ReadonlyArray<Repo>;
  selectedId?: string;
  onSelect?: (repo: Repo) => void;
}

export function RepoList({ repos, selectedId, onSelect }: RepoListProps) {
  return (
    <ul
      role="list"
      aria-label="Ingested repositories"
      className="flex flex-col gap-2"
      data-testid="repo-list"
    >
      {repos.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onSelect?.(r)}
            data-testid="repo-list-item"
            data-repo-id={r.id}
            data-repo-status={r.status}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-md border p-3 text-left text-sm transition-colors',
              selectedId === r.id
                ? 'border-forge-300 bg-forge-800/60'
                : 'border-forge-700/40 hover:border-forge-500',
            )}
          >
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-forge-300" aria-hidden="true" />
              <div className="flex flex-col">
                <span className="font-medium">{r.name}</span>
                <span className="font-mono text-[10px] text-forge-300">
                  {r.files} files · {(r.bytesIngested / 1_000_000).toFixed(1)} MB
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  STATUS_TONE[r.status],
                )}
              >
                {STATUS_ICON[r.status]}
                {r.status}
              </span>
              <span className="font-mono text-[10px] text-forge-300">
                {new Date(r.lastIngestionAt).toLocaleDateString()}
              </span>
            </div>
          </button>
          {r.errors.length > 0 ? (
            <ul className="ml-6 mt-1 flex flex-col gap-0.5 text-[10px] text-rose-300">
              {r.errors.map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export interface RepoDetailPanelProps {
  repo: Repo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RepoDetailPanel({ repo, open, onOpenChange }: RepoDetailPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md"
        data-testid="repo-detail-panel"
      >
        {repo ? (
          <div className="flex h-full flex-col gap-4 overflow-y-auto pr-2">
            <SheetHeader>
              <SheetTitle>{repo.name}</SheetTitle>
              <SheetDescription>
                <span className="font-mono text-xs">{repo.id}</span> · {repo.url}
              </SheetDescription>
            </SheetHeader>
            <Badge variant="outline">{repo.status}</Badge>
            <Separator />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <dt className="text-forge-300">Files</dt>
              <dd className="font-mono">{repo.files}</dd>
              <dt className="text-forge-300">Bytes ingested</dt>
              <dd className="font-mono">
                {(repo.bytesIngested / 1_000_000).toFixed(2)} MB
              </dd>
              <dt className="text-forge-300">Last ingestion</dt>
              <dd className="font-mono">
                {new Date(repo.lastIngestionAt).toLocaleString()}
              </dd>
            </dl>
            {repo.errors.length > 0 ? (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-rose-300">
                  Errors
                </h3>
                <ul className="list-inside list-disc text-xs text-rose-200">
                  {repo.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
