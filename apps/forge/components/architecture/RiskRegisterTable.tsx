'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { RiskRegister, Risk } from '@/lib/architecture/data';

function scoreTone(score: number): string {
  if (score >= 16) {
    return 'border-rose-500/50 bg-rose-500/20 text-rose-200';
  }
  if (score >= 9) {
    return 'border-amber-500/50 bg-amber-500/20 text-amber-200';
  }
  return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
}

const STATUS_TONE: Record<Risk['status'], string> = {
  open: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
  mitigating: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  closed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
};

export interface RiskRegisterTableProps {
  register: RiskRegister;
  className?: string;
}

export function RiskRegisterTable({ register, className }: RiskRegisterTableProps) {
  return (
    <article
      data-testid="risk-register-table"
      data-register-id={register.id}
      className={cn('card flex flex-col gap-3', className)}
    >
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold leading-tight">
            {register.title}
          </h3>
          <p className="font-mono text-xs text-forge-300">
            Source: {register.source} · updated{' '}
            {new Date(register.updatedAt).toLocaleDateString()}
          </p>
        </div>
        <Badge variant="outline">{register.risks.length} risks</Badge>
      </header>
      <div className="overflow-hidden rounded-md border border-forge-700/40">
        <table className="w-full text-sm">
          <thead className="bg-forge-900/40 text-left text-xs uppercase tracking-wider text-forge-300">
            <tr>
              <th className="px-3 py-2">Risk</th>
              <th className="px-3 py-2">L</th>
              <th className="px-3 py-2">I</th>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {register.risks.map((r) => {
              const score = r.likelihood * r.impact;
              return (
                <tr
                  key={r.id}
                  data-testid="risk-row"
                  data-risk-id={r.id}
                  className="border-t border-forge-700/40 align-top"
                >
                  <td className="px-3 py-2">
                    <p className="font-medium">{r.title}</p>
                    <p className="text-xs text-forge-300">{r.mitigation}</p>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.likelihood}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.impact}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'inline-flex rounded-sm border px-1.5 py-0.5 font-mono text-xs font-semibold',
                        scoreTone(score),
                      )}
                      aria-label={`Risk score ${score}`}
                    >
                      {score}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.owner}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'inline-flex rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                        STATUS_TONE[r.status],
                      )}
                    >
                      {r.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export interface RiskRegisterListProps {
  registers: ReadonlyArray<RiskRegister>;
  selectedId?: string;
  onSelect?: (r: RiskRegister) => void;
}

export function RiskRegisterList({
  registers,
  selectedId,
  onSelect,
}: RiskRegisterListProps) {
  return (
    <ul
      role="list"
      className="flex flex-col gap-2"
      data-testid="risk-register-list"
    >
      {registers.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onSelect?.(r)}
            data-testid="risk-register-item"
            data-register-id={r.id}
            className={cn(
              'flex w-full items-center justify-between rounded-md border p-3 text-left text-sm transition-colors',
              selectedId === r.id
                ? 'border-forge-300 bg-forge-800/60'
                : 'border-forge-700/40 hover:border-forge-500',
            )}
          >
            <div className="flex flex-col">
              <span className="font-medium">{r.title}</span>
              <span className="font-mono text-[10px] text-forge-300">
                {r.source}
              </span>
            </div>
            <span className="font-mono text-xs">{r.risks.length} risks</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
