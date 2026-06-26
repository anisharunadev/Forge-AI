'use client';

import * as React from 'react';
import { History, RotateCcw, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useWorkflowStore } from './store';

/**
 * VersionDrawer — slide-in drawer exposing the version history.
 * Read-only mock — every "save" appends a version. The current
 * version is highlighted.
 */

export interface VersionDrawerProps {
  readonly onClose: () => void;
}

export function VersionDrawer({ onClose }: VersionDrawerProps) {
  const doc = useWorkflowStore((s) => s.doc);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Version history"
      className="fixed inset-0 z-40 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex h-full w-[420px] flex-col border-l border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Version history</h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 thin-scrollbar">
          <ol role="list" className="relative space-y-3 border-l border-[var(--border-subtle)] pl-4">
            {doc.versions.map((v, i) => {
              const isCurrent = i === 0;
              return (
                <li key={v.id} className="relative">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute -left-[19px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-elevated)]',
                      isCurrent ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-inset)]',
                    )}
                  />
                  <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                    <header className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-[var(--fg-primary)]">{v.label}</span>
                      {isCurrent ? (
                        <span className="rounded-[var(--radius-sm)] bg-[rgba(99,102,241,0.12)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-primary)]">
                          Current
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden="true" /> Restore
                        </button>
                      )}
                    </header>
                    <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
                      {new Date(v.createdAt).toLocaleString()} · by {v.createdBy}
                    </p>
                    {v.notes ? <p className="mt-1 text-[11px] text-[var(--fg-secondary)]">{v.notes}</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}