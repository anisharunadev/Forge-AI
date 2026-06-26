'use client';

import * as React from 'react';
import { LayoutGrid, Maximize2, Columns, Rows } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useTerminalStore, type LayoutMode, type SessionStatus } from '@/lib/store';
import { TerminalPane } from '@/components/forge-terminal/TerminalPane';

const LAYOUTS: { id: LayoutMode; label: string; icon: React.ComponentType<{ className?: string }> }[] =
  [
    { id: 'single', label: 'Single', icon: Maximize2 },
    { id: 'split-horizontal', label: 'Split horizontal', icon: Rows },
    { id: 'split-vertical', label: 'Split vertical', icon: Columns },
    { id: 'grid-2x2', label: 'Grid 2×2', icon: LayoutGrid },
  ];

function PaneSlot({ sessionId, agent, workspace, status }: {
  sessionId: string;
  agent: string;
  workspace: string;
  status: SessionStatus;
}) {
  return (
    <TerminalPane
      sessionId={sessionId}
      agent={agent}
      workspace={workspace}
      status={status}
      wsPath={`/ws/terminal/${sessionId}`}
    />
  );
}

export function TerminalLayout() {
  const sessions = useTerminalStore((s) => s.sessions);
  const layout = useTerminalStore((s) => s.layout);
  const setLayout = useTerminalStore((s) => s.setLayout);
  const activeId = useTerminalStore((s) => s.activeSessionId);
  const agent = useTerminalStore((s) => s.agent);
  const workspace = useTerminalStore((s) => s.workspace);

  if (sessions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No active session. Use the <span className="mx-1 font-mono">+</span> above to
        create one.
      </div>
    );
  }

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0]!;
  const extras = sessions.filter((s) => s.id !== active.id).slice(0, 3);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-1 px-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Layout
        </span>
        <Separator orientation="vertical" className="mx-2 h-4" />
        {LAYOUTS.map((l) => {
          const Icon = l.icon;
          return (
            <Button
              key={l.id}
              type="button"
              variant={layout === l.id ? 'default' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              onClick={() => setLayout(l.id)}
              aria-label={l.label}
              title={l.label}
            >
              <Icon className="h-4 w-4" />
            </Button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1">
        {layout === 'single' && (
          <PaneSlot
            sessionId={active.id}
            agent={active.agent}
            workspace={active.workspace}
            status={active.status}
          />
        )}

        {layout === 'split-horizontal' && (
          <div className="flex h-full flex-col gap-2">
            <div className="min-h-0 flex-1">
              <PaneSlot
                sessionId={active.id}
                agent={active.agent}
                workspace={active.workspace}
                status={active.status}
              />
            </div>
            {extras[0] ? (
              <div className="min-h-0 flex-1">
                <PaneSlot
                  sessionId={extras[0].id}
                  agent={extras[0].agent}
                  workspace={extras[0].workspace}
                status={extras[0].status}
                />
              </div>
            ) : null}
          </div>
        )}

        {layout === 'split-vertical' && (
          <div className="flex h-full gap-2">
            <div className="min-w-0 flex-1">
              <PaneSlot
                sessionId={active.id}
                agent={active.agent}
                workspace={active.workspace}
                status={active.status}
              />
            </div>
            {extras[0] ? (
              <div className="min-w-0 flex-1">
                <PaneSlot
                  sessionId={extras[0].id}
                  agent={extras[0].agent}
                  workspace={extras[0].workspace}
                status={extras[0].status}
                />
              </div>
            ) : null}
          </div>
        )}

        {layout === 'grid-2x2' && (
          <div
            className={cn(
              'grid h-full grid-cols-2 grid-rows-2 gap-2',
            )}
          >
            <PaneSlot
              sessionId={active.id}
              agent={active.agent}
              workspace={active.workspace}
              status={active.status}
            />
            {extras[0] ? (
              <PaneSlot
                sessionId={extras[0].id}
                agent={extras[0].agent}
                workspace={extras[0].workspace}
                status={extras[0].status}
              />
            ) : null}
            {extras[1] ? (
              <PaneSlot
                sessionId={extras[1].id}
                agent={extras[1].agent}
                workspace={extras[1].workspace}
                status={extras[1].status}
              />
            ) : null}
            {extras[2] ? (
              <PaneSlot
                sessionId={extras[2].id}
                agent={extras[2].agent}
                workspace={extras[2].workspace}
                status={extras[2].status}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
