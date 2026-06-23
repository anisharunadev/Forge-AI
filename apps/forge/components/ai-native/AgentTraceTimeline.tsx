'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  agentStateToTone,
  agentStateGlyph,
  agentStatePulse,
  toneClasses,
} from '@/lib/design-system/status';
import type { AgentState } from '@/lib/design-system/forge-color-tokens';

/**
 * Agent trace timeline — vertical list of agent steps in time order.
 *
 * Each row carries a glyph (from `agentStateGlyph`) + a tone (from
 * `agentStateToTone`) + a pulse animation (from `agentStatePulse`) so
 * a user can see at a glance whether the agent is thinking, executing,
 * reviewing, completed, or failed.
 */
export interface AgentTraceStep {
  readonly id: string;
  readonly label: string;
  readonly agent: string;
  readonly state: AgentState;
  readonly durationMs?: number;
  readonly startedAt: string;
}

export interface AgentTraceTimelineProps {
  readonly steps: ReadonlyArray<AgentTraceStep>;
  readonly className?: string;
}

const PULSE_CLASS: Record<ReturnType<typeof agentStatePulse>, string> = {
  none: '',
  slow: 'animate-pulse-agent',
  active: 'animate-spin-execution',
  'fast-to-static': 'animate-pulse',
};

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '';
  if (ms < 1_000) return `${ms}ms`;
  const s = ms / 1_000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.round(s / 60)}m`;
}

export function AgentTraceTimeline({ steps, className }: AgentTraceTimelineProps) {
  if (steps.length === 0) {
    return (
      <div
        className={cn(
          'rounded-md border bg-card p-3 text-13 text-muted-foreground',
          className,
        )}
        data-testid="agent-trace-timeline-empty"
      >
        No agent steps yet.
      </div>
    );
  }
  return (
    <ol
      aria-label="Agent trace timeline"
      data-testid="agent-trace-timeline"
      data-steps={steps.length}
      className={cn(
        'relative ml-3 border-l border-border',
        className,
      )}
    >
      {steps.map((s) => {
        const tone = toneClasses[agentStateToTone(s.state)];
        const glyph = agentStateGlyph(s.state);
        const pulse = PULSE_CLASS[agentStatePulse(s.state)];
        return (
          <li
            key={s.id}
            data-testid="agent-trace-item"
            data-step-id={s.id}
            data-state={s.state}
            className="mb-3 ml-6"
          >
            <span
              aria-hidden="true"
              className={cn(
                'absolute -left-2 inline-flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-[10px]',
                tone.fg,
                pulse,
              )}
            >
              {glyph}
            </span>
            <div
              className={cn(
                'flex flex-col gap-1 rounded-md border bg-card p-3 text-13',
                'ring-1',
                tone.ring,
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{s.label}</span>
                <span className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
                  {s.agent}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs uppercase tracking-wider',
                    tone.bg,
                    tone.fg,
                  )}
                >
                  {s.state}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 font-mono text-2xs text-muted-foreground">
                <span>{new Date(s.startedAt).toLocaleString()}</span>
                {s.durationMs !== undefined ? (
                  <>
                    <span>·</span>
                    <span>{formatDuration(s.durationMs)}</span>
                  </>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
