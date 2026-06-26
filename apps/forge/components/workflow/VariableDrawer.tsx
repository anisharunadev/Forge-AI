'use client';

import * as React from 'react';
import { Braces, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useWorkflowStore } from './store';

/**
 * VariableDrawer — slide-in drawer exposing the workflow's inputs.
 * Read-only mock — wired to the store so the UI updates as the user
 * edits inputs from the right sidebar.
 */

export interface VariableDrawerProps {
  readonly onClose: () => void;
}

export function VariableDrawer({ onClose }: VariableDrawerProps) {
  const doc = useWorkflowStore((s) => s.doc);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Workflow variables"
      className="fixed inset-0 z-40 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex h-full w-[420px] flex-col border-l border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Braces className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Variables</h2>
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

        <div className="flex-1 space-y-4 overflow-y-auto p-4 thin-scrollbar">
          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
              Inputs
            </h3>
            {doc.inputs.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--border-subtle)] p-3 text-xs text-[var(--fg-tertiary)]">
                No inputs. Add inputs in the right sidebar under Inputs.
              </p>
            ) : (
              <ul role="list" className="space-y-2">
                {doc.inputs.map((input) => (
                  <li key={input.name} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5">
                    <p className="font-mono text-xs text-[var(--fg-primary)]">{`{{${input.name}}}`}</p>
                    <p className="mt-0.5 text-[10px] text-[var(--fg-tertiary)]">
                      {input.type}{input.required ? ' · required' : ''}
                      {input.defaultValue ? ` · default: ${input.defaultValue}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
              Outputs
            </h3>
            {doc.outputs.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--border-subtle)] p-3 text-xs text-[var(--fg-tertiary)]">
                No outputs declared. Outputs are computed from the workflow's end nodes.
              </p>
            ) : (
              <ul role="list" className="space-y-1">
                {doc.outputs.map((o) => (
                  <li key={o.name} className="font-mono text-xs text-[var(--fg-primary)]">{`{{${o.name}}}`}</li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}