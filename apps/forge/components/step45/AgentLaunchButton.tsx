'use client';

/**
 * Step 45 — Package-backed agent launch button.
 *
 * Renders a small "Run PM Agent / Run QA Agent / Run Canary Agent"
 * button that opens a side dialog describing the agent's invocation.
 * Each button resolves to the underlying forge-pi / forge-browser
 * capability.
 *
 * Used by Ideation Center, Stories detail, and the Deploy workflow.
 */

import * as React from 'react';
import { Sparkles, ScanEye, Bird, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type Step45AgentId = 'pm' | 'qa' | 'canary';

interface AgentMeta {
  id: Step45AgentId;
  label: string;
  package: 'forge-pi' | 'forge-browser';
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
  accent: string;
}

const AGENTS: Record<Step45AgentId, AgentMeta> = {
  pm: {
    id: 'pm',
    label: 'Run PM Agent',
    package: 'forge-pi',
    description:
      'Scan customer feedback, market signals, and PRDs to generate a ranked roadmap.',
    Icon: Sparkles,
    accent: 'bg-emerald-500/15 text-emerald-300',
  },
  qa: {
    id: 'qa',
    label: 'Run QA Agent',
    package: 'forge-browser',
    description:
      'Open the PR preview, capture screenshots, run a WCAG accessibility audit, and produce a visual diff report.',
    Icon: ScanEye,
    accent: 'bg-violet-500/15 text-violet-300',
  },
  canary: {
    id: 'canary',
    label: 'Run Canary Agent',
    package: 'forge-browser',
    description:
      'Open the production URL, capture a screenshot, and compare to the pre-deploy baseline.',
    Icon: Bird,
    accent: 'bg-violet-500/15 text-violet-300',
  },
};

export interface AgentLaunchButtonProps {
  agent: Step45AgentId;
  /** Optional callback receiving the chosen agent id. */
  onLaunch?: (id: Step45AgentId) => Promise<void> | void;
  className?: string;
  variant?: 'default' | 'outline' | 'ghost';
}

export function AgentLaunchButton({
  agent,
  onLaunch,
  className,
  variant = 'outline',
}: AgentLaunchButtonProps) {
  const meta = AGENTS[agent];
  const [busy, setBusy] = React.useState(false);
  const handle = async () => {
    if (!onLaunch) return;
    setBusy(true);
    try {
      await onLaunch(agent);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      type="button"
      onClick={handle}
      disabled={busy || !onLaunch}
      variant={variant}
      data-agent={agent}
      data-package={meta.package}
      className={cn('gap-2', className)}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <span
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded',
            meta.accent,
          )}
          aria-hidden
        >
          <meta.Icon className="h-3 w-3" />
        </span>
      )}
      {meta.label}
    </Button>
  );
}

export const STEP45_AGENT_DESCRIPTIONS: Record<Step45AgentId, string> =
  Object.fromEntries(
    Object.entries(AGENTS).map(([k, v]) => [k, v.description]),
  ) as Record<Step45AgentId, string>;