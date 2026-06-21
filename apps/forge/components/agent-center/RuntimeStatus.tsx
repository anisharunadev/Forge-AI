'use client';

import * as React from 'react';
import { Server, Cpu, MemoryStick, Clock } from 'lucide-react';

import { cn } from '@/lib/utils';
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
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

export interface RuntimeStatusProps {
  runtimes: ReadonlyArray<Runtime>;
  agents: ReadonlyArray<Agent>;
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

export function RuntimeStatus({ runtimes, agents }: RuntimeStatusProps) {
  const agentById = React.useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );

  return (
    <ul
      role="list"
      aria-label="Active runtimes"
      data-testid="runtime-list"
      className="grid gap-3 md:grid-cols-2"
    >
      {runtimes.map((r) => {
        const agent = agentById.get(r.agentId);
        return (
          <li
            key={r.id}
            className="card space-y-3"
            data-testid="runtime-row"
            data-runtime-id={r.id}
            data-runtime-status={r.status}
          >
            <header className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-forge-700 bg-forge-800 text-forge-200">
                  <Server className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-base font-semibold leading-tight">
                    {agent?.name ?? r.agentId}
                  </h3>
                  <p className="font-mono text-xs text-forge-300">
                    {KIND_LABEL[r.kind]} · {r.region}
                  </p>
                </div>
              </div>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  STATUS_TONE[r.status],
                )}
                aria-label={`Status: ${r.status}`}
              >
                {r.status}
              </span>
            </header>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-forge-300">
                <Cpu className="h-3 w-3" aria-hidden="true" />
                CPU
              </div>
              <Bar value={r.cpuPercent} label="cpu" />
              <div className="flex items-center gap-2 pt-1 text-xs text-forge-300">
                <MemoryStick className="h-3 w-3" aria-hidden="true" />
                Memory
              </div>
              <Bar value={r.memPercent} label="mem" />
            </div>

            <footer className="flex items-center justify-between border-t border-forge-800 pt-2 text-[10px] text-forge-300">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden="true" />
                uptime {fmtUptime(r.uptimeSec)}
              </span>
              <span className="font-mono">{r.id}</span>
            </footer>
          </li>
        );
      })}
    </ul>
  );
}
