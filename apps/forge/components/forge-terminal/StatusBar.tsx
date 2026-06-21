'use client';

import { CircleDot } from 'lucide-react';

import { useTerminalStore } from '@/lib/store';
import { cn } from '@/lib/utils';

export function StatusBar() {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeSessionId);
  const agent = useTerminalStore((s) => s.agent);
  const layout = useTerminalStore((s) => s.layout);
  const active = sessions.find((s) => s.id === activeId);

  return (
    <footer
      role="status"
      aria-live="polite"
      className="flex items-center justify-between border-t border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5">
          <CircleDot
            className={cn(
              'h-3 w-3',
              active ? 'text-emerald-500' : 'text-muted-foreground',
            )}
            aria-hidden="true"
          />
          {active ? 'Connected (mock)' : 'No session'}
        </span>
        <span>Layout: {layout}</span>
      </div>
      <div className="flex items-center gap-3">
        <span>Agent: {agent}</span>
        <span className="font-mono">{active?.id ?? '—'}</span>
        <span>Commands: {active?.commandCount ?? 0}</span>
      </div>
    </footer>
  );
}
