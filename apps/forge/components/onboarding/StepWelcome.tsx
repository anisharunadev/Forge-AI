'use client';

import * as React from 'react';
import { Bot, Network, PlayCircle, Rocket, ShieldCheck, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface StepWelcomeProps {
  onGetStarted: () => void;
  onUseSample: () => void;
  onSkipSetup: () => void;
  /**
   * Fired when the user clicks "Take a quick tour". The parent
   * (project-onboarding page) lifts the `useOnboardingTour` hook so
   * the overlay can render at the page root. The Step itself does
   * not own the tour state — it only signals that the user asked
   * for it.
   *
   * Added in M9 T-B3.
   */
  onTakeTour?: () => void;
}

const FEATURES: ReadonlyArray<{
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties; 'aria-hidden'?: boolean }>;
  title: string;
  body: string;
}> = [
  {
    icon: Bot,
    title: 'AI Workforce',
    body: 'Register agents like Claude Code, Codex, and Aider — wired to your stack in one click.',
  },
  {
    icon: Network,
    title: 'Knowledge Graph',
    body: 'Auto-build from your codebase, tickets, and docs. Query it through any agent.',
  },
  {
    icon: ShieldCheck,
    title: 'Governance',
    body: 'Configure approval gates, cost ceilings, and audit retention before agents go live.',
  },
];

/**
 * Step 1 — Welcome. Sets the tone for the wizard: a friendly hero
 * with three feature cards and a primary CTA. The "Take a quick
 * tour" affordance was a no-op stub in step-61 — wired up in M9
 * (Track B T-B3) to call `props.onTakeTour` which the page wires
 * to `useOnboardingTour.open()`.
 */
export function StepWelcome({
  onGetStarted,
  onUseSample,
  onSkipSetup,
  onTakeTour,
}: StepWelcomeProps) {
  return (
    <section
      className="space-y-8"
      data-testid="step-welcome"
    >
      <div
        className="rounded-[var(--radius-xl)] p-12 text-center"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div
          className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl"
          style={{
            background: 'var(--bg-base)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-glow-primary)',
          }}
          aria-hidden="true"
        >
          <Rocket
            className="h-10 w-10 animate-bounce"
            style={{
              color: 'var(--accent-cyan)',
              animationDuration: '2.4s',
            }}
          />
        </div>

        <h2
          className="mb-3"
          style={{
            fontSize: 'var(--text-2xl)',
            fontWeight: 'var(--font-weight-bold)',
            color: 'var(--fg-primary)',
            lineHeight: 'var(--leading-2xl)',
          }}
        >
          Welcome to Forge
        </h2>
        <p
          className="mx-auto max-w-xl"
          style={{
            fontSize: 'var(--text-md)',
            color: 'var(--fg-secondary)',
            lineHeight: 'var(--leading-md)',
          }}
        >
          Forge is your AI workforce for the SDLC. In the next 5
          minutes, we&apos;ll set up everything you need to start
          automating your development workflow.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className={cn(
                'rounded-[var(--radius-lg)] p-5 text-left transition-colors',
                'hover:border-[var(--accent-primary)]/40',
              )}
              style={{
                background: 'var(--bg-base)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div
                className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md"
                style={{
                  background: 'var(--bg-inset)',
                  border: '1px solid var(--border-subtle)',
                }}
                aria-hidden="true"
              >
                <Icon
                  className="h-4.5 w-4.5"
                  style={{ color: 'var(--accent-primary)' }}
                />
              </div>
              <p
                className="mb-1"
                style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--font-weight-semibold)',
                  color: 'var(--fg-primary)',
                }}
              >
                {title}
              </p>
              <p
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--fg-tertiary)',
                  lineHeight: 'var(--leading-base)',
                }}
              >
                {body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col items-center justify-center gap-3">
          <Button
            size="lg"
            onClick={onGetStarted}
            className="h-12 min-w-[220px]"
            style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-weight-medium)' }}
            data-testid="welcome-get-started"
          >
            Get started
            <span aria-hidden="true" style={{ marginLeft: 8 }}>→</span>
          </Button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onUseSample}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                'hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              )}
              style={{ color: 'var(--fg-secondary)' }}
              data-testid="welcome-use-sample"
            >
              <Sparkles
                className="h-3 w-3"
                style={{ color: 'var(--accent-violet)' }}
                aria-hidden="true"
              />
              Use sample data
            </button>
            <span
              aria-hidden="true"
              style={{
                color: 'var(--fg-tertiary)',
                fontSize: 10,
              }}
            >
              •
            </span>
            <button
              type="button"
              onClick={onTakeTour ?? onSkipSetup}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                'hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              )}
              style={{ color: 'var(--fg-secondary)' }}
              data-testid="welcome-take-tour"
            >
              <PlayCircle className="h-3 w-3" aria-hidden="true" />
              Take a quick tour
            </button>
          </div>
        </div>
      </div>

      <p
        className="text-center"
        style={{
          fontSize: 10,
          color: 'var(--fg-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
        }}
      >
        Skip setup on top-right of the wizard at any time.
      </p>
    </section>
  );
}