'use client';

import * as React from 'react';
import { Copy, Eye, MoreVertical, Play, FileCode2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { WorkflowTemplate } from '@/lib/workflow/types';

import { TemplatePreview } from './TemplatePreview';

/**
 * TemplateCard — the gallery's primary surface.
 *
 * Click anywhere on the card to load the template into the canvas.
 * The 3-dot menu (hover) offers Preview / Duplicate / View source.
 */

export interface TemplateCardProps {
  readonly template: WorkflowTemplate;
  readonly onUse: (template: WorkflowTemplate) => void;
  readonly onPreview?: (template: WorkflowTemplate) => void;
  readonly onDuplicate?: (template: WorkflowTemplate) => void;
  readonly onViewSource?: (template: WorkflowTemplate) => void;
  readonly className?: string;
}

export function TemplateCard({
  template,
  onUse,
  onPreview,
  onDuplicate,
  onViewSource,
  className,
}: TemplateCardProps) {
  const Icon = template.icon;
  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <article
      data-testid={`template-card-${template.id}`}
      className={cn(
        'group relative flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5',
        'card-hover cursor-pointer focus-within:ring-2 focus-within:ring-[var(--accent-primary)]',
        className,
      )}
      tabIndex={0}
      onClick={() => onUse(template)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onUse(template);
        }
      }}
      role="button"
      aria-label={`Use template ${template.name}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-inset)]"
            style={{ color: `var(${template.colorVar})` }}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-md font-semibold leading-tight text-[var(--fg-primary)]">{template.name}</h3>
            <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">by Forge Team</p>
          </div>
        </div>

        {/* 3-dot menu */}
        <div className="relative">
          <button
            type="button"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)] opacity-0 transition-opacity',
              'hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)] focus:opacity-100 focus:outline-none group-hover:opacity-100',
            )}
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-9 z-20 min-w-[160px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-md)]"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onPreview?.(template);
                }}
                className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
              >
                <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Preview
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onDuplicate?.(template);
                }}
                className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Duplicate
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onViewSource?.(template);
                }}
                className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
              >
                <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" /> View source
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <TemplatePreview template={template} />

      <p className="line-clamp-2 text-sm text-[var(--fg-secondary)]">{template.description}</p>

      <footer className="mt-1 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-secondary)]">
            {template.nodes.length} nodes
          </span>
          <span className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] text-[var(--fg-tertiary)]">
            {template.category}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUse(template);
          }}
          data-testid={`template-use-${template.id}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-medium text-white',
            'transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
          )}
        >
          <Play className="h-3 w-3" aria-hidden="true" />
          Use template
        </button>
      </footer>
    </article>
  );
}

/* ---------------------------------------------------------------------------
 * Variant for My workflows / Shared / Drafts tabs.
 * Different visual: status dot + last-edited + owner.
 * --------------------------------------------------------------------------- */

export interface WorkflowListCardData {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: 'draft' | 'published' | 'archived';
  readonly updatedAt: string;
  readonly runCount?: number;
  readonly lastRunStatus?: 'succeeded' | 'failed' | 'running' | 'pending';
  readonly ownerName?: string;
  readonly ownerAvatar?: string;
  readonly nodes: number;
}

export interface WorkflowListCardProps {
  readonly data: WorkflowListCardData;
  readonly onOpen: (id: string) => void;
  readonly className?: string;
}

const STATUS_DOT: Record<NonNullable<WorkflowListCardData['lastRunStatus']>, string> = {
  succeeded: 'bg-[var(--accent-emerald)] shadow-[0_0_6px_var(--accent-emerald)]',
  running: 'bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan)] ai-thinking-dot',
  pending: 'bg-[var(--accent-amber)]',
  failed: 'bg-[var(--accent-rose)]',
};

const STATUS_PILL: Record<WorkflowListCardData['status'], { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-[rgba(245,158,11,0.12)] text-[var(--accent-amber)]' },
  published: { label: 'Published', cls: 'bg-[rgba(16,185,129,0.12)] text-[var(--accent-emerald)]' },
  archived: { label: 'Archived', cls: 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]' },
};

export function WorkflowListCard({ data, onOpen, className }: WorkflowListCardProps) {
  const status = STATUS_PILL[data.status];
  return (
    <article
      data-testid={`workflow-list-card-${data.id}`}
      className={cn(
        'group flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5',
        'card-hover cursor-pointer',
        className,
      )}
      tabIndex={0}
      onClick={() => onOpen(data.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(data.id);
        }
      }}
      role="button"
      aria-label={`Open workflow ${data.name}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-md font-semibold leading-tight text-[var(--fg-primary)]">
            {data.name}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
            {data.nodes} nodes · updated {data.updatedAt}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
            status.cls,
          )}
        >
          {status.label}
        </span>
      </header>

      <p className="line-clamp-2 text-sm text-[var(--fg-secondary)]">{data.description}</p>

      <footer className="flex items-center justify-between gap-2 text-xs text-[var(--fg-tertiary)]">
        <div className="flex items-center gap-2">
          {data.lastRunStatus ? (
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 rounded-full', STATUS_DOT[data.lastRunStatus])}
            />
          ) : null}
          {data.runCount !== undefined ? (
            <span>
              <span className="font-mono">{data.runCount}</span> runs
            </span>
          ) : null}
        </div>
        {data.ownerName ? (
          <span className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-inset)] font-mono text-[10px] text-[var(--fg-secondary)]">
              {(data.ownerAvatar ?? data.ownerName.slice(0, 2)).toUpperCase()}
            </span>
            {data.ownerName}
          </span>
        ) : null}
      </footer>
    </article>
  );
}