'use client';

/**
 * `<OneClickPipelineDrawer>` — Step 28.
 *
 * Live progress drawer for the "🚀 Send to build pipeline" flow.
 * Renders the four pipeline steps with state transitions:
 *   pending → running → success (or failed)
 *
 * Drives a `setInterval` mock — real progress comes from the
 * orchestrator via SSE in a follow-up.
 */

import * as React from 'react';
import { CheckCircle2, CircleAlert, Loader2, Rocket, X } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  buildInitialPipelineRun,
  type PipelineRunStep,
  type PipelineRunStepState,
} from '@/lib/ideation/pipeline-data';
import type { Idea } from '@/lib/ideation/data';

function stateIcon(state: PipelineRunStepState): React.ReactNode {
  if (state === 'success') return <CheckCircle2 className="h-4 w-4 text-[var(--accent-emerald)]" aria-hidden="true" />;
  if (state === 'running') return <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-cyan)]" aria-hidden="true" />;
  if (state === 'failed') return <CircleAlert className="h-4 w-4 text-[var(--accent-rose)]" aria-hidden="true" />;
  return <span className="h-2 w-2 rounded-full bg-[var(--fg-muted)]" aria-hidden="true" />;
}

function stateLabel(state: PipelineRunStepState): string {
  switch (state) {
    case 'pending':
      return 'Pending';
    case 'running':
      return 'Running…';
    case 'success':
      return 'Success';
    case 'failed':
      return 'Failed';
  }
}

export interface OneClickPipelineDrawerProps {
  readonly idea: Idea | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function OneClickPipelineDrawer({ idea, open, onOpenChange }: OneClickPipelineDrawerProps) {
  const [steps, setSteps] = React.useState<PipelineRunStep[]>([]);
  const [running, setRunning] = React.useState(false);

  // Reset and start whenever a new idea is opened.
  React.useEffect(() => {
    if (!idea || !open) {
      setSteps([]);
      setRunning(false);
      return;
    }
    const initial = buildInitialPipelineRun(idea);
    setSteps(initial);
    setRunning(true);
  }, [idea, open]);

  // Drive the mock run.
  React.useEffect(() => {
    if (!running || steps.length === 0) return;
    const interval = window.setInterval(() => {
      setSteps((curr) => {
        const next = [...curr];
        const idx = next.findIndex((s) => s.state === 'pending' || s.state === 'running');
        if (idx < 0) {
          setRunning(false);
          window.clearInterval(interval);
          return next;
        }
        const step = next[idx];
        if (!step) return next;
        if (step.state === 'pending') {
          next[idx] = { ...step, state: 'running' };
        } else if (step.state === 'running') {
          next[idx] = { ...step, state: 'success' };
        }
        return next;
      });
    }, 1200);
    return () => window.clearInterval(interval);
  }, [running, steps]);

  const allDone = steps.length > 0 && steps.every((s) => s.state === 'success');
  const someFailed = steps.some((s) => s.state === 'failed');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md"
        data-testid="one-click-pipeline-drawer"
      >
        {idea ? (
          <div className="flex h-full flex-col gap-4">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Rocket className="h-5 w-5 text-[var(--accent-amber)]" aria-hidden="true" />
                Build pipeline
              </SheetTitle>
              <SheetDescription>
                <span className="font-mono text-xs">{idea.id}</span> · {idea.title}
              </SheetDescription>
            </SheetHeader>

            <ol className="flex flex-col gap-2" data-testid="pipeline-run-steps">
              {steps.map((s, i) => (
                <li
                  key={s.id}
                  data-testid="pipeline-run-step"
                  data-step-state={s.state}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-[var(--radius-md)] border p-3 transition-colors',
                    s.state === 'running'
                      ? 'border-[var(--accent-cyan)] bg-[rgba(34,211,238,0.06)]'
                      : s.state === 'success'
                        ? 'border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.06)]'
                        : s.state === 'failed'
                          ? 'border-[rgba(244,63,94,0.35)] bg-[rgba(244,63,94,0.06)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                      {i + 1}
                    </span>
                    {stateIcon(s.state)}
                    <div>
                      <div className="text-sm font-medium text-[var(--fg-primary)]">
                        {s.label}
                      </div>
                      {s.detail ? (
                        <div className="text-[10px] text-[var(--fg-tertiary)]">{s.detail}</div>
                      ) : null}
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                    {stateLabel(s.state)}
                  </span>
                </li>
              ))}
            </ol>

            <div className="mt-auto flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
              {allDone ? (
                <div className="flex flex-col gap-1 text-[11px] text-[var(--accent-emerald)]">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Pipeline complete
                  </span>
                  <span className="text-[var(--fg-tertiary)]">
                    PRD · Jira · Confluence · ai agent — all queued.
                  </span>
                </div>
              ) : someFailed ? (
                <div className="flex items-center gap-2 text-[11px] text-[var(--accent-rose)]">
                  <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  A step failed — re-run after the issue is fixed.
                </div>
              ) : (
                <div className="flex items-center gap-2 text-[11px] text-[var(--fg-tertiary)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-cyan)]" aria-hidden="true" />
                  Running pipeline…
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                data-testid="pipeline-run-close"
                className="text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}