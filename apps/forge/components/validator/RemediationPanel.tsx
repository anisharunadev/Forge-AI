/**
 * RemediationPanel — suggested fixes per finding.
 *
 * Renders one collapsible block per finding. Each block surfaces:
 *   - severity badge + rule id
 *   - finding title + message
 *   - suggested fix (when present), formatted as a code-like block
 *   - file:line location
 *
 * Findings without a `suggestedFix` are still rendered (with an
 * explicit "No suggested fix" placeholder) so the operator never has
 * to wonder whether the panel is empty because of a UI bug.
 */

import * as React from 'react';
import { Wrench, ChevronDown } from 'lucide-react';

import type { ValidationFinding } from '@/lib/api';
import { SeverityBadge } from './SeverityBadge';
import { cn } from '@/lib/utils';

export interface RemediationPanelProps {
  readonly findings: ReadonlyArray<ValidationFinding>;
}

export function RemediationPanel({ findings }: RemediationPanelProps) {
  if (findings.length === 0) {
    return (
      <section
        aria-label="Remediation"
        className="card text-sm text-forge-300"
        data-testid="remediation-empty"
      >
        No remediation actions required.
      </section>
    );
  }

  return (
    <section
      aria-label="Remediation"
      className="card space-y-3 p-0"
      data-testid="remediation-panel"
    >
      <header className="flex items-center gap-2 border-b border-forge-800 px-4 py-3">
        <Wrench className="h-4 w-4 text-brand-400" aria-hidden={true} />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-forge-200">
          Suggested fixes
        </h2>
      </header>

      <ul className="divide-y divide-forge-800">
        {findings.map((f) => (
          <RemediationItem key={f.id} finding={f} />
        ))}
      </ul>
    </section>
  );
}

interface RemediationItemProps {
  readonly finding: ValidationFinding;
}

function RemediationItem({ finding }: RemediationItemProps) {
  const f = finding;
  const [open, setOpen] = React.useState<boolean>(false);
  return (
    <li
      className="px-4 py-3"
      data-testid="remediation-item"
      data-finding-id={f.id}
      data-severity={f.severity}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 text-left"
        data-testid="remediation-toggle"
        aria-expanded={open}
      >
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={f.severity} />
            <span className="font-mono text-[11px] uppercase tracking-wider text-forge-300">
              {f.ruleId}
            </span>
          </div>
          <p
            className="text-sm font-medium text-forge-50"
            data-testid="remediation-title"
          >
            {f.title}
          </p>
          <p className="font-mono text-xs text-forge-300">
            {f.location.filePath}
            {f.location.line !== undefined ? `:${f.location.line}` : ''}
          </p>
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-forge-400 transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden={true}
        />
      </button>

      {open ? (
        <div className="mt-3 space-y-2" data-testid="remediation-body">
          <p className="text-xs text-forge-300">{f.message}</p>
          <pre
            className="overflow-x-auto rounded-sm border border-forge-800 bg-forge-950/70 p-3 font-mono text-xs text-forge-100"
            data-testid="remediation-fix"
          >
            {f.suggestedFix ?? '// No suggested fix recorded for this finding.'}
          </pre>
        </div>
      ) : null}
    </li>
  );
}