'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import type { RefactorRisk, RefactorPhase } from '@/lib/api';

const SEVERITY_TONE: Record<RefactorRisk['severity'], string> = {
  low: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  high: 'border-orange-500/40 bg-orange-500/10 text-orange-300',
  critical: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

export interface RiskRegisterProps {
  risks: ReadonlyArray<RefactorRisk>;
  phases: ReadonlyArray<RefactorPhase>;
  className?: string;
}

/**
 * Risk register table linked to phases. Each risk row exposes the
 * severity badge, the owning phase (looked up by id), and the
 * mitigation summary. Empty registers render an honest "No risks"
 * row so the operator can confirm nothing was surfaced.
 */
export function RiskRegister({ risks, phases, className }: RiskRegisterProps) {
  const phaseById = React.useMemo(() => {
    const m = new Map<string, RefactorPhase>();
    for (const p of phases) m.set(p.id, p);
    return m;
  }, [phases]);

  return (
    <section
      aria-labelledby="risk-register-h"
      className={cn('card flex flex-col gap-3', className)}
      data-testid="risk-register"
      data-risk-count={risks.length}
    >
      <header className="flex items-center justify-between">
        <div>
          <h3 id="risk-register-h" className="text-base font-semibold leading-tight">
            Risk register
          </h3>
          <p className="text-xs text-forge-300">
            {risks.length} risk{risks.length === 1 ? '' : 's'} linked to phases.
          </p>
        </div>
      </header>

      {risks.length === 0 ? (
        <p className="text-sm text-forge-300" data-testid="risk-register-empty">
          No risks surfaced for this plan.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-forge-700/40">
          <table className="w-full text-sm">
            <thead className="bg-forge-900/40 text-left text-xs uppercase tracking-wider text-forge-300">
              <tr>
                <th className="px-3 py-2">Risk</th>
                <th className="px-3 py-2">Phase</th>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Owner</th>
              </tr>
            </thead>
            <tbody>
              {risks.map((r) => {
                const phase = phaseById.get(r.phaseId);
                return (
                  <tr
                    key={r.id}
                    data-testid="risk-register-row"
                    data-risk-id={r.id}
                    data-phase-id={r.phaseId}
                    className="border-t border-forge-700/40 align-top"
                  >
                    <td className="px-3 py-2">
                      <p className="font-medium">{r.title}</p>
                      <p className="text-xs text-forge-300">{r.mitigation}</p>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {phase ? `Phase ${phase.index} · ${phase.title}` : r.phaseId}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'inline-flex rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                          SEVERITY_TONE[r.severity],
                        )}
                        aria-label={`Severity ${r.severity}`}
                      >
                        {r.severity}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">{r.owner}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}