'use client';

import * as React from 'react';
import { Wrench } from 'lucide-react';

import { cn } from '@/lib/utils';
import { toneClasses, type StatusTone } from '@/lib/design-system/status';

/**
 * Tool-call card — surfaces one model-issued tool call with its
 * status, JSON arguments, and result preview.
 *
 * Status colors derive from `toneClasses`, never direct hex literals.
 */
export type ToolCallStatus = 'running' | 'success' | 'failed';

export interface ToolCallCardProps {
  readonly tool: string;
  readonly status: ToolCallStatus;
  readonly args: Readonly<Record<string, unknown>>;
  readonly result?: string;
  readonly durationMs?: number;
}

const STATUS_TONE: Record<ToolCallStatus, StatusTone> = {
  running: 'execution',
  success: 'success',
  failed: 'danger',
};

const STATUS_GLYPH: Record<ToolCallStatus, string> = {
  running: '●',
  success: '✓',
  failed: '✕',
};

const STATUS_LABEL: Record<ToolCallStatus, string> = {
  running: 'Running',
  success: 'Success',
  failed: 'Failed',
};

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ToolCallCard({
  tool,
  status,
  args,
  result,
  durationMs,
}: ToolCallCardProps) {
  const tone = toneClasses[STATUS_TONE[status]];
  const glyph = STATUS_GLYPH[status];
  return (
    <article
      data-testid="tool-call-card"
      data-tool={tool}
      data-status={status}
      className={cn(
        'flex flex-col gap-2 rounded-md border bg-card p-3 shadow-elev-xs',
        'ring-1',
        tone.ring,
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wrench className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono text-13 font-semibold">{tool}</span>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider',
            tone.bg,
            tone.fg,
          )}
        >
          <span aria-hidden="true">{glyph}</span>
          {STATUS_LABEL[status]}
        </span>
      </header>
      <div>
        <p className="mb-1 text-2xs uppercase tracking-wider text-muted-foreground">
          Arguments
        </p>
        <pre
          data-testid="tool-call-args"
          className="max-h-40 overflow-auto rounded-sm border bg-surface p-2 font-mono text-2xs leading-relaxed"
        >
          {safeStringify(args)}
        </pre>
      </div>
      {result !== undefined ? (
        <div>
          <p className="mb-1 text-2xs uppercase tracking-wider text-muted-foreground">
            Result
          </p>
          <pre
            data-testid="tool-call-result"
            className="max-h-40 overflow-auto rounded-sm border bg-surface p-2 font-mono text-2xs leading-relaxed"
          >
            {result}
          </pre>
        </div>
      ) : null}
      {durationMs !== undefined ? (
        <footer className="text-2xs font-mono text-muted-foreground">
          {durationMs}ms
        </footer>
      ) : null}
    </article>
  );
}
