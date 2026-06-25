'use client';

/**
 * F-800 — Tool call card.
 *
 * Collapsible card showing one tool invocation: tool name, args,
 * duration, and success/error status. Used inside `MessageBubble` to
 * render the assistant message's tool-call transcript. Plan 3 ships
 * the read-only variant — pending-state spinners live in Plan 5.
 */

import * as React from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CopilotToolCall } from '@/lib/api/copilot';

export interface ToolCallCardProps {
  toolCall: CopilotToolCall;
}

/**
 * Collapsible tool-call card. Defaults to collapsed; expand to see
 * the full args object as JSON. Status icon shows ✓ (success) or ✗
 * (error) with the tool name + duration.
 */
export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [open, setOpen] = React.useState(false);
  const isError = toolCall.result_status === 'error';

  return (
    <div
      className={cn(
        'rounded-md border bg-card/40 text-xs',
        isError ? 'border-destructive/40' : 'border-border',
      )}
      data-testid="copilot-tool-call"
      data-tool-name={toolCall.tool}
      data-result-status={toolCall.result_status}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto w-full justify-between gap-2 px-2 py-1.5 text-left font-normal hover:bg-transparent"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid={`copilot-tool-call-${toolCall.tool}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {isError ? (
            <XCircle
              className="h-3.5 w-3.5 shrink-0 text-destructive"
              aria-label="Error"
            />
          ) : (
            <CheckCircle2
              className="h-3.5 w-3.5 shrink-0 text-emerald-400"
              aria-label="Success"
            />
          )}
          <code className="font-mono text-xs">{toolCall.tool}</code>
          {toolCall.duration_ms > 0 ? (
            <span className="text-[10px] text-muted-foreground">
              {toolCall.duration_ms}ms
            </span>
          ) : null}
        </span>
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
      </Button>
      {open ? (
        <div className="border-t px-2 py-1.5">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Args
          </p>
          <pre className="overflow-x-auto rounded bg-muted/50 p-1.5 font-mono text-[10px] leading-snug">
            {JSON.stringify(toolCall.args, null, 2)}
          </pre>
          {toolCall.error ? (
            <>
              <p className="mb-1 mt-2 text-[10px] uppercase tracking-wide text-destructive">
                Error
              </p>
              <pre className="overflow-x-auto rounded bg-destructive/10 p-1.5 font-mono text-[10px] leading-snug text-destructive">
                {toolCall.error}
              </pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}