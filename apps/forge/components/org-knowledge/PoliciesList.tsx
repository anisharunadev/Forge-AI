'use client';

import * as React from 'react';
import { ShieldCheck, Pencil } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  POLICY_EFFECT_LABEL,
  type Policy,
} from '@/lib/org-knowledge/data';

const EFFECT_TONE: Record<Policy['effect'], string> = {
  allow: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  deny: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  'require-approval': 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  notify: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
};

export interface PoliciesListProps {
  policies: ReadonlyArray<Policy>;
  selectedId?: string;
  onSelect: (policy: Policy) => void;
}

export function PoliciesList({ policies, selectedId, onSelect }: PoliciesListProps) {
  return (
    <ul
      role="list"
      aria-label="Policies"
      data-testid="policies-list"
      className="space-y-2"
    >
      {policies.map((p) => {
        const active = p.id === selectedId;
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelect(p)}
              className={cn(
                'card flex w-full items-center justify-between gap-3 text-left transition-colors',
                active ? 'ring-1 ring-ring' : 'hover:bg-forge-800/60',
              )}
              data-testid={`policies-item-${p.id}`}
              data-selected={String(active)}
              data-enabled={String(p.enabled)}
            >
              <div className="flex items-start gap-2">
                <ShieldCheck
                  className="mt-0.5 h-4 w-4 text-forge-300"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-medium">{p.title}</p>
                  <p className="font-mono text-[10px] text-forge-300">
                    {p.scope}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    EFFECT_TONE[p.effect],
                  )}
                >
                  {POLICY_EFFECT_LABEL[p.effect]}
                </span>
                <Pencil
                  className="h-3 w-3 text-forge-300"
                  aria-hidden="true"
                />
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
