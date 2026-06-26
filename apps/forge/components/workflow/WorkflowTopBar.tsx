'use client';

import * as React from 'react';
import {
  ArrowLeft,
  Braces,
  Copy,
  Download,
  FileCode2,
  FlaskConical,
  History,
  MoreVertical,
  Pencil,
  Play,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useWorkflowStore } from './store';
import { useMockExecution } from './useMockExecution';

/**
 * WorkflowTopBar — Step-23: 64px height, three zones.
 *
 * LEFT (gap-3):  Back · name · version · save status
 * CENTER:        Draft pill · animated run progress · paused/failed
 * RIGHT (gap-2): Variables · Test run · Run+Stop · 3-dot menu
 */

export interface WorkflowTopBarProps {
  readonly onBack: () => void;
  readonly onShowVersions: () => void;
  readonly onShowVariables: () => void;
  readonly className?: string;
}

export function WorkflowTopBar({ onBack, onShowVersions, onShowVariables, className }: WorkflowTopBarProps) {
  const doc = useWorkflowStore((s) => s.doc);
  const setDoc = useWorkflowStore((s) => s.setDoc);
  const saveStatus = useWorkflowStore((s) => s.saveStatus);
  const lastSavedAt = useWorkflowStore((s) => s.lastSavedAt);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [editingName, setEditingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(doc.name);
  const { isExecuting, start, stop, progress, currentNodeLabel } = useMockExecution();

  React.useEffect(() => {
    setNameDraft(doc.name);
  }, [doc.name]);

  // Tick "Saved Xs ago" once per second.
  const [, forceTick] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    const id = setInterval(forceTick, 1000);
    return () => clearInterval(id);
  }, []);

  const statusDot =
    doc.status === 'published' ? 'bg-[var(--accent-emerald)]' :
    doc.status === 'archived' ? 'bg-[var(--fg-tertiary)]' :
    'bg-[var(--accent-amber)]';

  const saveMeta = (() => {
    if (saveStatus === 'saving') return { dot: 'bg-[var(--accent-cyan)] animate-spin motion-reduce:animate-none', label: 'Saving…' };
    if (saveStatus === 'error') return { dot: 'bg-[var(--accent-rose)]', label: 'Save failed — retry' };
    if (saveStatus === 'saved' && lastSavedAt) {
      const seconds = Math.max(1, Math.round((Date.now() - lastSavedAt) / 1000));
      return { dot: 'bg-[var(--accent-emerald)]', label: `Saved ${seconds}s ago` };
    }
    if (saveStatus === 'idle') return { dot: 'bg-[var(--accent-amber)]', label: 'Unsaved changes' };
    return { dot: 'bg-[var(--fg-tertiary)]', label: 'Saved' };
  })();

  const commitName = () => {
    if (nameDraft.trim() && nameDraft !== doc.name) {
      setDoc({ name: nameDraft.trim() });
    } else {
      setNameDraft(doc.name);
    }
    setEditingName(false);
  };

  return (
    <header
      className={cn(
        'flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-5',
        className,
      )}
      data-testid="workflow-topbar"
    >
      {/* Left cluster */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          aria-label="Back to gallery"
          onClick={onBack}
          data-testid="workflow-back"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        <span aria-hidden="true" className="h-6 w-px shrink-0 bg-[var(--border-subtle)]" />

        <div className="flex min-w-0 items-center gap-2">
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') {
                  setNameDraft(doc.name);
                  setEditingName(false);
                }
              }}
              className="max-w-[280px] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-base)] px-2 py-1 text-base font-semibold text-[var(--fg-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              data-testid="workflow-name-input"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="max-w-[280px] truncate rounded-[var(--radius-sm)] px-1 py-0.5 text-base font-semibold text-[var(--fg-primary)] hover:bg-[var(--bg-inset)]"
              data-testid="workflow-name"
              title={doc.name}
            >
              {doc.name}
            </button>
          )}
          <button
            type="button"
            onClick={onShowVersions}
            data-testid="workflow-version"
            className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-2 py-0.5 font-mono text-xs text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]"
          >
            {doc.versions[0]?.label ?? 'v1'}
          </button>
          <span
            aria-hidden="true"
            className={cn('h-2 w-2 rounded-full', statusDot)}
            title={doc.status}
          />
          <span className="sr-only">{doc.status}</span>
          <span
            className="flex items-center gap-1.5 font-mono text-xs text-[var(--fg-tertiary)]"
            data-testid="workflow-save-status"
          >
            <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', saveMeta.dot)} />
            {saveMeta.label}
          </span>
        </div>
      </div>

      {/* Center — execution pill */}
      <div className="flex shrink-0 items-center gap-2">
        <ExecutionPill />
      </div>

      {/* Right cluster */}
      <div className="flex flex-1 items-center justify-end gap-2">
        <button
          type="button"
          onClick={onShowVariables}
          data-testid="workflow-variables"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-transparent px-3 py-1.5 text-sm text-[var(--fg-primary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
        >
          <Braces className="h-4 w-4" aria-hidden="true" />
          Variables
          <span className="rounded-full bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]">0 vars</span>
        </button>
        <button
          type="button"
          onClick={() => (isExecuting ? stop() : start())}
          data-testid="workflow-test-run"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-transparent px-3 py-1.5 text-sm text-[var(--fg-primary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
        >
          <FlaskConical className="h-4 w-4" aria-hidden="true" />
          Test run
        </button>
        <button
          type="button"
          onClick={() => (isExecuting ? stop() : start())}
          data-testid={isExecuting ? 'workflow-stop' : 'workflow-run'}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] px-4 text-sm font-semibold text-white transition-colors',
            isExecuting ? 'bg-[var(--accent-rose)] hover:opacity-90' : 'bg-[var(--accent-primary)] hover:opacity-90',
          )}
        >
          {isExecuting ? <Square className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          {isExecuting ? 'Stop' : 'Run'}
        </button>
        <div className="relative">
          <button
            type="button"
            aria-label="More actions"
            onClick={() => setMenuOpen((v) => !v)}
            data-testid="workflow-more"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-10 z-30 min-w-[200px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-md)]"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <MenuItem icon={Copy} label="Duplicate" />
              <MenuItem icon={Download} label="Export JSON" />
              <MenuItem icon={Upload} label="Import JSON" />
              <MenuItem icon={FileCode2} label="View source" />
              <MenuItem icon={History} label="Version history" onClick={onShowVersions} />
              <MenuItem icon={Trash2} label="Delete" danger />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function ExecutionPill() {
  const { isExecuting, progress, currentNodeLabel } = useMockExecution();
  const executionStartedAt = useWorkflowStore((s) => s.executionStartedAt);
  const [, forceTick] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    if (!isExecuting) return;
    const id = setInterval(forceTick, 1000);
    return () => clearInterval(id);
  }, [isExecuting]);

  if (!isExecuting) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-1.5 text-xs text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]"
        data-testid="workflow-exec-pill"
        data-state="idle"
      >
        <Pencil className="h-3 w-3" aria-hidden="true" />
        Draft
      </button>
    );
  }

  const elapsedMs = executionStartedAt ? Date.now() - executionStartedAt : 0;
  const elapsed = formatElapsed(elapsedMs);
  const pct = Math.min(100, Math.round((progress.current / Math.max(1, progress.total)) * 100));

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-1.5"
      data-testid="workflow-exec-pill"
      data-state="running"
    >
      <span
        aria-hidden="true"
        className="ai-thinking-dot h-2 w-2 rounded-full bg-[var(--accent-cyan)]"
      />
      <span className="font-mono text-xs text-[var(--fg-primary)]">
        Running · step {progress.current} of {progress.total}
        {currentNodeLabel ? <span className="text-[var(--fg-tertiary)]"> · {currentNodeLabel}</span> : null}
      </span>
      <span
        aria-hidden="true"
        className="h-1 w-[120px] overflow-hidden rounded-full bg-[var(--bg-inset)]"
      >
        <span
          className="block h-full bg-[var(--accent-cyan)] transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="font-mono text-xs text-[var(--fg-tertiary)]">{elapsed}</span>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m${rs.toString().padStart(2, '0')}s`;
}

function MenuItem({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm',
        danger ? 'text-[var(--accent-rose)] hover:bg-[var(--bg-inset)]' : 'text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}