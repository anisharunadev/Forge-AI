'use client';

/**
 * Runtime status (step-54 — Phase 2).
 *
 * Renders the list of runtime handles with a "Stop" button for
 * running handles. Stop calls `POST /runtimes/{id}/stop` which
 * transitions the runtime to STOPPED state.
 *
 * Skill rules adopted:
 *   - **Confirmation before destructive action** — stop is
 *     reversible in some sense (start a new runtime), but we still
 *     confirm to avoid accidental clicks.
 *   - **Toast feedback** — every stop action surfaces a toast.
 */

import * as React from 'react';
import { Server, Cpu, MemoryStick, Clock, Plus, Square } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AddRuntimeDialog } from '@/components/agent-center/AddRuntimeDialog';
import { EmptyState } from '@/src/components/empty-state';
import { useToast } from '@/hooks/use-toast';
import { useStopRuntime } from '@/lib/query/hooks';
import type { Agent, Runtime } from '@/lib/agent-center/data';

const STATUS_TONE: Record<Runtime['status'], string> = {
  active: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  idle: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
  degraded: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  offline: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

const KIND_LABEL: Record<Runtime['kind'], string> = {
  sandbox: 'Sandbox',
  container: 'Container',
  vm: 'VM',
  lambda: 'Lambda',
};

function fmtUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return `${Math.floor(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export interface RuntimeStatusProps {
  runtimes: ReadonlyArray<Runtime>;
  agents: ReadonlyArray<Agent>;
  onRegisterRuntime?: () => void;
}

function Bar({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  const tone =
    clamped >= 85
      ? 'bg-rose-500'
      : clamped >= 65
        ? 'bg-amber-500'
        : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 text-[10px] uppercase tracking-wider text-forge-300">
        {label}
      </span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-forge-800">
        <div
          className={cn('h-full', tone)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="w-10 text-right font-mono text-[10px] text-forge-200">
        {clamped}%
      </span>
    </div>
  );
}

function RuntimeRow({
  runtime,
  agentName,
  onStop,
  stopping,
}: {
  runtime: Runtime;
  agentName: string;
  onStop: () => void;
  stopping: boolean;
}) {
  return (
    <li
      key={runtime.id}
      className="card space-y-3"
      data-testid="runtime-row"
      data-runtime-id={runtime.id}
      data-runtime-status={runtime.status}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-forge-700 bg-forge-800 text-forge-200">
            <Server className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-semibold leading-tight">
              {agentName}
            </h3>
            <p className="font-mono text-xs text-forge-300">
              {KIND_LABEL[runtime.kind]} · {runtime.region}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            STATUS_TONE[runtime.status],
          )}
          aria-label={`Status: ${runtime.status}`}
        >
          {runtime.status}
        </span>
      </header>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-forge-300">
          <Cpu className="h-3 w-3" aria-hidden="true" />
          CPU
        </div>
        <Bar value={runtime.cpuPercent} label="cpu" />
        <div className="flex items-center gap-2 pt-1 text-xs text-forge-300">
          <MemoryStick className="h-3 w-3" aria-hidden="true" />
          Memory
        </div>
        <Bar value={runtime.memPercent} label="mem" />
      </div>

      <footer className="flex items-center justify-between border-t border-forge-800 pt-2 text-[10px] text-forge-300">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden="true" />
          uptime {fmtUptime(runtime.uptimeSec)}
        </span>
        <div className="flex items-center gap-2">
          <span className="font-mono">{runtime.id.slice(0, 8)}</span>
          {runtime.status === 'active' || runtime.status === 'degraded' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onStop}
              disabled={stopping}
              data-testid="runtime-stop"
              className="text-[var(--fg-secondary)] hover:bg-rose-500/10 hover:text-rose-300"
            >
              <Square className="h-3 w-3" aria-hidden="true" />
              {stopping ? 'Stopping…' : 'Stop'}
            </Button>
          ) : null}
        </div>
      </footer>
    </li>
  );
}

export function RuntimeStatus({ runtimes, agents, onRegisterRuntime }: RuntimeStatusProps) {
  const agentById = React.useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );
  const stopRuntime = useStopRuntime();
  const { toast } = useToast();

  const handleStop = async (id: string) => {
    if (typeof window !== 'undefined' && !window.confirm('Stop this runtime?')) {
      return;
    }
    try {
      await stopRuntime.mutateAsync(id);
      toast({ title: 'Runtime stopped' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: 'Could not stop runtime',
        description: message,
        variant: 'destructive',
      });
    }
  };

  if (runtimes.length === 0) {
    return (
      <div className="space-y-3" data-testid="runtime-list-empty">
        <div className="flex items-center justify-end">
          <AddRuntimeDialog />
        </div>
        <EmptyState
          illustration={<Server size={40} strokeWidth={1.5} />}
          title="No runtimes registered"
          description="Runtimes are sandboxes where agents execute."
          primaryAction={
            onRegisterRuntime
              ? { label: 'Register Runtime', onClick: onRegisterRuntime, icon: <Plus size={14} /> }
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <AddRuntimeDialog />
      </div>
      <ul
        role="list"
        aria-label="Active runtimes"
        data-testid="runtime-list"
        className="grid gap-3 md:grid-cols-2"
      >
        {runtimes.map((r) => (
          <RuntimeRow
            key={r.id}
            runtime={r}
            agentName={agentById.get(r.agentId)?.name ?? r.agentId.slice(0, 8)}
            onStop={() => handleStop(r.id)}
            stopping={stopRuntime.isPending}
          />
        ))}
      </ul>
    </div>
  );
}