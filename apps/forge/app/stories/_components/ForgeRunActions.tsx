'use client';

/**
 * Forge-core Run Actions (Step 44, Fix 5).
 *
 * Two surfaces:
 *   - <StoryRunMenu story … /> — dropdown on every In Progress story
 *     card. Lists skills + commands + agents read from the catalog.
 *   - <ColumnAutomationLink status … /> — "Automate this column" link
 *     on every Kanban column header. Click to expand a panel that
 *     configures which forge-* skill fires automatically when a story
 *     enters the column.
 *
 * The forge-core catalog is the single source of truth — never
 * hardcode skill names in this file. Drop a new `forge-*` skill in
 * packages/forge-core/ and it auto-appears on next load.
 */

import * as React from 'react';
import { Bot, ChevronDown, Cog, Play, TerminalSquare, Workflow, Zap } from 'lucide-react';
import { toast } from 'sonner';

import type { Story, StoryStatus } from '@/lib/stories/types';
import {
  FORGE_SKILLS,
  phaseFor,
  phaseLabel,
  phaseEstimatedMinutes,
  type ForgeSkill,
} from '@/lib/forge-core/manifest';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*  StoryRunMenu — dropdown on In-Progress cards                              */
/* -------------------------------------------------------------------------- */

export interface StoryRunMenuProps {
  readonly story: Story;
  readonly onLaunchTerminal?: (storyId: string, commandId: string) => void;
}

export function StoryRunMenu({ story, onLaunchTerminal }: StoryRunMenuProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const run = (skill: ForgeSkill) => {
    setOpen(false);
    onLaunchTerminal?.(story.id, skill.id);
    toast.success(`Launching ${skill.id}`, {
      description: `${story.identifier} → ${skill.label}`,
    });
  };

  const skills = FORGE_SKILLS.slice(0, 8);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={`story-run-menu-${story.identifier}`}
        className={cn(
          'inline-flex w-fit items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5',
          'text-[10px] font-medium text-[var(--accent-primary)]',
          'hover:bg-[rgba(99,102,241,0.10)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        )}
      >
        <Play size={10} aria-hidden="true" />
        <span>Run</span>
        <ChevronDown size={10} aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            'absolute left-0 top-full z-30 mt-1 w-64',
            'rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5',
            'shadow-[var(--shadow-lg)]',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <RunGroup
            title="Run skill"
            icon={Workflow}
            items={skills.filter((s) => !!s.skillFile).slice(0, 4)}
            onPick={run}
            testIdPrefix="run-skill"
          />
          <RunGroup
            title="Run agent"
            icon={Bot}
            items={skills.filter((s) => s.category === 'operational').slice(0, 3)}
            onPick={run}
            testIdPrefix="run-agent"
          />
          <RunGroup
            title="Run command"
            icon={Zap}
            items={skills.slice(4, 8)}
            onPick={run}
            testIdPrefix="run-cmd"
          />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLaunchTerminal?.(story.id, '__terminal__');
            }}
            className="mt-0.5 flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[11px] text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg-primary)]"
          >
            <TerminalSquare size={11} aria-hidden="true" />
            Open in terminal (raw)
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RunGroup({
  title,
  icon: Icon,
  items,
  onPick,
  testIdPrefix,
}: {
  readonly title: string;
  readonly icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  readonly items: ReadonlyArray<ForgeSkill>;
  readonly onPick: (skill: ForgeSkill) => void;
  readonly testIdPrefix: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-1">
      <p className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        <Icon size={9} aria-hidden="true" />
        {title}
      </p>
      <ul className="flex flex-col">
        {items.map((skill) => (
          <li key={skill.id}>
            <button
              type="button"
              role="menuitem"
              onClick={() => onPick(skill)}
              data-testid={`${testIdPrefix}-${skill.id}`}
              className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[11px] text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:bg-[var(--hover)] focus-visible:text-[var(--fg-primary)]"
            >
              <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{skill.id}</span>
              <span className="truncate">{skill.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  ColumnAutomationLink — "Automate this column" on every column header      */
/* -------------------------------------------------------------------------- */

export interface ColumnAutomationLinkProps {
  readonly status: StoryStatus;
  readonly onConfigure?: (status: StoryStatus) => void;
}

export function ColumnAutomationLink({ status, onConfigure }: ColumnAutomationLinkProps) {
  const skills = phaseFor(status);
  if (skills.length === 0) {
    return (
      <span className="text-[10px] text-[var(--fg-muted)]" title="No automations for this column">
        —
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onConfigure?.(status);
      }}
      data-testid={`column-automate-${status}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5',
        'text-[10px] text-[var(--accent-violet)]',
        'hover:bg-[rgba(139,92,246,0.10)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-violet)]',
      )}
      title={`When a story enters this column, run: ${phaseLabel(status)}`}
    >
      <Cog size={10} aria-hidden="true" />
      <span>Automate</span>
      <span className="font-mono text-[var(--fg-tertiary)]">~{phaseEstimatedMinutes(status)}m</span>
    </button>
  );
}
