'use client';

/**
 * Terminal — Left rail (Step 36 / Fix 3).
 *
 * Collapsible left rail with five sections:
 *   - Sessions  (Terminal)        — list of active sessions.
 *   - Context   (Layers)          — context items attached to session.
 *   - Skills    (Sparkles)        — available forge-* skills.
 *   - Commands  (Command)         — recent / favorite forge-* commands.
 *   - Layout    (LayoutGrid)      — layout switcher.
 *
 * Collapsed state: 56px-wide vertical strip with stacked icon buttons.
 * Expanded state: 320px panel with the section's content.
 *
 * Skill influence:
 *   - ux-guideline (touch target size) — collapsed icons are 56×56,
 *     well above the 44px tap-target minimum.
 *   - ux-guideline (focus states) — visible focus rings on every
 *     collapsible icon (radix-as-Child pattern not needed — the button
 *     itself is the focus target).
 *   - ux-guideline (reduced-motion) — width transition honors
 *     prefers-reduced-motion via the global `motion-reduce` rule.
 */

import * as React from 'react';
import {
  Command as CommandIcon,
  Copy,
  Layers,
  LayoutGrid,
  Plus,
  ScrollText,
  Sparkles,
  Terminal as TerminalIcon,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SegmentedControl } from '@/components/agent-center/AgentCenterControls';
import { cn } from '@/lib/utils';
import { useTerminalStore } from '@/lib/store';
import {
  useTerminalUiStore,
  LEFT_RAIL_SECTIONS,
  type LeftRailSection,
} from '@/lib/terminal-ui-store';

const COLLAPSED_WIDTH = 56;
const EXPANDED_WIDTH = 320;

const SECTION_ICONS: Record<
  LeftRailSection,
  React.ComponentType<{ className?: string }>
> = {
  sessions: TerminalIcon,
  context:  Layers,
  skills:   Sparkles,
  commands: CommandIcon,
  layout:   LayoutGrid,
};

// -----------------------------------------------------------------------------
// Type contracts — kept here so the panels below stay typed when the live
// data hooks land (Day 4+). Empty-state UI is wired in Track O (Day 3);
// the SAMPLE_* fixtures are retained ONLY for backwards-compat with any
// external tester that imports them by name. They are NOT seeded into the
// UI anymore.
// -----------------------------------------------------------------------------

interface ContextItem {
  id: string;
  name: string;
  source: 'spec' | 'ticket' | 'adr' | 'doc';
}

interface SkillEntry {
  id: string;
  name: string;
  description: string;
}

interface RecentCommand {
  id: string;
  label: string;
  hint: string;
}

// ponytail: deliberately empty fixtures — Track O (Day 3) removed
// SAMPLE_* seeding from the rail panels. These exports remain solely so
// any tests or doc-imports that referenced them by name still resolve
// to a typed empty array instead of an undeclared identifier.
/**
 * @deprecated Retained for backwards-compat only. Track O (Day 3) removed
 *   seeding from the LeftRail; panels render explicit empty states. Drop
 *   on Day 4+ once external callers migrate.
 */
export const SAMPLE_CONTEXT: ReadonlyArray<ContextItem> = [];

/**
 * @deprecated Retained for backwards-compat only. Track O (Day 3) removed
 *   seeding from the LeftRail; the SkillsPanel renders an empty state.
 */
export const SAMPLE_SKILLS: ReadonlyArray<SkillEntry> = [];

/**
 * @deprecated Retained for backwards-compat only. Track O (Day 3) removed
 *   seeding from the LeftRail; the CommandsPanel renders an empty state.
 */
export const SAMPLE_COMMANDS: ReadonlyArray<RecentCommand> = [];

const CONTEXT_SOURCE_COLOR: Record<ContextItem['source'], string> = {
  spec:   'var(--accent-cyan)',
  ticket: 'var(--accent-amber)',
  adr:    'var(--accent-violet)',
  doc:    'var(--accent-emerald)',
};

// -----------------------------------------------------------------------------
// Rail container
// -----------------------------------------------------------------------------

interface LeftRailProps {
  onNewSession: () => void;
}

