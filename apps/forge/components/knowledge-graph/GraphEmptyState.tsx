'use client';

import * as React from 'react';
import {
  Network,
  GitBranch,
  FileText,
  Sparkles,
} from 'lucide-react';

export interface GraphEmptyStateProps {
  onIngest: () => void;
  onImport: () => void;
  onAuto: () => void;
}

/**
 * First-run empty state — 80x80 violet tile with the Network icon,
 * title, body, three source cards, and a "How the knowledge graph
 * works" footer link.
 */
export function GraphEmptyState({ onIngest, onImport, onAuto }: GraphEmptyStateProps) {
  return (
    <div
      className="flex h-full items-center justify-center rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-6"
      data-testid="graph-empty-state"
    >
      <div className="flex max-w-[480px] flex-col items-center text-center">
        <div
          aria-hidden="true"
          className="inline-flex h-20 w-20 items-center justify-center rounded-[var(--radius-xl)] bg-[rgba(168,85,247,0.10)] animate-[pulse-glow_2.4s_ease-in-out_infinite]"
        >
          <Network className="h-10 w-10 text-[var(--accent-violet)]" aria-hidden="true" />
        </div>

        <h2 className="mt-5 text-xl font-bold text-[var(--fg-primary)]">
          Your knowledge graph is empty
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--fg-secondary)]">
          Connect a source to populate the graph. Forge can ingest GitHub repos,
          ADRs, ideas, runs, agents, and any artifact type across your project.
        </p>

        <div className="mt-6 grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={onIngest}
            data-testid="empty-ingest-github"
            className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-3 py-3 text-xs font-medium text-white shadow-[var(--shadow-glow-primary)] transition-opacity hover:opacity-90"
          >
            <GitBranch className="h-4 w-4" aria-hidden="true" />
            Connect GitHub repo
          </button>
          <button
            type="button"
            onClick={onImport}
            data-testid="empty-import-adrs"
            className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3 text-xs font-medium text-[var(--fg-primary)] transition-colors hover:bg-[var(--bg-surface)]"
          >
            <FileText className="h-4 w-4 text-[var(--accent-violet)]" aria-hidden="true" />
            Import existing ADRs
          </button>
          <button
            type="button"
            onClick={onAuto}
            data-testid="empty-auto-generate"
            className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3 text-xs font-medium text-[var(--fg-primary)] transition-colors hover:bg-[var(--bg-surface)]"
          >
            <Sparkles className="h-4 w-4 text-[var(--accent-amber)]" aria-hidden="true" />
            Auto-generate from runs
          </button>
        </div>

        <a
          href="/docs/knowledge-graph"
          className="mt-6 text-xs text-[var(--accent-primary)] underline-offset-2 hover:underline"
        >
          How the knowledge graph works →
        </a>
      </div>
    </div>
  );
}