'use client';

/**
 * Stories Center — StoryCard (Step 21).
 *
 * Single card shape used in the kanban board. Designed to be:
 *   - **compact** enough to stack 6+ in a column
 *   - **honest** about status (done = strikethrough, blocked = rose tint)
 *   - **a11y-friendly** with role="button", aria-grabbed, focus ring
 *
 * Skill influence:
 *   - Always show label above input (label chips are visible, not tooltips)
 *   - Avoid arbitrary large z-index
 *   - Maintain 4.5:1 contrast (--fg-primary on --bg-surface)
 */

import * as React from 'react';
import Link from 'next/link';
import {
  Clock,
  GripVertical,
  MessageSquare,
  Paperclip,
  MoreHorizontal,
  Rocket,
  TerminalSquare,
} from 'lucide-react';

import type { LabelKind, Story } from '@/lib/stories/types';
import {
  LABEL_DOT_VAR,
  LABEL_LABEL,
  PRIORITY_DOT_VAR,
} from '@/lib/stories/types';
import { StoryRunMenu } from './ForgeRunActions';
import { cn } from '@/lib/utils';

export interface StoryCardProps {
  readonly story: Story;
  readonly isDragging?: boolean;
  readonly onOpen: (id: string) => void;
  readonly dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  readonly draggableProps?: React.HTMLAttributes<HTMLDivElement>;
  /** When set, render a "Live coding session" pill that deep-links
   *  into the bound terminal session (Step 38, Fix 5). */
  readonly liveSessionId?: string;
  /** When set, render a "Start implementation" micro-button on cards
   *  in `todo` / `backlog` status so the user can launch a session
   *  without opening the drawer first. */
  readonly onStartImplementation?: (story: Story) => void;
  /** Step 44 — wire a story → forge-core skill launch. Routed to the
   *  StoriesCenter so it can open a terminal session with the right
   *  context. */
  readonly onRunCommand?: (story: Story, commandId: string) => void;
}

