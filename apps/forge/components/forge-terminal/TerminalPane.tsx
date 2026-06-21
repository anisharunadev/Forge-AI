'use client';

import { useTerminal } from '@/hooks/use-terminal';
import { cn } from '@/lib/utils';

export interface TerminalPaneProps {
  sessionId: string;
  agent: string;
  workspace: string;
  wsPath?: string;
  className?: string;
}

/**
 * xterm.js wrapper. Mounts a terminal into a ref'd div and (optionally)
 * attaches a WebSocket. Per session, one TerminalPane = one xterm instance.
 */
export function TerminalPane({
  sessionId,
  agent,
  workspace,
  wsPath,
  className,
}: TerminalPaneProps) {
  const { containerRef } = useTerminal({
    wsPath,
    welcome: `Session ${sessionId} — agent: ${agent} — workspace: ${workspace}`,
  });

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-md border bg-[#0b0f1a]',
        className,
      )}
      data-session-id={sessionId}
    >
      <div className="flex items-center justify-between border-b border-border/40 bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
        <span className="font-mono">{sessionId}</span>
        <span>
          {agent} · {workspace}
        </span>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 p-2" />
    </div>
  );
}
