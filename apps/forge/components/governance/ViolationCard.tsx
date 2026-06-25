/**
 * F-829 Phase C — Single guardrail violation detail card.
 *
 * Used by `/governance/compliance` to render the violation list with
 * severity pills and a sanitized-content summary (the raw PII /
 * injection payload never leaves the LiteLLM Proxy — Rule 6).
 */
'use client';

import * as React from 'react';

export type GuardrailSeverity = 'low' | 'medium' | 'high' | 'critical';
export type GuardrailAction = 'blocked' | 'warned' | 'passed';

export interface ViolationCardProps {
  id: string;
  guardrail_id: string;
  severity: GuardrailSeverity | string;
  action_taken: GuardrailAction | string;
  sanitized_content: string;
  resolved: boolean;
  occurred_at: string;
  onResolve?: (id: string) => void;
  onReopen?: (id: string) => void;
}

const SEVERITY_PILL: Record<string, { tone: string; glyph: string; label: string }> = {
  low: { tone: 'idle', glyph: '○', label: 'low' },
  medium: { tone: 'review', glyph: '◑', label: 'medium' },
  high: { tone: 'warn', glyph: '▲', label: 'high' },
  critical: { tone: 'danger', glyph: '✕', label: 'critical' },
};

const ACTION_PILL: Record<string, { tone: string; glyph: string; label: string }> = {
  blocked: { tone: 'danger', glyph: '✕', label: 'blocked' },
  warned: { tone: 'warn', glyph: '▲', label: 'warned' },
  passed: { tone: 'idle', glyph: '✓', label: 'passed' },
};

function Pill({
  tone,
  glyph,
  label,
  testid,
}: {
  tone: string;
  glyph: string;
  label: string;
  testid?: string;
}) {
  const toneClass: Record<string, string> = {
    idle: 'bg-muted text-muted-foreground',
    review: 'bg-blue-500/15 text-blue-300',
    warn: 'bg-amber-500/15 text-amber-300',
    danger: 'bg-rose-500/15 text-rose-300',
    success: 'bg-emerald-500/15 text-emerald-300',
  };
  return (
    <span
      data-testid={testid}
      data-tone={tone}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
        toneClass[tone] ?? toneClass.idle
      }`}
    >
      <span aria-hidden="true">{glyph}</span>
      <span>{label}</span>
    </span>
  );
}

export function ViolationCard({
  id,
  guardrail_id,
  severity,
  action_taken,
  sanitized_content,
  resolved,
  occurred_at,
  onResolve,
  onReopen,
}: ViolationCardProps) {
  const sev = SEVERITY_PILL[severity] ?? SEVERITY_PILL.medium!;
  const act = ACTION_PILL[action_taken] ?? ACTION_PILL.warned!;

  return (
    <article
      data-testid={`violation-card-${id}`}
      data-severity={severity}
      data-action={action_taken}
      data-resolved={String(resolved)}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-mono text-xs text-muted-foreground">
            guardrail · {guardrail_id}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {occurred_at}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill
            tone={sev.tone}
            glyph={sev.glyph}
            label={sev.label}
            testid={`violation-severity-${id}`}
          />
          <Pill
            tone={act.tone}
            glyph={act.glyph}
            label={act.label}
            testid={`violation-action-${id}`}
          />
          {resolved && (
            <Pill
              tone="success"
              glyph="✓"
              label="resolved"
              testid={`violation-resolved-${id}`}
            />
          )}
        </div>
      </header>
      <p
        className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-background/40 p-2 text-xs text-foreground"
        data-testid={`violation-content-${id}`}
      >
        {sanitized_content || '(no sanitized content)'}
      </p>
      <div role="group" aria-label="Violation actions" className="flex justify-end gap-2">
        {resolved ? (
          onReopen && (
            <button
              type="button"
              onClick={() => onReopen(id)}
              className="rounded-md border border-border bg-background px-3 py-1 text-xs text-foreground hover:bg-accent"
              data-action="reopen"
              data-testid={`violation-reopen-${id}`}
            >
              Reopen
            </button>
          )
        ) : (
          onResolve && (
            <button
              type="button"
              onClick={() => onResolve(id)}
              className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:opacity-90"
              data-action="resolve"
              data-testid={`violation-resolve-${id}`}
            >
              Mark resolved
            </button>
          )
        )}
      </div>
    </article>
  );
}

export default ViolationCard;
