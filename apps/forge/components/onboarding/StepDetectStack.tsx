'use client';

import * as React from 'react';
import { Check, ChevronDown, Layers } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { DetectedStack, SampleRepo } from '@/lib/onboarding/data';

const CONFIDENCE_TONE: Record<
  DetectedStack['confidence'],
  { bg: string; fg: string; border: string; label: string }
> = {
  high: {
    bg: 'rgba(16, 185, 129, 0.10)',
    fg: 'var(--accent-emerald)',
    border: 'rgba(16, 185, 129, 0.30)',
    label: 'High',
  },
  medium: {
    bg: 'rgba(245, 158, 11, 0.10)',
    fg: 'var(--accent-amber)',
    border: 'rgba(245, 158, 11, 0.30)',
    label: 'Medium',
  },
  low: {
    bg: 'rgba(244, 63, 94, 0.10)',
    fg: 'var(--accent-rose)',
    border: 'rgba(244, 63, 94, 0.30)',
    label: 'Low',
  },
};

export interface StepDetectStackProps {
  stacks: ReadonlyArray<DetectedStack>;
  repos: ReadonlyArray<SampleRepo>;
  accepted: ReadonlyArray<string>;
  onAccept: (next: string[]) => void;
  /** Optional override map: stackId -> language override. */
  overrides?: Record<string, string>;
  onOverride?: (stackId: string, language: string) => void;
}

/**
 * Step 3 — Stack detection. Each row shows the detected language /
 * framework, a confidence badge, and an override dropdown so users
 * can correct the heuristic before continuing.
 */
export function StepDetectStack({
  stacks,
  repos,
  accepted,
  onAccept,
  overrides,
  onOverride,
}: StepDetectStackProps) {
  const repoById = React.useMemo(
    () => new Map(repos.map((r) => [r.id, r])),
    [repos],
  );

  const toggle = (id: string) => {
    if (accepted.includes(id)) {
      onAccept(accepted.filter((s) => s !== id));
    } else {
      onAccept([...accepted, id]);
    }
  };

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5 space-y-5"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
      }}
      data-testid="step-detect-stack"
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
          <Layers className="h-4 w-4" aria-hidden="true" />
          Stack detection
        </h2>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--fg-secondary)',
            lineHeight: 'var(--leading-base)',
          }}
        >
          Confirm the languages, frameworks, and tooling we detected.{' '}
          {accepted.length > 0
            ? `${accepted.length} of ${stacks.length} confirmed.`
            : null}
        </p>
      </header>

      {stacks.length === 0 ? (
        <EmptyStacks />
      ) : (
        <ul role="list" className="space-y-2" data-testid="stack-list">
          {stacks.map((s) => {
            const active = accepted.includes(s.id);
            const repo = repoById.get(s.repoId);
            const tone = CONFIDENCE_TONE[s.confidence];
            const overrideValue = overrides?.[s.id] ?? s.language;
            return (
              <li key={s.id}>
                <div
                  className={cn(
                    'rounded-[var(--radius-md)] border p-3 transition-colors',
                    active && 'shadow-[var(--shadow-glow-primary)]',
                  )}
                  style={{
                    background: 'var(--bg-elevated)',
                    borderColor: active
                      ? 'var(--accent-primary)'
                      : 'var(--border-subtle)',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => toggle(s.id)}
                      aria-pressed={active}
                      className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] rounded-md"
                      data-testid={`stack-item-${s.id}`}
                      data-accepted={String(active)}
                    >
                      <p
                        style={{
                          fontSize: 'var(--text-sm)',
                          fontWeight: 'var(--font-weight-medium)',
                          color: 'var(--fg-primary)',
                        }}
                      >
                        {s.language}
                        {s.framework ? ` · ${s.framework}` : ''}
                      </p>
                      <p
                        className="mt-0.5"
                        style={{
                          fontSize: '10px',
                          color: 'var(--fg-tertiary)',
                        }}
                      >
                        {repo?.url ?? s.repoId}
                        {s.buildTool ? ` · build: ${s.buildTool}` : ''}
                        {s.testFramework
                          ? ` · test: ${s.testFramework}`
                          : ''}
                      </p>
                    </button>
                    <span
                      className="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-medium uppercase tracking-wide"
                      style={{
                        fontSize: '10px',
                        background: tone.bg,
                        color: tone.fg,
                        borderColor: tone.border,
                      }}
                    >
                      {tone.label}
                    </span>
                  </div>

                  <div
                    className="mt-2 flex items-center gap-2 border-t pt-2"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <label
                      htmlFor={`override-${s.id}`}
                      style={{
                        fontSize: '10px',
                        color: 'var(--fg-tertiary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.18em',
                      }}
                    >
                      Override
                    </label>
                    <div className="relative flex-1">
                      <select
                        id={`override-${s.id}`}
                        value={overrideValue}
                        onChange={(e) =>
                          onOverride?.(s.id, e.target.value)
                        }
                        className="w-full appearance-none rounded-md border px-2 py-1 pr-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                        style={{
                          fontSize: 'var(--text-xs)',
                          background: 'var(--bg-inset)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--fg-primary)',
                          fontFamily: 'var(--font-mono)',
                        }}
                        data-testid={`stack-override-${s.id}`}
                      >
                        <option value={s.language}>
                          {s.language} (detected)
                        </option>
                        <option value="TypeScript">TypeScript</option>
                        <option value="JavaScript">JavaScript</option>
                        <option value="Python">Python</option>
                        <option value="Go">Go</option>
                        <option value="Rust">Rust</option>
                        <option value="Java">Java</option>
                        <option value="Kotlin">Kotlin</option>
                        <option value="Ruby">Ruby</option>
                        <option value="C#">C#</option>
                      </select>
                      <ChevronDown
                        className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2"
                        style={{ color: 'var(--fg-tertiary)' }}
                        aria-hidden="true"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle(s.id)}
                      aria-pressed={active}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                      )}
                      style={{
                        background: active
                          ? 'rgba(16, 185, 129, 0.10)'
                          : 'transparent',
                        borderColor: active
                          ? 'rgba(16, 185, 129, 0.30)'
                          : 'var(--border-subtle)',
                        color: active
                          ? 'var(--accent-emerald)'
                          : 'var(--fg-secondary)',
                      }}
                    >
                      {active ? (
                        <>
                          <Check
                            className="h-3 w-3"
                            aria-hidden="true"
                          />
                          Accepted
                        </>
                      ) : (
                        'Accept'
                      )}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function EmptyStacks() {
  return (
    <div
      className="rounded-md border border-dashed p-6 text-center"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'var(--bg-inset)',
      }}
      data-testid="stack-empty"
    >
      <p
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--fg-secondary)',
        }}
      >
        No stacks detected yet.
      </p>
      <p
        className="mt-1"
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--fg-tertiary)',
        }}
      >
        Run first intel to populate this list, or add a repo on step 2.
      </p>
    </div>
  );
}