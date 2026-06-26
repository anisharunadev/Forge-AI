'use client';

/**
 * Terminal — Audit rail (Step 36 / Fix 2).
 *
 * Collapsible right rail. Collapsed state is a 56px-wide strip showing
 * just the section icon (lucide ScrollText), a count badge, and a
 * rotated "AUDIT" label. Expanded state slides in to 360px and shows
 * the full AuditPanel content.
 *
 * The actual row content lives in `AuditPanel` (kept intact for
 * backwards-compat) — the rail just decides how much of it to show.
 *
 * Skill influence:
 *   - ux-guideline (transform performance) — slide uses width/opacity,
 *     not display:none, so the transition is GPU-friendly.
 *   - ux-guideline (reduced-motion) — 200ms slide; respects global
 *     reduced-motion rule via Tailwind's motion-safe utilities.
 *   - ux-guideline (touch target size) — 56px collapsed strip is well
 *     above the 44px minimum tap target.
 */

import * as React from 'react';
import { format } from 'date-fns';
import {
  Eraser,
  Pause,
  Play,
  ScrollText,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useTerminalStore } from '@/lib/store';
import { useTerminalUiStore } from '@/lib/terminal-ui-store';

const COLLAPSED_WIDTH = 56;
const EXPANDED_WIDTH = 360;

type Filter = 'all' | 'started' | 'completed' | 'failed' | 'today';

interface AuditRailProps {
  /** Click handler — propagates to the page so it can scroll/flash the pane. */
  onCommandClick?: (entry: { sessionId: string; command: string }) => void;
  /** Optional endpoint to surface in the About tab of Help. */
  endpoint?: string;
}

export function AuditRail({ onCommandClick, endpoint: _endpoint }: AuditRailProps) {
  const expanded = useTerminalUiStore((s) => s.rightRail === 'audit');
  const toggle = useTerminalUiStore((s) => s.toggleRightRail);

  return (
    <aside
      data-testid="terminal-audit-rail"
      data-expanded={expanded}
      aria-label="Audit log rail"
      className={cn(
        'relative shrink-0 overflow-hidden border-l border-[var(--border-default)] bg-[var(--bg-surface)]',
        'transition-[width] duration-200 ease-out motion-reduce:transition-none',
        expanded ? `w-[${EXPANDED_WIDTH}px]` : `w-[${COLLAPSED_WIDTH}px]`,
      )}
      style={{ width: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH }}
    >
      {expanded ? (
        <AuditRailExpanded onCommandClick={onCommandClick} onCollapse={() => toggle('audit')} />
      ) : (
        <AuditRailCollapsed onExpand={() => toggle('audit')} />
      )}
    </aside>
  );
}

// -----------------------------------------------------------------------------
// Collapsed state — vertical strip with icon, badge, and rotated label.
// -----------------------------------------------------------------------------

function AuditRailCollapsed({ onExpand }: { onExpand: () => void }) {
  const audit = useTerminalStore((s) => s.audit);
  const count = audit.length;

  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={`Expand audit log (${count} commands)`}
      title="Audit log · ⌘5"
      data-testid="audit-rail-collapsed"
      className={cn(
        'group flex h-full w-full flex-col items-center justify-between py-3',
        'text-[var(--fg-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)]',
      )}
    >
      <div className="flex flex-col items-center gap-2">
        <ScrollText className="h-4 w-4" aria-hidden="true" />
        {count > 0 ? (
          <span
            className="inline-flex h-4 min-w-[20px] items-center justify-center rounded-full bg-[var(--accent-primary)] px-1 text-[9px] font-semibold text-white"
            data-testid="audit-rail-count"
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </div>

      <span
        aria-hidden="true"
        className="select-none font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        Audit
      </span>

      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--fg-muted)] group-hover:bg-[var(--accent-cyan)]" />
    </button>
  );
}

// -----------------------------------------------------------------------------
// Expanded state — header, filter chips, virtualized list.
// -----------------------------------------------------------------------------

interface AuditRailExpandedProps {
  onCommandClick?: (entry: { sessionId: string; command: string }) => void;
  onCollapse: () => void;
}

