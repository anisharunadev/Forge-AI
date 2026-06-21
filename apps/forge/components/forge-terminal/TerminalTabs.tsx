'use client';

import * as React from 'react';
import { Plus, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useTerminalStore } from '@/lib/store';

export function TerminalTabs() {
  const sessions = useTerminalStore((s) => s.sessions);
  const active = useTerminalStore((s) => s.activeSessionId);
  const setActive = useTerminalStore((s) => s.setActiveSession);
  const closeSession = useTerminalStore((s) => s.closeSession);
  const createSession = useTerminalStore((s) => s.createSession);

  return (
    <div
      role="tablist"
      aria-label="Terminal sessions"
      className="flex items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-2 py-1"
    >
      {sessions.map((s) => (
        <button
          key={s.id}
          role="tab"
          aria-selected={active === s.id}
          type="button"
          onClick={() => setActive(s.id)}
          className={cn(
            'group inline-flex items-center gap-2 rounded-md px-3 py-1 text-xs',
            active === s.id
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-background/60',
          )}
        >
          <span className="font-mono">{s.title}</span>
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              closeSession(s.id);
            }}
            className="rounded p-0.5 opacity-0 hover:bg-destructive/10 group-hover:opacity-100"
            aria-label={`Close ${s.title}`}
          >
            <X className="h-3 w-3" />
          </span>
        </button>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => createSession()}
        aria-label="New session"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}
