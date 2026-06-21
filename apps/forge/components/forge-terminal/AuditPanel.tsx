'use client';

import { format } from 'date-fns';

import { ScrollArea } from '@/components/ui/scroll-area';
import { useTerminalStore } from '@/lib/store';

export function AuditPanel() {
  const audit = useTerminalStore((s) => s.audit);

  return (
    <aside className="flex h-full w-72 flex-col border-l border-border bg-background">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Audit log</h2>
        <p className="text-xs text-muted-foreground">
          Last {audit.length} commands across all sessions.
        </p>
      </header>
      <ScrollArea className="flex-1">
        <ul className="divide-y divide-border">
          {audit.length === 0 ? (
            <li className="px-4 py-6 text-xs text-muted-foreground">
              No commands yet. Run a command from the Command Center.
            </li>
          ) : (
            audit.map((entry) => (
              <li key={entry.id} className="px-4 py-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{format(new Date(entry.timestamp), 'HH:mm:ss')}</span>
                  <span className="font-mono">{entry.sessionId.slice(0, 12)}</span>
                </div>
                <code className="mt-1 block break-all text-xs">
                  {entry.command}
                </code>
              </li>
            ))
          )}
        </ul>
      </ScrollArea>
    </aside>
  );
}
