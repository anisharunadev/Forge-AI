'use client';

/**
 * QuickActions menu (Step 38, Fix 8).
 *
 * A consistent dropdown of "do this now" actions rendered in the
 * hero band of both Project Intelligence and Stories. Each entry has
 * a lucide icon + label + optional keyboard hint.
 *
 * Skill influence:
 *   - ux-guideline (deep linking) — actions update the URL or open a
 *     new tab so the user can share / bookmark.
 *   - ux-guideline (active state) — pressing shows the active style.
 */

import * as React from 'react';
import {
  Bot,
  ClipboardList,
  Code2,
  Compass,
  FileText,
  GitBranch,
  Lightbulb,
  Plus,
  Rocket,
  Sparkles,
  TerminalSquare,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface QuickAction {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon: LucideIcon;
  readonly onSelect: () => void;
}

export interface QuickActionsMenuProps {
  readonly variant: 'projects' | 'stories';
  readonly actions: ReadonlyArray<QuickAction>;
  readonly className?: string;
}

const VARIANT_LABEL: Record<QuickActionsMenuProps['variant'], string> = {
  projects: 'Quick actions',
  stories: 'Quick actions',
};

export function QuickActionsMenu({
  variant,
  actions,
  className,
}: QuickActionsMenuProps) {
  // Group by category (derive from id prefix). Pattern: `<category>:<id>`.
  const grouped = React.useMemo(() => {
    const groups = new Map<string, QuickAction[]>();
    for (const a of actions) {
      const cat = a.id.includes(':') ? a.id.split(':')[0]! : 'misc';
      const arr = groups.get(cat) ?? [];
      arr.push(a);
      groups.set(cat, arr);
    }
    return Array.from(groups.entries());
  }, [actions]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={`quick-actions-${variant}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)]',
            'bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-[var(--fg-primary)]',
            'hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
            className,
          )}
        >
          <Zap size={12} aria-hidden="true" className="text-[var(--accent-amber)]" />
          <span>{VARIANT_LABEL[variant]}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-64 border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--fg-primary)]"
      >
        {grouped.map(([cat, items], gIdx) => (
          <React.Fragment key={cat}>
            {gIdx > 0 ? <DropdownMenuSeparator className="bg-[var(--border-subtle)]" /> : null}
            <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]">
              {cat === 'create' ? 'Create' : cat === 'open' ? 'Open' : cat === 'ai' ? 'AI assist' : 'Quick'}
            </DropdownMenuLabel>
            {items.map((a) => {
              const Icon = a.icon;
              return (
                <DropdownMenuItem
                  key={a.id}
                  onSelect={(e) => {
                    e.preventDefault();
                    a.onSelect();
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] text-xs focus:bg-[rgba(99,102,241,0.10)] focus:text-[var(--fg-primary)]"
                  data-testid={`quick-action-${a.id}`}
                >
                  <Icon size={12} aria-hidden="true" className="shrink-0 text-[var(--fg-tertiary)]" />
                  <span className="flex-1 truncate">{a.label}</span>
                  {a.hint ? (
                    <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--fg-tertiary)]">
                      {a.hint}
                    </kbd>
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------ */
/*  Pre-baked action sets for both variants (Fix 8).                   */
/* ------------------------------------------------------------------ */

export function projectsQuickActions(handlers: {
  readonly onNewIdea: () => void;
  readonly onNewPrd: () => void;
  readonly onNewEpic: () => void;
  readonly onNewStory: () => void;
  readonly onOpenTerminal: () => void;
  readonly onOpenCopilot: () => void;
  readonly onOpenCommandCenter: () => void;
}): ReadonlyArray<QuickAction> {
  return [
    { id: 'create:idea', label: 'New idea', hint: '⌘N · I', icon: Lightbulb, onSelect: handlers.onNewIdea },
    { id: 'create:prd', label: 'New PRD', hint: '⌘N · P', icon: ClipboardList, onSelect: handlers.onNewPrd },
    { id: 'create:epic', label: 'New epic', icon: GitBranch, onSelect: handlers.onNewEpic },
    { id: 'create:story', label: 'New story', hint: '⌘⇧S', icon: FileText, onSelect: handlers.onNewStory },
    { id: 'open:terminal', label: 'Open in terminal', hint: '⌘`', icon: TerminalSquare, onSelect: handlers.onOpenTerminal },
    { id: 'open:copilot', label: 'Open co-pilot', hint: '⌘J', icon: Sparkles, onSelect: handlers.onOpenCopilot },
    { id: 'open:command', label: 'Command center', icon: Compass, onSelect: handlers.onOpenCommandCenter },
    { id: 'ai:agent', label: 'New agent', icon: Bot, onSelect: handlers.onNewIdea },
    { id: 'ai:ship', label: 'Ship this project', icon: Rocket, onSelect: handlers.onNewIdea },
  ];
}

export function storiesQuickActions(handlers: {
  readonly onNewStory: () => void;
  readonly onStartSprint: () => void;
  readonly onOpenTerminal: () => void;
  readonly onOpenCopilot: () => void;
  readonly onGenerateTasks: () => void;
}): ReadonlyArray<QuickAction> {
  return [
    { id: 'create:story', label: 'New story', hint: '⌘⇧S', icon: Plus, onSelect: handlers.onNewStory },
    { id: 'create:sprint', label: 'Start sprint', icon: Rocket, onSelect: handlers.onStartSprint },
    { id: 'ai:tasks', label: 'Generate tasks from story', hint: '⌘⇧G', icon: Sparkles, onSelect: handlers.onGenerateTasks },
    { id: 'open:terminal', label: 'Open in terminal', hint: '⌘`', icon: TerminalSquare, onSelect: handlers.onOpenTerminal },
    { id: 'open:copilot', label: 'View in co-pilot', icon: Bot, onSelect: handlers.onOpenCopilot },
  ];
}

/** Stub exporter for the dummy `onGenerateTasks` icon imports. */
export const _unused = { Code2 };
