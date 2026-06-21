'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { TerminalSquare } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { AgentSelector } from '@/components/forge-terminal/AgentSelector';
import { AuditPanel } from '@/components/forge-terminal/AuditPanel';
import { StatusBar } from '@/components/forge-terminal/StatusBar';
import { TerminalTabs } from '@/components/forge-terminal/TerminalTabs';
import { WorkspaceSelector } from '@/components/forge-terminal/WorkspaceSelector';
import { BackendBanner } from '@/components/BackendBanner';
import { useTerminalStore } from '@/lib/store';

const TerminalLayout = dynamic(
  () =>
    import('@/components/forge-terminal/TerminalLayout').then(
      (m) => m.TerminalLayout,
    ),
  { ssr: false },
);

export default function ForgeTerminalPage() {
  // Auto-create a starter session so the layout renders something useful.
  const sessionsCount = useTerminalStore((s) => s.sessions.length);
  const createSession = useTerminalStore((s) => s.createSession);

  React.useEffect(() => {
    if (sessionsCount === 0) createSession({ title: 'Session 1' });
  }, [sessionsCount, createSession]);

  return (
    <AdminShell>
      <div className="flex h-[calc(100vh-6rem)] flex-col gap-3">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Forge Terminal Center
          </p>
          <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <TerminalSquare className="h-5 w-5" aria-hidden="true" />
              Live terminal sessions
            </h1>
            <div className="flex items-center gap-2">
              <WorkspaceSelector />
              <AgentSelector />
            </div>
          </div>
        </header>

        {/* Phase A.3: visible banner so users see exactly why no I/O. */}
        <BackendBanner kind="terminal" />

        <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex min-w-0 flex-1 flex-col">
            <TerminalTabs />
            <div className="min-h-0 flex-1 p-3">
              <TerminalLayout />
            </div>
            <StatusBar />
          </div>
          <AuditPanel />
        </div>
      </div>
    </AdminShell>
  );
}
