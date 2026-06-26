'use client';

/**
 * Zone 5 — Notification popover (Step 26 polish — Fix 8).
 *
 * The bell in the greeting bar dispatches a `bell:open` window event;
 * `BellAnchorBridge` listens and flips `popoverOpen`. The Popover is
 * mounted alongside the trigger so Radix can manage focus + dismiss
 * cleanly.
 *
 * Skill influence:
 *   - `style` (Real-Time Monitoring) — critical alerts get a rose left
 *     border + "Action required" badge.
 *   - `ux` (Hover vs Tap) — click opens the popover (mobile-safe).
 *   - `ux` (Reduced Motion) — the popover animates via Tailwind's
 *     data-[state] tokens which already gate on reduced-motion.
 */

import * as React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AlertTriangle, CheckCircle2, Info, ChevronRight } from 'lucide-react';
import Link from 'next/link';

import type { AlertItem, AlertSeverity } from './types';

export function NotificationCenter({
  alerts,
  unreadIds,
  onMarkAll,
  onMarkRead,
  children,
  open,
}: {
  alerts: ReadonlyArray<AlertItem>;
  unreadIds: ReadonlySet<string>;
  onMarkAll: () => void;
  onMarkRead: (id: string) => void;
  children: React.ReactNode;
  open?: boolean;
}) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isControlled = typeof open === 'boolean';
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = isControlled ? () => undefined : setInternalOpen;

  // Filter pills state lives inside the popover.
  const [filter, setFilter] = React.useState<'All' | 'Unread' | 'Critical'>('All');

  React.useEffect(() => {
    if (!isControlled) return;
    if (open) setInternalOpen(true);
    else setInternalOpen(false);
  }, [open, isControlled]);

  const visible = React.useMemo(() => {
    return alerts
      .filter((a) => {
        if (filter === 'Critical') return a.severity === 'critical';
        if (filter === 'Unread') return unreadIds.has(a.id);
        return true;
      })
      .slice(0, 5);
  }, [alerts, filter, unreadIds]);

  return (
    <Popover open={isOpen} onOpenChange={(o) => setOpen(o)}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[380px] border-[var(--border-default)] bg-[var(--bg-elevated)] p-0 shadow-[var(--shadow-lg)]"
        data-testid="notification-popover"
      >
        <header className="flex flex-col gap-2 border-b border-[var(--border-subtle)] p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">Notifications</h3>
            <button
              type="button"
              onClick={onMarkAll}
              className="text-[11px] text-[var(--fg-tertiary)] hover:text-[var(--accent-primary)]"
              data-testid="notification-mark-all"
            >
              Mark all read
            </button>
          </div>
          <div className="flex items-center gap-1" role="tablist" aria-label="Filter notifications">
            {(['All', 'Unread', 'Critical'] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={[
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  filter === f
                    ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                    : 'text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)]',
                ].join(' ')}
                data-testid={`notification-filter-${f}`}
              >
                {f}
              </button>
            ))}
          </div>
        </header>
        <ul className="thin-scrollbar max-h-[420px] overflow-y-auto">
          {visible.length === 0 ? (
            <li className="p-6 text-center text-[11px] text-[var(--fg-tertiary)]">No alerts match this filter.</li>
          ) : (
            visible.map((a) => {
              const tone = alertTone(a.severity);
              const Icon = a.icon === 'triangle' ? AlertTriangle : a.icon === 'check' ? CheckCircle2 : Info;
              const isUnread = unreadIds.has(a.id);
              return (
                <li
                  key={a.id}
                  className={[
                    'group flex items-start gap-2 border-b border-[var(--border-subtle)] p-3 last:border-b-0 hover:bg-[rgba(255,255,255,0.04)]',
                    a.severity === 'critical' ? 'border-l-2 border-l-[var(--accent-rose)]' : '',
                  ].join(' ')}
                  data-testid={`notif-row-${a.id}`}
                >
                  <span className={['mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded', tone.bg, tone.fg].join(' ')} aria-hidden="true">
                    <Icon className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {isUnread ? (
                        <span
                          aria-hidden="true"
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-emerald)]"
                          data-testid="notif-unread-dot"
                        />
                      ) : null}
                      <p className="truncate text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">{a.title}</p>
                      {a.severity === 'critical' ? (
                        <span className="rounded bg-[var(--accent-rose)]/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--accent-rose)]">
                          Action required
                        </span>
                      ) : null}
                    </div>
                    <p className="line-clamp-1 text-[11px] text-[var(--fg-tertiary)]">{a.body}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-[var(--fg-muted)]">{a.timestamp}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {isUnread ? (
                      <button
                        type="button"
                        onClick={() => onMarkRead(a.id)}
                        className="text-[10px] text-[var(--accent-primary)] hover:underline"
                      >
                        Mark read
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label="View alert"
                      className="text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
                    >
                      <ChevronRight className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })
          )}
        </ul>
        <footer className="border-t border-[var(--border-subtle)] p-2">
          <Link
            href="/audit"
            className="block rounded px-2 py-1 text-center text-[11px] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--accent-primary)]"
            data-testid="notification-view-all"
          >
            View all notifications →
          </Link>
        </footer>
      </PopoverContent>
    </Popover>
  );
}

function alertTone(s: AlertSeverity): { fg: string; bg: string } {
  switch (s) {
    case 'critical':
      return { fg: 'text-[var(--accent-rose)]', bg: 'bg-[var(--accent-rose)]/15' };
    case 'warning':
      return { fg: 'text-[var(--accent-amber)]', bg: 'bg-[var(--accent-amber)]/15' };
    case 'success':
      return { fg: 'text-[var(--accent-emerald)]', bg: 'bg-[var(--accent-emerald)]/15' };
    case 'info':
      return { fg: 'text-[var(--accent-cyan)]', bg: 'bg-[var(--accent-cyan)]/15' };
  }
}