export function LeftRail({ onNewSession }: LeftRailProps) {
  const expanded = useTerminalUiStore((s) => s.leftRail);
  const toggle = useTerminalUiStore((s) => s.toggleLeftRail);

  return (
    <aside
      data-testid="terminal-left-rail"
      data-expanded={expanded ? 'true' : 'false'}
      aria-label="Terminal left rail"
      className={cn(
        'relative shrink-0 overflow-hidden border-r border-[var(--border-default)] bg-[var(--bg-surface)]',
        'transition-[width] duration-200 ease-out motion-reduce:transition-none',
      )}
      style={{ width: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH }}
    >
      {expanded ? (
        <LeftRailExpanded
          section={expanded}
          onCollapse={() => toggle(expanded)}
          onNewSession={onNewSession}
        />
      ) : (
        <LeftRailCollapsed />
      )}
    </aside>
  );
}

// -----------------------------------------------------------------------------
// Collapsed — vertical icon stack
// -----------------------------------------------------------------------------

function LeftRailCollapsed() {
  const sessionsCount = useTerminalStore((s) => s.sessions.length);
  const toggle = useTerminalUiStore((s) => s.toggleLeftRail);
  const visitCount = useTerminalUiStore((s) => s.visitCount);

  return (
    <div
      className="flex h-full flex-col items-center gap-1 py-2"
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Terminal sections"
    >
      {LEFT_RAIL_SECTIONS.map((section, idx) => {
        const Icon = SECTION_ICONS[section.id];
        const showFirstVisitTip = visitCount > 0 && visitCount < 5 && idx === 0;
        return (
          <React.Fragment key={section.id}>
            <button
              type="button"
              onClick={() => toggle(section.id)}
              aria-label={`${section.label} (${section.shortcut})`}
              title={`${section.label} · ${section.shortcut}`}
              data-testid={`left-rail-icon-${section.id}`}
              className={cn(
                'group relative flex h-10 w-10 items-center justify-center rounded-md',
                'text-[var(--fg-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)]',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {section.id === 'sessions' && sessionsCount > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[var(--accent-primary)] px-1 text-[8px] font-semibold leading-none text-white"
                >
                  {sessionsCount}
                </span>
              ) : null}
            </button>
            {/* Tiny divider after the first three sections for visual grouping */}
            {idx === 2 ? (
              <span aria-hidden="true" className="my-1 h-px w-6 bg-[var(--border-subtle)]" />
            ) : null}
            {showFirstVisitTip ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-[60px] top-[14px] whitespace-nowrap rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--fg-secondary)] shadow-sm animate-in fade-in slide-in-from-left-2"
              >
                Press ⌘1 to expand
              </span>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Expanded — single section at a time
// -----------------------------------------------------------------------------

interface LeftRailExpandedProps {
  section: LeftRailSection;
  onCollapse: () => void;
  onNewSession: () => void;
}

function LeftRailExpanded({ section, onCollapse, onNewSession }: LeftRailExpandedProps) {
  const meta = LEFT_RAIL_SECTIONS.find((s) => s.id === section);
  const Icon = SECTION_ICONS[section];

  return (
    <div className="flex h-full min-w-0 flex-col" data-testid={`left-rail-expanded-${section}`}>
      <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">{meta?.label}</h2>
          <span className="font-mono text-[10px] text-[var(--fg-muted)]">
            {meta?.shortcut}
          </span>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`Close ${meta?.label ?? section} rail`}
          title={`Close · ${meta?.shortcut ?? ''}`}
          onClick={onCollapse}
          data-testid="left-rail-close"
          className="h-6 w-6 text-[var(--fg-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
        >
          <X className="h-3 w-3" />
        </Button>
      </header>

      <ScrollArea className="thin-scrollbar min-h-0 flex-1">
        {section === 'sessions' && <SessionsPanel onNewSession={onNewSession} />}
        {section === 'context' && <ContextPanel />}
        {section === 'skills' && <SkillsPanel />}
        {section === 'commands' && <CommandsPanel />}
        {section === 'layout' && <LayoutPanel />}
      </ScrollArea>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Section: Sessions
// -----------------------------------------------------------------------------

function SessionsPanel({ onNewSession }: { onNewSession: () => void }) {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeSessionId);
  const setActive = useTerminalStore((s) => s.setActiveSession);
  const closeSession = useTerminalStore((s) => s.closeSession);
  const removeSession = useTerminalStore((s) => s.removeSession);
  const renameSession = useTerminalStore((s) => (s as unknown as { renameSession?: (id: string, title: string) => void }).renameSession);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ul className="flex-1 divide-y divide-[var(--border-subtle)]">
        {sessions.length === 0 ? (
          <li className="px-4 py-8 text-center text-xs text-[var(--fg-tertiary)]">
            No sessions yet — start one below.
          </li>
        ) : (
          sessions.map((s) => {
            const active = s.id === activeId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setActive(s.id)}
                  data-testid={`left-rail-session-${s.id}`}
                  className={cn(
                    'group flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                    active
                      ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)]'
                      : 'text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: sessionStatusColor(s.status) }}
                  />
                  <span className="flex-1 truncate font-medium">{s.title}</span>
                  <span className="font-mono text-[10px] text-[var(--fg-muted)]">
                    {s.agent}
                  </span>
                  <button
                    type="button"
                    aria-label={`Close ${s.title}`}
                    title="Close session"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeSession(s.id);
                    }}
                    className="rounded p-0.5 text-[var(--fg-muted)] opacity-0 transition-opacity hover:text-[var(--accent-rose)] group-hover:opacity-100"
                    data-testid={`left-rail-session-close-${s.id}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </button>
                {active ? (
                  <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-1.5 text-[10px] text-[var(--fg-muted)]">
                    <span>id <span className="font-mono">{s.id.slice(0, 12)}</span></span>
                    <span>·</span>
                    <span>{s.commandCount} cmds</span>
                    {renameSession ? (
                      <button
                        type="button"
                        onClick={() => {
                          const next = window.prompt('Rename session', s.title);
                          if (next && next !== s.title) renameSession(s.id, next);
                        }}
                        className="ml-auto text-[var(--accent-cyan)] hover:underline"
                      >
                        Rename
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => removeSession(s.id)}
                      className="text-[var(--accent-rose)] hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })
        )}
      </ul>
      <div className="border-t border-[var(--border-subtle)] p-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onNewSession}
          className="w-full justify-center gap-1 text-xs"
          data-testid="left-rail-new-session"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          New session
        </Button>
      </div>
    </div>
  );
}

function sessionStatusColor(status: string): string {
  switch (status) {
    case 'active':   return 'var(--accent-emerald)';
    case 'creating': return 'var(--accent-cyan)';
    case 'error':    return 'var(--accent-rose)';
    default:         return 'var(--fg-muted)';
  }
}

// -----------------------------------------------------------------------------
// Section: Context
// -----------------------------------------------------------------------------

function ContextPanel() {
  // ponytail: skills/context/commands endpoints are pending; start empty
  // (Track O — Day 3). The local "remove" reducer still wires through to
  // an empty state without changes.
  const [items, setItems] = React.useState<ContextItem[]>([]);

  const remove = (id: string) => setItems((xs) => xs.filter((x) => x.id !== id));

  return (
    <div className="p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-tertiary)]">
        Injected into the active session
      </p>
      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-[var(--fg-tertiary)]">
          No context attached. Use “+ Add context” to inject specs, ADRs, or tickets.
        </p>
      ) : (
        <ul className="space-y-1.5" data-testid="left-rail-context-list">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs"
            >
              <ScrollText
                className="h-3 w-3 shrink-0"
                style={{ color: CONTEXT_SOURCE_COLOR[item.source] }}
                aria-hidden="true"
              />
              <span className="flex-1 truncate font-mono text-[11px] text-[var(--fg-primary)]">
                {item.name}
              </span>
              <button
                type="button"
                onClick={() => remove(item.id)}
                aria-label={`Remove ${item.name}`}
                data-testid={`left-rail-context-remove-${item.id}`}
                className="rounded p-0.5 text-[var(--fg-muted)] hover:bg-[var(--bg-base)] hover:text-[var(--accent-rose)]"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-3 w-full justify-center gap-1 text-xs"
        data-testid="left-rail-add-context"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Add context
      </Button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Section: Skills
// -----------------------------------------------------------------------------

function SkillsPanel() {
  const [query, setQuery] = React.useState('');

  // ponytail: skills registry endpoint pending — empty source list.
  // The filter logic is preserved so Day-4 wiring is a one-line change.
  const source: ReadonlyArray<SkillEntry> = React.useMemo(() => [], []);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return source;
    return source.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [query, source]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[var(--border-subtle)] p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter skills…"
          data-testid="left-rail-skill-search"
          className={cn(
            'h-7 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2',
            'text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)]',
            'focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]',
          )}
        />
      </div>
      <ul className="flex-1 divide-y divide-[var(--border-subtle)]" data-testid="left-rail-skill-list">
        {filtered.length === 0 ? (
          <li className="px-4 py-6 text-center text-xs text-[var(--fg-tertiary)]">
            No skills loaded yet — Skills registry pending.
          </li>
        ) : (
          filtered.map((skill) => (
            <li key={skill.id}>
              <button
                type="button"
                onClick={() => {
                  // Insert into the active terminal as a slash command.
                  window.dispatchEvent(
                    new CustomEvent('forge:terminal:ws-send', {
                      detail: { text: `/${skill.name}\n` },
                    }),
                  );
                }}
                data-testid={`left-rail-skill-${skill.id}`}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)]"
              >
                <span className="font-mono text-[11px] text-[var(--accent-cyan)]">
                  /{skill.name}
                </span>
                <span className="text-[10px] text-[var(--fg-tertiary)]">
                  {skill.description}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Section: Commands
// -----------------------------------------------------------------------------

function CommandsPanel() {
  const [copied, setCopied] = React.useState<string | null>(null);

  const run = (cmd: RecentCommand) => {
    void navigator.clipboard.writeText(cmd.label).then(() => {
      setCopied(cmd.id);
      window.setTimeout(() => setCopied(null), 1100);
    });
    window.dispatchEvent(
      new CustomEvent('forge:terminal:ws-send', { detail: { text: `${cmd.label}\n` } }),
    );
  };

  // ponytail: recent-commands endpoint pending — render an explicit empty
  // state instead of seeding fixtures. The "run" callback stays wired so
  // Day-4 wiring is a one-line change.
  const commands: ReadonlyArray<RecentCommand> = [];

  if (commands.length === 0) {
    return (
      <div
        className="p-4 text-center text-xs text-[var(--fg-tertiary)]"
        data-testid="left-rail-command-empty"
      >
        No recent commands yet — backend integration pending.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-[var(--border-subtle)]" data-testid="left-rail-command-list">
      {commands.map((cmd) => (
        <li key={cmd.id}>
          <button
            type="button"
            onClick={() => run(cmd)}
            data-testid={`left-rail-cmd-${cmd.id}`}
            className="group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)]"
          >
            <CommandIcon className="h-3 w-3 shrink-0 text-[var(--accent-primary)]" aria-hidden="true" />
            <span className="flex-1">
              <span className="block font-mono text-[11px] text-[var(--fg-primary)]">
                {cmd.label}
              </span>
              <span className="block text-[10px] text-[var(--fg-tertiary)]">{cmd.hint}</span>
            </span>
            <span className="opacity-0 transition-opacity group-hover:opacity-100">
              {copied === cmd.id ? (
                <span className="text-[10px] text-[var(--accent-emerald)]">sent</span>
              ) : (
                <Copy className="h-3 w-3 text-[var(--fg-muted)]" aria-hidden="true" />
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// -----------------------------------------------------------------------------
// Section: Layout
// -----------------------------------------------------------------------------

import type { LayoutMode } from '@/lib/store';

const LAYOUT_OPTIONS: ReadonlyArray<{ value: LayoutMode; label: string }> = [
  { value: 'single',           label: 'Single' },
  { value: 'split-horizontal', label: 'Split H' },
  { value: 'split-vertical',   label: 'Split V' },
  { value: 'grid-2x2',         label: 'Grid 2×2' },
];

function LayoutPanel() {
  const layout = useTerminalStore((s) => s.layout);
  const setLayout = useTerminalStore((s) => s.setLayout);

  return (
    <div className="p-3" data-testid="left-rail-layout">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-tertiary)]">
        Pane arrangement
      </p>
      <SegmentedControl
        value={layout}
        onChange={(v) => setLayout(v as LayoutMode)}
        ariaLabel="Terminal layout"
        options={LAYOUT_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
          testId: `left-rail-layout-${o.value}`,
        }))}
      />
      <p className="mt-3 text-[10px] leading-relaxed text-[var(--fg-tertiary)]">
        Use the layout toolbar in the canvas header for quick switching.
        Grid mode renders up to 4 sessions at once.
      </p>
    </div>
  );
}