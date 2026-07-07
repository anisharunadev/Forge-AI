'use client';

/**
 * FirstRunOnboarding — Step 26 Fix 14.
 *
 * Replaces the bento content for a brand-new user with a friendly
 * welcome surface. NOT a modal — sits where the bento grid would be.
 *
 * Detection:
 *   - No runs today
 *   - No registered agents
 *   - No alerts
 *   - User hasn't dismissed onboarding (localStorage)
 *
 * Skill influence:
 *   - `style` (Zero Interface) — progressive disclosure, no chrome
 *     until the user asks for it.
 *   - `ux` (Empty States, Onboarding User Freedom) — Skip link always
 *     visible; never locks the user.
 */

import * as React from 'react';
import Link from 'next/link';
import { Bot, GitBranch, Play, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FirstRunOnboardingProps {
  onDismiss: () => void;
  className?: string;
}

export function FirstRunOnboarding({ onDismiss, className }: FirstRunOnboardingProps) {
  return (
    <section
      aria-labelledby="first-run-title"
      data-testid="first-run-onboarding"
      className={cn(
        'relative mx-auto flex max-w-[640px] flex-col items-center justify-center rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-10 text-center',
        className,
      )}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Skip onboarding"
        className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        data-testid="first-run-skip"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span
        aria-hidden="true"
        className="inline-flex h-20 w-20 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--bg-elevated)] text-[var(--accent-cyan)]"
      >
        <Sparkles className="h-10 w-10 animate-pulse" />
      </span>
      <h1
        id="first-run-title"
        className="mt-6 text-[var(--text-3xl)] font-bold tracking-tight text-[var(--fg-primary)]"
      >
        Welcome to Forge
      </h1>
      <p className="mt-3 max-w-[480px] text-[var(--text-sm)] text-[var(--fg-secondary)]">
        Your AI workforce lives here. Register your first agent, run your first
        command, and watch this dashboard come alive with live activity, cost
        insights, and team coordination.
      </p>

      <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        <OnboardStep
          icon={Bot}
          title="Register an agent"
          cta="Start with a template"
          href="/agent-center"
          color="var(--accent-primary)"
          testId="onboard-step-register"
        />
        <OnboardStep
          icon={Play}
          title="Run a command"
          cta="Open Command Center"
          href="/workflow"
          color="var(--accent-cyan)"
          testId="onboard-step-run"
        />
        <OnboardStep
          icon={GitBranch}
          title="Connect your repo"
          cta="Browse connectors"
          href="/connector-center"
          color="var(--accent-emerald)"
          testId="onboard-step-connect"
        />
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="mt-6 text-[11px] text-[var(--fg-tertiary)] underline-offset-2 hover:text-[var(--accent-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        data-testid="first-run-skip-link"
      >
        Skip onboarding
      </button>
    </section>
  );
}

function OnboardStep({
  icon: Icon,
  title,
  cta,
  href,
  color,
  testId,
}: {
  icon: typeof Sparkles;
  title: string;
  cta: string;
  href: string;
  color: string;
  testId: string;
}) {
  return (
    <article
      className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 text-left"
      data-testid={testId}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md"
        style={{ background: `${color}1A`, color }}
      >
        <Icon className="h-5 w-5" />
      </span>
      <h2 className="mt-1 text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">{title}</h2>
      <Button asChild size="sm" className="mt-auto w-full">
        <Link href={href}>{cta}</Link>
      </Button>
    </article>
  );
}