'use client';

/**
 * Terminal — Audit log sidecar.
 *
 * Sticky 320px column on desktop, collapses under the main panel on
 * narrower viewports. Each row shows:
 *   - timestamp (mono, --fg-tertiary)
 *   - command (mono)
 *   - exit-code badge (emerald for 0, rose for non-zero)
 *
 * Click a row to emit a synthetic `goto` event on the document so the
 * main terminal can scroll/highlight the matching output. The terminal
 * page subscribes to that event in `TerminalPanel`.
 *
 * Skill influence:
 *   - ux-guideline (loading indicators) — empty state uses the global
 *     empty pattern (icon + title + body), never a blank void.
 *   - ux-guideline (status indicator) — exit-code color is paired
 *     with the numeric value so it's not a color-only signal.
 */

import * as React from 'react';
import { format } from 'date-fns';
import { History, Terminal as TerminalIcon } from 'lucide-react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useTerminalStore } from '@/lib/store';

export interface AuditPanelHandle {
  /** Programmatic scroll-to-row helper used by tests. */
  scrollTo: (sessionId: string) => void;
}

export interface AuditPanelProps {
  onCommandClick?: (entry: { sessionId: string; command: string }) => void;
}

export const AuditPanel = React.forwardRef<AuditPanelHandle, AuditPanelProps>(
  function AuditPanel({ onCommandClick }, _ref) {
    const audit = useTerminalStore((s) => s.audit);

    return (
      <aside
        aria-label="Terminal audit log"
        data-testid="terminal-audit-panel audit-panel"
        className="flex h-full w-full min-w-0 flex-col border-l border-[var(--border-default)] bg-[var(--bg-surface)] md:w-[320px]"
      >
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--fg-primary)]">
              <History className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
              Audit log
            </h2>
            <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">
              Last {audit.length} command{audit.length === 1 ? '' : 's'} across all sessions.
            </p>
          </div>
        </header>

        <ScrollArea className="thin-scrollbar flex-1">
          {audit.length === 0 ? (
            <EmptyAudit />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {audit.map((entry) => (
                <AuditRow
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
      </aside>
    );
  },
);

function EmptyAudit() {
  return (
    <div
      data-testid="audit-empty"
      className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 px-6 py-10 text-center"
    >
      <TerminalIcon className="h-5 w-5 text-[var(--fg-muted)]" aria-hidden="true" />
      <p className="text-sm font-medium text-[var(--fg-primary)]">No commands yet</p>
      <p className="text-xs text-[var(--fg-tertiary)]">
        Run a command from the Command Center. Each invocation lands here with
        its timestamp and exit code.
      </p>
    </div>
  );
}

interface AuditRowProps {
  sessionId: string;
  command: string;
  timestamp: string;
  exitCode?: number;
  onClick: () => void;
}

function AuditRow({
  sessionId,
  command,
  timestamp,
  exitCode,
  onClick,
}: AuditRowProps) {
  const ok = exitCode === 0;
  const color = exitCode === undefined
    ? 'var(--fg-muted)'
    : ok
      ? 'var(--accent-emerald)'
      : 'var(--accent-rose)';

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        data-testid="audit-row"
        data-session-id={sessionId}
        className={cn(
          'group block w-full px-4 py-2 text-left transition-colors',
          'hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        )}
      >
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
          <span className="font-mono">
            {format(new Date(timestamp), 'HH:mm:ss')}
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono normal-case tracking-normal text-[var(--fg-tertiary)]">
              {sessionId.slice(0, 12)}
            </span>
            {exitCode !== undefined ? (
              <span
                className="inline-flex h-4 min-w-[24px] items-center justify-center rounded-sm px-1 font-mono text-[10px]"
                style={{
                  background: ok
                    ? 'rgba(16,185,129,0.12)'
                    : 'rgba(244,63,94,0.12)',
                  color,
                }}
                aria-label={`Exit code ${exitCode}`}
              >
                {exitCode}
              </span>
            ) : (
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: 'var(--fg-muted)' }}
                aria-hidden="true"
              />
            )}
          </div>
        </div>
        <code
          className={cn(
            'mt-1 block break-all rounded-sm px-1.5 py-0.5 font-mono text-xs',
            'bg-[var(--bg-inset)] text-[var(--fg-primary)]',
            'group-hover:bg-[rgba(99,102,241,0.10)] group-hover:text-[var(--fg-primary)]',
          )}
        >
          {command}
        </code>
      </button>
    </li>
  );
}
