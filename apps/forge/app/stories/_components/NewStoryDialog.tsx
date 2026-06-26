'use client';

/**
 * Stories Center — New Story Dialog (Step 44).
 *
 * Richer modal with markdown description, acceptance-criteria checkboxes,
 * subtasks, and linked items. Footer adds "Save as draft" / "Create" /
 * "Create and start implementation" — the killer one-click flow that
 * handoff straight into the StartImplementationModal.
 *
 * Skill influence:
 *   - ux-guideline (always show label) — every field has a visible label
 *   - ux-guideline (focus trap) — Esc closes, focus on title on open
 *   - ux-guideline (auto-grow) — description auto-grows 3→12 rows
 *   - ux-guideline (reduced motion) — toolbar transitions respect it
 *   - ux-guideline (markdown toolbar) — reused from Step 12
 */

import * as React from 'react';
import {
  Bold,
  Italic,
  Heading2,
  Link as LinkIcon,
  List,
  Code,
  Quote,
  AtSign,
  X,
  Plus,
  Trash2,
  FileText,
  GitBranch,
  Lightbulb,
  Layers,
  CheckSquare,
} from 'lucide-react';

import type {
  AcceptanceCriterion,
  Assignee,
  Estimate,
  LabelKind,
  LinkedItem,
  Sprint,
  StoryPriority,
  Subtask,
} from '@/lib/stories/types';
import { ESTIMATE_POINTS, LABEL_LABEL, PRIORITY_LABEL } from '@/lib/stories/types';
import { cn } from '@/lib/utils';

export interface NewStoryDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreate: (data: NewStoryInput, options: CreateOptions) => void;
  readonly assignees: ReadonlyArray<Assignee>;
  readonly sprints: ReadonlyArray<Sprint>;
  readonly currentSprintId: string;
}

export interface NewStoryInput {
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: ReadonlyArray<AcceptanceCriterion>;
  readonly subtasks: ReadonlyArray<Subtask>;
  readonly epicId: string | null;
  readonly priority: StoryPriority;
  readonly estimate: Estimate;
  readonly labels: ReadonlyArray<LabelKind>;
  readonly assigneeId: string | null;
  readonly sprintId: string;
  readonly linkedItems: ReadonlyArray<LinkedItem>;
  readonly status: 'draft' | 'todo';
}

export type CreateOptions = {
  readonly mode: 'create' | 'create_and_implement' | 'save_draft';
};

const EPICS = [
  { id: 'epic-os', label: 'Forge OS' },
  { id: 'epic-billing', label: 'Billing & Plans' },
  { id: 'epic-onboarding', label: 'Onboarding' },
];

const LINK_TABS: ReadonlyArray<{ key: LinkedItem['kind']; label: string }> = [
  { key: 'adr', label: 'ADRs' },
  { key: 'epic', label: 'Epics' },
  { key: 'story', label: 'Stories' },
  { key: 'run', label: 'Tasks' },
];

const LINK_OPTIONS: ReadonlyArray<{ kind: LinkedItem['kind']; id: string; label: string; href?: string }> = [
  { kind: 'adr', id: 'ADR-005', label: 'ADR-005 · Use FastAPI for orchestrator' },
  { kind: 'adr', id: 'ADR-012', label: 'ADR-012 · Strict tenant isolation' },
  { kind: 'epic', id: 'epic-os', label: 'Epic · Forge OS' },
  { kind: 'epic', id: 'epic-billing', label: 'Epic · Billing & Plans' },
  { kind: 'story', id: 'S-101', label: 'S-101 · Spike: OAuth2 PKCE feasibility' },
  { kind: 'run', id: 'RUN-42', label: 'Task · Implement OAuth2 PKCE flow' },
];

const DEFAULT_CRITERIA: ReadonlyArray<AcceptanceCriterion> = [
  { id: 'ac-given', text: 'Given [context]…', done: false },
  { id: 'ac-when', text: 'When [action]…', done: false },
  { id: 'ac-then', text: 'Then [outcome]…', done: false },
];

