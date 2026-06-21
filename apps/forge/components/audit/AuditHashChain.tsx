'use client';

import * as React from 'react';
import { Link2, ShieldCheck } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { AuditRecord } from '@/lib/audit/data';

export interface AuditHashChainProps {
  records: ReadonlyArray<AuditRecord>;
}

export function AuditHashChain({ records }: AuditHashChainProps) {
  // Show the 8 most recent records as a chain visualization.
  const recent = records.slice(0, 8);

  if (recent.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Hash chain"
      data-testid="audit-hash-chain"
      className="card flex flex-col gap-3"
    >
      <header className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          Tamper-evident hash chain
        </h3>
        <span className="font-mono text-[10px] text-forge-300">
          head {recent[0]?.hash.slice(0, 12)}…
        </span>
      </header>
      <ol className="flex flex-wrap items-center gap-2">
        {recent.map((r, idx) => (
          <li
            key={r.id}
            className={cn(
              'flex items-center gap-2 rounded-md border border-forge-700/40 bg-forge-900/40 px-2 py-1',
            )}
            data-testid="hash-chain-item"
            data-record-id={r.id}
          >
            <span className="font-mono text-[10px] text-forge-400">
              #{records.length - idx}
            </span>
            <span className="font-mono text-[11px] font-semibold text-forge-100">
              {r.hash.slice(0, 8)}…
            </span>
            {idx < recent.length - 1 ? (
              <Link2 className="h-3 w-3 text-forge-400" aria-hidden="true" />
            ) : null}
          </li>
        ))}
      </ol>
      <p className="text-xs text-forge-300">
        Each record carries the SHA-256 of the previous record. Any tampering
        invalidates every subsequent hash.
      </p>
    </section>
  );
}
