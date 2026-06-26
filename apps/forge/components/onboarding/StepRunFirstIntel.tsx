'use client';

import * as React from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
} from 'recharts';
import { Check, Loader2, PlayCircle, RotateCw, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type IntelState = 'idle' | 'running' | 'done' | 'failed' | 'skipped';

export interface StepRunFirstIntelProps {
  state: IntelState;
  onRun: () => void;
}

/** 5 phases of the first-intel pass — order matters. */
const PHASES: ReadonlyArray<{
  id: string;
  label: string;
  description: string;
}> = [
  { id: 'clone', label: 'Clone', description: 'Shallow clone repos' },
  {
    id: 'detect',
    label: 'Detect',
    description: 'Identify languages & frameworks',
  },
  { id: 'map', label: 'Map', description: 'Build dependency graph' },
  { id: 'scan', label: 'Scan', description: 'Index symbols & APIs' },
  { id: 'summarize', label: 'Summarize', description: 'Generate tenant brief' },
];

/**
 * Step 5 — Run first project intelligence. Recharts radial bar
 * shows overall progress; a checklist tracks each phase as it
 * completes. ETA is computed from the per-phase duration profile.
 */
export function StepRunFirstIntel({ state, onRun }: StepRunFirstIntelProps) {
  // Simulated phase schedule. Real implementation would poll an
  // SSE/WebSocket channel; the mock keeps the UX legible without
  // a backend.
  const PHASE_DURATION_MS = 900;
  const totalDuration = PHASES.length * PHASE_DURATION_MS;

  const [startedAt, setStartedAt] = React.useState<number | null>(null);
  const [now, setNow] = React.useState<number>(Date.now());

  React.useEffect(() => {
    if (state === 'running' && startedAt == null) {
      setStartedAt(Date.now());
    }
    if (state !== 'running') setStartedAt(null);
  }, [state, startedAt]);

  React.useEffect(() => {
    if (state !== 'running') return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [state]);

  const elapsedMs =
    state === 'running' && startedAt != null ? now - startedAt : 0;
  const completedPhases =
    state === 'done'
      ? PHASES.length
      : Math.min(
          PHASES.length,
          Math.floor(elapsedMs / PHASE_DURATION_MS),
        );
  const pct =
    state === 'done'
      ? 100
      : state === 'running'
        ? Math.min(99, Math.round((elapsedMs / totalDuration) * 100))
        : 0;

  const etaSec =
    state === 'running'
      ? Math.max(1, Math.round((totalDuration - elapsedMs) / 1000))
      : state === 'done'
        ? 0
        : Math.round(totalDuration / 1000);

  const radialData = [{ name: 'progress', value: pct, fill: 'var(--accent-primary)' }];

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5 space-y-5"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
      }}
      data-testid="step-run-first-intel"
    >
      <header className="space-y-1">
        <h2
          className="flex items-center gap-2"
          style={{
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--fg-primary)',
          }}
        >
          <Sparkles
            className="h-4 w-4"
            style={{ color: 'var(--accent-violet)' }}
            aria-hidden="true"
          />
          Run first project intelligence
        </h2>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--fg-secondary)',
            lineHeight: 'var(--leading-base)',
          }}
        >
          Kicks off the initial scan to map dependencies, conventions, and
          risks for the selected repos.
        </p>
      </header>

      <div
        className="grid items-center gap-6 md:grid-cols-[180px_1fr]"
        data-testid="intel-status"
        data-state={state}
      >
        <div className="relative h-44 w-44 self-center justify-self-center">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              data={radialData}
              startAngle={90}
              endAngle={-270}
              innerRadius="70%"
              outerRadius="100%"
              barSize={10}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <PolarGrid radialLines={false} />
              <RadialBar
                background={{ fill: 'var(--bg-inset)' } as React.ComponentProps<typeof RadialBar>['background']}
                dataKey="value"
                cornerRadius={6}
                fill="url(#intel-gradient)"
              />
              <defs>
                <linearGradient
                  id="intel-gradient"
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="1"
                >
                  <stop offset="0%" stopColor="var(--accent-primary)" />
                  <stop
                    offset="50%"
                    stopColor="var(--accent-violet)"
                  />
                  <stop offset="100%" stopColor="var(--accent-cyan)" />
                </linearGradient>
              </defs>
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span
              className="font-mono"
              style={{
                fontSize: 'var(--text-2xl)',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--fg-primary)',
              }}
              data-testid="intel-pct"
            >
              {pct}%
            </span>
            <span
              style={{
                fontSize: '10px',
                color: 'var(--fg-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.18em',
              }}
            >
              {state === 'running' ? 'Running' : state === 'done' ? 'Complete' : 'Standby'}
            </span>
          </div>
        </div>

        <ol className="space-y-2" data-testid="intel-phases">
          {PHASES.map((phase, idx) => {
            const done = state === 'done' || idx < completedPhases;
            const current =
              state === 'running' && idx === completedPhases;
            return (
              <li
                key={phase.id}
                className={cn(
                  'flex items-center gap-3 rounded-md border p-2 transition-colors',
                  current && 'bg-[var(--bg-inset)]',
                )}
                style={{
                  borderColor: done
                    ? 'rgba(16, 185, 129, 0.30)'
                    : 'var(--border-subtle)',
                  background: done && !current ? 'rgba(16, 185, 129, 0.06)' : undefined,
                }}
                data-testid={`intel-phase-${phase.id}`}
                data-state={done ? 'done' : current ? 'running' : 'pending'}
              >
                <span
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full"
                  style={{
                    background: done
                      ? 'var(--accent-emerald)'
                      : current
                        ? 'var(--accent-primary)'
                        : 'var(--bg-inset)',
                    color: done || current ? 'white' : 'var(--fg-tertiary)',
                  }}
                  aria-hidden="true"
                >
                  {done ? (
                    <Check className="h-3 w-3" />
                  ) : current ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <span className="font-mono text-[10px]">{idx + 1}</span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    style={{
                      fontSize: 'var(--text-sm)',
                      fontWeight: 'var(--font-weight-medium)',
                      color: 'var(--fg-primary)',
                    }}
                  >
                    {phase.label}
                  </p>
                  <p
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--fg-tertiary)',
                    }}
                  >
                    {phase.description}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div
        className="flex items-center justify-between gap-2 rounded-md border p-3"
        style={{
          borderColor: 'var(--border-subtle)',
          background: 'var(--bg-inset)',
          fontSize: 'var(--text-xs)',
          color: 'var(--fg-secondary)',
        }}
      >
        <span className="inline-flex items-center gap-2">
          {state === 'idle' ? (
            <>
              <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Ready to start. First pass takes ~{Math.round(totalDuration / 1000)}s.
            </>
          ) : null}
          {state === 'running' ? (
            <>
              <Loader2
                className="h-3.5 w-3.5 animate-spin"
                aria-hidden="true"
              />
              Running — ETA {etaSec}s
            </>
          ) : null}
          {state === 'done' ? (
            <>
              <Check
                className="h-3.5 w-3.5"
                style={{ color: 'var(--accent-emerald)' }}
                aria-hidden="true"
              />
              Done. 4 repos scanned, 6 stacks confirmed, 0 anomalies.
            </>
          ) : null}
          {state === 'failed' ? (
            <>
              <RotateCw
                className="h-3.5 w-3.5"
                style={{ color: 'var(--accent-rose)' }}
                aria-hidden="true"
              />
              Failed — retry from the dashboard.
            </>
          ) : null}
          {state === 'skipped' ? (
            <>
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
              Skipped — you can run intel later from the dashboard.
            </>
          ) : null}
        </span>
        <Button
          size="sm"
          onClick={onRun}
          disabled={state === 'running' || state === 'done'}
          data-testid="intel-run"
        >
          <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {state === 'running'
            ? 'Running…'
            : state === 'done'
              ? 'Complete'
              : 'Run first pass'}
        </Button>
      </div>
    </section>
  );
}