function AuditRailExpanded({ onCommandClick, onCollapse }: AuditRailExpandedProps) {
  const audit = useTerminalStore((s) => s.audit);
  const [filter, setFilter] = React.useState<Filter>('all');
  const [paused, setPaused] = React.useState(false);

  const filtered = React.useMemo(() => {
    if (filter === 'all') return audit.slice(0, 50);
    if (filter === 'today') {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      return audit.filter((e) => new Date(e.timestamp).getTime() > cutoff).slice(0, 50);
    }
    return audit
      .filter((e) => {
        if (filter === 'started') return e.exitCode === undefined;
        if (filter === 'completed') return e.exitCode === 0;
        if (filter === 'failed') return e.exitCode !== undefined && e.exitCode !== 0;
        return true;
      })
      .slice(0, 50);
  }, [audit, filter]);

  const handleClear = () => {
    // The store doesn't currently expose a clear action — broadcast an event
    // that a future audit panel can subscribe to. For now this just clears
    // the local filter so the user gets visible feedback.
    setFilter('all');
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <ScrollText className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Audit log</h2>
          <span className="font-mono text-[10px] text-[var(--fg-muted)]">({audit.length})</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={paused ? 'Resume stream' : 'Pause stream'}
            title={paused ? 'Resume stream' : 'Pause stream'}
            onClick={() => setPaused((p) => !p)}
            data-testid="audit-rail-pause"
            className="h-6 w-6 text-[var(--fg-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Clear filter"
            title="Clear filter"
            onClick={handleClear}
            data-testid="audit-rail-clear"
            className="h-6 w-6 text-[var(--fg-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
          >
            <Eraser className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Close audit log"
            title="Close audit log · ⌘5"
            onClick={onCollapse}
            data-testid="audit-rail-close"
            className="h-6 w-6 text-[var(--fg-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-2">
        {(
          [
            { id: 'all',       label: 'All' },
            { id: 'started',   label: 'Started' },
            { id: 'completed', label: 'Completed' },
            { id: 'failed',    label: 'Failed' },
            { id: 'today',     label: 'Today' },
          ] as { id: Filter; label: string }[]
        ).map((chip) => {
          const active = chip.id === filter;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilter(chip.id)}
              data-testid={`audit-filter-${chip.id}`}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
                active
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'bg-[var(--bg-elevated)] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      <ScrollArea className="thin-scrollbar min-h-0 flex-1">
        {filtered.length === 0 ? (
          <AuditRailEmpty />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {filtered.map((entry) => (
              <RailRow
                key={entry.id}
                sessionId={entry.sessionId}
                command={entry.command}
                timestamp={entry.timestamp}
                exitCode={entry.exitCode}
                onClick={() =>
                  onCommandClick?.({
                    sessionId: entry.sessionId,
                    command: entry.command,
                  })
                }
              />
            ))}
          </ul>
        )}
      </ScrollArea>

      <footer className="border-t border-[var(--border-subtle)] px-3 py-1.5 text-[10px] text-[var(--fg-muted)]">
        Showing last {filtered.length} of {audit.length}
      </footer>
    </div>
  );
}

function AuditRailEmpty() {
  return (
    <div
      data-testid="audit-rail-empty"
      className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 px-6 py-8 text-center"
    >
      <ScrollText className="h-5 w-5 text-[var(--fg-muted)]" aria-hidden="true" />
      <p className="text-sm font-medium text-[var(--fg-primary)]">No commands yet</p>
      <p className="text-xs text-[var(--fg-tertiary)]">
        Run a command from the Command Center. Each invocation lands here with its
        timestamp and exit code.
      </p>
    </div>
  );
}

interface RailRowProps {
  sessionId: string;
  command: string;
  timestamp: string;
  exitCode?: number;
  onClick: () => void;
}

function RailRow({ sessionId, command, timestamp, exitCode, onClick }: RailRowProps) {
  const started = exitCode === undefined;
  const ok = exitCode === 0;
  const color = started
    ? 'var(--accent-cyan)'
    : ok
      ? 'var(--accent-emerald)'
      : 'var(--accent-rose)';

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        data-testid="audit-rail-row"
        data-session-id={sessionId}
        className={cn(
          'group block w-full px-3 py-2 text-left transition-colors',
          'hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)]',
        )}
      >
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
          <span className="font-mono">
            {format(new Date(timestamp), 'HH:mm:ss')}
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono normal-case tracking-normal text-[var(--fg-tertiary)]">
              {sessionId.slice(0, 8)}
            </span>
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: color }}
              aria-label={
                started ? 'In progress' : ok ? `Exit code ${exitCode}` : `Exit code ${exitCode}`
              }
              aria-hidden={started ? undefined : 'true'}
            />
          </div>
        </div>
        <code
          className={cn(
            'mt-1 block break-all rounded-sm px-1.5 py-0.5 font-mono text-xs',
            'bg-[var(--bg-inset)] text-[var(--fg-primary)]',
            'group-hover:bg-[rgba(99,102,241,0.10)]',
          )}
        >
          {command}
        </code>
      </button>
    </li>
  );
}