export const StoryCard = React.forwardRef<HTMLDivElement, StoryCardProps>(
  function StoryCard(
    {
      story,
      isDragging,
      onOpen,
      dragHandleProps,
      draggableProps,
      liveSessionId,
      onStartImplementation,
      onRunCommand,
    },
    ref,
  ) {
    const done = story.status === 'done';
    const subtasksTotal = story.subtasks.length;
    const subtasksDone = story.subtasks.filter((s) => s.done).length;
    const ageLabel = formatAge(story.updatedAt);
    const canStart = (story.status === 'todo' || story.status === 'backlog') && !!onStartImplementation;
    const canRun = (story.status === 'in_progress' || story.status === 'in_review') && !!onRunCommand;

    return (
      <div
        ref={ref}
        {...draggableProps}
        data-testid={`story-card-${story.identifier}`}
        data-status={story.status}
        className={cn(
          'group relative flex flex-col gap-2 rounded-[var(--radius-md)] border p-3 text-left',
          'transition-[transform,box-shadow,border-color] duration-fast ease-out-soft',
          done
            ? 'border-[var(--border-subtle)] bg-[var(--bg-surface)] opacity-65'
            : story.blocked
            ? 'border-[rgba(244,63,94,0.30)] bg-[var(--bg-surface)]'
            : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]',
          'hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)]',
          isDragging
            ? 'scale-[1.02] rotate-[1deg] opacity-95 shadow-[var(--shadow-lg)]'
            : '',
        )}
      >
        {/* Drag handle */}
        <button
          type="button"
          aria-label={`Drag story ${story.identifier}`}
          {...dragHandleProps}
          className={cn(
            'absolute -left-1.5 top-1.5 hidden h-5 w-5 items-center justify-center rounded-[var(--radius-sm)]',
            'text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] focus:outline-none',
            'focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
            'group-hover:flex',
          )}
        >
          <GripVertical size={12} aria-hidden="true" />
        </button>

        {/* Top row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: PRIORITY_DOT_VAR[story.priority] }}
            />
            <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
              {story.identifier}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {story.blocked ? (
              <span className="rounded-[var(--radius-sm)] bg-[rgba(244,63,94,0.15)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--accent-rose)]">
                Blocked
              </span>
            ) : null}
            <button
              type="button"
              aria-label="Open story menu"
              onClick={(e) => {
                e.stopPropagation();
              }}
              className={cn(
                'rounded-[var(--radius-sm)] p-1 text-[var(--fg-muted)]',
                'hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              )}
            >
              <MoreHorizontal size={12} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Title (button so the card itself is keyboard-openable) */}
        <button
          type="button"
          onClick={() => onOpen(story.id)}
          className={cn(
            'text-left text-sm font-medium leading-snug text-[var(--fg-primary)]',
            'focus:outline-none focus-visible:underline',
            done ? 'line-through text-[var(--fg-secondary)]' : '',
          )}
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {story.title}
        </button>

        {/* Live session pill (when a terminal session is bound) */}
        {liveSessionId ? (
          <Link
            href={`/forge-terminal?sessionId=${liveSessionId}`}
            data-testid={`story-card-live-${story.identifier}`}
            className={cn(
              'inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-sm)] border',
              'border-[var(--accent-emerald)]/40 bg-[rgba(34,197,94,0.10)]',
              'px-2 py-0.5 text-[10px] font-medium text-[var(--accent-emerald)]',
              'transition-colors duration-fast ease-out-soft',
              'hover:bg-[rgba(34,197,94,0.18)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-emerald)]',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent-emerald)] opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)]" />
            </span>
            <TerminalSquare size={10} aria-hidden="true" />
            <span>Live coding session</span>
            <span aria-hidden="true">→</span>
          </Link>
        ) : null}

        {/* Start implementation micro-button (todo / backlog only) */}
        {canStart ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartImplementation?.(story);
            }}
            data-testid={`story-card-start-${story.identifier}`}
            className={cn(
              'inline-flex w-fit items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5',
              'text-[10px] font-medium text-[var(--accent-primary)]',
              'hover:bg-[rgba(99,102,241,0.10)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
            )}
          >
            <Rocket size={10} aria-hidden="true" />
            <span>Start implementation</span>
          </button>
        ) : null}

        {/* Step 44 Fix 5 — forge-core Run actions on in-flight cards */}
        {canRun ? (
          <StoryRunMenu
            story={story}
            onLaunchTerminal={(storyId, commandId) => onRunCommand?.(story, commandId)}
          />
        ) : null}

        {/* Label chips */}
        {story.labels.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {story.labels.slice(0, 3).map((label) => (
              <LabelChip key={label} kind={label} />
            ))}
            {story.labels.length > 3 ? (
              <span className="text-[10px] text-[var(--fg-tertiary)]">
                +{story.labels.length - 3}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Bottom row */}
        <div className="mt-1 flex items-center justify-between gap-2 text-[var(--fg-tertiary)]">
          <div className="flex items-center gap-2">
            {story.assignee ? (
              <span
                aria-hidden="true"
                className="relative inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                style={{ backgroundColor: story.assignee.color }}
                title={story.assignee.name}
              >
                {story.assignee.initials}
                {story.assignee.online ? (
                  <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border border-[var(--bg-surface)] bg-[var(--accent-emerald)]" />
                ) : null}
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-[var(--border-default)] text-[8px] text-[var(--fg-tertiary)]"
                title="Unassigned"
              >
                ?
              </span>
            )}
            <span className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-secondary)]">
              {story.estimate}
            </span>
            {story.commentCount > 0 ? (
              <span className="inline-flex items-center gap-0.5 text-[10px]">
                <MessageSquare size={10} aria-hidden="true" />
                {story.commentCount}
              </span>
            ) : null}
            {story.attachmentCount > 0 ? (
              <span className="inline-flex items-center gap-0.5 text-[10px]">
                <Paperclip size={10} aria-hidden="true" />
                {story.attachmentCount}
              </span>
            ) : null}
          </div>
          <span className="inline-flex items-center gap-0.5 text-[10px]" title="Last updated">
            <Clock size={10} aria-hidden="true" />
            {ageLabel}
          </span>
        </div>

        {/* Subtask progress */}
        {subtasksTotal > 0 ? (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={subtasksTotal}
            aria-valuenow={subtasksDone}
            aria-label={`${subtasksDone} of ${subtasksTotal} subtasks complete`}
            className="mt-1 flex flex-col gap-1"
          >
            <div className="flex items-center justify-between text-[10px] text-[var(--fg-tertiary)]">
              <span>
                {subtasksDone}/{subtasksTotal} subtasks
              </span>
            </div>
            <div className="h-0.5 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]">
              <span
                aria-hidden="true"
                className="block h-full rounded-full bg-[var(--accent-primary)]"
                style={{ width: `${(subtasksDone / subtasksTotal) * 100}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);

function LabelChip({ kind }: { kind: LabelKind }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--fg-secondary)]"
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: LABEL_DOT_VAR[kind] }}
      />
      {LABEL_LABEL[kind]}
    </span>
  );
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}