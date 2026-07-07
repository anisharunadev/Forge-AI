'use client';

import * as React from 'react';
import { Plus, Workflow as WorkflowIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { WorkflowTemplate } from '@/lib/workflow/types';
import { EmptyState } from '@/components/shell/EmptyState';
import { WORKFLOW_TEMPLATES } from '@/lib/workflow/templates';

import { HeroBand } from './HeroBand';
import { KPIStrip } from './KPIStrip';
import { TemplateCard } from './TemplateCard';
import { WORKFLOW_KPIS } from '@/lib/workflow/templates';

/**
 * WorkflowGallery — Mode A. The default landing on /workflows.
 *
 * 4 segments:
 *   1. Hero band (animated border) with "From scratch" CTA.
 *   2. KPI strip (4 tiles).
 *   3. Tab bar (Templates / My workflows / Shared / Drafts).
 *   4. Card grid (1-3 cols responsive).
 */

export interface WorkflowGalleryProps {
  readonly onOpenTemplate: (template: WorkflowTemplate) => void;
  readonly onOpenUserWorkflow: (id: string) => void;
  readonly onPreviewTemplate?: (template: WorkflowTemplate) => void;
  readonly onDuplicateTemplate?: (template: WorkflowTemplate) => void;
  readonly onViewSourceTemplate?: (template: WorkflowTemplate) => void;
  readonly onFromScratch: () => void;
  readonly className?: string;
}

type GalleryTab = 'templates' | 'mine' | 'shared' | 'drafts';

const TAB_LABELS: Record<GalleryTab, string> = {
  templates: 'Templates',
  mine: 'My workflows',
  shared: 'Shared with me',
  drafts: 'Drafts',
};

export function WorkflowGallery(props: WorkflowGalleryProps) {
  const { onOpenTemplate, onOpenUserWorkflow, onFromScratch, onPreviewTemplate, onDuplicateTemplate, onViewSourceTemplate } = props;
  const [tab, setTab] = React.useState<GalleryTab>('templates');

  return (
    <div className={cn('flex flex-col gap-6', props.className)} data-testid="workflow-gallery">
      <HeroBand
        eyebrow="Center"
        title="Workflows"
        description="Compose multi-step AI workflows. Connect commands, approvals, and custom logic into a DAG your team can run, schedule, or trigger from events."
        primaryActionLabel="From scratch"
        onPrimaryAction={onFromScratch}
      />

      <KPIStrip kpis={WORKFLOW_KPIS} />

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Workflow views"
        className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1"
      >
        {(Object.keys(TAB_LABELS) as GalleryTab[]).map((id) => {
          const active = tab === id;
          const count = getTabCount(id);
          return (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={active}
              data-testid={`gallery-tab-${id}`}
              onClick={() => setTab(id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors duration-200 ease-out-soft',
                active
                  ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-secondary)]',
              )}
            >
              {TAB_LABELS[id]}
              <span
                className={cn(
                  'rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px]',
                  active ? 'bg-[var(--bg-inset)] text-[var(--fg-secondary)]' : 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Card grid */}
      {tab === 'templates' ? (
        <TemplateGrid
          onOpenTemplate={onOpenTemplate}
          onPreviewTemplate={onPreviewTemplate}
          onDuplicateTemplate={onDuplicateTemplate}
          onViewSourceTemplate={onViewSourceTemplate}
        />
      ) : null}

      {tab === 'mine' ? <MyWorkflowsGrid onOpen={onOpenUserWorkflow} /> : null}

      {tab === 'shared' ? <SharedGrid onOpen={onOpenUserWorkflow} /> : null}

      {tab === 'drafts' ? <DraftsGrid onOpen={onOpenUserWorkflow} /> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------- */

function getTabCount(tab: GalleryTab): number {
  switch (tab) {
    case 'templates':
      return WORKFLOW_TEMPLATES.length;
    // ponytail: backend pending, Day 4+ — no /v1/workflows/runs list endpoint
    case 'mine':
    case 'shared':
    case 'drafts':
      return 0;
  }
  return 0;
}

/* ---------------------------------------------------------------------------
 * Sub-grids
 * --------------------------------------------------------------------------- */

interface TemplateGridProps {
  readonly onOpenTemplate: (template: WorkflowTemplate) => void;
  readonly onPreviewTemplate?: (template: WorkflowTemplate) => void;
  readonly onDuplicateTemplate?: (template: WorkflowTemplate) => void;
  readonly onViewSourceTemplate?: (template: WorkflowTemplate) => void;
}

function TemplateGrid({
  onOpenTemplate,
  onPreviewTemplate,
  onDuplicateTemplate,
  onViewSourceTemplate,
}: TemplateGridProps) {
  if (WORKFLOW_TEMPLATES.length === 0) {
    return (
      <EmptyState
        title="No templates yet"
        description="Predefined workflow templates will appear here."
      />
    );
  }
  return (
    <ul
      role="list"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      data-testid="workflow-template-grid"
    >
      {WORKFLOW_TEMPLATES.map((t) => (
        <li key={t.id}>
          <TemplateCard
            template={t}
            onUse={onOpenTemplate}
            {...(onPreviewTemplate ? { onPreview: onPreviewTemplate } : {})}
            {...(onDuplicateTemplate ? { onDuplicate: onDuplicateTemplate } : {})}
            {...(onViewSourceTemplate ? { onViewSource: onViewSourceTemplate } : {})}
          />
        </li>
      ))}
    </ul>
  );
}

function MyWorkflowsGrid({ onOpen: _onOpen }: { onOpen: (id: string) => void }) {
  // ponytail: backend pending, Day 4+ — no /v1/workflows list endpoint
  return (
    <EmptyState
      icon={<Plus className="h-5 w-5" />}
      title="No workflows yet"
      description="Backend integration pending — Day 4+. Start from a template or build from scratch."
      action={
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--fg-primary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
          >
            Browse templates
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            From scratch
          </button>
        </div>
      }
    />
  );
}

function SharedGrid({ onOpen: _onOpen }: { onOpen: (id: string) => void }) {
  // ponytail: backend pending, Day 4+ — no /v1/workflows list endpoint
  return <EmptyState title="No shared workflows" description="Backend integration pending — Day 4+. Workflows your team has shared with you will appear here." />;
}

function DraftsGrid({ onOpen: _onOpen }: { onOpen: (id: string) => void }) {
  // ponytail: backend pending, Day 4+ — no /v1/workflows list endpoint
  return (
    <EmptyState
      icon={<WorkflowIcon className="h-5 w-5" />}
      title="No drafts"
      description="Backend integration pending — Day 4+. Drafts are auto-saved when you start building a workflow without naming it."
    />
  );
}

// Avoid unused-export warnings.
export {};