export function NewStoryDialog({
  open,
  onClose,
  onCreate,
  assignees,
  sprints,
  currentSprintId,
}: NewStoryDialogProps) {
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [criteria, setCriteria] =
    React.useState<ReadonlyArray<AcceptanceCriterion>>(DEFAULT_CRITERIA);
  const [subtasks, setSubtasks] = React.useState<ReadonlyArray<Subtask>>([]);
  const [epicId, setEpicId] = React.useState<string | null>('epic-os');
  const [priority, setPriority] = React.useState<StoryPriority>('P2');
  const [estimate, setEstimate] = React.useState<Estimate>('M');
  const [labels, setLabels] = React.useState<ReadonlyArray<LabelKind>>([]);
  const [assigneeId, setAssigneeId] = React.useState<string | null>(null);
  const [sprintId, setSprintId] = React.useState(currentSprintId);
  const [linkedItems, setLinkedItems] = React.useState<ReadonlyArray<LinkedItem>>([]);
  const [linkTab, setLinkTab] = React.useState<LinkedItem['kind']>('adr');
  const [linkQuery, setLinkQuery] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const titleRef = React.useRef<HTMLInputElement>(null);
  const descRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setCriteria(DEFAULT_CRITERIA);
      setSubtasks([]);
      setLinkedItems([]);
      setLinkQuery('');
      setError(null);
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Auto-grow description textarea 3 → 12 rows based on content.
  React.useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 22;
    const max = 12 * lineHeight;
    const min = 3 * lineHeight;
    const next = Math.min(max, Math.max(min, el.scrollHeight));
    el.style.height = `${next}px`;
  }, [description]);

  if (!open) return null;

  const submit = (mode: CreateOptions['mode']) => {
    if (!title.trim()) {
      setError('Title is required.');
      titleRef.current?.focus();
      return;
    }
    onCreate(
      {
        title: title.trim(),
        description,
        acceptanceCriteria: criteria,
        subtasks,
        epicId,
        priority,
        estimate,
        labels,
        assigneeId,
        sprintId,
        linkedItems,
        status: mode === 'save_draft' ? 'draft' : 'todo',
      },
      { mode },
    );
    onClose();
  };

  const updateCriterion = (id: string, text: string) =>
    setCriteria((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)));
  const toggleCriterion = (id: string) =>
    setCriteria((prev) => prev.map((c) => (c.id === id ? { ...c, done: !c.done } : c)));
  const removeCriterion = (id: string) =>
    setCriteria((prev) => prev.filter((c) => c.id !== id));
  const addCriterion = () =>
    setCriteria((prev) => [
      ...prev,
      { id: `ac-${Date.now()}`, text: '', done: false },
    ]);

  const addSubtask = () =>
    setSubtasks((prev) => [
      ...prev,
      { id: `sub-${Date.now()}`, title: '', done: false },
    ]);
  const updateSubtask = (id: string, title: string) =>
    setSubtasks((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
  const removeSubtask = (id: string) =>
    setSubtasks((prev) => prev.filter((s) => s.id !== id));

  const addLink = (item: (typeof LINK_OPTIONS)[number]) => {
    if (linkedItems.some((l) => l.id === item.id && l.kind === item.kind)) return;
    setLinkedItems((prev) => [
      ...prev,
      { kind: item.kind, id: item.id, label: item.label, href: item.href },
    ]);
  };
  const removeLink = (id: string, kind: LinkedItem['kind']) =>
    setLinkedItems((prev) => prev.filter((l) => !(l.id === id && l.kind === kind)));

  // Markdown toolbar handlers — wrap selection with delimiter.
  const wrap = (before: string, after: string = before) => {
    const el = descRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const value = description;
    const next = value.slice(0, start) + before + value.slice(start, end) + after + value.slice(end);
    setDescription(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = start + before.length;
      el.selectionEnd = end + before.length;
    });
  };
  const insertAtCursor = (text: string) => {
    const el = descRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const value = description;
    const next = value.slice(0, start) + text + value.slice(start);
    setDescription(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + text.length;
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-story-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="new-story-dialog"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[var(--scrim)] backdrop-blur-sm"
      />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-[640px] flex-col rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-xl)]">
        <header className="flex shrink-0 items-start justify-between border-b border-[var(--border-subtle)] p-6 pb-4">
          <div>
            <h2 id="new-story-title" className="text-lg font-semibold text-[var(--fg-primary)]">
              New story
            </h2>
            <p className="mt-1 text-xs text-[var(--fg-tertiary)]">
              Create a user story with rich description, acceptance criteria, and subtasks.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-[var(--radius-sm)] p-1 text-[var(--fg-tertiary)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit('create');
          }}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4"
        >
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-story-title-input" className="text-xs font-medium text-[var(--fg-secondary)]">
              Title <span className="text-[var(--accent-rose)]">*</span>
            </label>
            <input
              ref={titleRef}
              id="new-story-title-input"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError(null);
              }}
              required
              aria-invalid={!!error}
              data-testid="new-story-title-input"
              className={cn(
                'h-9 rounded-[var(--radius-md)] border bg-[var(--bg-base)] px-3 text-sm text-[var(--fg-primary)]',
                error ? 'border-[var(--accent-rose)]' : 'border-[var(--border-default)]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              )}
            />
            {error ? (
              <p role="alert" className="text-xs text-[var(--accent-rose)]">
                {error}
              </p>
            ) : null}
          </div>

          {/* Description with markdown toolbar */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="new-story-desc" className="text-xs font-medium text-[var(--fg-secondary)]">
                Description
                <span className="ml-1 text-[10px] font-normal text-[var(--fg-tertiary)]">
                  (markdown)
                </span>
              </label>
              <button
                type="button"
                onClick={() => insertAtCursor('{{user_problem}}')}
                className="rounded text-[10px] text-[var(--accent-primary)] hover:underline focus:outline-none focus-visible:underline"
              >
                + user_problem
              </button>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-0.5 rounded-t-[var(--radius-md)] border border-b-0 border-[var(--border-default)] bg-[var(--bg-inset)] px-1.5 py-1">
              <ToolbarButton label="Bold" onClick={() => wrap('**')}>
                <Bold size={12} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton label="Italic" onClick={() => wrap('_')}>
                <Italic size={12} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton label="Heading" onClick={() => wrap('## ')}>
                <Heading2 size={12} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton label="Link" onClick={() => wrap('[', '](url)')}>
                <LinkIcon size={12} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton label="List" onClick={() => insertAtCursor('\n- ')}>
                <List size={12} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton label="Code" onClick={() => wrap('`')}>
                <Code size={12} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton label="Quote" onClick={() => insertAtCursor('\n> ')}>
                <Quote size={12} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton label="Mention" onClick={() => insertAtCursor('@')}>
                <AtSign size={12} aria-hidden="true" />
              </ToolbarButton>
            </div>

            <textarea
              ref={descRef}
              id="new-story-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={'## Problem\n\nThe {{user_problem}} is…'}
              rows={3}
              data-testid="new-story-desc"
              className={cn(
                'w-full resize-none rounded-b-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-base)] p-2 text-sm text-[var(--fg-primary)]',
                'placeholder:text-[var(--fg-tertiary)]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              )}
            />
          </div>

          {/* Acceptance criteria */}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs font-medium text-[var(--fg-secondary)]">
              Acceptance criteria
            </legend>
            <ul className="flex flex-col gap-1.5">
              {criteria.map((c) => (
                <li key={c.id} className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => toggleCriterion(c.id)}
                    aria-pressed={c.done}
                    className={cn(
                      'mt-1 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border',
                      c.done
                        ? 'border-[var(--accent-emerald)] bg-[var(--accent-emerald)] text-white'
                        : 'border-[var(--border-default)] bg-[var(--bg-base)]',
                    )}
                  >
                    {c.done ? (
                      <CheckSquare size={10} aria-hidden="true" />
                    ) : null}
                  </button>
                  <input
                    type="text"
                    value={c.text}
                    onChange={(e) => updateCriterion(c.id, e.target.value)}
                    placeholder="Given/When/Then…"
                    className={cn(
                      'h-7 flex-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--bg-base)] px-2 text-xs text-[var(--fg-primary)]',
                      'hover:border-[var(--border-subtle)] focus:border-[var(--accent-primary)] focus:outline-none',
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => removeCriterion(c.id)}
                    aria-label="Remove criterion"
                    className="mt-1 rounded p-0.5 text-[var(--fg-tertiary)] hover:text-[var(--accent-rose)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                  >
                    <Trash2 size={11} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={addCriterion}
              className="inline-flex w-fit items-center gap-1 rounded text-[11px] text-[var(--accent-primary)] hover:underline focus:outline-none focus-visible:underline"
            >
              <Plus size={10} aria-hidden="true" /> Add criterion
            </button>
          </fieldset>

          {/* Subtasks */}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs font-medium text-[var(--fg-secondary)]">
              Subtasks <span className="text-[10px] font-normal text-[var(--fg-tertiary)]">(optional)</span>
            </legend>
            <ul className="flex flex-col gap-1">
              {subtasks.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-3 w-3 shrink-0 rounded-[2px] border border-[var(--border-default)] bg-[var(--bg-base)]"
                  />
                  <input
                    type="text"
                    value={s.title}
                    onChange={(e) => updateSubtask(s.id, e.target.value)}
                    placeholder="Subtask title…"
                    className={cn(
                      'h-7 flex-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--bg-base)] px-2 text-xs text-[var(--fg-primary)]',
                      'hover:border-[var(--border-subtle)] focus:border-[var(--accent-primary)] focus:outline-none',
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => removeSubtask(s.id)}
                    aria-label="Remove subtask"
                    className="rounded p-0.5 text-[var(--fg-tertiary)] hover:text-[var(--accent-rose)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                  >
                    <Trash2 size={11} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={addSubtask}
              className="inline-flex w-fit items-center gap-1 rounded text-[11px] text-[var(--accent-primary)] hover:underline focus:outline-none focus-visible:underline"
            >
              <Plus size={10} aria-hidden="true" /> Add subtask
            </button>
          </fieldset>

          {/* Metadata row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="new-story-epic" className="text-xs font-medium text-[var(--fg-secondary)]">
                Epic
              </label>
              <select
                id="new-story-epic"
                value={epicId ?? ''}
                onChange={(e) => setEpicId(e.target.value || null)}
                className={cn(
                  'h-9 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-base)] px-2 text-sm text-[var(--fg-primary)]',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                )}
              >
                <option value="">— None —</option>
                {EPICS.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="new-story-sprint" className="text-xs font-medium text-[var(--fg-secondary)]">
                Sprint
              </label>
              <select
                id="new-story-sprint"
                value={sprintId}
                onChange={(e) => setSprintId(e.target.value)}
                className={cn(
                  'h-9 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-base)] px-2 text-sm text-[var(--fg-primary)]',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                )}
              >
                {sprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Priority + Estimate */}
          <div className="grid grid-cols-2 gap-3">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-xs font-medium text-[var(--fg-secondary)]">Priority</legend>
              <div className="flex flex-wrap gap-1.5">
                {(['P0', 'P1', 'P2', 'P3'] as ReadonlyArray<StoryPriority>).map((p) => (
                  <label
                    key={p}
                    className={cn(
                      'inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-md)] border px-2 py-0.5 text-xs',
                      priority === p
                        ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.10)] text-[var(--fg-primary)]'
                        : 'border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--fg-secondary)]',
                    )}
                  >
                    <input
                      type="radio"
                      name="priority"
                      value={p}
                      checked={priority === p}
                      onChange={() => setPriority(p)}
                      className="sr-only"
                    />
                    <span>{PRIORITY_LABEL[p]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-xs font-medium text-[var(--fg-secondary)]">Estimate</legend>
              <div className="flex flex-wrap gap-1.5">
                {(['XS', 'S', 'M', 'L', 'XL'] as ReadonlyArray<Estimate>).map((e) => (
                  <label
                    key={e}
                    className={cn(
                      'inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-md)] border px-2 py-0.5 text-xs',
                      estimate === e
                        ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.10)] text-[var(--fg-primary)]'
                        : 'border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--fg-secondary)]',
                    )}
                  >
                    <input
                      type="radio"
                      name="estimate"
                      value={e}
                      checked={estimate === e}
                      onChange={() => setEstimate(e)}
                      className="sr-only"
                    />
                    <span className="font-mono">
                      {e} · {ESTIMATE_POINTS[e]}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          {/* Labels */}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs font-medium text-[var(--fg-secondary)]">Labels</legend>
            <div className="flex flex-wrap gap-1.5">
              {(['bug', 'feature', 'chore', 'docs', 'spike'] as ReadonlyArray<LabelKind>).map(
                (l) => {
                  const active = labels.includes(l);
                  return (
                    <button
                      key={l}
                      type="button"
                      onClick={() =>
                        setLabels(active ? labels.filter((x) => x !== l) : [...labels, l])
                      }
                      className={cn(
                        'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-0.5 text-xs',
                        active
                          ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.10)] text-[var(--fg-primary)]'
                          : 'border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--fg-secondary)]',
                      )}
                    >
                      {LABEL_LABEL[l]}
                    </button>
                  );
                },
              )}
            </div>
          </fieldset>

          {/* Assignee */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-story-assignee" className="text-xs font-medium text-[var(--fg-secondary)]">
              Assignee
            </label>
            <select
              id="new-story-assignee"
              value={assigneeId ?? ''}
              onChange={(e) => setAssigneeId(e.target.value || null)}
              className={cn(
                'h-9 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-base)] px-2 text-sm text-[var(--fg-primary)]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              )}
            >
              <option value="">Unassigned</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Linked items */}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs font-medium text-[var(--fg-secondary)]">
              Linked items <span className="text-[10px] font-normal text-[var(--fg-tertiary)]">(optional)</span>
            </legend>

            {linkedItems.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {linkedItems.map((l) => (
                  <li
                    key={`${l.kind}-${l.id}`}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-base)] px-2 py-0.5 text-xs"
                  >
                    <LinkIconFor kind={l.kind} />
                    <span className="font-mono">{l.id}</span>
                    <button
                      type="button"
                      onClick={() => removeLink(l.id, l.kind)}
                      aria-label={`Remove ${l.label}`}
                      className="ml-0.5 rounded text-[var(--fg-tertiary)] hover:text-[var(--accent-rose)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                    >
                      <X size={10} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-wrap gap-1 border-b border-[var(--border-subtle)] pb-1.5">
              {LINK_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setLinkTab(t.key)}
                  aria-pressed={linkTab === t.key}
                  className={cn(
                    'rounded-t-[var(--radius-sm)] px-2 py-0.5 text-[11px]',
                    linkTab === t.key
                      ? 'bg-[var(--bg-base)] font-medium text-[var(--fg-primary)]'
                      : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={linkQuery}
              onChange={(e) => setLinkQuery(e.target.value)}
              placeholder="Search…"
              className={cn(
                'h-7 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-base)] px-2 text-xs',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              )}
            />
            <ul className="max-h-24 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)]">
              {LINK_OPTIONS.filter((o) => o.kind === linkTab)
                .filter((o) => !linkQuery || o.label.toLowerCase().includes(linkQuery.toLowerCase()))
                .map((o) => (
                  <li key={`${o.kind}-${o.id}`}>
                    <button
                      type="button"
                      onClick={() => addLink(o)}
                      className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:bg-[var(--hover)] focus-visible:text-[var(--fg-primary)]"
                    >
                      <LinkIconFor kind={o.kind} />
                      <span className="font-mono">{o.id}</span>
                      <span className="truncate">{o.label}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </fieldset>
        </form>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
          <button
            type="button"
            onClick={() => submit('save_draft')}
            className="rounded-[var(--radius-md)] border border-transparent px-3 py-2 text-sm font-medium text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          >
            Save as draft
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => submit('create')}
              data-testid="new-story-create"
              className={cn(
                'rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-white shadow-[var(--shadow-glow-primary)]',
                'hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2',
              )}
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => submit('create_and_implement')}
              data-testid="new-story-create-and-impl"
              className={cn(
                'rounded-[var(--radius-md)] border border-[var(--accent-primary)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--accent-primary)]',
                'hover:bg-[rgba(99,102,241,0.10)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2',
              )}
            >
              Create and start implementation →
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ---------- Local toolbar primitive ---------- */

interface ToolbarButtonProps {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}

function ToolbarButton({ label, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)]',
        'hover:bg-[var(--hover)] hover:text-[var(--fg-primary)]',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]',
        'transition-colors duration-150',
      )}
    >
      {children}
    </button>
  );
}

function LinkIconFor({ kind }: { kind: LinkedItem['kind'] }) {
  switch (kind) {
    case 'adr':
      return <FileText size={10} aria-hidden="true" className="text-[var(--accent-cyan)]" />;
    case 'epic':
      return <Layers size={10} aria-hidden="true" className="text-[var(--accent-violet)]" />;
    case 'story':
      return <GitBranch size={10} aria-hidden="true" className="text-[var(--accent-primary)]" />;
    case 'pr':
      return <GitBranch size={10} aria-hidden="true" className="text-[var(--accent-emerald)]" />;
    case 'run':
      return <Lightbulb size={10} aria-hidden="true" className="text-[var(--accent-amber)]" />;
  }
}
